// Trình chỉnh sửa trang: ký tên, chú thích, che thông tin
import {
  h, $, $$, openPdfjs, renderPage, toast, modal, displaySize, drawImageBox, drawRectBox,
  textToPng, canvasPngBytes, rgb, readBytes, PDFLib, embedVnFont, drawTextLines, BASELINE, pdfjsLib, fontCss,
} from './core.js';
import { icon } from './icons.js';
import { createFormatBar, colorButton } from './formatbar.js';

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const uid = () => Math.random().toString(36).slice(2, 9);
const TEXT_KEYS = ['font', 'size', 'color', 'bg', 'bold', 'italic', 'underline', 'strike', 'align'];

const TOOLSETS = {
  sign: [
    { id: 'select', label: 'Chọn', icon: 'grip-vertical' },
    { id: 'signature', label: 'Chữ ký', icon: 'pen-tool', action: true },
    { id: 'text', label: 'Chữ', icon: 'type' },
    { id: 'date', label: 'Ngày', icon: 'list-ordered', action: true },
    { id: 'image', label: 'Ảnh', icon: 'image', action: true },
  ],
  annotate: [
    { id: 'select', label: 'Chọn', icon: 'grip-vertical' },
    { id: 'text', label: 'Chữ', icon: 'type' },
    { id: 'draw', label: 'Bút vẽ', icon: 'pencil' },
    { id: 'highlight', label: 'Tô sáng', icon: 'highlighter' },
    { id: 'rect', label: 'Khung', icon: 'square' },
    { id: 'whiteout', label: 'Che trắng', icon: 'eraser' },
    { id: 'image', label: 'Ảnh', icon: 'image', action: true },
  ],
  edittext: [
    { id: 'edit', label: 'Sửa chữ', icon: 'type' },
    { id: 'text', label: 'Thêm chữ', icon: 'plus' },
    { id: 'whiteout', label: 'Xóa vùng', icon: 'eraser' },
    { id: 'select', label: 'Di chuyển', icon: 'grip-vertical' },
    { id: 'image', label: 'Ảnh', icon: 'image', action: true },
  ],
  redact: [
    { id: 'redact', label: 'Vẽ ô che', icon: 'square' },
    { id: 'select', label: 'Chọn / di chuyển', icon: 'grip-vertical' },
  ],
};

export function createEditor(root, file, mode, password) {
  const state = {
    tool: { redact: 'redact', sign: 'select', edittext: 'edit' }[mode] || 'text',
    color: mode === 'annotate' ? '#e53935' : '#000000', size: 14, font: 'arimo', bg: null, bold: false, italic: false, underline: false, strike: false, align: 'left',
    items: [], pages: [],
  };
  const toolbar = h('div', { class: 'editor-toolbar' });
  const pagesBox = h('div', { class: 'editor-pages' });
  const hint = h('div', { class: 'editor-hint' });
  root.append(toolbar, hint, pagesBox);

  // ---------- Thanh công cụ ----------
  const tools = TOOLSETS[mode];
  const toolsRow = h('div', { class: 'tools-row' });
  toolbar.append(toolsRow);
  for (const t of tools) {
    toolsRow.append(h('button', {
      class: 'tool-btn', 'data-tool': t.id, title: t.label,
      onclick: () => (t.action ? runAction(t.id) : setTool(t.id)),
      html: `${icon(t.icon, 18)}<span>${t.label}</span>`,
    }));
  }
  toolsRow.append(h('button', { class: 'tool-btn', title: 'Hoàn tác', onclick: undo, html: `${icon('undo-2', 18)}<span>Hoàn tác</span>` }));
  let fb = null;
  if (mode !== 'redact') {
    fb = createFormatBar(state, () => applyToSelected());
    if (mode === 'annotate') toolsRow.append(colorButton(state, () => { fb.sync(); applyToSelected(); }, 'Màu nét').el);
    toolbar.append(fb.el);
  }
  // Phím tắt như Word khi đang gõ chữ
  pagesBox.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !fb || !e.target.classList.contains('etext')) return;
    const k = { b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()];
    if (!k) return;
    e.preventDefault(); state[k] = !state[k]; fb.sync(); applyToSelected();
  });

  function setTool(id) {
    state.tool = id;
    $$('.tool-btn', toolbar).forEach((b) => b.classList.toggle('active', b.dataset.tool === id));
    pagesBox.dataset.tool = id;
    const hints = {
      select: 'Kéo để di chuyển, kéo góc dưới phải để đổi kích thước, bấm × để xóa.',
      text: 'Bấm vào trang ở vị trí muốn thêm chữ rồi gõ.',
      draw: 'Giữ chuột / ngón tay và vẽ trên trang.',
      highlight: 'Kéo trên trang để tô sáng một vùng.',
      rect: 'Kéo trên trang để vẽ khung.',
      whiteout: mode === 'edittext' ? 'Kéo trên trang để xóa trắng một vùng (chữ, hình...).' : 'Kéo trên trang để che trắng một vùng (ví dụ để xóa chữ cũ, rồi thêm chữ mới).',
      redact: 'Kéo trên trang để vẽ ô đen che thông tin nhạy cảm.',
      edit: 'Bấm vào dòng chữ có sẵn (khung xanh) để sửa. Xóa hết chữ trong ô để xóa dòng đó. Đổi cỡ, màu, đậm/nghiêng ở thanh công cụ.',
    };
    hint.textContent = hints[id] || '';
  }

  // ---------- Hiển thị trang ----------
  let pdf;
  const ready = (async () => {
    pdf = await openPdfjs(file, password);
    for (let i = 1; i <= pdf.numPages; i++) {
      const wrap = h('div', { class: 'epage', 'data-page': i });
      const canvas = h('canvas');
      const overlay = h('div', { class: 'eoverlay' });
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'edraw'); svg.setAttribute('viewBox', '0 0 1000 1000'); svg.setAttribute('preserveAspectRatio', 'none');
      overlay.append(svg);
      wrap.append(canvas, overlay, h('div', { class: 'epage-num' }, `Trang ${i} / ${pdf.numPages}`));
      pagesBox.append(wrap);
      const pg = await pdf.getPage(i);
      const vp = pg.getViewport({ scale: 1 });
      wrap.style.aspectRatio = `${vp.width} / ${vp.height}`;
      state.pages[i] = { wrap, canvas, overlay, svg, ptW: vp.width, ptH: vp.height, rendered: false };
      bindOverlay(i);
    }
    const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) drawPage(+en.target.dataset.page); }), { rootMargin: '400px' });
    $$('.epage', pagesBox).forEach((p) => io.observe(p));
    const ro = new ResizeObserver(() => updateScale());
    ro.observe(pagesBox);
    updateScale();
    setTool(state.tool);
  })();

  function updateScale() {
    for (const p of state.pages) {
      if (!p) continue;
      p.wrap.style.setProperty('--s', p.wrap.clientWidth / p.ptW);
    }
  }
  async function drawPage(i) {
    const p = state.pages[i];
    if (p.rendered) return;
    p.rendered = true;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const { page } = await renderPage(pdf, i, { width: Math.min(1600, p.wrap.clientWidth * ratio * 1.25), canvas: p.canvas });
    if (mode === 'edittext') await buildTextLayer(i, page).catch((e) => console.warn(e));
  }

  // ---------- Nhận diện các dòng chữ có sẵn để sửa ----------
  async function buildTextLayer(i, page) {
    const p = state.pages[i];
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const runs = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) { if (runs.length && it.str) runs[runs.length - 1].pendingSpace = true; continue; }
      const t = pdfjsLib.Util.transform(vp.transform, it.transform);
      if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01 || t[0] <= 0) continue; // bỏ qua chữ xoay
      const size = Math.hypot(t[2], t[3]);
      if (size < 3) continue;
      const x = t[4], base = t[5], w = it.width * (vp.scale || 1);
      const last = runs[runs.length - 1];
      if (last && it.fontName === last.fontName && Math.abs(last.base - base) < size * 0.3 && Math.abs(last.size - size) < 0.5 && x - (last.x + last.w) < size * 0.8 && x >= last.x + last.w - size * 0.5) {
        const gap = x - (last.x + last.w);
        last.text += ((gap > size * 0.15 || last.pendingSpace) && !last.text.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
        last.w = x + w - last.x; last.pendingSpace = false;
      } else runs.push({ text: it.str, x, base, w, size, fontName: it.fontName, pendingSpace: false });
    }
    for (const r of runs) {
      const font = page.commonObjs.has(r.fontName) ? page.commonObjs.get(r.fontName) : null;
      const fname = `${font?.name || ''} ${font?.fallbackName || ''} ${tc.styles[r.fontName]?.fontFamily || ''}`;
      r.bold = !!font?.bold || !!font?.black || /bold|black|heavy|semibold|demi/i.test(fname);
      r.italic = !!font?.italic || /italic|oblique/i.test(fname);
      const fn = `${font?.name || ''}`;
      r.family = /courier|cousine|mono|consol/i.test(fn) ? 'cousine' : /times|tinos|roman|georgia|garamond|cambria|minion|palatino|bookman|century|serif(?!.*sans)/i.test(fn) && !/sans/i.test(fn) ? 'tinos'
        : /arial|arimo|helvetica|calibri|roboto|segoe|tahoma|verdana|sans/i.test(fn) ? 'arimo'
        : font?.fallbackName === 'serif' || tc.styles[r.fontName]?.fontFamily === 'serif' ? 'tinos' : 'arimo';
      r.text = r.text.replace(/\s+$/, '').normalize('NFC');
      const box = { x: (r.x - 1) / p.ptW, y: (r.base - r.size * 0.92) / p.ptH, w: (r.w + 2) / p.ptW, h: (r.size * 1.2) / p.ptH };
      const el = h('div', { class: 'tline', title: 'Bấm để sửa', style: `left:${box.x * 100}%;top:${box.y * 100}%;width:${box.w * 100}%;height:${box.h * 100}%` });
      el.addEventListener('pointerdown', (e) => {
        if (state.tool !== 'edit') return;
        e.preventDefault(); e.stopPropagation();
        editRun(i, r, box, el);
      });
      p.overlay.append(el);
    }
  }

  function sampleColors(i, box) {
    const p = state.pages[i];
    const c = p.canvas, k = c.width;
    const ctx = c.getContext('2d');
    const x0 = Math.max(0, Math.floor(box.x * k)), y0 = Math.max(0, Math.floor(box.y * c.height));
    const w = Math.max(1, Math.min(c.width - x0, Math.ceil(box.w * k))), hh = Math.max(1, Math.min(c.height - y0, Math.ceil(box.h * c.height)));
    const d = ctx.getImageData(x0, y0, w, hh).data;
    const counts = new Map();
    const edge = [];
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (y < 2 || y >= hh - 2 || x < 2 || x >= w - 2) edge.push((y * w + x) * 4);
    for (const o of edge) { const key = ((d[o] >> 3) << 10) | ((d[o + 1] >> 3) << 5) | (d[o + 2] >> 3); counts.set(key, (counts.get(key) || 0) + 1); }
    let bgKey = 0, best = -1;
    for (const [kk, v] of counts) if (v > best) { best = v; bgKey = kk; }
    const bgPx = edge.filter((o) => (((d[o] >> 3) << 10) | ((d[o + 1] >> 3) << 5) | (d[o + 2] >> 3)) === bgKey);
    const bg = [0, 1, 2].map((j) => Math.round(bgPx.reduce((a, o) => a + d[o + j], 0) / Math.max(1, bgPx.length)));
    let maxD = 0; const px = [];
    for (let o = 0; o < d.length; o += 4) {
      const dist = Math.abs(d[o] - bg[0]) + Math.abs(d[o + 1] - bg[1]) + Math.abs(d[o + 2] - bg[2]);
      if (dist > maxD) maxD = dist;
      px.push([dist, o]);
    }
    const ink = px.filter(([dd]) => dd > maxD * 0.7);
    const avg = [0, 1, 2].map((j) => Math.round(ink.reduce((a, [, o]) => a + d[o + j], 0) / Math.max(1, ink.length)));
    const hex = (a) => `#${a.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
    return { bg: hex(bg), fg: maxD > 60 ? hex(avg) : '#000000' };
  }

  function editRun(i, r, box, marker) {
    const p = state.pages[i];
    const { bg, fg } = sampleColors(i, box);
    marker.remove();
    const cover = { id: uid(), page: i, type: 'cover', color: bg, x: box.x, y: box.y, w: box.w, h: box.h };
    state.items.push(cover); renderItem(cover);
    const size = Math.round(r.size * 10) / 10;
    const it = {
      id: uid(), page: i, type: 'text', text: r.text, color: fg, size, font: r.family, bold: r.bold, italic: r.italic, underline: false, strike: false, bg: null, align: 'left',
      x: r.x / p.ptW, y: (r.base - size * BASELINE) / p.ptH, w: 0, h: 0, cover: cover.id,
    };
    state.items.push(it);
    const el = renderItem(it);
    const ed = $('.etext', el);
    ed.focus();
    const sel = window.getSelection(); sel.selectAllChildren(ed); sel.collapseToEnd();
    select(it);
  }

  // ---------- Thao tác trên trang ----------
  function relPos(e, overlay) {
    const r = overlay.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  }
  function bindOverlay(i) {
    const { overlay } = state.pages[i];
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target !== overlay && !e.target.classList.contains('edraw')) return;
      const t = state.tool;
      if (t === 'select') { select(null); return; }
      if (t === 'edit') { select(null); return; }
      const start = relPos(e, overlay);
      if (t === 'text') { e.preventDefault(); addText(i, start.x, start.y); return; }
      overlay.setPointerCapture(e.pointerId);
      if (t === 'draw') {
        const item = { id: uid(), page: i, type: 'draw', color: state.color, width: Math.max(1.5, state.size / 7), points: [start] };
        state.items.push(item); renderDraw(i);
        const move = (ev) => { item.points.push(relPos(ev, overlay)); renderDraw(i); };
        const up = () => { overlay.removeEventListener('pointermove', move); overlay.removeEventListener('pointerup', up); if (item.points.length < 2) { state.items = state.items.filter((x) => x !== item); renderDraw(i); } };
        overlay.addEventListener('pointermove', move); overlay.addEventListener('pointerup', up);
        return;
      }
      // Vẽ hình chữ nhật (tô sáng / khung / che)
      const color = t === 'highlight' && !['#2e7d32', '#1e40af', '#f9a825'].includes(state.color) ? '#f9a825' : state.color;
      const item = { id: uid(), page: i, type: t, color, x: start.x, y: start.y, w: 0, h: 0 };
      state.items.push(item);
      const el = renderItem(item);
      const move = (ev) => {
        const p = relPos(ev, overlay);
        item.x = Math.min(start.x, p.x); item.y = Math.min(start.y, p.y);
        item.w = Math.abs(p.x - start.x); item.h = Math.abs(p.y - start.y);
        place(el, item);
      };
      const up = () => {
        overlay.removeEventListener('pointermove', move); overlay.removeEventListener('pointerup', up);
        if (item.w < 0.01 || item.h < 0.005) removeItem(item);
      };
      overlay.addEventListener('pointermove', move); overlay.addEventListener('pointerup', up);
    });
  }

  function renderDraw(i) {
    const { svg } = state.pages[i];
    svg.innerHTML = state.items.filter((it) => it.page === i && it.type === 'draw').map((it) =>
      `<polyline points="${it.points.map((p) => `${p.x * 1000},${p.y * 1000}`).join(' ')}" fill="none" stroke="${it.color}" stroke-width="${it.width}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" style="stroke-width:calc(var(--s) * ${it.width}px)"/>`).join('');
  }

  function place(el, it) {
    el.style.left = `${it.x * 100}%`; el.style.top = `${it.y * 100}%`;
    if (it.type !== 'text') { el.style.width = `${it.w * 100}%`; el.style.height = `${it.h * 100}%`; }
  }

  function renderItem(it) {
    const { overlay } = state.pages[it.page];
    const el = h('div', { class: `eitem eitem-${it.type}`, 'data-id': it.id });
    if (it.type === 'image') el.append(h('img', { src: it.src, alt: '', draggable: 'false' }));
    if (it.type === 'text') {
      const ed = h('div', { class: 'etext', contenteditable: 'true', spellcheck: 'false' });
      ed.textContent = it.text || '';
      styleText(ed, it);
      ed.addEventListener('input', () => { it.text = ed.innerText; });
      ed.addEventListener('focus', () => select(it));
      ed.addEventListener('blur', () => { if (!ed.innerText.trim() && !it.cover) removeItem(it); });
      el.append(ed);
    }
    if (it.type === 'rect') el.style.borderColor = it.color;
    if (it.type === 'highlight') el.style.background = it.color;
    el.append(h('button', { class: 'eitem-del', 'aria-label': 'Xóa', onpointerdown: (e) => e.stopPropagation(), onclick: () => removeItem(it), html: '&times;' }));
    if (it.type === 'cover') { el.style.background = it.color; place(el, it); overlay.prepend(el); return el; }
    if (it.type !== 'text') el.append(h('span', { class: 'eitem-resize', 'aria-hidden': 'true' }));
    place(el, it);
    overlay.append(el);
    // Di chuyển / đổi kích thước
    el.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('eitem-del')) return;
      const isText = e.target.classList.contains('etext');
      select(it);
      if (isText && document.activeElement === e.target) return;
      const resizing = e.target.classList.contains('eitem-resize');
      const start = relPos(e, overlay), orig = { ...it };
      let moved = false;
      el.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const p = relPos(ev, overlay);
        const dx = p.x - start.x, dy = p.y - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.003) moved = true;
        if (!moved) return;
        if (resizing) {
          let nw = Math.max(0.02, orig.w + dx);
          let nh = it.type === 'image' ? nw * (orig.h / orig.w) * (state.pages[it.page].ptW / state.pages[it.page].ptW) : Math.max(0.01, orig.h + dy);
          if (it.type === 'image') nh = nw * orig.h / orig.w;
          it.w = Math.min(nw, 1 - it.x); it.h = nh;
        } else {
          it.x = Math.min(1 - 0.01, Math.max(0, orig.x + dx)); it.y = Math.min(1 - 0.01, Math.max(0, orig.y + dy));
        }
        place(el, it);
      };
      const up = () => {
        el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
        if (isText && !moved) e.target.focus();
      };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
      if (!isText) e.preventDefault();
    });
    return el;
  }

  function select(it) {
    state.selected = it;
    if (it?.type === 'text' && fb) {
      for (const k of TEXT_KEYS) state[k] = it[k];
      fb.sync();
    }
    $$('.eitem', pagesBox).forEach((el) => el.classList.toggle('selected', it && el.dataset.id === it.id));
  }
  function applyToSelected() {
    const it = state.selected;
    if (!it) return;
    const el = $(`.eitem[data-id="${it.id}"]`, pagesBox);
    if (it.type === 'text') { for (const k of TEXT_KEYS) it[k] = state[k]; styleText($('.etext', el), it); }
    if (it.type === 'rect' || it.type === 'highlight') { it.color = state.color; el.style.borderColor = it.color; if (it.type === 'highlight') el.style.background = it.color; }
  }
  function removeItem(it) {
    state.items = state.items.filter((x) => x !== it);
    $(`.eitem[data-id="${it.id}"]`, pagesBox)?.remove();
  }
  function styleText(ed, it) {
    ed.style.color = it.color; ed.style.fontSize = `calc(var(--s) * ${it.size}px)`;
    ed.style.fontFamily = fontCss(it.font);
    ed.style.fontWeight = it.bold ? '700' : '400'; ed.style.fontStyle = it.italic ? 'italic' : 'normal';
    ed.style.textDecoration = [it.underline && 'underline', it.strike && 'line-through'].filter(Boolean).join(' ') || 'none';
    ed.style.backgroundColor = it.bg || 'transparent';
    ed.style.textAlign = it.align || 'left';
  }
  function undo() {
    const it = state.items.pop();
    if (!it) return;
    if (it.cover) { const c = state.items.find((x) => x.id === it.cover); if (c) { state.items = state.items.filter((x) => x !== c); $(`.eitem[data-id="${c.id}"]`, pagesBox)?.remove(); } }
    if (it.type === 'draw') renderDraw(it.page); else $(`.eitem[data-id="${it.id}"]`, pagesBox)?.remove();
  }

  function addText(page, x, y, text = '') {
    const it = { id: uid(), page, type: 'text', x, y, text };
    for (const k of TEXT_KEYS) it[k] = state[k];
    state.items.push(it);
    const el = renderItem(it);
    const ed = $('.etext', el);
    ed.focus();
    setTimeout(() => { if (document.activeElement !== ed) ed.focus(); }, 0);
    return it;
  }

  function visiblePage() {
    const mid = window.innerHeight / 2;
    let best = 1, bestD = Infinity;
    for (const p of state.pages) {
      if (!p) continue;
      const r = p.wrap.getBoundingClientRect();
      const d = Math.abs((r.top + r.bottom) / 2 - mid);
      if (d < bestD) { bestD = d; best = +p.wrap.dataset.page; }
    }
    return best;
  }
  async function addImage(src, natW, natH, widthPt = 160) {
    const page = visiblePage();
    const p = state.pages[page];
    const w = Math.min(0.6, widthPt / p.ptW);
    const hgt = w * (natH / natW) * (p.ptW / p.ptH);
    const it = { id: uid(), page, type: 'image', src, x: 0.5 - w / 2, y: 0.6, w, h: hgt };
    if (it.y + hgt > 1) it.y = Math.max(0, 1 - hgt - 0.02);
    state.items.push(it);
    renderItem(it); select(it); setTool('select');
    p.wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function runAction(id) {
    if (id === 'signature') {
      const sig = await signatureDialog();
      if (sig) await addImage(sig.src, sig.w, sig.h, 150);
    } else if (id === 'date') {
      const d = new Date();
      const page = visiblePage();
      addText(page, 0.1, 0.5, `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`);
      setTool('select');
      state.pages[page].wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (id === 'image') {
      const f = await pickFile('image/png,image/jpeg,image/webp');
      if (!f) return;
      const src = await fileToPngDataUrl(f);
      const img = await loadImg(src);
      await addImage(src, img.naturalWidth, img.naturalHeight, 200);
    }
  }

  // ---------- Ghi vào PDF ----------
  async function apply(doc) {
    await ready;
    $$('.etext', pagesBox).forEach((e) => e.blur());
    const pages = doc.getPages();
    const touched = new Set();
    for (const it of state.items) {
      const page = pages[it.page - 1];
      if (!page) continue;
      const { w: PW, h: PH } = displaySize(page);
      touched.add(it.page);
      const box = { x: it.x * PW, y: it.y * PH, w: it.w * PW, h: it.h * PH };
      if (it.type === 'image') {
        const bytes = await (await fetch(it.src)).arrayBuffer();
        drawImageBox(page, await doc.embedPng(bytes), box);
      } else if (it.type === 'text') {
        if (!it.text?.trim()) continue;
        const scale = PW / state.pages[it.page].ptW; // = 1 nếu cùng kích thước
        const font = await embedVnFont(doc, it.font, it.bold, it.italic);
        drawTextLines(page, it.text.replace(/\n$/, '').normalize('NFC'), {
          x: box.x, y: box.y, size: it.size * scale, font, color: hexToRgb(it.color), align: it.align,
          bg: it.bg && hexToRgb(it.bg), underline: it.underline, strike: it.strike,
        });
      } else if (it.type === 'highlight') {
        drawRectBox(page, box, { color: hexToRgb(it.color), opacity: 0.4, blendMode: PDFLib.BlendMode.Multiply });
      } else if (it.type === 'rect') {
        drawRectBox(page, box, { borderColor: hexToRgb(it.color), borderWidth: 2 });
      } else if (it.type === 'cover') {
        drawRectBox(page, { x: box.x, y: box.y, w: box.w, h: box.h }, { color: hexToRgb(it.color) });
      } else if (it.type === 'whiteout') {
        drawRectBox(page, box, { color: rgb(1, 1, 1) });
      } else if (it.type === 'redact') {
        drawRectBox(page, box, { color: rgb(0, 0, 0) });
      }
    }
    // Nét vẽ tay: gom thành 1 ảnh trong suốt cho mỗi trang
    for (const [pnum, strokes] of groupBy(state.items.filter((i) => i.type === 'draw'), (i) => i.page)) {
      const page = pages[pnum - 1];
      const { w: PW, h: PH } = displaySize(page);
      const k = 3;
      const c = h('canvas'); c.width = Math.ceil(PW * k); c.height = Math.ceil(PH * k);
      const ctx = c.getContext('2d'); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const s of strokes) {
        ctx.strokeStyle = s.color; ctx.lineWidth = s.width * k * (PW / state.pages[pnum].ptW);
        ctx.beginPath();
        s.points.forEach((p, j) => (j ? ctx.lineTo(p.x * c.width, p.y * c.height) : ctx.moveTo(p.x * c.width, p.y * c.height)));
        ctx.stroke();
      }
      drawImageBox(page, await doc.embedPng(await canvasPngBytes(c)), { x: 0, y: 0, w: PW, h: PH });
      touched.add(pnum);
    }
    return { count: state.items.length, pages: [...touched].sort((a, b) => a - b) };
  }

  return { apply, ready, get count() { return state.items.length; } };
}

function groupBy(arr, fn) {
  const m = new Map();
  for (const x of arr) { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}

export function pickFile(accept, multiple = false) {
  return new Promise((res) => {
    const inp = h('input', { type: 'file', accept, multiple, style: 'display:none' });
    inp.addEventListener('change', () => { res(multiple ? [...inp.files] : inp.files[0] || null); inp.remove(); });
    document.body.append(inp); inp.click();
  });
}
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
async function fileToPngDataUrl(f) {
  const img = await loadImg(URL.createObjectURL(f));
  const c = h('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  return c.toDataURL('image/png');
}

// Cắt bỏ phần trong suốt xung quanh
function trimCanvas(c) {
  const ctx = c.getContext('2d');
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const out = h('canvas'); out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

const SIG_KEY = 'mpt-signatures';
function savedSignatures() { try { return JSON.parse(localStorage.getItem(SIG_KEY) || '[]'); } catch { return []; } }
function storeSignature(sig) {
  try { const list = [sig, ...savedSignatures().filter((s) => s.src !== sig.src)].slice(0, 4); localStorage.setItem(SIG_KEY, JSON.stringify(list)); } catch { /* bộ nhớ trình duyệt bị chặn */ }
}

/** Hộp thoại tạo chữ ký: Vẽ / Gõ / Tải ảnh. Trả về {src, w, h} */
export async function signatureDialog() {
  let color = '#0b1f66';
  let tab = 'draw';
  const body = h('div', { class: 'sig' });
  const tabs = h('div', { class: 'seg' });
  const panes = {};
  const saved = savedSignatures();

  // Vẽ
  const pad = h('canvas', { class: 'sig-pad', width: 900, height: 300 });
  const pctx = pad.getContext('2d');
  pctx.lineCap = 'round'; pctx.lineJoin = 'round'; pctx.lineWidth = 5;
  let drawing = false, last = null, hasInk = false;
  const pos = (e) => { const r = pad.getBoundingClientRect(); return { x: (e.clientX - r.left) * (pad.width / r.width), y: (e.clientY - r.top) * (pad.height / r.height) }; };
  pad.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); pad.setPointerCapture(e.pointerId); pctx.strokeStyle = color; pctx.beginPath(); pctx.arc(last.x, last.y, 2.2, 0, Math.PI * 2); pctx.fillStyle = color; pctx.fill(); hasInk = true; });
  pad.addEventListener('pointermove', (e) => { if (!drawing) return; const p = pos(e); pctx.beginPath(); pctx.moveTo(last.x, last.y); pctx.lineTo(p.x, p.y); pctx.stroke(); last = p; });
  pad.addEventListener('pointerup', () => { drawing = false; });
  panes.draw = h('div', {}, pad, h('div', { class: 'sig-row' }, h('span', { class: 'muted' }, 'Ký bằng chuột hoặc ngón tay vào ô trên'),
    h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { pctx.clearRect(0, 0, pad.width, pad.height); hasInk = false; } }, 'Xóa')));

  // Gõ
  const typed = h('input', { class: 'input', placeholder: 'Nhập họ tên của bạn', maxlength: 40 });
  const preview = h('div', { class: 'sig-typed' }, 'Chữ ký của bạn');
  typed.addEventListener('input', () => { preview.textContent = typed.value || 'Chữ ký của bạn'; });
  panes.type = h('div', {}, typed, preview);

  // Tải ảnh
  let upImg = null;
  const upPrev = h('div', { class: 'sig-upload-prev muted' }, 'Chưa chọn ảnh');
  const removeBg = h('input', { type: 'checkbox', checked: true });
  panes.upload = h('div', {},
    h('button', { class: 'btn btn-ghost', onclick: async () => {
      const f = await pickFile('image/png,image/jpeg,image/webp');
      if (!f) return;
      upImg = await loadImg(URL.createObjectURL(f));
      upPrev.innerHTML = ''; upPrev.append(h('img', { src: upImg.src, alt: 'Ảnh chữ ký' }));
    }, html: `${icon('upload', 18)} Chọn ảnh chữ ký` }),
    upPrev, h('label', { class: 'check' }, removeBg, ' Tự động xóa nền trắng'));

  // Đã lưu
  if (saved.length) {
    panes.saved = h('div', { class: 'sig-saved' }, saved.map((s) => h('button', { class: 'sig-saved-item', onclick: () => { chosenSaved = s; close.click(); } }, h('img', { src: s.src, alt: 'Chữ ký đã lưu' }))));
  }
  let chosenSaved = null;
  const labels = { draw: 'Vẽ', type: 'Gõ', upload: 'Tải ảnh', ...(saved.length ? { saved: 'Đã lưu' } : {}) };
  const show = (k) => { tab = k; $$('button', tabs).forEach((b) => b.classList.toggle('on', b.dataset.k === k)); Object.entries(panes).forEach(([pk, p]) => { p.hidden = pk !== k; }); };
  for (const [k, l] of Object.entries(labels)) tabs.append(h('button', { 'data-k': k, onclick: () => show(k) }, l));
  const colorRow = h('div', { class: 'sig-colors' }, 'Màu mực: ', ['#0b1f66', '#000000', '#c62828'].map((c) => h('button', {
    class: `swatch${c === color ? ' on' : ''}`, style: `background:${c}`, 'aria-label': `Màu ${c}`,
    onclick: (e) => { color = c; preview.style.color = c; $$('.sig-colors .swatch').forEach((s) => s.classList.remove('on')); e.currentTarget.classList.add('on'); },
  })));
  preview.style.color = color;
  const close = h('button', { hidden: true });
  body.append(tabs, ...Object.values(panes), colorRow, close);
  show(saved.length ? 'saved' : 'draw');

  const p = modal('Tạo chữ ký', body, [{ label: 'Hủy', value: null }, { label: 'Dùng chữ ký này', primary: true, value: 'ok' }]);
  close.addEventListener('click', () => $('.modal-actions .btn-primary')?.click());
  const ans = await p;
  if (chosenSaved) return chosenSaved;
  if (ans !== 'ok') return null;

  let out;
  if (tab === 'draw') {
    if (!hasInk) { toast('Bạn chưa vẽ chữ ký', 'error'); return null; }
    out = trimCanvas(pad);
  } else if (tab === 'type') {
    if (!typed.value.trim()) { toast('Bạn chưa nhập tên', 'error'); return null; }
    await document.fonts.load('600 80px "Dancing Script"', typed.value);
    const t = textToPng(typed.value.trim(), { size: 80, color, font: '"Dancing Script", cursive', scale: 2 });
    out = trimCanvas(t.canvas);
  } else if (tab === 'upload') {
    if (!upImg) { toast('Bạn chưa chọn ảnh', 'error'); return null; }
    const c = h('canvas'); c.width = upImg.naturalWidth; c.height = upImg.naturalHeight;
    const ctx = c.getContext('2d'); ctx.drawImage(upImg, 0, 0);
    if (removeBg.checked) {
      const d = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < d.data.length; i += 4) {
        const lum = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3;
        if (lum > 200) d.data[i + 3] = Math.max(0, Math.round((255 - lum) / 55 * 255));
      }
      ctx.putImageData(d, 0, 0);
    }
    out = trimCanvas(c) || c;
  } else return null;
  if (!out) return null;
  const sig = { src: out.toDataURL('image/png'), w: out.width, h: out.height };
  if (tab !== 'upload') storeSignature(sig);
  return sig;
}
export { readBytes };
