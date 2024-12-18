import * as pako from "pako"
var UPNG = (function () {
  var _bin = {
    nextZero: function (data, p) {
      while (data[p] != 0) p++
      return p
    },
    readUshort: function (buff, p) {
      return (buff[p] << 8) | buff[p + 1]
    },
    writeUshort: function (buff, p, n) {
      buff[p] = (n >> 8) & 255
      buff[p + 1] = n & 255
    },
    readUint: function (buff, p) {
      return (buff[p] * (256 * 256 * 256)) +
        ((buff[p + 1] << 16) | (buff[p + 2] << 8) | buff[p + 3])
    },
    writeUint: function (buff, p, n) {
      buff[p] = (n >> 24) & 255
      buff[p + 1] = (n >> 16) & 255
      buff[p + 2] = (n >> 8) & 255
      buff[p + 3] = n & 255
    },
    readASCII: function (buff, p, l) {
      var s = ""
      for (var i = 0; i < l; i++) s += String.fromCharCode(buff[p + i])
      return s
    },
    writeASCII: function (data, p, s) {
      for (var i = 0; i < s.length; i++) data[p + i] = s.charCodeAt(i)
    },
    readBytes: function (buff, p, l) {
      var arr = []
      for (var i = 0; i < l; i++) arr.push(buff[p + i])
      return arr
    },
    pad: function (n) {
      return n.length < 2 ? "0" + n : n
    },
    readUTF8: function (buff, p, l) {
      var s = "", ns
      for (var i = 0; i < l; i++) s += "%" + _bin.pad(buff[p + i].toString(16))
      try {
        ns = decodeURIComponent(s)
      } catch (e) {
        return _bin.readASCII(buff, p, l)
      }
      return ns
    },
  }
  return {
    _bin: _bin,
  }
})()
;(function () {
  var _bin = UPNG._bin
  var crcLib = {
    table: (function () {
      var tab = new Uint32Array(256)
      for (var n = 0; n < 256; n++) {
        var c = n
        for (var k = 0; k < 8; k++) {
          if (c & 1) c = 0xedb88320 ^ (c >>> 1)
          else c = c >>> 1
        }
        tab[n] = c
      }
      return tab
    })(),
    update: function (c, buf, off, len) {
      for (var i = 0; i < len; i++) {
        c = crcLib.table[(c ^ buf[off + i]) & 0xff] ^ (c >>> 8)
      }
      return c
    },
    crc: function (b, o, l) {
      return crcLib.update(0xffffffff, b, o, l) ^ 0xffffffff
    },
  }
  function encodeLL(bufs, w, h, cc, ac, depth, dels, tabs) {
		var nimg = {  ctype: 0 + (cc==1 ? 0 : 2) + (ac==0 ? 0 : 4),      depth: depth,  frames: []  };
		var bipp = (cc+ac)*depth, bipl = bipp * w;
		for(var i=0; i<bufs.length; i++)
			nimg.frames.push({  rect:{x:0,y:0,width:w,height:h},img:new Uint8Array(bufs[i]), blend:0,
    dispose:1, bpp:Math.ceil(bipp/8), bpl:Math.ceil(bipl/8)  });
		compressPNG(nimg, 0, true);
		var out = _main(nimg, w, h, dels, tabs);
		return out;
	}
  function _main(nimg, w, h, dels, tabs) {
    if (tabs == null) tabs = {}
    var crc = crcLib.crc,
      wUi = _bin.writeUint,
      wUs = _bin.writeUshort,
      wAs = _bin.writeASCII
    var offset = 8
    var leng = 8 + (16 + 5 + 4)
    for (var j = 0; j < nimg.frames.length; j++) {
      var fr = nimg.frames[j]
      leng += fr.cimg.length + 12
      if (j != 0) leng += 4
    }
    leng += 12
    var data = new Uint8Array(leng)
    var wr = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    for (var i = 0; i < 8; i++) data[i] = wr[i]
    wUi(data, offset, 13)
    offset += 4
    wAs(data, offset, "IHDR")
    offset += 4
    wUi(data, offset, w)
    offset += 4
    wUi(data, offset, h)
    offset += 4
    data[offset] = nimg.depth
    offset++ // depth
    data[offset] = nimg.ctype
    offset++ // ctype
    data[offset] = 0
    offset++ // compress
    data[offset] = 0
    offset++ // filter
    data[offset] = 0
    offset++ // interlace
    wUi(data, offset, crc(data, offset - 17, 17))
    offset += 4 // crc
    var fi = 0
    for (var j = 0; j < nimg.frames.length; j++) {
      var fr = nimg.frames[j]
      var imgd = fr.cimg, dl = imgd.length
      wUi(data, offset, dl + (j == 0 ? 0 : 4))
      offset += 4
      var ioff = offset
      wAs(data, offset, (j == 0) ? "IDAT" : "fdAT")
      offset += 4
      if (j != 0) {
        wUi(data, offset, fi++)
        offset += 4
      }
      data.set(imgd, offset)
      offset += dl
      wUi(data, offset, crc(data, ioff, offset - ioff))
      offset += 4 // crc
    }
    wUi(data, offset, 0)
    offset += 4
    wAs(data, offset, "IEND")
    offset += 4
    wUi(data, offset, crc(data, offset - 4, 4))
    offset += 4 // crc
    return data.buffer
  }
  function compressPNG(out, filter, levelZero) {
    for (var i = 0; i < out.frames.length; i++) {
      var frm = out.frames[i], nh = frm.rect.height
      var fdata = new Uint8Array(nh * frm.bpl + nh)
      frm.cimg = _filterZero( frm.img, nh, frm.bpp, frm.bpl, fdata, filter, levelZero,)
    }
  }
  function _filterZero(img, h, bpp, bpl, data, filter, levelZero) {
    var fls = [], ftry = [0, 1, 2, 3, 4]
    if (filter != -1) ftry = [filter]
    else if (h * bpl > 500000 || bpp == 1) ftry = [0]
    var opts
    if (levelZero) opts = { level: 0 }
    for (var i = 0; i < ftry.length; i++) {
      for (var y = 0; y < h; y++) _filterLine(data, img, y, bpl, bpp, ftry[i])
      fls.push(pako.deflate(data, opts))
    }
    var ti, tsize = 1e9
    for (var i = 0; i < fls.length; i++) {
      if (fls[i].length < tsize) {
        ti = i
        tsize = fls[i].length
      }
    }
    return fls[ti]
  }
  function _filterLine(data, img, y, bpl, bpp, type) {
    var i = y * bpl, di = i + y
    data[di] = type
    di++
    data.set(new Uint8Array(img.buffer, i, bpl), di)
  }
  UPNG.encodeLL = encodeLL
})()
export UPNG 
