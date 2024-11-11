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
  function encode(bufs, w, h, ps, dels, tabs, forbidPlte) {
    if (ps == null) ps = 0
    if (forbidPlte == null) forbidPlte = false
    var nimg = compress(bufs, w, h, ps, [
      false,
      false,
      false,
      0,
      forbidPlte,
      false,
    ])
    compressPNG(nimg, -1)
    return _main(nimg, w, h, dels, tabs)
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
      frm.cimg = _filterZero(
        frm.img,
        nh,
        frm.bpp,
        frm.bpl,
        fdata,
        filter,
        levelZero,
      )
    }
  }
  function compress(bufs, w, h, ps, prms)
  {
    var onlyBlend = prms[0], evenCrd = prms[1], forbidPrev = prms[2]
    var ctype = 6, depth = 8, alphaAnd = 255
    for (var j = 0; j < bufs.length; j++) {
      var img = new Uint8Array(bufs[j]), ilen = img.length
      for (var i = 0; i < ilen; i += 4) alphaAnd &= img[i + 3]
    }
    var frms = framize(bufs, w, h, onlyBlend, evenCrd, forbidPrev)
    var cmap = {}, plte = [], inds = []
    for (var j = 0; j < frms.length; j++) {
      var frm = frms[j],
        img32 = new Uint32Array(frm.img.buffer),
        nw = frm.rect.width,
        ilen = img32.length
      var ind = new Uint8Array(ilen)
      inds.push(ind)
      for (var i = 0; i < ilen; i++) {
        var c = img32[i]
        if (i != 0 && c == img32[i - 1]) ind[i] = ind[i - 1]
        else if (i > nw && c == img32[i - nw]) ind[i] = ind[i - nw]
        else {
          var cmc = cmap[c]
          if (cmc == null) {
            cmap[c] = cmc = plte.length
            plte.push(c)
            if (plte.length >= 300) break
          }
          ind[i] = cmc
        }
      }
    }
    var cc = plte.length
    depth = 8
    for (var j = 0; j < frms.length; j++) {
      var frm = frms[j], nw = frm.rect.width
      var cimg = frm.img
      var bpl = 4 * nw, bpp = 4
      frm.img = cimg
      frm.bpl = bpl
      frm.bpp = bpp
    }
    return { ctype: ctype, depth: depth, plte: plte, frames: frms }
  }
  function framize(bufs, w, h, alwaysBlend, evenCrd, forbidPrev) {
    var frms = []
    for (var j = 0; j < bufs.length; j++) {
      var cimg = new Uint8Array(bufs[j]), cimg32 = new Uint32Array(cimg.buffer)
      var nimg
      var nx = 0, ny = 0, nw = w, nh = h, blend = alwaysBlend ? 1 : 0
      if (j != 0) {
        var tlim =
            (forbidPrev || alwaysBlend || j == 1 || frms[j - 2].dispose != 0)
              ? 1
              : 2,
          tstp = 0,
          tarea = 1e9
        for (var it = 0; it < tlim; it++) {
          var p32 = new Uint32Array(bufs[j - 1 - it])
          var mix = w, miy = h, max = -1, may = -1
          for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
              var i = y * w + x
              if (cimg32[i] != p32[i]) {
                if (x < mix) mix = x
                if (x > max) max = x
                if (y < miy) miy = y
                if (y > may) may = y
              }
            }
          }
          if (max == -1) {
            mix =
              miy =
              max =
              may =
                0
          }
          if (evenCrd) {
            if ((mix & 1) == 1) mix--
            if ((miy & 1) == 1) miy--
          }
          var sarea = (max - mix + 1) * (may - miy + 1)
          if (sarea < tarea) {
            tarea = sarea
            tstp = it
            nx = mix
            ny = miy
            nw = max - mix + 1
            nh = may - miy + 1
          }
        }
        if (tstp == 1) frms[j - 1].dispose = 2
        nimg = new Uint8Array(nw * nh * 4)
      } else nimg = cimg.slice(0)
      frms.push({
        rect: { x: nx, y: ny, width: nw, height: nh },
        img: nimg,
        blend: blend,
        dispose: 0,
      })
    }
    if (alwaysBlend) {
      for (var j = 0; j < frms.length; j++) {
        var frm = frms[j]
        if (frm.blend == 1) continue
        var r0 = frm.rect, r1 = frms[j - 1].rect
        var miX = Math.min(r0.x, r1.x), miY = Math.min(r0.y, r1.y)
        var maX = Math.max(r0.x + r0.width, r1.x + r1.width),
          maY = Math.max(r0.y + r0.height, r1.y + r1.height)
        var r = { x: miX, y: miY, width: maX - miX, height: maY - miY }
        frms[j - 1].dispose = 1
        if (j - 1 != 0) {
          _updateFrame(bufs, w, h, frms, j - 1, r, evenCrd)
        }
        _updateFrame(bufs, w, h, frms, j, r, evenCrd)
      }
    }
    var area = 0
    if (bufs.length != 1) {
      for (var i = 0; i < frms.length; i++) {
        var frm = frms[i]
        area += frm.rect.width * frm.rect.height
      }
    }
    return frms
  }
  function _updateFrame(bufs, w, h, frms, i, r, evenCrd) {
    var U8 = Uint8Array, U32 = Uint32Array
    var cimg = new U8(bufs[i]), cimg32 = new U32(cimg.buffer)
    var mix = w, miy = h, max = -1, may = -1
    for (var y = 0; y < r.height; y++) {
      for (var x = 0; x < r.width; x++) {
        var cx = r.x + x, cy = r.y + y
        var j = cy * w + cx, cc = cimg32[j]
      }
    }
    if (max == -1) {
      mix =
        miy =
        max =
        may =
          0
    }
    if (evenCrd) {
      if ((mix & 1) == 1) mix--
      if ((miy & 1) == 1) miy--
    }
    r = { x: mix, y: miy, width: max - mix + 1, height: may - miy + 1 }
    var fr = frms[i]
    fr.rect = r
    fr.blend = 1
    fr.img = new Uint8Array(r.width * r.height * 4)
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
  UPNG.encode = encode
  UPNG.encode.compress = compress
})()
export { UPNG }
