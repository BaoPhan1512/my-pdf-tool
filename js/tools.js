// Danh sách công cụ và cách xử lý của từng công cụ
import {
  h, $, PDFDocument, StandardFonts, rgb, degrees, loadPdfLib, saveDoc, pdfBlob, baseName, readBytes,
  openPdfjs, renderPage, canvasToBlob, parseRanges, rangesToPages, zipResults, displaySize, drawImageBox,
  textToPng, canvasPngBytes, rasterizePages, isImage,
} from './core.js';
import { recompressImages } from './compress.js';

export const CATEGORIES = [
  { id: 'organize', name: 'Sắp xếp', icon: 'layout-grid' },
  { id: 'optimize', name: 'Nén', icon: 'minimize-2' },
  { id: 'convert', name: 'Chuyển đổi', icon: 'file-output' },
  { id: 'edit', name: 'Chỉnh sửa', icon: 'pencil' },
  { id: 'sign', name: 'Ký tên', icon: 'pen-tool' },
  { id: 'security', name: 'Bảo mật', icon: 'shield' },
];

// Ô chọn dạng "nút bấm" (segmented)
function seg(name, options, value, onChange) {
  const box = h('div', { class: 'seg', role: 'radiogroup' });
  for (const o of options) {
    box.append(h('button', {
      type: 'button', class: o.value === value ? 'on' : '', role: 'radio', 'aria-checked': String(o.value === value),
      onclick: (e) => { [...box.children].forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-checked', 'false'); }); e.currentTarget.classList.add('on'); e.currentTarget.setAttribute('aria-checked', 'true'); onChange(o.value); },
    }, o.label, o.sub ? h('small', {}, o.sub) : null));
  }
  return box;
}
const field = (label, control, help) => h('div', { class: 'field' }, h('label', { class: 'field-label' }, label), control, help ? h('div', { class: 'help' }, help) : null);
const input = (attrs, onInput) => { const el = h('input', { class: 'input', ...attrs }); el.addEventListener('input', () => onInput(el.type === 'number' || el.type === 'range' ? +el.value : el.type === 'checkbox' ? el.checked : el.value)); return el; };
const check = (label, value, onChange) => { const el = h('input', { type: 'checkbox', checked: value }); el.addEventListener('change', () => onChange(el.checked)); return h('label', { class: 'check' }, el, ' ', label); };
const outName = (file, suffix, ext = 'pdf') => `${baseName(file.name)}${suffix}.${ext}`;

async function copyAll(src) {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, src.getPageIndices());
  pages.forEach((p) => out.addPage(p));
  return out;
}
async function subset(src, indices) {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return out;
}

const POS9 = [
  { value: 'tl', label: '↖' }, { value: 'tc', label: '↑' }, { value: 'tr', label: '↗' },
  { value: 'bl', label: '↙' }, { value: 'bc', label: '↓' }, { value: 'br', label: '↘' },
];
function posGrid(value, onChange) {
  const g = seg('pos', POS9, value, onChange);
  g.classList.add('pos-grid');
  return g;
}

export const TOOLS = [
  /* ============ SẮP XẾP ============ */
  {
    id: 'gop-pdf', name: 'Gộp PDF', desc: 'Ghép nhiều file PDF thành một file duy nhất, sắp xếp thứ tự tùy ý.',
    icon: 'combine', color: '#6d4aff', cat: 'organize', popular: true,
    accept: 'pdf', multiple: true, minFiles: 2, workspace: 'files', action: 'Gộp PDF',
    async run({ files, passwords, progress }) {
      const out = await PDFDocument.create();
      for (let i = 0; i < files.length; i++) {
        progress(i + 1, files.length, `Đang gộp file ${i + 1}/${files.length}`);
        const src = await loadPdfLib(files[i], passwords.get(files[i]));
        (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
      }
      return [{ name: 'da-gop.pdf', blob: pdfBlob(await saveDoc(out)) }];
    },
  },
  {
    id: 'tach-pdf', name: 'Tách PDF', desc: 'Chia một file PDF thành nhiều file theo khoảng trang hoặc từng trang.',
    icon: 'scissors', color: '#7b61ff', cat: 'organize', popular: true,
    accept: 'pdf', workspace: 'single', action: 'Tách PDF',
    defaults: { mode: 'each', ranges: '', every: 2 },
    options(o, ctx) {
      const extra = h('div');
      const draw = () => {
        extra.innerHTML = '';
        if (o.mode === 'ranges') extra.append(field('Khoảng trang (mỗi khoảng thành 1 file)', input({ value: o.ranges, placeholder: 'Ví dụ: 1-3, 4-6, 7', inputmode: 'text' }, (v) => { o.ranges = v; }), `File có ${ctx.pageCount} trang.`));
        if (o.mode === 'every') extra.append(field('Số trang mỗi file', input({ type: 'number', min: 1, max: ctx.pageCount, value: o.every }, (v) => { o.every = v; })));
      };
      draw();
      return h('div', {}, field('Cách tách', seg('mode', [
        { value: 'each', label: 'Mỗi trang 1 file' }, { value: 'ranges', label: 'Theo khoảng trang' }, { value: 'every', label: 'Cứ N trang' },
      ], o.mode, (v) => { o.mode = v; draw(); })), extra);
    },
    async run({ files: [file], opts, password, progress }) {
      const src = await loadPdfLib(file, password);
      const n = src.getPageCount();
      let groups;
      if (opts.mode === 'each') groups = Array.from({ length: n }, (_, i) => [i + 1, i + 1]);
      else if (opts.mode === 'every') { const k = Math.max(1, opts.every | 0); groups = []; for (let i = 1; i <= n; i += k) groups.push([i, Math.min(n, i + k - 1)]); }
      else groups = parseRanges(opts.ranges, n);
      const results = [];
      for (let g = 0; g < groups.length; g++) {
        const [a, b] = groups[g];
        progress(g + 1, groups.length, `Đang tạo file ${g + 1}/${groups.length}`);
        const out = await subset(src, Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i));
        results.push({ name: outName(file, a === b ? `-trang-${a}` : `-trang-${a}-${b}`), blob: pdfBlob(await saveDoc(out)) });
      }
      return results.length > 1 ? [await zipResults(results, outName(file, '-da-tach', 'zip')), ...results] : results;
    },
  },
  {
    id: 'xoa-trang', name: 'Xóa trang PDF', desc: 'Chọn và xóa những trang không cần thiết khỏi file PDF.',
    icon: 'trash-2', color: '#7b61ff', cat: 'organize',
    accept: 'pdf', workspace: 'pages', pageMode: 'select', selectLabel: 'Bấm vào trang muốn XÓA', action: 'Xóa trang đã chọn',
    async run({ files: [file], pages, password }) {
      const del = pages.filter((p) => p.selected).map((p) => p.index);
      if (!del.length) throw new Error('Bạn chưa chọn trang nào để xóa');
      if (del.length === pages.length) throw new Error('Không thể xóa tất cả các trang');
      const src = await loadPdfLib(file, password);
      const out = await subset(src, src.getPageIndices().filter((i) => !del.includes(i)));
      return [{ name: outName(file, '-da-xoa-trang'), blob: pdfBlob(await saveDoc(out)) }];
    },
  },
  {
    id: 'trich-xuat-trang', name: 'Trích xuất trang', desc: 'Lấy ra những trang bạn cần thành một file PDF mới.',
    icon: 'file-output', color: '#7b61ff', cat: 'organize',
    accept: 'pdf', workspace: 'pages', pageMode: 'select', selectLabel: 'Bấm vào trang muốn LẤY RA', action: 'Trích xuất',
    defaults: { separate: false },
    options(o) { return check('Mỗi trang thành một file riêng', o.separate, (v) => { o.separate = v; }); },
    async run({ files: [file], pages, opts, password }) {
      const pick = pages.filter((p) => p.selected).map((p) => p.index);
      if (!pick.length) throw new Error('Bạn chưa chọn trang nào');
      const src = await loadPdfLib(file, password);
      if (!opts.separate) return [{ name: outName(file, '-trich-xuat'), blob: pdfBlob(await saveDoc(await subset(src, pick))) }];
      const results = [];
      for (const i of pick) results.push({ name: outName(file, `-trang-${i + 1}`), blob: pdfBlob(await saveDoc(await subset(src, [i]))) });
      return results.length > 1 ? [await zipResults(results, outName(file, '-trich-xuat', 'zip')), ...results] : results;
    },
  },
  {
    id: 'sap-xep-trang', name: 'Sắp xếp trang', desc: 'Kéo thả để đổi thứ tự trang, xoay hoặc xóa từng trang.',
    icon: 'layout-grid', color: '#7b61ff', cat: 'organize',
    accept: 'pdf', workspace: 'pages', pageMode: 'organize', action: 'Lưu thay đổi',
    async run({ files: [file], pages, password }) {
      const keep = pages.filter((p) => !p.deleted);
      if (!keep.length) throw new Error('Không còn trang nào');
      const src = await loadPdfLib(file, password);
      const out = await subset(src, keep.map((p) => p.index));
      out.getPages().forEach((pg, i) => { if (keep[i].rotate) pg.setRotation(degrees((pg.getRotation().angle + keep[i].rotate) % 360)); });
      return [{ name: outName(file, '-da-sap-xep'), blob: pdfBlob(await saveDoc(out)) }];
    },
  },
  {
    id: 'xoay-pdf', name: 'Xoay PDF', desc: 'Xoay tất cả hoặc từng trang PDF theo chiều bạn muốn.',
    icon: 'rotate-cw', color: '#7b61ff', cat: 'organize',
    accept: 'pdf', workspace: 'pages', pageMode: 'rotate', action: 'Lưu file đã xoay',
    async run({ files: [file], pages, password }) {
      if (!pages.some((p) => p.rotate)) throw new Error('Bạn chưa xoay trang nào. Bấm nút xoay trên trang hoặc "Xoay tất cả".');
      const doc = await loadPdfLib(file, password);
      doc.getPages().forEach((pg, i) => { const r = pages[i].rotate; if (r) pg.setRotation(degrees((pg.getRotation().angle + r) % 360)); });
      return [{ name: outName(file, '-da-xoay'), blob: pdfBlob(await saveDoc(doc)) }];
    },
  },

  /* ============ NÉN ============ */
  {
    id: 'nen-pdf', name: 'Nén PDF', desc: 'Giảm dung lượng file PDF để gửi email, Zalo dễ dàng hơn.',
    icon: 'minimize-2', color: '#e5322d', cat: 'optimize', popular: true,
    accept: 'pdf', workspace: 'single', action: 'Nén PDF',
    defaults: { level: 'medium' },
    options(o) {
      return field('Mức nén', seg('level', [
        { value: 'low', label: 'Nhẹ', sub: 'Chất lượng cao nhất' },
        { value: 'medium', label: 'Khuyến nghị', sub: 'Cân bằng chất lượng & dung lượng' },
        { value: 'high', label: 'Mạnh', sub: 'Nhỏ nhất, ảnh mờ hơn' },
        { value: 'max', label: 'Tối đa', sub: 'Chuyển trang thành ảnh (không copy được chữ)' },
      ], o.level, (v) => { o.level = v; }));
    },
    async run({ files: [file], opts, password, progress }) {
      const original = file.size;
      let bytes;
      if (opts.level === 'max') {
        const doc = await rasterizePages(file, { dpi: 110, quality: 0.6, password, onProgress: (i, n) => progress(i, n, `Đang nén trang ${i}/${n}`) });
        bytes = await saveDoc(doc);
      } else {
        const doc = await loadPdfLib(file, password);
        const lv = { low: { quality: 0.82, maxDim: 2400, flate: false }, medium: { quality: 0.68, maxDim: 1700, flate: true }, high: { quality: 0.5, maxDim: 1200, flate: true } }[opts.level];
        await recompressImages(doc, lv, (i, n) => progress(i, n, `Đang nén ảnh ${i}/${n}`));
        bytes = await saveDoc(doc);
      }
      const better = bytes.length < original;
      const blob = better ? pdfBlob(bytes) : file;
      const pct = Math.round((1 - blob.size / original) * 100);
      return Object.assign([{ name: outName(file, '-da-nen'), blob }], {
        note: better ? `Đã giảm ${pct}% dung lượng.` : 'File này đã được tối ưu sẵn, không thể nén nhỏ hơn ở mức này. Hãy thử mức nén mạnh hơn.',
        sizes: { before: original, after: blob.size },
      });
    },
  },

  /* ============ CHUYỂN ĐỔI ============ */
  {
    id: 'pdf-sang-anh', name: 'PDF sang Ảnh', desc: 'Chuyển từng trang PDF thành ảnh JPG hoặc PNG chất lượng cao.',
    icon: 'image', color: '#f5b400', cat: 'convert', popular: true,
    accept: 'pdf', workspace: 'single', action: 'Chuyển sang ảnh',
    defaults: { format: 'jpg', dpi: 150, ranges: '' },
    options(o, ctx) {
      return h('div', {},
        field('Định dạng', seg('format', [{ value: 'jpg', label: 'JPG', sub: 'Nhẹ, phổ biến' }, { value: 'png', label: 'PNG', sub: 'Sắc nét, nặng hơn' }], o.format, (v) => { o.format = v; })),
        field('Chất lượng', seg('dpi', [{ value: 96, label: 'Thường' }, { value: 150, label: 'Cao' }, { value: 300, label: 'Rất cao (in ấn)' }], o.dpi, (v) => { o.dpi = v; })),
        field('Trang cần chuyển (để trống = tất cả)', input({ value: o.ranges, placeholder: `Ví dụ: 1-3, 5 (file có ${ctx.pageCount} trang)` }, (v) => { o.ranges = v; })));
    },
    async run({ files: [file], opts, password, progress }) {
      const pdf = await openPdfjs(file, password);
      const pages = opts.ranges.trim() ? rangesToPages(parseRanges(opts.ranges, pdf.numPages)) : Array.from({ length: pdf.numPages }, (_, i) => i + 1);
      const results = [];
      const type = opts.format === 'png' ? 'image/png' : 'image/jpeg';
      for (let k = 0; k < pages.length; k++) {
        progress(k + 1, pages.length, `Đang chuyển trang ${pages[k]}`);
        const { canvas } = await renderPage(pdf, pages[k], { scale: opts.dpi / 72 });
        results.push({ name: outName(file, `-trang-${pages[k]}`, opts.format), blob: await canvasToBlob(canvas, type, 0.9) });
        canvas.width = canvas.height = 0;
      }
      return results.length > 1 ? [await zipResults(results, outName(file, '-anh', 'zip')), ...results] : results;
    },
  },
  {
    id: 'anh-sang-pdf', name: 'Ảnh sang PDF', desc: 'Ghép ảnh JPG, PNG từ điện thoại hoặc máy tính thành file PDF.',
    icon: 'images', color: '#f5b400', cat: 'convert', popular: true,
    accept: 'image', multiple: true, workspace: 'files', action: 'Tạo PDF',
    defaults: { size: 'a4', orient: 'auto', margin: 'small' },
    options(o) {
      return h('div', {},
        field('Khổ giấy', seg('size', [{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'fit', label: 'Vừa ảnh' }], o.size, (v) => { o.size = v; })),
        field('Hướng giấy', seg('orient', [{ value: 'auto', label: 'Tự động' }, { value: 'portrait', label: 'Dọc' }, { value: 'landscape', label: 'Ngang' }], o.orient, (v) => { o.orient = v; })),
        field('Lề', seg('margin', [{ value: 'none', label: 'Không lề' }, { value: 'small', label: 'Lề nhỏ' }, { value: 'big', label: 'Lề lớn' }], o.margin, (v) => { o.margin = v; })));
    },
    async run({ files, opts, progress }) {
      const out = await PDFDocument.create();
      const SIZES = { a4: [595.28, 841.89], letter: [612, 792] };
      const M = { none: 0, small: 20, big: 50 }[opts.margin];
      for (let i = 0; i < files.length; i++) {
        progress(i + 1, files.length, `Đang thêm ảnh ${i + 1}/${files.length}`);
        const f = files[i];
        let img;
        const bytes = await readBytes(f);
        if (/jpe?g$/i.test(f.type) || /\.jpe?g$/i.test(f.name)) img = await out.embedJpg(bytes).catch(() => null);
        else if (/png$/i.test(f.type) || /\.png$/i.test(f.name)) img = await out.embedPng(bytes).catch(() => null);
        if (!img) { // webp, gif, bmp... -> chuyển qua canvas
          const bmp = await createImageBitmap(f);
          const c = h('canvas'); c.width = bmp.width; c.height = bmp.height;
          const cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height); cx.drawImage(bmp, 0, 0);
          img = await out.embedJpg(new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.92)).arrayBuffer()));
        }
        const iw = img.width * 0.75, ih = img.height * 0.75; // px -> pt (96 dpi)
        let pw, ph;
        if (opts.size === 'fit') { pw = iw + 2 * M; ph = ih + 2 * M; }
        else {
          [pw, ph] = SIZES[opts.size];
          const land = opts.orient === 'landscape' || (opts.orient === 'auto' && iw > ih);
          if (land) [pw, ph] = [ph, pw];
        }
        const s = Math.min((pw - 2 * M) / iw, (ph - 2 * M) / ih, opts.size === 'fit' ? 1 : Infinity);
        const page = out.addPage([pw, ph]);
        page.drawImage(img, { x: (pw - iw * s) / 2, y: (ph - ih * s) / 2, width: iw * s, height: ih * s });
      }
      return [{ name: files.length === 1 ? outName(files[0], '') : 'anh-sang-pdf.pdf', blob: pdfBlob(await saveDoc(out)) }];
    },
  },
  {
    id: 'pdf-sang-van-ban', name: 'Lấy chữ từ PDF', desc: 'Lấy toàn bộ chữ trong PDF để sao chép, sửa trong Word hoặc dán vào AI tóm tắt / dịch.',
    icon: 'file-text', color: '#2b6cff', cat: 'convert',
    accept: 'pdf', workspace: 'single', action: 'Lấy chữ',
    async run({ files: [file], password, progress }) {
      const pdf = await openPdfjs(file, password);
      const parts = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        progress(i, pdf.numPages, `Đang đọc trang ${i}/${pdf.numPages}`);
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        let line = '', out = '';
        for (const it of tc.items) { line += it.str; if (it.hasEOL) { out += line + '\n'; line = ''; } }
        out += line;
        parts.push(`--- Trang ${i} ---\n${out.trim()}`);
      }
      const text = parts.join('\n\n');
      const empty = text.replace(/--- Trang \d+ ---/g, '').trim().length === 0;
      return Object.assign([{ name: outName(file, '', 'txt'), blob: new Blob([text], { type: 'text/plain;charset=utf-8' }) }], {
        text, note: empty ? 'Không tìm thấy chữ. Có thể đây là bản scan (ảnh chụp), cần công cụ OCR để nhận dạng chữ.' : null,
      });
    },
  },

  /* ============ CHỈNH SỬA ============ */
  {
    id: 'chu-thich-pdf', name: 'Chú thích PDF', desc: 'Thêm chữ, vẽ, tô sáng, đóng khung hoặc che trắng nội dung trên PDF.',
    icon: 'pencil', color: '#14b8a6', cat: 'edit', popular: true,
    accept: 'pdf', workspace: 'editor', editorMode: 'annotate', action: 'Lưu PDF',
    async run({ files: [file], editor, password }) {
      if (!editor.count) throw new Error('Bạn chưa thêm nội dung nào lên trang');
      const doc = await loadPdfLib(file, password);
      await editor.apply(doc);
      return [{ name: outName(file, '-chu-thich'), blob: pdfBlob(await saveDoc(doc)) }];
    },
  },
  {
    id: 'danh-so-trang', name: 'Đánh số trang', desc: 'Thêm số trang vào PDF, chọn vị trí, kiểu hiển thị và cỡ chữ.',
    icon: 'list-ordered', color: '#14b8a6', cat: 'edit',
    accept: 'pdf', workspace: 'single', action: 'Đánh số trang',
    defaults: { pos: 'bc', format: 'n', start: 1, size: 11, skipFirst: false },
    options(o) {
      return h('div', {},
        field('Vị trí', posGrid(o.pos, (v) => { o.pos = v; })),
        field('Kiểu hiển thị', seg('format', [{ value: 'n', label: '1' }, { value: 'page', label: 'Trang 1' }, { value: 'nofn', label: '1 / 10' }, { value: 'pageofn', label: 'Trang 1 / 10' }], o.format, (v) => { o.format = v; })),
        h('div', { class: 'row2' },
          field('Bắt đầu từ số', input({ type: 'number', min: 0, value: o.start }, (v) => { o.start = v; })),
          field('Cỡ chữ', input({ type: 'number', min: 6, max: 48, value: o.size }, (v) => { o.size = v; }))),
        check('Không đánh số trang đầu tiên (trang bìa)', o.skipFirst, (v) => { o.skipFirst = v; }));
    },
    async run({ files: [file], opts, password }) {
      const doc = await loadPdfLib(file, password);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const pages = doc.getPages();
      const total = pages.length - (opts.skipFirst ? 1 : 0);
      pages.forEach((page, i) => {
        if (opts.skipFirst && i === 0) return;
        const n = (opts.start | 0) + i - (opts.skipFirst ? 1 : 0);
        const last = (opts.start | 0) + total - 1;
        const label = { n: `${n}`, page: `Trang ${n}`, nofn: `${n} / ${last}`, pageofn: `Trang ${n} / ${last}` }[opts.format];
        const size = opts.size || 11;
        const tw = font.widthOfTextAtSize(label, size);
        const { w, h: ph } = displaySize(page);
        const m = 24;
        const x = opts.pos[1] === 'l' ? m : opts.pos[1] === 'r' ? w - m - tw : (w - tw) / 2;
        const y = opts.pos[0] === 't' ? m : ph - m - size;
        drawText(page, label, { x, y, size, font });
      });
      return [{ name: outName(file, '-danh-so'), blob: pdfBlob(await saveDoc(doc)) }];
    },
  },
  {
    id: 'watermark-pdf', name: 'Chèn Watermark', desc: 'Đóng dấu chữ hoặc logo mờ lên các trang PDF để bảo vệ bản quyền.',
    icon: 'stamp', color: '#14b8a6', cat: 'edit',
    accept: 'pdf', workspace: 'single', action: 'Chèn watermark',
    defaults: { type: 'text', text: 'BẢN QUYỀN', size: 60, color: '#e53935', opacity: 0.25, rotate: 45, layout: 'center', image: null, imgScale: 40 },
    options(o) {
      const box = h('div');
      const draw = () => {
        box.innerHTML = '';
        if (o.type === 'text') {
          box.append(
            field('Nội dung (có dấu tiếng Việt)', input({ value: o.text, maxlength: 80 }, (v) => { o.text = v; })),
            h('div', { class: 'row2' },
              field('Cỡ chữ', input({ type: 'number', min: 10, max: 200, value: o.size }, (v) => { o.size = v; })),
              field('Màu', input({ type: 'color', value: o.color, class: 'input input-color' }, (v) => { o.color = v; }))));
        } else {
          const name = h('span', { class: 'muted' }, o.image ? o.image.name : 'Chưa chọn ảnh');
          const fi = h('input', { type: 'file', accept: 'image/png,image/jpeg', class: 'input' });
          fi.addEventListener('change', () => { o.image = fi.files[0] || null; name.textContent = o.image?.name || 'Chưa chọn ảnh'; });
          box.append(field('Ảnh / logo (PNG nền trong suốt là đẹp nhất)', fi), field('Kích thước (% chiều rộng trang)', input({ type: 'range', min: 10, max: 100, value: o.imgScale }, (v) => { o.imgScale = v; })));
        }
      };
      draw();
      return h('div', {},
        field('Loại watermark', seg('type', [{ value: 'text', label: 'Chữ' }, { value: 'image', label: 'Ảnh / Logo' }], o.type, (v) => { o.type = v; draw(); })),
        box,
        field('Độ mờ', input({ type: 'range', min: 5, max: 100, value: o.opacity * 100 }, (v) => { o.opacity = v / 100; })),
        field('Góc xoay', seg('rot', [{ value: 0, label: 'Ngang' }, { value: 45, label: 'Chéo 45°' }, { value: 90, label: 'Dọc' }], o.rotate, (v) => { o.rotate = v; })),
        field('Bố cục', seg('layout', [{ value: 'center', label: 'Giữa trang' }, { value: 'tile', label: 'Lặp kín trang' }], o.layout, (v) => { o.layout = v; })));
    },
    async run({ files: [file], opts, password }) {
      const doc = await loadPdfLib(file, password);
      let canvas;
      if (opts.type === 'text') {
        if (!opts.text.trim()) throw new Error('Vui lòng nhập nội dung watermark');
        canvas = textToPng(opts.text, { size: opts.size, color: opts.color, weight: '700', scale: 2 }).canvas;
      } else {
        if (!opts.image) throw new Error('Vui lòng chọn ảnh watermark');
        const bmp = await createImageBitmap(opts.image);
        canvas = h('canvas'); canvas.width = bmp.width; canvas.height = bmp.height; canvas.getContext('2d').drawImage(bmp, 0, 0);
      }
      // Xoay ảnh watermark sẵn trên canvas để đơn giản hóa việc đặt lên trang
      const rad = (opts.rotate * Math.PI) / 180;
      const rw = Math.abs(canvas.width * Math.cos(rad)) + Math.abs(canvas.height * Math.sin(rad));
      const rh = Math.abs(canvas.width * Math.sin(rad)) + Math.abs(canvas.height * Math.cos(rad));
      const rc = h('canvas'); rc.width = Math.ceil(rw); rc.height = Math.ceil(rh);
      const rx = rc.getContext('2d'); rx.translate(rw / 2, rh / 2); rx.rotate(-rad); rx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
      const img = await doc.embedPng(await canvasPngBytes(rc));
      const textScale = opts.type === 'text' ? 0.5 : null; // canvas chữ vẽ ở scale 2
      for (const page of doc.getPages()) {
        const { w, h: ph } = displaySize(page);
        let iw = textScale ? rw * textScale : (w * opts.imgScale) / 100;
        let ih = textScale ? rh * textScale : iw * (rh / rw);
        if (iw > w * 0.95) { ih *= (w * 0.95) / iw; iw = w * 0.95; }
        if (opts.layout === 'center') drawImageBox(page, img, { x: (w - iw) / 2, y: (ph - ih) / 2, w: iw, h: ih }, opts.opacity);
        else {
          const gx = iw * 1.3, gy = ih * 1.6;
          for (let y = -ih / 2, r = 0; y < ph; y += gy, r++) for (let x = (r % 2 ? -gx / 2 : 0); x < w; x += gx) drawImageBox(page, img, { x, y, w: iw, h: ih }, opts.opacity);
        }
      }
      return [{ name: outName(file, '-watermark'), blob: pdfBlob(await saveDoc(doc)) }];
    },
  },
  {
    id: 'cat-le-pdf', name: 'Cắt lề PDF', desc: 'Cắt bớt phần lề trắng hoặc vùng thừa xung quanh trang PDF.',
    icon: 'crop', color: '#14b8a6', cat: 'edit',
    accept: 'pdf', workspace: 'single', preview: 'crop', action: 'Cắt lề',
    defaults: { top: 5, right: 5, bottom: 5, left: 5 },
    options(o, ctx) {
      const upd = () => ctx.updatePreview?.();
      const f = (k, l) => field(l, input({ type: 'number', min: 0, max: 45, step: 0.5, value: o[k] }, (v) => { o[k] = Math.min(45, Math.max(0, v || 0)); upd(); }));
      return h('div', {}, h('div', { class: 'help' }, 'Nhập phần trăm cần cắt bớt ở mỗi cạnh. Vùng mờ trên ảnh xem trước là phần sẽ bị cắt.'),
        h('div', { class: 'row2' }, f('top', 'Trên (%)'), f('bottom', 'Dưới (%)'), f('left', 'Trái (%)'), f('right', 'Phải (%)')));
    },
    async run({ files: [file], opts, password }) {
      if (opts.top + opts.bottom >= 90 || opts.left + opts.right >= 90) throw new Error('Phần cắt quá lớn');
      const doc = await loadPdfLib(file, password);
      for (const page of doc.getPages()) {
        const { w, h: ph } = displaySize(page);
        // Tính theo hướng hiển thị rồi quy đổi sang tọa độ PDF
        const dl = (opts.left / 100) * w, dr = (opts.right / 100) * w, dt = (opts.top / 100) * ph, db = (opts.bottom / 100) * ph;
        const cb = page.getCropBox();
        const r = ((page.getRotation().angle % 360) + 360) % 360;
        const [L, R, T, B] = { 0: [dl, dr, dt, db], 90: [dt, db, dr, dl], 180: [dr, dl, db, dt], 270: [db, dt, dl, dr] }[r];
        const box = [cb.x + L, cb.y + B, cb.width - L - R, cb.height - T - B];
        page.setCropBox(...box);
        page.setMediaBox(...box);
      }
      return [{ name: outName(file, '-da-cat-le'), blob: pdfBlob(await saveDoc(doc)) }];
    },
  },
  {
    id: 'che-thong-tin', name: 'Che thông tin', desc: 'Bôi đen vĩnh viễn số điện thoại, CCCD, số tài khoản... trước khi chia sẻ.',
    icon: 'eraser', color: '#14b8a6', cat: 'edit',
    accept: 'pdf', workspace: 'editor', editorMode: 'redact', action: 'Áp dụng che',
    defaults: { burn: true },
    options(o) { return check('Xóa hẳn nội dung bên dưới (khuyến nghị — trang có ô che sẽ được chuyển thành ảnh)', o.burn, (v) => { o.burn = v; }); },
    async run({ files: [file], editor, opts, password, progress }) {
      if (!editor.count) throw new Error('Bạn chưa vẽ ô che nào');
      const doc = await loadPdfLib(file, password);
      const { pages } = await editor.apply(doc);
      const marked = new File([await saveDoc(doc)], file.name, { type: 'application/pdf' });
      if (!opts.burn) return [{ name: outName(file, '-da-che'), blob: marked }];
      const flat = await rasterizePages(marked, { dpi: 200, quality: 0.85, pages, onProgress: (i, n) => progress(i, n, `Đang xử lý trang ${i}/${n}`) });
      return [{ name: outName(file, '-da-che'), blob: pdfBlob(await saveDoc(flat)) }];
    },
  },

  /* ============ KÝ TÊN ============ */
  {
    id: 'ky-ten-pdf', name: 'Ký tên PDF', desc: 'Vẽ, gõ hoặc tải ảnh chữ ký rồi đặt vào tài liệu PDF.',
    icon: 'pen-tool', color: '#e94bd8', cat: 'sign', popular: true,
    accept: 'pdf', workspace: 'editor', editorMode: 'sign', action: 'Hoàn tất & tải về',
    async run({ files: [file], editor, password }) {
      if (!editor.count) throw new Error('Bạn chưa thêm chữ ký. Bấm "Chữ ký" trên thanh công cụ.');
      const doc = await loadPdfLib(file, password);
      await editor.apply(doc);
      return [{ name: outName(file, '-da-ky'), blob: pdfBlob(await saveDoc(doc)) }];
    },
  },

  /* ============ BẢO MẬT ============ */
  {
    id: 'khoa-pdf', name: 'Khóa PDF', desc: 'Đặt mật khẩu cho file PDF, chỉ người biết mật khẩu mới mở được.',
    icon: 'lock', color: '#e5322d', cat: 'security',
    accept: 'pdf', workspace: 'single', action: 'Khóa PDF',
    defaults: { pw: '', pw2: '', noPrint: false, noCopy: false },
    options(o) {
      return h('div', {},
        field('Mật khẩu', input({ type: 'password', value: o.pw, autocomplete: 'new-password' }, (v) => { o.pw = v; })),
        field('Nhập lại mật khẩu', input({ type: 'password', value: o.pw2, autocomplete: 'new-password' }, (v) => { o.pw2 = v; })),
        check('Không cho phép in', o.noPrint, (v) => { o.noPrint = v; }),
        check('Không cho phép sao chép nội dung', o.noCopy, (v) => { o.noCopy = v; }),
        h('div', { class: 'help warn' }, 'Hãy ghi nhớ mật khẩu. Nếu quên, không ai có thể mở lại file.'));
    },
    async run({ files: [file], opts, password }) {
      if (opts.pw.length < 4) throw new Error('Mật khẩu cần ít nhất 4 ký tự');
      if (opts.pw !== opts.pw2) throw new Error('Hai mật khẩu không khớp nhau');
      const src = await loadPdfLib(file, password);
      const doc = password ? await copyAll(src) : src;
      doc.encrypt({
        userPassword: opts.pw, ownerPassword: opts.pw + '#owner' + Math.random().toString(36).slice(2),
        permissions: { printing: opts.noPrint ? undefined : 'highResolution', copying: !opts.noCopy, modifying: false, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: false },
      });
      return [{ name: outName(file, '-da-khoa'), blob: pdfBlob(await doc.save({ useObjectStreams: false })) }];
    },
  },
  {
    id: 'mo-khoa-pdf', name: 'Mở khóa PDF', desc: 'Gỡ mật khẩu khỏi file PDF (bạn cần biết mật khẩu hiện tại).',
    icon: 'lock-open', color: '#e5322d', cat: 'security',
    accept: 'pdf', workspace: 'single', action: 'Mở khóa PDF', allowLocked: true,
    defaults: { pw: '' },
    options(o) {
      return field('Mật khẩu hiện tại của file', input({ type: 'password', value: o.pw, autocomplete: 'current-password' }, (v) => { o.pw = v; }),
        'Nếu file chỉ bị hạn chế in/sao chép (mở được không cần mật khẩu), hãy để trống.');
    },
    async run({ files: [file], opts }) {
      const bytes = await readBytes(file);
      let doc;
      try { doc = await PDFDocument.load(bytes, { password: opts.pw || '' }); } catch (e) {
        try { doc = await PDFDocument.load(bytes); return Object.assign([{ name: file.name, blob: file }], { note: 'File này không có mật khẩu.' }); } catch { /* tiếp tục */ }
        throw new Error(opts.pw ? 'Sai mật khẩu, vui lòng thử lại' : 'File này cần mật khẩu để mở. Vui lòng nhập mật khẩu.');
      }
      delete doc.context.trailerInfo.Encrypt;
      let out;
      try { out = await doc.save(); await PDFDocument.load(out); } catch { out = await saveDoc(await copyAll(doc)); }
      return [{ name: outName(file, '-da-mo-khoa'), blob: pdfBlob(out) }];
    },
  },
  {
    id: 'lam-phang-pdf', name: 'Làm phẳng PDF', desc: 'Khóa nội dung biểu mẫu, chú thích để không ai chỉnh sửa được nữa.',
    icon: 'layers', color: '#e5322d', cat: 'security',
    accept: 'pdf', workspace: 'single', action: 'Làm phẳng',
    defaults: { mode: 'forms' },
    options(o) {
      return field('Cách làm phẳng', seg('mode', [
        { value: 'forms', label: 'Chỉ biểu mẫu', sub: 'Giữ chữ sắc nét, copy được' },
        { value: 'all', label: 'Toàn bộ', sub: 'Chuyển trang thành ảnh, không thể sửa' },
      ], o.mode, (v) => { o.mode = v; }));
    },
    async run({ files: [file], opts, password, progress }) {
      if (opts.mode === 'all') {
        const doc = await rasterizePages(file, { dpi: 170, quality: 0.85, password, onProgress: (i, n) => progress(i, n, `Đang xử lý trang ${i}/${n}`) });
        return [{ name: outName(file, '-lam-phang'), blob: pdfBlob(await saveDoc(doc)) }];
      }
      const doc = await loadPdfLib(file, password);
      const form = doc.getForm();
      const n = form.getFields().length;
      if (!n) throw new Error('File này không có ô biểu mẫu nào. Hãy chọn "Toàn bộ" để làm phẳng chú thích và nội dung.');
      try { form.flatten(); } catch { form.flatten({ updateFieldAppearances: false }); }
      return Object.assign([{ name: outName(file, '-lam-phang'), blob: pdfBlob(await saveDoc(doc)) }], { note: `Đã làm phẳng ${n} ô biểu mẫu.` });
    },
  },
];

// Vẽ chữ (ASCII) theo hướng trang đang hiển thị
function drawText(page, text, { x, y, size, font }) {
  const { r } = displaySize(page);
  // x, y: góc trên-trái của dòng chữ theo hướng nhìn; quy đổi điểm gốc (baseline trái)
  const cb = page.getCropBox();
  const dx = x, dy = y + size * 0.8;
  let px, py;
  switch (r) {
    case 90: px = cb.x + dy; py = cb.y + dx; break;
    case 180: px = cb.x + cb.width - dx; py = cb.y + dy; break;
    case 270: px = cb.x + cb.width - dy; py = cb.y + cb.height - dx; break;
    default: px = cb.x + dx; py = cb.y + cb.height - dy;
  }
  page.drawText(text, { x: px, y: py, size, font, color: rgb(0.15, 0.15, 0.15), rotate: degrees(r) });
}

export const GUIDES = [
  {
    id: 'word-sang-pdf', name: 'Word, Excel, PowerPoint sang PDF', icon: 'file-type', color: '#2b6cff', cat: 'convert',
    desc: 'Cách chuyển file Office sang PDF miễn phí, chất lượng tốt nhất.',
    html: `
      <p>Việc chuyển file Office sang PDF cần chính phần mềm Office để giữ nguyên bố cục, phông chữ. Cách tốt nhất và <b>miễn phí</b>:</p>
      <h3>Trên máy tính có Microsoft Office</h3>
      <ol><li>Mở file Word / Excel / PowerPoint.</li><li>Bấm <b>File (Tệp)</b> → <b>Save As (Lưu dưới dạng)</b>.</li><li>Ở ô định dạng chọn <b>PDF</b> → <b>Save (Lưu)</b>.</li></ol>
      <h3>Không có Office</h3>
      <ol><li>Tải <a href="https://vi.libreoffice.org/" target="_blank" rel="noopener">LibreOffice</a> (miễn phí, tiếng Việt).</li><li>Mở file → <b>Tệp</b> → <b>Xuất ra PDF</b>.</li></ol>
      <h3>Trên điện thoại</h3>
      <ol><li>Mở file bằng Google Docs / Google Sheets / Word trên điện thoại.</li><li>Chọn <b>Chia sẻ & xuất</b> → <b>Lưu dưới dạng / In</b> → <b>PDF</b>.</li></ol>
      <h3>PDF sang Word</h3>
      <p>Dùng công cụ <a href="#/pdf-sang-van-ban">Lấy chữ từ PDF</a> để sao chép chữ vào Word. Hoặc mở PDF bằng <b>Microsoft Word</b> (File → Open) hoặc <b>Google Docs</b> (tải lên Drive → Mở bằng Google Docs): cả hai đều tự chuyển PDF thành văn bản sửa được, miễn phí.</p>`,
  },
  {
    id: 'ai-pdf', name: 'Tóm tắt, dịch, hỏi đáp PDF bằng AI', icon: 'sparkles', color: '#2b6cff', cat: 'convert',
    desc: 'Dùng AI miễn phí để tóm tắt, dịch hoặc hỏi đáp nội dung PDF.',
    html: `
      <p>Các tính năng AI cần máy chủ trả phí theo từng lượt dùng, nên web này hướng dẫn bạn dùng AI <b>miễn phí</b> có sẵn:</p>
      <ol>
        <li>Mở công cụ <a href="#/pdf-sang-van-ban">Lấy chữ từ PDF</a>, chọn file, bấm <b>Lấy chữ</b>, rồi bấm <b>Sao chép</b>.</li>
        <li>Mở một trợ lý AI miễn phí: <a href="https://claude.ai" target="_blank" rel="noopener">Claude</a>, <a href="https://gemini.google.com" target="_blank" rel="noopener">Gemini</a> hoặc <a href="https://chatgpt.com" target="_blank" rel="noopener">ChatGPT</a>.</li>
        <li>Dán chữ vào và gõ yêu cầu, ví dụ: <i>"Tóm tắt tài liệu này thành 5 ý chính"</i>, <i>"Dịch sang tiếng Anh"</i>, <i>"Tài liệu này nói gì về thời hạn hợp đồng?"</i>.</li>
      </ol>
      <p>Mẹo: hầu hết các trợ lý AI trên đều cho phép <b>tải thẳng file PDF</b> lên (biểu tượng kẹp giấy / dấu +).</p>
      <p class="help warn">Lưu ý: khi dùng AI, nội dung tài liệu sẽ được gửi lên máy chủ của nhà cung cấp AI. Không nên làm vậy với tài liệu mật.</p>`,
  },
];

export const toolById = (id) => TOOLS.find((t) => t.id === id);
export const guideById = (id) => GUIDES.find((g) => g.id === id);
export { isImage };
