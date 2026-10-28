// Nén PDF: nén lại các hình ảnh bên trong file (giữ nguyên chữ, vẫn chọn/copy được)
import { PDFLib, canvasToBlob } from './core.js';

const { PDFName, PDFRawStream, PDFNumber, PDFArray, PDFDict, PDFRef } = PDFLib;

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function unPredict(data, width, colors, predictor) {
  if (predictor < 10) return data;
  const bpp = colors, rowLen = width * colors;
  const out = new Uint8Array(rowLen * Math.floor(data.length / (rowLen + 1)));
  let prev = new Uint8Array(rowLen);
  for (let r = 0, i = 0; i + rowLen < data.length + 1 && r * rowLen < out.length; r++) {
    const type = data[i++];
    const row = out.subarray(r * rowLen, (r + 1) * rowLen);
    for (let x = 0; x < rowLen; x++) {
      const raw = data[i++];
      const a = x >= bpp ? row[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v;
      switch (type) {
        case 1: v = raw + a; break;
        case 2: v = raw + b; break;
        case 3: v = raw + ((a + b) >> 1); break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: v = raw;
      }
      row[x] = v & 255;
    }
    prev = row;
  }
  return out;
}

function lookup(ctx, obj) { return obj instanceof PDFRef ? ctx.lookup(obj) : obj; }

function colorComponents(ctx, cs) {
  cs = lookup(ctx, cs);
  if (!cs) return 0;
  if (cs === PDFName.of('DeviceRGB')) return 3;
  if (cs === PDFName.of('DeviceGray')) return 1;
  if (cs instanceof PDFArray && cs.get(0) === PDFName.of('ICCBased')) {
    const s = lookup(ctx, cs.get(1));
    const n = s?.dict?.get(PDFName.of('N'));
    return n instanceof PDFNumber ? n.asNumber() : 0;
  }
  return 0;
}

/**
 * level: { quality: 0..1, maxDim: px, flate: bool }
 */
export async function recompressImages(doc, { quality, maxDim, flate }, onProgress) {
  const ctx = doc.context;
  const items = ctx.enumerateIndirectObjects().filter(([, o]) =>
    o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
  let done = 0, changed = 0;
  for (const [ref, stream] of items) {
    onProgress?.(++done, items.length);
    try {
      const d = stream.dict;
      if (d.get(PDFName.of('ImageMask'))?.toString() === 'true') continue;
      if (d.get(PDFName.of('Decode'))) continue;
      if (stream.contents.length < 15_000) continue;
      let filter = lookup(ctx, d.get(PDFName.of('Filter')));
      if (filter instanceof PDFArray) { if (filter.size() !== 1) continue; filter = filter.get(0); }
      const w = lookup(ctx, d.get(PDFName.of('Width')))?.asNumber?.();
      const hgt = lookup(ctx, d.get(PDFName.of('Height')))?.asNumber?.();
      if (!w || !hgt) continue;
      const comps = colorComponents(ctx, d.get(PDFName.of('ColorSpace')));
      let bitmap;
      if (filter === PDFName.of('DCTDecode')) {
        if (comps !== 3 && comps !== 1) continue; // bỏ qua ảnh CMYK
        bitmap = await createImageBitmap(new Blob([stream.contents], { type: 'image/jpeg' }));
      } else if (filter === PDFName.of('FlateDecode') && flate) {
        if (comps !== 3 && comps !== 1) continue;
        const bpc = lookup(ctx, d.get(PDFName.of('BitsPerComponent')))?.asNumber?.();
        if (bpc !== 8) continue;
        const parms = lookup(ctx, d.get(PDFName.of('DecodeParms')));
        const pred = parms instanceof PDFDict ? (lookup(ctx, parms.get(PDFName.of('Predictor')))?.asNumber?.() || 1) : 1;
        if (pred > 1 && pred < 10) continue;
        let raw = await inflate(stream.contents);
        raw = unPredict(raw, w, comps, pred);
        if (raw.length < w * hgt * comps) continue;
        const rgba = new Uint8ClampedArray(w * hgt * 4);
        for (let i = 0, j = 0; i < w * hgt; i++) {
          if (comps === 3) { rgba[j++] = raw[i * 3]; rgba[j++] = raw[i * 3 + 1]; rgba[j++] = raw[i * 3 + 2]; }
          else { const g = raw[i]; rgba[j++] = g; rgba[j++] = g; rgba[j++] = g; }
          rgba[j++] = 255;
        }
        bitmap = await createImageBitmap(new ImageData(rgba, w, hgt));
      } else continue;

      const s = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      const nw = Math.max(1, Math.round(bitmap.width * s)), nh = Math.max(1, Math.round(bitmap.height * s));
      const canvas = document.createElement('canvas');
      canvas.width = nw; canvas.height = nh;
      const c2 = canvas.getContext('2d');
      c2.fillStyle = '#fff'; c2.fillRect(0, 0, nw, nh);
      c2.drawImage(bitmap, 0, 0, nw, nh);
      bitmap.close?.();
      const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      canvas.width = canvas.height = 0;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length >= stream.contents.length * 0.9) continue;

      const nd = d.clone(ctx);
      nd.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
      nd.delete(PDFName.of('DecodeParms'));
      nd.set(PDFName.of('Width'), PDFNumber.of(nw));
      nd.set(PDFName.of('Height'), PDFNumber.of(nh));
      nd.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
      nd.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
      nd.set(PDFName.of('Length'), PDFNumber.of(bytes.length));
      ctx.assign(ref, PDFRawStream.of(nd, bytes));
      changed++;
    } catch (e) {
      console.warn('Bỏ qua 1 ảnh không nén được', e);
    }
  }
  return changed;
}
