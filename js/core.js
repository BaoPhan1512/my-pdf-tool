// Các hàm dùng chung: đọc/ghi PDF, hiển thị trang, tải file, nén zip...
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
const PDFJS_OPTS = {
  cMapUrl: new URL('../vendor/pdfjs/cmaps/', import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href,
};

export const PDFLib = window.PDFLib;
export const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;

/* ---------- DOM ---------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg, type = 'info', ms = 4000) {
  let box = $('#toasts');
  if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: `toast toast-${type}` }, msg);
  box.append(t);
  setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 300); }, ms);
}

export function modal(title, body, actions = []) {
  return new Promise((resolve) => {
    const close = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const footer = h('div', { class: 'modal-actions' }, actions.map((a) =>
      h('button', { class: `btn ${a.primary ? 'btn-primary' : 'btn-ghost'}`, onclick: () => close(a.value ?? a.label) }, a.label)));
    const overlay = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) close(null); } },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Đóng', onclick: () => close(null), html: '&times;' })),
        h('div', { class: 'modal-body' }, body),
        actions.length ? footer : null));
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
  });
}

/* ---------- File ---------- */
export const readBytes = async (file) => new Uint8Array(await file.arrayBuffer());
export const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
export const isImage = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name);
export const baseName = (name) => name.replace(/\.[^.]+$/, '');

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function pdfBlob(bytes) { return new Blob([bytes], { type: 'application/pdf' }); }

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function zipResults(results, zipName) {
  const zip = new window.JSZip();
  const used = new Set();
  for (const r of results) {
    let n = r.name, i = 1;
    while (used.has(n)) n = r.name.replace(/(\.[^.]+)$/, `-${i++}$1`);
    used.add(n);
    zip.file(n, r.blob);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  return { name: zipName, blob };
}

/* ---------- PDF (pdf-lib) ---------- */
export class PasswordError extends Error {}

export async function loadPdfLib(fileOrBytes, password) {
  const bytes = fileOrBytes instanceof Uint8Array ? fileOrBytes : await readBytes(fileOrBytes);
  try {
    return await PDFDocument.load(bytes, password != null ? { password } : {});
  } catch (e) {
    if (e?.name === 'EncryptedPDFError' || /encrypted/i.test(e?.message || '')) {
      // File chỉ có mật khẩu chủ sở hữu (mở được không cần mật khẩu)
      if (password == null) {
        try { return await PDFDocument.load(bytes, { password: '' }); } catch { /* cần mật khẩu */ }
      }
      throw new PasswordError('PDF này được bảo vệ bằng mật khẩu');
    }
    throw new Error('Không đọc được file PDF. File có thể bị lỗi.');
  }
}

export async function saveDoc(doc) {
  return doc.save({ useObjectStreams: true });
}

/* ---------- PDF (pdf.js) - hiển thị ---------- */
const pdfjsCache = new WeakMap();
export async function openPdfjs(file, password) {
  if (!password && pdfjsCache.has(file)) return pdfjsCache.get(file);
  const data = await readBytes(file);
  const task = pdfjsLib.getDocument({ data, password, ...PDFJS_OPTS });
  const p = task.promise.catch((e) => {
    pdfjsCache.delete(file);
    if (e?.name === 'PasswordException') throw new PasswordError('PDF này được bảo vệ bằng mật khẩu');
    throw new Error('Không đọc được file PDF. File có thể bị lỗi.');
  });
  if (!password) pdfjsCache.set(file, p);
  return p;
}

/** Vẽ một trang lên canvas. width = chiều rộng mong muốn (px CSS) hoặc scale */
export async function renderPage(pdf, pageNum, { width, scale, canvas, background = '#fff' } = {}) {
  const page = await pdf.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const s = scale ?? width / base.width;
  const dpr = canvas ? 1 : 1;
  const viewport = page.getViewport({ scale: s * dpr });
  const c = canvas || document.createElement('canvas');
  c.width = Math.max(1, Math.floor(viewport.width));
  c.height = Math.max(1, Math.floor(viewport.height));
  const ctx = c.getContext('2d');
  ctx.fillStyle = background; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas: c, viewport, page };
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
  return new Promise((res) => canvas.toBlob(res, type, quality));
}

/** Thumbnail nhỏ (dùng cho lưới trang), xếp hàng để không làm treo máy */
let thumbQueue = Promise.resolve();
export function thumbnail(file, pageNum, width = 160, password) {
  const job = thumbQueue.then(async () => {
    const pdf = await openPdfjs(file, password);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const { canvas } = await renderPage(pdf, pageNum, { width: width * ratio });
    canvas.style.width = '100%';
    return canvas;
  });
  thumbQueue = job.catch(() => {});
  return job;
}

/* ---------- Phân tích khoảng trang: "1-3, 5, 8-" ---------- */
export function parseRanges(text, total) {
  const out = [];
  const parts = String(text).replace(/\s+/g, '').split(/[,;]/).filter(Boolean);
  if (!parts.length) throw new Error('Vui lòng nhập số trang, ví dụ: 1-3, 5');
  for (const p of parts) {
    const m = p.match(/^(\d*)-(\d*)$/) || p.match(/^(\d+)$/);
    if (!m) throw new Error(`Không hiểu "${p}". Ví dụ đúng: 1-3, 5, 8-10`);
    let a, b;
    if (m.length === 3) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : total; } else { a = b = +m[1]; }
    if (a < 1 || b > total || a > b) throw new Error(`Khoảng "${p}" không hợp lệ (file có ${total} trang)`);
    out.push([a, b]);
  }
  return out;
}
export const rangesToPages = (ranges) => [...new Set(ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i)))];

/* ---------- Đặt nội dung lên trang (tính cả trang bị xoay) ----------
 * box: {x, y, w, h} tính bằng point, gốc ở góc trên-trái của trang như người dùng nhìn thấy */
export function displaySize(page) {
  const { width, height } = page.getCropBox();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  return r % 180 === 0 ? { w: width, h: height, r } : { w: height, h: width, r };
}
export function displayToPdf(page, dx, dy) {
  const cb = page.getCropBox();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  switch (r) {
    case 90: return { x: cb.x + dy, y: cb.y + dx };
    case 180: return { x: cb.x + cb.width - dx, y: cb.y + dy };
    case 270: return { x: cb.x + cb.width - dy, y: cb.y + cb.height - dx };
    default: return { x: cb.x + dx, y: cb.y + cb.height - dy };
  }
}
export function drawImageBox(page, image, box, opacity = 1) {
  const { r } = displaySize(page);
  const p = displayToPdf(page, box.x, box.y + box.h);
  page.drawImage(image, { x: p.x, y: p.y, width: box.w, height: box.h, rotate: degrees(r), opacity });
}
export function drawRectBox(page, box, opts) {
  const { r } = displaySize(page);
  const p = displayToPdf(page, box.x, box.y + box.h);
  page.drawRectangle({ x: p.x, y: p.y, width: box.w, height: box.h, rotate: degrees(r), ...opts });
}

/* ---------- Chữ tiếng Việt -> ảnh PNG (để không cần nhúng font) ---------- */
export function textToPng(text, { size = 48, color = '#000', font = 'Arial, Helvetica, sans-serif', weight = '600', scale = 3, padding = 0.15 } = {}) {
  const lines = String(text).split('\n');
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const fontStr = `${weight} ${size * scale}px ${font}`;
  ctx.font = fontStr;
  const lineH = size * scale * 1.25;
  const pad = size * scale * padding;
  const w = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
  c.width = Math.ceil(w + pad * 2);
  c.height = Math.ceil(lineH * lines.length + pad * 2);
  ctx.font = fontStr; ctx.fillStyle = color; ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, pad, pad + lineH * (i + 0.5)));
  return { canvas: c, width: c.width / scale, height: c.height / scale };
}
export async function canvasPngBytes(canvas) {
  const blob = await canvasToBlob(canvas, 'image/png');
  return new Uint8Array(await blob.arrayBuffer());
}

/* ---------- Chuyển trang thành ảnh rồi dựng lại PDF (nén mạnh / làm phẳng / che thông tin) ---------- */
export async function rasterizePages(file, { dpi = 150, quality = 0.75, pages = null, password, onProgress } = {}) {
  const pdf = await openPdfjs(file, password);
  const src = await loadPdfLib(file, password);
  const out = await PDFDocument.create();
  const total = pdf.numPages;
  for (let i = 1; i <= total; i++) {
    onProgress?.(i, total);
    if (pages && !pages.includes(i)) {
      const [cp] = await out.copyPages(src, [i - 1]);
      out.addPage(cp);
      continue;
    }
    const { canvas, page } = await renderPage(pdf, i, { scale: dpi / 72 });
    const vp = page.getViewport({ scale: 1 });
    const jpg = await canvasToBlob(canvas, 'image/jpeg', quality);
    const img = await out.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
    const p = out.addPage([vp.width, vp.height]);
    p.drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
    canvas.width = canvas.height = 0;
  }
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { pdfjsLib };
