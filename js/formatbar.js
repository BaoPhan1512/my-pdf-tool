// Thanh định dạng chữ kiểu Word: phông, cỡ chữ, màu chữ, màu tô nền, đậm/nghiêng/gạch chân/gạch ngang, căn lề
import { h, $, $$, FONTS, fontCss } from './core.js';
import { icon } from './icons.js';

const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

// Bảng màu giống Word: 10 màu chủ đề x (gốc + 5 sắc độ) + 10 màu chuẩn
const THEME = ['#ffffff', '#000000', '#e7e6e6', '#44546a', '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'];
const STANDARD = ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];
const HIGHLIGHT = ['#ffff00', '#00ff00', '#00ffff', '#ff00ff', '#0000ff', '#ff0000', '#000080', '#008080', '#008000', '#800080', '#800000', '#808000', '#808080', '#c0c0c0', '#000000'];

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (a) => `#${a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const tint = (hex, t) => toHex(toRgb(hex).map((v) => v + (255 - v) * t));
const shade = (hex, s) => toHex(toRgb(hex).map((v) => v * (1 - s)));
function shades(hex) {
  if (hex === '#ffffff') return [0.05, 0.15, 0.25, 0.35, 0.5].map((s) => shade(hex, s));
  if (hex === '#000000') return [0.5, 0.35, 0.25, 0.15, 0.05].map((t) => tint(hex, t));
  return [tint(hex, 0.8), tint(hex, 0.6), tint(hex, 0.4), shade(hex, 0.25), shade(hex, 0.5)];
}

let openPop = null;
function closePop() { openPop?.remove(); openPop = null; document.removeEventListener('pointerdown', outside, true); }
function outside(e) { if (openPop && !openPop.contains(e.target) && !e.target.closest('.fb-drop')) closePop(); }

function palette(anchor, { highlight = false, current, onPick }) {
  closePop();
  const pick = (c) => { onPick(c); closePop(); };
  const sw = (c) => h('button', { class: `pal-sw${c === current ? ' on' : ''}`, style: `background:${c}`, title: c, 'aria-label': `Màu ${c}`, onclick: () => pick(c) });
  const pop = h('div', { class: 'palette', role: 'dialog', 'aria-label': highlight ? 'Màu tô nền chữ' : 'Màu chữ' });
  if (highlight) {
    pop.append(h('button', { class: 'pal-none', onclick: () => pick(null) }, 'Không tô màu'), h('div', { class: 'pal-grid pal-5' }, HIGHLIGHT.map(sw)));
  } else {
    pop.append(h('button', { class: 'pal-none', onclick: () => pick('#000000') }, h('span', { class: 'pal-sw', style: 'background:#000' }), 'Tự động (đen)'));
    pop.append(h('div', { class: 'pal-title' }, 'Màu chủ đề'), h('div', { class: 'pal-grid' }, THEME.map(sw)));
    const cols = THEME.map(shades);
    pop.append(h('div', { class: 'pal-grid pal-shades' }, [0, 1, 2, 3, 4].flatMap((r) => cols.map((c) => sw(c[r])))));
    pop.append(h('div', { class: 'pal-title' }, 'Màu chuẩn'), h('div', { class: 'pal-grid' }, STANDARD.map(sw)));
  }
  const custom = h('input', { type: 'color', value: current || '#000000', class: 'pal-custom-input' });
  custom.addEventListener('change', () => pick(custom.value));
  pop.append(h('label', { class: 'pal-more' }, h('span', { html: icon('pencil', 14) }), 'Màu khác...', custom));
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`;
  pop.style.top = `${r.bottom + 6 + ph > window.innerHeight ? Math.max(8, r.top - ph - 6) : r.bottom + 6}px`;
  openPop = pop;
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
}

/**
 * state: { font, size, color, bg, bold, italic, underline, strike, align }
 * text: có hiện các nút dành cho chữ không (false = chỉ hiện màu, dùng cho bút vẽ / khung)
 */
export function createFormatBar(state, onChange) {
  const bar = h('div', { class: 'formatbar' });

  // Phông chữ
  const font = h('select', { class: 'fb-font', 'aria-label': 'Phông chữ', title: 'Phông chữ' });
  const groups = {};
  for (const f of FONTS) {
    if (!groups[f.group]) { groups[f.group] = h('optgroup', { label: f.group }); font.append(groups[f.group]); }
    groups[f.group].append(h('option', { value: f.id }, f.label));
  }
  font.addEventListener('change', () => { state.font = font.value; paintFont(); onChange('font'); });
  const paintFont = () => { font.style.fontFamily = fontCss(state.font); };

  // Cỡ chữ: gõ số tùy ý hoặc chọn từ danh sách
  const listId = `fb-sizes-${Math.random().toString(36).slice(2, 7)}`;
  const size = h('input', { class: 'fb-size', type: 'number', min: 4, max: 200, step: 0.5, list: listId, 'aria-label': 'Cỡ chữ', title: 'Cỡ chữ (gõ số hoặc chọn)', inputmode: 'decimal' });
  const dl = h('datalist', { id: listId }, SIZES.map((s) => h('option', { value: s })));
  const setSize = (v) => { v = Math.max(4, Math.min(200, Math.round(v * 2) / 2 || state.size)); state.size = v; size.value = v; onChange('size'); };
  size.addEventListener('change', () => setSize(+size.value));
  size.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setSize(+size.value); } });
  const grow = (dir) => {
    const cur = state.size;
    const next = dir > 0 ? SIZES.find((s) => s > cur) ?? cur + 4 : [...SIZES].reverse().find((s) => s < cur) ?? Math.max(4, cur - 1);
    setSize(next);
  };

  // Nút bật/tắt
  const toggle = (k, label, content, style = '') => {
    const b = h('button', { class: 'fb-btn', 'data-k': k, title: label, 'aria-label': label, 'aria-pressed': 'false', style, onclick: () => { state[k] = !state[k]; sync(); onChange(k); } });
    b.innerHTML = content;
    return b;
  };
  const alignBtn = (a, label, ic) => h('button', { class: 'fb-btn', 'data-align': a, title: label, 'aria-label': label, 'aria-pressed': 'false', html: ic, onclick: () => { state.align = a; sync(); onChange('align'); } });

  // Màu chữ & màu tô nền
  const colorBar = h('span', { class: 'fb-colorbar' });
  const colorBtn = h('button', { class: 'fb-btn fb-drop', title: 'Màu chữ', 'aria-label': 'Màu chữ' }, h('span', { class: 'fb-A' }, 'A'), colorBar);
  colorBtn.addEventListener('click', () => palette(colorBtn, { current: state.color, onPick: (c) => { state.color = c; sync(); onChange('color'); } }));
  const bgBar = h('span', { class: 'fb-colorbar' });
  const bgBtn = h('button', { class: 'fb-btn fb-drop', title: 'Màu tô nền chữ', 'aria-label': 'Màu tô nền chữ' }, h('span', { html: icon('highlighter', 16) }), bgBar);
  bgBtn.addEventListener('click', () => palette(bgBtn, { highlight: true, current: state.bg, onPick: (c) => { state.bg = c; sync(); onChange('bg'); } }));

  const alignIcons = {
    left: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h12M3 18h16"/></svg>',
    center: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M6 12h12M4 18h16"/></svg>',
    right: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M9 12h12M5 18h16"/></svg>',
  };

  bar.append(
    h('div', { class: 'fb-group' }, font),
    h('div', { class: 'fb-group' },
      h('button', { class: 'fb-btn', title: 'Giảm cỡ chữ', 'aria-label': 'Giảm cỡ chữ', onclick: () => grow(-1), html: '<span style="font-size:.8em">A</span><sup>−</sup>' }),
      size, dl,
      h('button', { class: 'fb-btn', title: 'Tăng cỡ chữ', 'aria-label': 'Tăng cỡ chữ', onclick: () => grow(1), html: 'A<sup>+</sup>' })),
    h('div', { class: 'fb-group' },
      toggle('bold', 'Đậm (Ctrl+B)', 'B', 'font-weight:800'),
      toggle('italic', 'Nghiêng (Ctrl+I)', 'I', 'font-style:italic;font-family:Georgia,serif'),
      toggle('underline', 'Gạch chân (Ctrl+U)', 'U', 'text-decoration:underline'),
      toggle('strike', 'Gạch ngang', 'S', 'text-decoration:line-through')),
    h('div', { class: 'fb-group' }, colorBtn, bgBtn),
    h('div', { class: 'fb-group' }, alignBtn('left', 'Căn trái', alignIcons.left), alignBtn('center', 'Căn giữa', alignIcons.center), alignBtn('right', 'Căn phải', alignIcons.right)));

  function sync() {
    font.value = state.font; paintFont();
    size.value = state.size;
    $$('[data-k]', bar).forEach((b) => b.setAttribute('aria-pressed', String(!!state[b.dataset.k])));
    $$('[data-align]', bar).forEach((b) => b.setAttribute('aria-pressed', String(state.align === b.dataset.align)));
    colorBar.style.background = state.color;
    bgBar.style.background = state.bg || 'transparent';
    bgBar.classList.toggle('none', !state.bg);
  }
  sync();
  return { el: bar, sync };
}

/** Chỉ một nút chọn màu (cho bút vẽ, khung, tô sáng ở các công cụ khác) */
export function colorButton(state, onChange, label = 'Màu') {
  const bar = h('span', { class: 'fb-colorbar' });
  const btn = h('button', { class: 'fb-btn fb-drop fb-wide', title: label, 'aria-label': label }, h('span', { html: icon('pencil', 16) }), h('span', { class: 'fb-lbl' }, label), bar);
  const sync = () => { bar.style.background = state.color; };
  btn.addEventListener('click', () => palette(btn, { current: state.color, onPick: (c) => { state.color = c; sync(); onChange('color'); } }));
  sync();
  return { el: btn, sync };
}
export { closePop as closePalette, $ };
