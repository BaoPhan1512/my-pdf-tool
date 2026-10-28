// Chuyển PDF sang Word / Excel / PowerPoint, chạy hoàn toàn trên máy người dùng.
// - PDF có chữ: lấy đúng từng ký tự Unicode trong file (tự chuyển phông cũ TCVN3/VNI sang Unicode).
// - PDF scan / ảnh, hoặc trang có chữ bị lỗi mã: nhận dạng chữ tiếng Việt (OCR) bằng Tesseract.
// - Phông chữ đầu ra luôn là phông có sẵn trên Windows/Mac và hỗ trợ đủ tiếng Việt, để không bị lỗi phông.
import { openPdfjs, renderPage, pdfjsLib, baseName } from './core.js';
import { legacyKind, decodeLegacy } from './vn-legacy.js';

const { Util, OPS } = pdfjsLib;
const abs = (p) => new URL(p, location.href).href;

/* ---------- Tải thư viện khi cần ---------- */
const scripts = {};
function loadScript(src) {
  return (scripts[src] ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res;
    s.onerror = () => { delete scripts[src]; rej(new Error('Không tải được thư viện chuyển đổi. Hãy kiểm tra kết nối mạng rồi thử lại.')); };
    document.head.append(s);
  }));
}
const libs = {
  docx: () => loadScript('vendor/office/docx.iife.js').then(() => window.docx),
  xlsx: () => loadScript('vendor/office/xlsx.full.min.js').then(() => window.XLSX),
  pptx: async () => {
    const zip = window.JSZip; // pptxgen tự gắn JSZip của nó, giữ lại bản đang dùng
    await loadScript('vendor/office/pptxgen.bundle.js');
    const P = window.PptxGenJS;
    if (zip) window.JSZip = zip;
    return P;
  },
  tesseract: () => loadScript('vendor/ocr/tesseract.min.js').then(() => window.Tesseract),
};

/* ---------- Phông chữ đầu ra ---------- */
// Chỉ dùng phông có sẵn trên máy và hỗ trợ đầy đủ tiếng Việt
function officeFont(name = '', serifHint = false) {
  const n = name.replace(/^[A-Z]{6}\+/, '');
  const leg = legacyKind(n);
  if (leg) return /time|roman|vni-(times|souvenir|book)/i.test(n) || !/arial|helve|univer|avant|sans/i.test(n) ? 'Times New Roman' : 'Arial';
  if (/courier|cousine|mono|consol/i.test(n)) return 'Courier New';
  if (/calibri|carlito/i.test(n)) return 'Calibri';
  if (/cambria|caladea/i.test(n)) return 'Cambria';
  if (/tahoma/i.test(n)) return 'Tahoma';
  if (/verdana/i.test(n)) return 'Verdana';
  if (/segoe/i.test(n)) return 'Segoe UI';
  if (/times|tinos|roman|georgia|garamond|minion|palatino|book|century|serif(?!.*sans)/i.test(n) && !/sans/i.test(n)) return 'Times New Roman';
  if (/arial|arimo|helvetica|liberationsans|roboto|inter|opensans|noto ?sans|sans/i.test(n)) return 'Arial';
  return serifHint ? 'Times New Roman' : 'Arial';
}

/* ---------- Kiểm tra chữ lấy ra có bị lỗi mã không ---------- */
const BAD = /[�-\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g;
const VN_REAL = /[Ạ-ỹơưđăĐƠƯĂ]/;
const TCVN_HINT = /[µ¸¶·¹»¾¼½Æ©ÇÊÈË®ÌÐÑªÒÕÓÔÖ×ÝØÞßäå«æçé¬êíëìîïñôõøö÷ùþ]/g;

/* ---------- Đọc chữ, ảnh, đường kẻ của một trang PDF ---------- */
const SCALE = 2; // ảnh trang để lấy màu chữ và cắt hình (144 dpi)

async function analyseTextPage(page, canvas) {
  const vp = page.getViewport({ scale: 1 });
  const ops = await page.getOperatorList(); // nạp phông vào commonObjs + lấy vị trí ảnh, đường kẻ
  const tc = await page.getTextContent({ disableNormalization: true }); // giữ nguyên ký tự gốc
  const fonts = {};
  const fontInfo = (id) => {
    if (fonts[id]) return fonts[id];
    const f = page.commonObjs.has(id) ? page.commonObjs.get(id) : null;
    const name = f?.name || '';
    const all = `${name} ${tc.styles[id]?.fontFamily || ''}`;
    return (fonts[id] = {
      name,
      bold: !!f?.bold || !!f?.black || /bold|black|heavy|semibold|demi/i.test(all),
      italic: !!f?.italic || /italic|oblique/i.test(all),
      legacy: legacyKind(name),
      face: officeFont(name, f?.fallbackName === 'serif' || tc.styles[id]?.fontFamily === 'serif'),
      raw: '',
    });
  };

  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue; // khoảng trắng do pdf.js tự chèn: tính lại theo khoảng cách thật
    const t = Util.transform(vp.transform, it.transform);
    const size = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]);
    if (size < 1) continue;
    const fi = fontInfo(it.fontName);
    fi.raw += it.str;
    items.push({ str: it.str, x: t[4], base: t[5], w: Math.abs(it.width), size, fi });
  }
  // Phông cũ TCVN3 nhưng tên phông đã bị đổi: nhận ra qua ký tự đặc trưng
  for (const fi of Object.values(fonts)) {
    if (fi.legacy || VN_REAL.test(fi.raw)) continue;
    const hits = (fi.raw.match(TCVN_HINT) || []).length;
    if (hits >= 3 && hits / fi.raw.replace(/\s/g, '').length > 0.04) fi.legacy = { kind: 'tcvn3', upper: false };
  }
  let legacyUsed = false;
  for (const it of items) {
    if (it.fi.legacy) { it.str = decodeLegacy(it.str, it.fi.legacy); legacyUsed = true; }
    else it.str = it.str.replace(/[\uFB00-\uFB06]/g, (c) => c.normalize('NFKC')); // chữ ghép fi, fl -> f i, f l
    it.str = it.str.normalize('NFC');
  }

  // Ảnh trang để lấy màu chữ
  const ctx = canvas.getContext('2d');
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (const it of items) Object.assign(it, inkColor(px, { x: it.x, y: it.base - it.size * 0.8, w: it.w, h: it.size * 0.95 }));

  const { images, rules } = scanGraphics(ops, vp);
  const all = items.map((i) => i.str).join('');
  const nonSpace = all.replace(/\s/g, '');
  const bad = (nonSpace.match(BAD) || []).length;
  return {
    w: vp.width, h: vp.height, items, images, rules, legacyUsed,
    chars: nonSpace.length, badRatio: nonSpace.length ? bad / nonSpace.length : 0,
  };
}

// Theo dõi ma trận biến đổi để biết vị trí ảnh và đường kẻ bảng trên trang
function scanGraphics(ops, vp) {
  const images = [], rules = [];
  let ctm = vp.transform.slice();
  const stack = [];
  const box = (m, x0, y0, x1, y1) => {
    const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => Util.applyTransform([x, y], m));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], a = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = Util.transform(ctm, a);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (a?.[0]) ctm = Util.transform(ctm, a[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat || fn === OPS.paintImageMaskXObject) {
      images.push(box(ctm, 0, 0, 1, 1));
    } else if (fn === OPS.constructPath) {
      const mm = a?.[2];
      if (mm && mm.length === 4 && Number.isFinite(mm[0])) rules.push(box(ctm, mm[0], mm[1], mm[2], mm[3]));
    }
  }
  return { images, rules };
}

// Màu chữ và màu nền phía sau chữ: màu chiếm nhiều nhất trong khung = nền, màu khác nền nhiều nhất = chữ
function inkColor(img, b) {
  const { data, width, height } = img;
  const x0 = Math.max(0, Math.floor(b.x * SCALE)), y0 = Math.max(0, Math.floor(b.y * SCALE));
  const x1 = Math.min(width, Math.ceil((b.x + b.w) * SCALE)), y1 = Math.min(height, Math.ceil((b.y + b.h) * SCALE));
  const plain = { color: '000000', bg: null };
  if (x1 - x0 < 2 || y1 - y0 < 2) return plain;
  const step = (x1 - x0) * (y1 - y0) > 6000 ? 2 : 1;
  const counts = new Map();
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
    const o = (y * width + x) * 4;
    const k = ((data[o] >> 4) << 8) | ((data[o + 1] >> 4) << 4) | (data[o + 2] >> 4);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let bgK = 0, best = -1;
  for (const [k, v] of counts) if (v > best) { best = v; bgK = k; }
  const bg = [(bgK >> 8) * 16 + 8, ((bgK >> 4) & 15) * 16 + 8, (bgK & 15) * 16 + 8];
  const dist = (o) => Math.abs(data[o] - bg[0]) + Math.abs(data[o + 1] - bg[1]) + Math.abs(data[o + 2] - bg[2]);
  let maxD = 0;
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) maxD = Math.max(maxD, dist((y * width + x) * 4));
  const hex = (c) => c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('').toUpperCase();
  const bgHex = Math.min(...bg) > 225 ? null : hex(bg); // nền trắng -> không cần tô nền
  if (maxD < 90) return { color: '000000', bg: bgHex };
  const sum = [0, 0, 0]; let n = 0;
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
    const o = (y * width + x) * 4;
    if (dist(o) > maxD * 0.75) { sum[0] += data[o]; sum[1] += data[o + 1]; sum[2] += data[o + 2]; n++; }
  }
  const c = sum.map((v) => Math.round(v / Math.max(1, n)));
  if (Math.max(...c) < 80 && Math.max(...c) - Math.min(...c) < 40) return { color: '000000', bg: bgHex }; // gần đen -> đen
  return { color: hex(c), bg: bgHex };
}

/* ---------- Nhận dạng chữ (OCR) ---------- */
let ocrWorker = null;
let ocrProgress = () => {};
async function getOcr() {
  if (ocrWorker) return ocrWorker;
  const T = await libs.tesseract();
  ocrWorker = await T.createWorker('vie', 1, {
    workerPath: abs('vendor/ocr/worker.min.js'),
    corePath: abs('vendor/ocr/core/'),
    langPath: abs('vendor/ocr/lang'),
    gzip: true,
    workerBlobURL: false,
    logger: (m) => { if (m.status === 'recognizing text') ocrProgress(m.progress); },
  }).catch((e) => { ocrWorker = null; throw new Error(`Không khởi động được bộ nhận dạng chữ: ${e?.message || e}`); });
  await ocrWorker.setParameters({ preserve_interword_spaces: '1' });
  return ocrWorker;
}
export async function stopOcr() { const w = ocrWorker; ocrWorker = null; await w?.terminate().catch(() => {}); }

const OCR_DPI = 300;
async function ocrPage(pdf, num, onPct) {
  const { canvas, viewport } = await renderPage(pdf, num, { scale: OCR_DPI / 72 });
  const rules = removeRules(canvas, OCR_DPI / 72);
  const worker = await getOcr();
  ocrProgress = onPct;
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
  ocrProgress = () => {};
  const k = OCR_DPI / 72;
  const items = [];
  let confSum = 0, confN = 0;
  for (const bl of data.blocks || []) for (const para of bl.paragraphs || []) for (const ln of para.lines || []) {
    const words = (ln.words || []).filter((w) => w.text && w.text.trim() && !/^[|¦]+$/.test(w.text.trim())); // bỏ vạch kẻ bảng còn sót
    // dòng có độ tin cậy rất thấp thường là ảnh chụp / hoa văn bị đọc nhầm thành chữ
    if (!words.length || (ln.confidence ?? 100) < 50) continue;
    // cỡ chữ ước lượng từ chiều cao dòng (chữ tiếng Việt có dấu nên dòng cao hơn cỡ chữ)
    // cỡ chữ ước lượng từ chiều cao dòng của Tesseract (dòng toàn chữ hoa cao hơn dòng thường)
    const rh = ln.rowAttributes?.row_height || (ln.bbox.y1 - ln.bbox.y0) * 0.85;
    const caps = ln.text === ln.text.toLocaleUpperCase('vi') && /\p{L}/u.test(ln.text);
    const tallest = Math.max(...words.map((w) => w.bbox.y1 - w.bbox.y0));
    const size = Math.max(5, Math.round(Math.min(rh / 0.92, tallest / 0.9) / k / (caps ? 1.12 : 1)));
    const base = (ln.baseline?.y0 && ln.baseline.y0 > ln.bbox.y0 ? (ln.baseline.y0 + ln.baseline.y1) / 2 : ln.bbox.y1 - (ln.bbox.y1 - ln.bbox.y0) * 0.15) / k;
    for (const w of words) {
      confSum += w.confidence * w.text.length; confN += w.text.length;
      items.push({
        str: w.text.normalize('NFC'), x: w.bbox.x0 / k, base, w: (w.bbox.x1 - w.bbox.x0) / k, size,
        fi: { bold: !!w.is_bold, italic: !!w.is_italic, face: 'Times New Roman' }, color: '000000', bg: null, low: w.confidence < 70, word: true,
      });
    }
  }
  // bản scan: cỡ chữ ước lượng dao động, dòng nào gần cỡ chữ phổ biến thì lấy đúng cỡ đó
  const sz = items.flatMap((it) => Array(it.str.length).fill(it.size)).sort((x, y) => x - y);
  const med = sz[Math.floor(sz.length / 2)];
  if (med) for (const it of items) if (Math.abs(it.size - med) <= med * 0.25) it.size = med;
  const page = { w: viewport.width / k, h: viewport.height / k, items, images: [], rules, ocr: true, conf: confN ? confSum / confN : 0, canvas };
  return page;
}

// Xóa đường kẻ bảng dài trên ảnh scan (đường kẻ làm bộ nhận dạng bỏ sót chữ trong ô)
function removeRules(canvas, k) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  const dark = new Uint8Array(W * H);
  for (let i = 0, o = 0; i < W * H; i++, o += 4) dark[i] = d[o] * 0.3 + d[o + 1] * 0.59 + d[o + 2] * 0.11 < 200 ? 1 : 0;
  const minLen = Math.round(45 * k);
  const kill = new Uint8Array(W * H);
  const rules = [];
  for (let y = 0; y < H; y++) {
    let run = 0;
    for (let x = 0; x <= W; x++) {
      if (x < W && dark[y * W + x]) { run++; continue; }
      if (run >= minLen) {
        for (let j = x - run; j < x; j++) for (let dy = -1; dy <= 1; dy++) if (y + dy >= 0 && y + dy < H) kill[(y + dy) * W + j] = 1;
        rules.push({ x: (x - run) / k, y: y / k, w: run / k, h: 1 / k });
      }
      run = 0;
    }
  }
  for (let x = 0; x < W; x++) {
    let run = 0;
    for (let y = 0; y <= H; y++) {
      if (y < H && dark[y * W + x]) { run++; continue; }
      if (run >= minLen) {
        for (let j = y - run; j < y; j++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && x + dx < W) kill[j * W + x + dx] = 1;
        rules.push({ x: x / k, y: (y - run) / k, w: 1 / k, h: run / k });
      }
      run = 0;
    }
  }
  let any = false;
  for (let i = 0, o = 0; i < W * H; i++, o += 4) if (kill[i]) { d[o] = d[o + 1] = d[o + 2] = 255; any = true; }
  if (any) ctx.putImageData(img, 0, 0);
  return rules;
}

/* ---------- Dựng dòng, đoạn, bảng ---------- */
function buildLines(items) {
  const sorted = [...items].sort((a, b) => a.base - b.base || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    let line = null;
    for (let j = lines.length - 1; j >= 0 && j >= lines.length - 4; j--) {
      const l = lines[j];
      if (Math.abs(l.base - it.base) < Math.max(l.size, it.size) * 0.45) { line = l; break; }
    }
    if (!line) { line = { base: it.base, size: it.size, items: [] }; lines.push(line); }
    line.items.push(it);
    line.size = Math.max(line.size, it.size);
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    // dùng đường chân chữ của chữ to nhất (chữ nhỏ có thể là chỉ số trên/dưới)
    l.base = l.items.reduce((m, i) => (i.size > m.size ? i : m), l.items[0]).base;
    l.segs = [];
    let seg = null, prev = null;
    for (const it of l.items) {
      const gap = prev ? it.x - (prev.x + prev.w) : 0;
      const split = !prev || gap > Math.max(it.size, prev.size) * (prev.word ? 1.6 : 1.3);
      if (split) { seg = { x0: it.x, x1: it.x + it.w, runs: [] }; l.segs.push(seg); }
      else {
        const needSpace = (prev.word || gap > it.size * 0.12) && !/\s$/.test(lastText(seg)) && !/^\s/.test(it.str);
        if (needSpace) addRun(seg, ' ', it);
      }
      addRun(seg, it.str, it);
      seg.x1 = Math.max(seg.x1, it.x + it.w);
      prev = it;
    }
    for (const s of l.segs) {
      const r0 = s.runs[0], rl = s.runs[s.runs.length - 1];
      r0.text = r0.text.replace(/^\s+/, ''); rl.text = rl.text.replace(/\s+$/, '');
      s.runs = s.runs.filter((r) => r.text);
      s.text = s.runs.map((r) => r.text).join('');
    }
    l.segs = l.segs.filter((s) => s.text);
    l.x0 = l.segs[0]?.x0 ?? 0; l.x1 = l.segs[l.segs.length - 1]?.x1 ?? 0;
    l.top = l.base - l.size * 0.9;
  }
  return lines.filter((l) => l.segs.length);
}
const lastText = (seg) => seg.runs[seg.runs.length - 1]?.text || '';
function addRun(seg, text, it) {
  const st = { bold: it.fi.bold, italic: it.fi.italic, face: it.fi.face, size: Math.round(it.size * 2) / 2, color: it.color, bg: it.bg, low: !!it.low };
  const last = seg.runs[seg.runs.length - 1];
  const same = last && last.bold === st.bold && last.italic === st.italic && last.face === st.face && last.size === st.size && last.color === st.color && last.bg === st.bg && last.low === st.low;
  if (same) last.text += text;
  else if (text === ' ' && last) last.text += ' ';
  else seg.runs.push({ text, ...st });
}

// Cột của một nhóm dòng: gộp các khoảng x của các đoạn chữ (chỉ tính dòng có từ 2 đoạn trở lên)
function columnsOf(lines) {
  const iv = lines.filter((l) => l.segs.length > 1).flatMap((l) => l.segs.map((s) => [s.x0, s.x1])).sort((a, b) => a[0] - b[0]);
  const cols = [];
  for (const [a, b] of iv) {
    const c = cols[cols.length - 1];
    if (c && a <= c[1] + 2) c[1] = Math.max(c[1], b); else cols.push([a, b]);
  }
  return cols;
}
function colIndex(cols, s) {
  let best = 0, bestOv = -Infinity;
  cols.forEach(([a, b], i) => {
    const ov = Math.min(b, s.x1) - Math.max(a, s.x0);
    const score = ov > 0 ? ov : -Math.min(Math.abs(s.x0 - a), Math.abs(s.x0 - b)) - 1000;
    if (score > bestOv) { bestOv = score; best = i; }
  });
  return best;
}
function gridRows(lines, cols) {
  return lines.map((l) => {
    const cells = cols.map(() => []);
    for (const s of l.segs) cells[colIndex(cols, s)].push(s);
    return cells;
  });
}

// Chia trang thành các khối: đoạn văn, bảng, ảnh — theo thứ tự từ trên xuống
function layoutPage(pg) {
  const lines = buildLines(pg.items);
  const sizes = lines.flatMap((l) => l.segs.map(() => l.size)).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] || 12;
  const left = lines.length ? Math.min(...lines.map((l) => l.x0)) : 72;
  const textRight = lines.length ? Math.max(...lines.map((l) => l.x1)) : pg.w - 72;
  const right = Math.max(textRight, pg.w * 0.72); // lề phải tham chiếu (trang ít chữ không bị coi là dòng đầy)
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.segs.length > 1) {
      // bảng: các dòng nhiều cột liền nhau (kèm dòng 1 cột nằm trong cột thứ 2 trở đi = chữ xuống dòng trong ô)
      const rows = [l];
      let j = i + 1;
      while (j < lines.length) {
        const n = lines[j], p = rows[rows.length - 1];
        if (n.base - p.base > Math.max(n.size, p.size) * 2.6) break;
        if (n.segs.length > 1) { rows.push(n); j++; continue; }
        const cols = columnsOf(rows);
        if (cols.length > 1 && n.x0 > cols[0][1] + 2) { rows.push(n); j++; continue; }
        break;
      }
      const cols = columnsOf(rows);
      if (rows.filter((r) => r.segs.length > 1).length >= 1 && cols.length > 1) {
        const grid = gridRows(rows, cols);
        // dòng 1 ô nằm ở cột sau -> nối vào hàng trên (chữ xuống dòng trong cùng ô)
        const merged = [];
        rows.forEach((r, k) => {
          const filled = grid[k].filter((c) => c.length).length;
          const prev = merged[merged.length - 1];
          if (prev && filled === 1 && r.base - prev.line.base < r.size * 1.8 && grid[k][0].length === 0) {
            grid[k].forEach((c, ci) => { if (c.length) prev.cells[ci].push({ br: true }, ...c); });
          } else merged.push({ line: r, cells: grid[k] });
        });
        const top = rows[0].top, bottom = rows[rows.length - 1].base + rows[rows.length - 1].size * 0.3;
        const ruled = pg.rules.filter((r) => r.y >= top - 4 && r.y <= bottom + 4 && (r.h < 2.5 || r.w < 2.5)).length >= 2;
        blocks.push({ type: 'table', top, cols, rows: merged, ruled, size: rows[0].size });
        i = j - 1;
        continue;
      }
    }
    blocks.push({ type: 'line', top: l.top, line: l });
  }
  // Ghép các dòng liền nhau thành đoạn văn
  const out = [];
  const startsItem = /^([-–•●▪+*]|\d+(\.\d+)*[.)]|[a-zđ][.)]|[IVXLC]+[.)])\s/i;
  for (const b of blocks) {
    if (b.type !== 'line') { out.push(b); continue; }
    const l = b.line, seg = l.segs[0];
    const prev = out[out.length - 1];
    if (prev?.type === 'para') {
      const pl = prev.lines[prev.lines.length - 1];
      const d = l.base - pl.base;
      const leading = prev.lines.length > 1 ? prev.lead : null;
      const sameStyle = Math.abs(l.size - pl.size) < 1;
      const prevFull = pl.x1 > right - Math.max(pl.size * 6, (right - left) * 0.12);
      const okGap = d > 0 && d < l.size * 1.9 && (leading == null || Math.abs(d - leading) < l.size * 0.35);
      const okIndent = Math.abs(l.x0 - prev.lines[Math.min(1, prev.lines.length - 1)].x0) < l.size * 1.2 || (prev.lines.length === 1 && l.x0 < pl.x0 + l.size * 0.5 && l.x0 >= left - 2);
      if (sameStyle && prevFull && okGap && okIndent && !startsItem.test(seg.text) && !prev.centered) {
        prev.lines.push(l); prev.lead = leading ?? d; continue;
      }
    }
    const width = l.x1 - l.x0;
    const mid = (l.x0 + l.x1) / 2, pageMid = (left + right) / 2;
    const centered = width < (right - left) * 0.85 && (Math.abs(mid - pageMid) < l.size * 1.5 || Math.abs(mid - (left + textRight) / 2) < l.size * 1.2 || Math.abs(mid - pg.w / 2) < l.size * 1.5) && l.x0 > left + l.size * 2;
    const rightAl = !centered && width < (right - left) * 0.6 && Math.abs(l.x1 - right) < l.size && l.x0 > pageMid;
    out.push({ type: 'para', top: l.top, lines: [l], lead: null, centered, rightAl, body });
  }
  for (const p of out) if (p.type === 'para') {
    p.justify = p.lines.length > 2 && p.lines.slice(0, -1).every((l) => right - l.x1 < l.size * 1.5);
  }
  // Ảnh (bỏ ảnh quá nhỏ, ảnh nền phủ cả trang)
  if (!pg.ocr) for (const im of pg.images) {
    const x = Math.max(0, im.x), y = Math.max(0, im.y), w = Math.min(pg.w, im.x + im.w) - x, hh = Math.min(pg.h, im.y + im.h) - y;
    if (w < 12 || hh < 12) continue;
    if (w * hh > pg.w * pg.h * 0.6 && lines.length) continue;
    out.push({ type: 'image', top: y, x, y, w, h: hh });
  }
  out.sort((a, b) => a.top - b.top);
  return { blocks: out, lines, left, right: textRight, body };
}

/* ---------- Đọc toàn bộ file ---------- */
async function analyse(file, password, opts, progress) {
  const pdf = await openPdfjs(file, password);
  const n = pdf.numPages;
  const pages = [];
  const stats = { text: 0, ocr: 0, img: 0, conf: [], legacy: false };
  for (let i = 1; i <= n; i++) {
    progress(i - 1 + 0.05, n, `Đang đọc trang ${i}/${n}`);
    const { canvas, page } = await renderPage(pdf, i, { scale: SCALE });
    let pg = await analyseTextPage(page, canvas);
    const bigImage = pg.images.some((im) => im.w * im.h > pg.w * pg.h * 0.5);
    const needOcr = opts.ocr !== 'never' && (opts.ocr === 'always' || pg.chars < 15 || pg.badRatio > 0.1 || (bigImage && pg.chars < 400));
    if (needOcr) {
      progress(i - 1 + 0.1, n, `Đang nhận dạng chữ trang ${i}/${n} (bản scan)...`);
      try {
        const o = await ocrPage(pdf, i, (p) => progress(i - 1 + 0.1 + p * 0.85, n, `Đang nhận dạng chữ trang ${i}/${n}: ${Math.round(p * 100)}%`));
        o.canvas.width = 0;
        const oChars = o.items.reduce((a, it) => a + it.str.length, 0);
        // trang có ảnh lớn nhưng đã có sẵn lớp chữ đầy đủ: giữ chữ gốc (chính xác hơn)
        const better = opts.ocr === 'always' || pg.chars < 15 || pg.badRatio > 0.1 || oChars > pg.chars * 1.5 + 30;
        // ít chữ đọc được -> trang là ảnh/hình chụp: giữ nguyên ảnh thay vì chữ đọc nhầm
        if (oChars >= 15 && better) pg = o;
      } catch (e) {
        if (pg.chars < 15) throw e;
      }
    }
    pg.canvas = canvas;
    pg.layout = layoutPage(pg);
    // Cắt ảnh từ trang đã vẽ
    for (const b of pg.layout.blocks) if (b.type === 'image') b.data = cropJpeg(canvas, b);
    if (opts.keepCanvas) pg.bgJpeg = canvas.toDataURL('image/jpeg', 0.82);
    canvas.width = canvas.height = 0; pg.canvas = null;
    if (pg.ocr) { stats.ocr++; stats.conf.push(pg.conf); } else if (pg.chars < 15) stats.img++; else stats.text++;
    if (pg.legacyUsed) stats.legacy = true;
    pages.push(pg);
  }
  await stopOcr();
  return { pages, stats };
}
function cropJpeg(canvas, b) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(b.w * SCALE)); c.height = Math.max(1, Math.round(b.h * SCALE));
  c.getContext('2d').drawImage(canvas, b.x * SCALE, b.y * SCALE, b.w * SCALE, b.h * SCALE, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.88);
  c.width = 0;
  return url;
}
const dataUrlBytes = (u) => Uint8Array.from(atob(u.split(',')[1]), (ch) => ch.charCodeAt(0));

function summary(stats, extra = '') {
  const parts = [];
  if (stats.text) parts.push(`${stats.text} trang lấy đúng chữ gốc trong PDF`);
  if (stats.ocr) {
    const avg = stats.conf.reduce((a, b) => a + b, 0) / stats.conf.length;
    parts.push(`${stats.ocr} trang là bản scan/ảnh nên đã nhận dạng chữ (độ tin cậy trung bình ${Math.round(avg)}%)`);
  }
  if (stats.img) parts.push(`${stats.img} trang chỉ có hình ảnh (không có chữ) nên được giữ nguyên dạng ảnh`);
  let note = `Đã chuyển: ${parts.join('; ')}.`;
  if (stats.legacy) note += ' Phông chữ cũ (TCVN3 .VnTime / VNI) đã được tự chuyển sang Unicode.';
  if (stats.ocr) note += ` Chữ nhận dạng từ ảnh có thể sai ở chỗ mờ, nhòe. ${extra}Hãy dò lại trước khi dùng.`;
  return note;
}

/* ================= WORD ================= */
export async function toWord(file, { password, opts, progress }) {
  const [D, doc] = await Promise.all([libs.docx(), analyse(file, password, opts, progress)]);
  progress(1, 1, 'Đang tạo file Word...');
  const tw = (pt) => Math.round(pt * 20);
  const run = (r) => new D.TextRun({
    text: r.text, bold: r.bold || undefined, italics: r.italic || undefined, size: Math.round(r.size * 2), font: r.face,
    color: r.color !== '000000' ? r.color : undefined, highlight: r.low && opts.mark ? 'yellow' : undefined,
    shading: r.bg && !(r.low && opts.mark) ? { type: D.ShadingType.CLEAR, fill: r.bg, color: 'auto' } : undefined,
  });
  const sections = doc.pages.map((pg) => {
    const L = pg.layout;
    const mL = Math.max(18, Math.min(L.left, pg.w / 3)) - 2;
    const mR = Math.max(14, Math.min(pg.w - L.right - 8, mL)); // lề phải không rộng hơn lề trái để căn giữa đúng
    const first = L.blocks[0];
    const mT = Math.max(14, Math.min(first ? first.top - 2 : 56, pg.h / 3));
    const children = [];
    let lastBottom = mT;
    for (const b of L.blocks) {
      const before = tw(Math.max(0, b.top - lastBottom));
      if (b.type === 'para') {
        const l0 = b.lines[0], l1 = b.lines[1] || l0;
        const kids = [];
        b.lines.forEach((l, k) => {
          if (k) kids.push(new D.TextRun({ text: ' ' }));
          l.segs.forEach((s, si) => {
            if (si) kids.push(new D.TextRun({ children: [new D.Tab()] }));
            s.runs.forEach((r) => kids.push(run(r)));
          });
        });
        const lineRatio = b.lead ? b.lead / (b.lines[0].size * 1.15) : 1;
        children.push(new D.Paragraph({
          children: kids,
          alignment: b.centered ? D.AlignmentType.CENTER : b.rightAl ? D.AlignmentType.RIGHT : b.justify ? D.AlignmentType.BOTH : D.AlignmentType.LEFT,
          indent: b.centered || b.rightAl ? undefined : { left: tw(Math.max(0, l1.x0 - mL)), firstLine: l0.x0 > l1.x0 ? tw(l0.x0 - l1.x0) : undefined, hanging: l0.x0 < l1.x0 - 1 ? tw(l1.x0 - l0.x0) : undefined },
          spacing: { before, after: 0, line: Math.round(240 * Math.min(2.5, Math.max(1, lineRatio))), lineRule: D.LineRuleType.AUTO },
        }));
        const ll = b.lines[b.lines.length - 1];
        lastBottom = ll.base + ll.size * 0.3;
      } else if (b.type === 'table') {
        const starts = b.cols.map(([a], i) => (i === 0 ? Math.min(mL, a) : a - 3));
        const end = Math.max(b.cols[b.cols.length - 1][1] + 3, L.right);
        const widths = starts.map((a, i) => Math.max(20, (starts[i + 1] ?? end) - a));
        const none = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
        const line = { style: D.BorderStyle.SINGLE, size: 4, color: '000000' };
        const bd = b.ruled ? line : none;
        const rows = b.rows.map((row) => new D.TableRow({
          children: row.cells.map((segs, ci) => {
            const paras = [];
            let cur = [];
            segs.forEach((s) => {
              if (s.br) { paras.push(cur); cur = []; return; }
              if (cur.length) cur.push(new D.TextRun({ text: ' ' }));
              s.runs.forEach((r) => cur.push(run(r)));
            });
            paras.push(cur);
            return new D.TableCell({
              width: { size: tw(widths[ci]), type: D.WidthType.DXA },
              borders: { top: bd, bottom: bd, left: bd, right: bd },
              margins: { left: 40, right: 40, top: 0, bottom: 0 },
              children: paras.map((p) => new D.Paragraph({ children: p, spacing: { before: 0, after: 0 } })),
            });
          }),
        }));
        if (before > 60) children.push(new D.Paragraph({ children: [new D.TextRun({ text: '', size: 2 })], spacing: { before: 0, after: 0, line: Math.min(before, 4000), lineRule: D.LineRuleType.EXACT } }));
        children.push(new D.Table({ rows, width: { size: tw(widths.reduce((a, c) => a + c, 0)), type: D.WidthType.DXA }, columnWidths: widths.map(tw), layout: D.TableLayoutType.FIXED, borders: b.ruled ? undefined : D.TableBorders.NONE }));
        const lr = b.rows[b.rows.length - 1].line;
        lastBottom = lr.base + lr.size * 0.3;
      } else if (b.type === 'image' && opts.images) {
        const k = 96 / 72;
        const fit = Math.min(1, (pg.w - mL - mR - 2) / b.w, (pg.h - mT - Math.min(36, mT) - 12) / b.h); // vừa khổ giấy
        children.push(new D.Paragraph({
          alignment: Math.abs(b.x + b.w / 2 - pg.w / 2) < 20 ? D.AlignmentType.CENTER : D.AlignmentType.LEFT,
          indent: Math.abs(b.x + b.w / 2 - pg.w / 2) < 20 ? undefined : { left: tw(Math.max(0, b.x - mL)) },
          spacing: { before, after: 0 },
          children: [new D.ImageRun({ type: 'jpg', data: dataUrlBytes(b.data), transformation: { width: Math.round(b.w * k * fit), height: Math.round(b.h * k * fit) } })],
        }));
        lastBottom = b.y + b.h;
      }
    }
    if (!children.length) children.push(new D.Paragraph({ children: [] }));
    return {
      properties: {
        page: {
          size: { width: tw(pg.w), height: tw(pg.h), orientation: pg.w > pg.h ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT },
          margin: { top: tw(mT), bottom: tw(Math.min(36, mT)), left: tw(mL), right: tw(mR), header: 0, footer: 0 },
        },
      },
      children,
    };
  });
  const d = new D.Document({
    creator: 'PDF Tool', styles: { default: { document: { run: { font: 'Times New Roman', size: 24 }, paragraph: { spacing: { after: 0 } } } } },
    sections,
  });
  const blob = await D.Packer.toBlob(d);
  return Object.assign([{ name: `${baseName(file.name)}.docx`, blob: new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }) }],
    { note: summary(doc.stats, opts.mark ? 'Các chữ chưa chắc chắn được tô vàng. ' : '') });
}

/* ================= EXCEL ================= */
export async function toExcel(file, { password, opts, progress }) {
  const [X, doc] = await Promise.all([libs.xlsx(), analyse(file, password, opts, progress)]);
  progress(1, 1, 'Đang tạo file Excel...');
  const wb = X.utils.book_new();
  const sheetOf = (pages, name) => {
    const aoa = [];
    let widths = [];
    const push = (row) => {
      aoa.push(row.map((v) => toCell(v, opts.numbers)));
      row.forEach((v, i) => { widths[i] = Math.max(widths[i] || 8, Math.min(60, [...v].length + 2)); });
    };
    for (const pg of pages) {
      for (const b of pg.layout.blocks) {
        if (b.type === 'table') {
          // mỗi ô một dữ liệu; chữ xuống dòng trong ô nối bằng dấu cách
          for (const row of b.rows) push(row.cells.map((segs) => segs.filter((s) => !s.br).map((s) => s.text).join(' ')));
        } else if (b.type === 'para') {
          for (const l of b.lines) push(l.segs.map((s) => s.text));
        }
      }
      if (pages.length > 1) aoa.push([]);
    }
    const ws = X.utils.aoa_to_sheet(aoa.length ? aoa : [['']]);
    ws['!cols'] = widths.map((w) => ({ wch: w }));
    X.utils.book_append_sheet(wb, ws, name);
  };
  if (opts.sheet === 'one') sheetOf(doc.pages, 'Dữ liệu');
  else doc.pages.forEach((pg, i) => sheetOf([pg], `Trang ${i + 1}`));
  const out = X.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
  return Object.assign([{ name: `${baseName(file.name)}.xlsx`, blob: new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) }],
    { note: summary(doc.stats) });
}
// Mặc định giữ nguyên chữ (kiểu văn bản). Khi bật "nhận số": chỉ đổi những ô chắc chắn là số
function toCell(v, numbers) {
  if (!numbers || !v) return v;
  const s = v.trim();
  let m;
  if ((m = /^(-?)(\d{1,3}(?:\.\d{3})+)(?:,(\d+))?$/.exec(s))) return { t: 'n', v: +`${m[1]}${m[2].replace(/\./g, '')}${m[3] ? `.${m[3]}` : ''}`, z: m[3] ? `#,##0.${'0'.repeat(m[3].length)}` : '#,##0' };
  if ((m = /^(-?)(\d{1,3}(?:,\d{3})+)(?:\.(\d+))?$/.exec(s))) return { t: 'n', v: +`${m[1]}${m[2].replace(/,/g, '')}${m[3] ? `.${m[3]}` : ''}`, z: m[3] ? `#,##0.${'0'.repeat(m[3].length)}` : '#,##0' };
  if (/^-?[1-9]\d{0,14}$|^-?0$/.test(s)) return { t: 'n', v: +s };
  return v;
}

/* ================= POWERPOINT ================= */
export async function toPowerPoint(file, { password, opts, progress }) {
  const asImage = opts.mode === 'image';
  const [P, doc] = await Promise.all([libs.pptx(), analyse(file, password, { ...opts, keepCanvas: asImage, ocr: asImage ? 'never' : opts.ocr }, progress)]);
  progress(1, 1, 'Đang tạo file PowerPoint...');
  const pptx = new P();
  const p0 = doc.pages[0];
  const W = p0.w / 72, H = p0.h / 72;
  pptx.defineLayout({ name: 'PDF', width: W, height: H });
  pptx.layout = 'PDF';
  const inch = (pt) => pt / 72;
  for (const pg of doc.pages) {
    const slide = pptx.addSlide();
    const fx = W / inch(pg.w), fy = H / inch(pg.h); // trang khác khổ -> co theo slide
    const X = (pt) => inch(pt) * fx, Y = (pt) => inch(pt) * fy;
    if (asImage) { slide.background = { data: pg.bgJpeg.replace(/^data:/, '') }; continue; }
    const runsOf = (segs, joiner) => {
      const arr = [];
      segs.forEach((s, i) => {
        if (i) arr.push({ text: joiner, options: {} });
        s.runs.forEach((r) => arr.push({ text: r.text, options: { bold: r.bold, italic: r.italic, fontFace: r.face, fontSize: r.size * fy, color: r.color, highlight: r.low && opts.mark ? 'FFFF00' : r.bg || undefined } }));
      });
      return arr;
    };
    const box = (runs, x0, x1, top, lines, size, align = 'left') => {
      if (!runs.length) return;
      slide.addText(runs, {
        x: X(x0), y: Y(top), w: Math.min(X(Math.max(x1 - x0, size)) * 1.04 + 0.05, W - X(x0)), h: Y(lines * size * 1.2 + size * 0.2),
        margin: 0, valign: 'top', align, fit: 'none', wrap: lines > 1, // dòng đơn: không tự xuống dòng paraSpaceBefore: 0, paraSpaceAfter: 0,
      });
    };
    for (const b of pg.layout.blocks) {
      if (b.type === 'para') {
        const segs = [];
        b.lines.forEach((l) => l.segs.forEach((s) => segs.push(s)));
        const x0 = Math.min(...b.lines.map((l) => l.x0)), x1 = Math.max(...b.lines.map((l) => l.x1));
        const runs = runsOf(segs, ' ');
        box(runs, x0, x1, b.lines[0].base - b.lines[0].size * 0.9, b.lines.length, b.lines[0].size, b.centered ? 'center' : b.rightAl ? 'right' : b.justify ? 'justify' : 'left');
      } else if (b.type === 'table') {
        for (const row of b.rows) {
          row.cells.forEach((segs) => {
            const real = segs.filter((s) => !s.br);
            if (!real.length) return;
            const n = segs.filter((s) => s.br).length + 1;
            box(runsOf(real, ' '), Math.min(...real.map((s) => s.x0)), Math.max(...real.map((s) => s.x1)), row.line.base - row.line.size * 0.9, n, row.line.size);
          });
        }
      } else if (b.type === 'image' && opts.images) {
        slide.addImage({ data: b.data.replace(/^data:/, ''), x: X(b.x), y: Y(b.y), w: X(b.w), h: Y(b.h) });
      }
    }
  }
  const blob = await pptx.write({ outputType: 'blob' });
  if (asImage) return Object.assign([{ name: `${baseName(file.name)}.pptx`, blob: new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }) }], { note: 'Mỗi trang PDF là một slide dạng ảnh: giữ nguyên 100% hình thức nhưng không sửa được chữ.' });
  return Object.assign([{ name: `${baseName(file.name)}.pptx`, blob: new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }) }],
    { note: summary(doc.stats, opts.mark ? 'Các chữ chưa chắc chắn được tô vàng. ' : '') });
}
