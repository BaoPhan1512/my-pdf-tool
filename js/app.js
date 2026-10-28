// Ứng dụng chính: điều hướng, trang chủ, luồng Tải lên → Tùy chọn → Tải xuống
import {
  h, $, $$, toast, modal, isPdf, isImage, formatSize, openPdfjs, thumbnail, downloadBlob, PasswordError, escapeHtml,
  parseRanges, rangesToPages,
} from './core.js';
import { TOOLS, GUIDES, CATEGORIES, toolById, guideById } from './tools.js';
import { createEditor } from './editor.js';
import { icon } from './icons.js';

const view = $('#view');
const APP_NAME = 'PDF Tiện Ích';
let carry = null; // file kết quả chuyển sang công cụ tiếp theo

/* ================= Điều hướng ================= */
function route() {
  const path = location.hash.replace(/^#\/?/, '');
  const [id, anchor] = path.split('/');
  window.scrollTo(0, 0);
  $$('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.route === (id || 'home') || (anchor && a.dataset.route === anchor)));
  if (!id || id === 'cong-cu') return renderHome(anchor);
  const tool = toolById(id);
  if (tool) return renderTool(tool);
  const guide = guideById(id);
  if (guide) return renderGuide(guide);
  renderHome();
}
window.addEventListener('hashchange', route);

/* ================= Khung trang ================= */
function buildShell() {
  const side = $('#sidebar');
  const bottom = $('#bottomnav');
  const items = [{ id: 'home', name: 'Trang chủ', icon: 'house', href: '#/' }, ...CATEGORIES.map((c) => ({ id: c.id, name: c.name, icon: c.icon, href: `#/cong-cu/${c.id}` }))];
  for (const it of items) {
    side.append(h('a', { class: 'nav-link', href: it.href, 'data-route': it.id, html: `${icon(it.icon, 22)}<span>${it.name}</span>` }));
  }
  for (const it of items.filter((i) => ['home', 'organize', 'optimize', 'convert', 'edit', 'sign'].includes(i.id))) {
    bottom.append(h('a', { class: 'nav-link', href: it.href, 'data-route': it.id, html: `${icon(it.icon, 22)}<span>${it.name}</span>` }));
  }
}

const toolIcon = (t, size = 20) => h('span', { class: 'tool-icon', style: `--c:${t.color}`, html: icon(t.icon, size) });
function toolCard(t, href = `#/${t.id}`) {
  return h('a', { class: 'tool-card', href },
    toolIcon(t),
    h('span', { class: 'tool-card-text' }, h('span', { class: 'tool-card-name' }, t.name), h('span', { class: 'tool-card-desc' }, t.desc)));
}

/* ================= Trang chủ ================= */
function renderHome(anchor) {
  document.title = `${APP_NAME} – Công cụ PDF miễn phí, riêng tư`;
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Tìm công cụ: gộp, nén, ký tên...', 'aria-label': 'Tìm công cụ' });
  const results = h('div', { class: 'grid', hidden: true });
  const sections = h('div');

  const all = [...TOOLS, ...GUIDES];
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
  search.addEventListener('input', () => {
    const q = norm(search.value.trim());
    sections.hidden = !!q; results.hidden = !q;
    results.innerHTML = '';
    if (!q) return;
    const found = all.filter((t) => norm(`${t.name} ${t.desc}`).includes(q));
    found.forEach((t) => results.append(toolCard(t)));
    if (!found.length) results.append(h('p', { class: 'muted' }, 'Không tìm thấy công cụ phù hợp.'));
  });

  const quick = dropzone({ accept: 'application/pdf,image/*', multiple: true, label: 'Chọn file', sub: 'hoặc kéo thả file PDF / ảnh vào đây để chọn công cụ' }, (files) => suggestTools(files));

  sections.append(
    h('section', { class: 'section' }, h('h2', {}, 'Công cụ PDF thông dụng nhất'), h('div', { class: 'grid' }, TOOLS.filter((t) => t.popular).map((t) => toolCard(t)))),
    ...CATEGORIES.map((c) => h('section', { class: 'section', id: `cat-${c.id}` },
      h('h2', {}, c.name),
      h('div', { class: 'grid' }, [...TOOLS, ...GUIDES].filter((t) => t.cat === c.id).map((t) => toolCard(t))))));

  view.replaceChildren(
    h('section', { class: 'hero' },
      h('h1', {}, 'Mọi công cụ PDF bạn cần, ', h('span', { class: 'accent' }, 'miễn phí'), ' và riêng tư'),
      h('p', { class: 'hero-sub' }, 'Gộp, tách, nén, chuyển đổi, ký tên, khóa PDF ngay trên trình duyệt. File của bạn không bao giờ bị tải lên mạng.'),
      h('div', { class: 'hero-search' }, h('span', { html: icon('search', 18) }), search),
      quick,
      h('ul', { class: 'trust' },
        h('li', { html: `${icon('check', 16)} Miễn phí 100%, không giới hạn` }),
        h('li', { html: `${icon('shield', 16)} Xử lý ngay trên máy bạn` }),
        h('li', { html: `${icon('check', 16)} Không cần tài khoản` }))),
    results, sections);
  if (anchor) requestAnimationFrame(() => $(`#cat-${anchor}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

async function suggestTools(files) {
  const pdf = files.every(isPdf), img = files.every(isImage);
  if (!pdf && !img) { toast('Vui lòng chọn file PDF hoặc ảnh (không trộn lẫn)', 'error'); return; }
  const list = TOOLS.filter((t) => (pdf ? t.accept === 'pdf' : t.accept === 'image') && (files.length === 1 || t.multiple));
  const body = h('div', { class: 'grid grid-compact' }, list.map((t) => {
    const card = toolCard(t, `#/${t.id}`);
    card.addEventListener('click', () => { carry = files; });
    return card;
  }));
  const p = modal(`Bạn muốn làm gì với ${files.length > 1 ? `${files.length} file` : `"${files[0].name}"`}?`, body);
  body.addEventListener('click', (e) => { if (e.target.closest('a')) $('.modal-overlay')?.remove(); });
  await p;
}

/* ================= Hộp kéo thả ================= */
function dropzone({ accept, multiple, label = 'Chọn file', sub }, onFiles) {
  const inp = h('input', { type: 'file', accept, multiple, hidden: true });
  inp.addEventListener('change', () => { if (inp.files.length) onFiles([...inp.files]); inp.value = ''; });
  const dz = h('div', { class: 'dropzone', tabindex: '0', role: 'button', 'aria-label': label },
    h('div', { class: 'dz-icon', html: icon('upload', 28) }),
    h('button', { class: 'btn btn-primary btn-lg', type: 'button', html: `${icon('folder-open', 20)} ${label}` }),
    h('div', { class: 'dz-sub' }, sub || (multiple ? 'hoặc kéo thả các file vào đây' : 'hoặc kéo thả file vào đây')),
    inp);
  dz.addEventListener('click', () => inp.click());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); });
  return dz;
}

/* ================= Trang hướng dẫn ================= */
function renderGuide(g) {
  document.title = `${g.name} – ${APP_NAME}`;
  view.replaceChildren(h('div', { class: 'tool-page' },
    toolHeader(g),
    h('article', { class: 'card guide', html: g.html })));
}

function toolHeader(t) {
  return h('div', { class: 'tool-head' },
    h('a', { class: 'back', href: '#/', html: `${icon('chevron-left', 18)} Tất cả công cụ` }),
    h('div', { class: 'tool-title' }, toolIcon(t, 26), h('div', {}, h('h1', {}, t.name), h('p', {}, t.desc))));
}

/* ================= Trang công cụ ================= */
function renderTool(tool) {
  document.title = `${tool.name} – ${APP_NAME}`;
  const page = h('div', { class: 'tool-page' });
  view.replaceChildren(page);
  const accept = tool.accept === 'pdf' ? 'application/pdf,.pdf' : 'image/*';

  const start = (files) => {
    const ok = files.filter((f) => (tool.accept === 'pdf' ? isPdf(f) : isImage(f)));
    if (ok.length < files.length) toast(tool.accept === 'pdf' ? 'Chỉ nhận file PDF, đã bỏ qua file khác' : 'Chỉ nhận file ảnh, đã bỏ qua file khác', 'error');
    if (!ok.length) return;
    workspace(tool, page, tool.multiple ? ok : [ok[0]]);
  };

  if (carry) { const f = carry; carry = null; start(f); return; }
  page.replaceChildren(
    toolHeader(tool),
    dropzone({ accept, multiple: !!tool.multiple, label: tool.accept === 'pdf' ? (tool.multiple ? 'Chọn các file PDF' : 'Chọn file PDF') : 'Chọn ảnh' }, start),
    h('p', { class: 'privacy', html: `${icon('shield', 16)} File được xử lý ngay trên thiết bị của bạn và không được tải lên bất kỳ máy chủ nào.` }));
}

async function askPassword(file) {
  const inp = h('input', { class: 'input', type: 'password', placeholder: 'Mật khẩu', autocomplete: 'current-password' });
  const body = h('div', {}, h('p', {}, `File "${file.name}" được bảo vệ bằng mật khẩu. Nhập mật khẩu để tiếp tục:`), inp);
  setTimeout(() => inp.focus(), 50);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.modal-actions .btn-primary')?.click(); });
  const ok = await modal('PDF có mật khẩu', body, [{ label: 'Hủy', value: null }, { label: 'Mở file', primary: true, value: 'ok' }]);
  return ok === 'ok' ? inp.value : null;
}

/** Mở file PDF, hỏi mật khẩu nếu cần. Trả về {pdf, password} hoặc null */
async function openWithPassword(file) {
  try { return { pdf: await openPdfjs(file), password: undefined }; } catch (e) {
    if (!(e instanceof PasswordError)) { toast(`${file.name}: ${e.message}`, 'error'); return null; }
  }
  for (;;) {
    const pw = await askPassword(file);
    if (pw == null) return null;
    try { return { pdf: await openPdfjs(file, pw), password: pw }; } catch { toast('Sai mật khẩu, vui lòng thử lại', 'error'); }
  }
}

async function workspace(tool, page, initialFiles) {
  const opts = structuredClone({ ...(tool.defaults || {}), image: null });
  if (tool.defaults?.image === null) opts.image = null;
  let files = [];
  const passwords = new Map();
  const ctx = { pageCount: 0 };
  let editor = null;
  let pages = [];

  page.replaceChildren(toolHeader(tool), h('div', { class: 'loading' }, h('div', { class: 'spinner' }), 'Đang mở file...'));

  // Kiểm tra file / mật khẩu
  const accepted = [];
  for (const f of initialFiles) {
    if (tool.accept === 'pdf' && !tool.allowLocked) {
      const r = await openWithPassword(f);
      if (!r) continue;
      if (r.password) passwords.set(f, r.password);
      if (!ctx.pageCount) ctx.pageCount = r.pdf.numPages;
    }
    accepted.push(f);
  }
  if (!accepted.length) { renderTool(tool); return; }
  files = accepted;

  const main = h('div', { class: 'ws-main' });
  const side = h('aside', { class: 'ws-side' });
  const actionBtn = h('button', { class: 'btn btn-primary btn-lg btn-block', html: `${tool.action} ${icon('arrow-right', 20)}` });
  const layout = h('div', { class: `workspace ws-${tool.workspace}` }, main, side);
  page.replaceChildren(toolHeader(tool), layout);

  // ----- Bảng tùy chọn -----
  const optBox = h('div', { class: 'ws-options' });
  if (tool.options) optBox.append(tool.options(opts, ctx));
  side.append(h('h3', { class: 'ws-side-title' }, tool.workspace === 'editor' ? 'Hoàn tất' : 'Tùy chọn'), optBox, h('div', { class: 'ws-action' }, actionBtn));
  if (!tool.options && tool.workspace !== 'editor') optBox.append(h('p', { class: 'muted' }, tool.multiple ? 'Kéo thả để sắp xếp thứ tự file.' : 'Sẵn sàng xử lý.'));

  // ----- Vùng nội dung -----
  if (tool.workspace === 'files') renderFiles();
  if (tool.workspace === 'single') renderSingle();
  if (tool.workspace === 'pages') await renderPages();
  if (tool.workspace === 'editor') {
    editor = createEditor(main, files[0], tool.editorMode, passwords.get(files[0]));
    optBox.prepend(h('p', { class: 'muted file-line', html: `${icon('file', 16)} ${escapeHtml(files[0].name)} · ${formatSize(files[0].size)}` }));
  }

  function renderFiles() {
    const grid = h('div', { class: 'file-grid' });
    const addMore = h('button', { class: 'file-card add-card', type: 'button', html: `${icon('plus', 28)}<span>Thêm file</span>` });
    const inp = h('input', { type: 'file', hidden: true, multiple: true, accept: tool.accept === 'pdf' ? 'application/pdf,.pdf' : 'image/*' });
    addMore.addEventListener('click', () => inp.click());
    inp.addEventListener('change', async () => {
      for (const f of [...inp.files]) {
        if (tool.accept === 'pdf') {
          if (!isPdf(f)) continue;
          const r = await openWithPassword(f); if (!r) continue;
          if (r.password) passwords.set(f, r.password);
        } else if (!isImage(f)) continue;
        files.push(f); grid.insertBefore(fileCard(f), addMore);
      }
      inp.value = '';
    });
    const fileCard = (f) => {
      const thumbBox = h('div', { class: 'fc-thumb' });
      const card = h('div', { class: 'file-card' },
        h('button', { class: 'fc-remove', 'aria-label': 'Bỏ file này', html: '&times;', onclick: () => { files = files.filter((x) => x !== f); card.remove(); } }),
        thumbBox, h('div', { class: 'fc-name', title: f.name }, f.name), h('div', { class: 'fc-size' }, formatSize(f.size)));
      card._file = f;
      if (isPdf(f)) thumbnail(f, 1, 160, passwords.get(f)).then((c) => thumbBox.append(c)).catch(() => { thumbBox.innerHTML = icon('file', 40); });
      else { const url = URL.createObjectURL(f); thumbBox.append(h('img', { src: url, alt: '' })); }
      return card;
    };
    files.forEach((f) => grid.append(fileCard(f)));
    grid.append(addMore, inp);
    main.append(h('p', { class: 'muted ws-hint' }, 'Kéo thả các ô để đổi thứ tự.'), grid);
    window.Sortable?.create(grid, {
      animation: 150, filter: '.add-card,.fc-remove', preventOnFilter: false, draggable: '.file-card:not(.add-card)',
      onEnd: () => { files = $$('.file-card', grid).filter((c) => c._file).map((c) => c._file); },
    });
  }

  async function renderSingle() {
    const f = files[0];
    const thumbBox = h('div', { class: 'single-thumb' });
    main.append(h('div', { class: 'single' }, thumbBox,
      h('div', { class: 'single-info' },
        h('div', { class: 'fc-name' }, f.name),
        h('div', { class: 'muted' }, `${formatSize(f.size)}${ctx.pageCount ? ` · ${ctx.pageCount} trang` : ''}`),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => renderTool(tool) }, 'Chọn file khác'))));
    if (tool.allowLocked) { thumbBox.innerHTML = icon('lock', 56); thumbBox.classList.add('locked'); return; }
    const c = await thumbnail(f, 1, 320, passwords.get(f)).catch(() => null);
    if (!c) { thumbBox.innerHTML = icon('file', 56); return; }
    thumbBox.append(c);
    if (tool.preview === 'crop') {
      const shade = h('div', { class: 'crop-shade' });
      thumbBox.append(shade);
      ctx.updatePreview = () => { shade.style.inset = `${opts.top}% ${opts.right}% ${opts.bottom}% ${opts.left}%`; };
      ctx.updatePreview();
    }
  }

  async function renderPages() {
    const f = files[0];
    const pdf = await openPdfjs(f, passwords.get(f));
    pages = Array.from({ length: pdf.numPages }, (_, i) => ({ index: i, rotate: 0, selected: false, deleted: false }));
    const grid = h('div', { class: 'page-grid' });
    const bar = h('div', { class: 'pages-bar' });
    const mode = tool.pageMode;
    const counter = h('span', { class: 'muted' });
    const refreshCount = () => {
      if (mode === 'select') counter.textContent = `Đã chọn ${pages.filter((p) => p.selected).length} / ${pages.length} trang`;
    };
    if (mode === 'select') {
      const rng = h('input', { class: 'input input-sm', placeholder: 'VD: 1-3, 5' });
      const applyRange = () => {
        try {
          const set = rangesToPages(parseRanges(rng.value, pages.length));
          pages.forEach((p) => { p.selected = set.includes(p.index + 1); });
          syncAll();
        } catch (e) { toast(e.message, 'error'); }
      };
      rng.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyRange(); });
      bar.append(h('strong', {}, tool.selectLabel), counter,
        h('div', { class: 'bar-group' }, rng, h('button', { class: 'btn btn-ghost btn-sm', onclick: applyRange }, 'Chọn theo số trang'),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { pages.forEach((p) => { p.selected = true; }); syncAll(); } }, 'Chọn tất cả'),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { pages.forEach((p) => { p.selected = false; }); syncAll(); } }, 'Bỏ chọn')));
    } else {
      bar.append(h('strong', {}, mode === 'organize' ? 'Kéo thả để đổi thứ tự trang' : 'Xoay từng trang hoặc tất cả'),
        h('div', { class: 'bar-group' },
          h('button', { class: 'btn btn-ghost btn-sm', html: `${icon('rotate-ccw', 16)} Xoay trái tất cả`, onclick: () => { pages.forEach((p) => { p.rotate = (p.rotate + 270) % 360; }); syncAll(); } }),
          h('button', { class: 'btn btn-ghost btn-sm', html: `${icon('rotate-cw', 16)} Xoay phải tất cả`, onclick: () => { pages.forEach((p) => { p.rotate = (p.rotate + 90) % 360; }); syncAll(); } })));
    }
    const cards = [];
    const sync = (p, card) => {
      card.classList.toggle('selected', p.selected);
      card.classList.toggle('deleted', p.deleted);
      $('.pc-thumb', card).style.transform = `rotate(${p.rotate}deg)`;
    };
    function syncAll() { pages.forEach((p, i) => sync(p, cards[i])); refreshCount(); }
    for (const p of pages) {
      const thumbBox = h('div', { class: 'pc-thumb' });
      const tools = h('div', { class: 'pc-tools' });
      const card = h('div', { class: 'page-card', 'data-i': p.index }, h('div', { class: 'pc-frame' }, thumbBox), tools, h('div', { class: 'pc-num' }, `${p.index + 1}`));
      if (mode === 'select') {
        card.setAttribute('role', 'checkbox'); card.tabIndex = 0;
        card.append(h('span', { class: 'pc-check', html: icon('check', 16) }));
        const toggle = () => { p.selected = !p.selected; sync(p, card); refreshCount(); card.setAttribute('aria-checked', String(p.selected)); };
        card.addEventListener('click', toggle);
        card.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } });
      } else {
        tools.append(h('button', { class: 'pc-btn', 'aria-label': 'Xoay trái', html: icon('rotate-ccw', 16), onclick: () => { p.rotate = (p.rotate + 270) % 360; sync(p, card); } }),
          h('button', { class: 'pc-btn', 'aria-label': 'Xoay phải', html: icon('rotate-cw', 16), onclick: () => { p.rotate = (p.rotate + 90) % 360; sync(p, card); } }));
        if (mode === 'organize') tools.append(h('button', { class: 'pc-btn', 'aria-label': 'Xóa / khôi phục trang', html: icon('trash-2', 16), onclick: () => { p.deleted = !p.deleted; sync(p, card); } }));
      }
      card._page = p;
      cards.push(card); grid.append(card);
      thumbnail(f, p.index + 1, 150, passwords.get(f)).then((c) => thumbBox.append(c)).catch(() => {});
    }
    refreshCount();
    main.append(bar, grid);
    if (mode === 'organize' && window.Sortable) {
      window.Sortable.create(grid, { animation: 150, filter: '.pc-btn', preventOnFilter: false, onEnd: () => { pages = $$('.page-card', grid).map((c) => c._page); $$('.pc-num', grid).forEach((n, i) => { n.textContent = `${i + 1}`; }); } });
    }
  }

  // ----- Xử lý -----
  actionBtn.addEventListener('click', async () => {
    if (tool.minFiles && files.length < tool.minFiles) { toast(`Cần ít nhất ${tool.minFiles} file`, 'error'); return; }
    if (!files.length) { toast('Chưa có file nào', 'error'); return; }
    const overlay = h('div', { class: 'processing' }, h('div', { class: 'proc-box' },
      h('div', { class: 'spinner' }), h('div', { class: 'proc-text' }, 'Đang xử lý...'), h('div', { class: 'progress' }, h('div', { class: 'progress-bar' }))));
    document.body.append(overlay);
    const progress = (i, n, text) => {
      $('.proc-text', overlay).textContent = text || 'Đang xử lý...';
      $('.progress-bar', overlay).style.width = `${Math.round((i / n) * 100)}%`;
    };
    await new Promise((r) => setTimeout(r, 30));
    try {
      const results = await tool.run({ files, opts, passwords, password: passwords.get(files[0]), progress, pages, editor });
      overlay.remove();
      showResult(tool, page, results);
    } catch (e) {
      overlay.remove();
      console.error(e);
      toast(e.message || 'Đã có lỗi xảy ra, vui lòng thử lại', 'error', 6000);
    }
  });
}

/* ================= Màn hình kết quả ================= */
function showResult(tool, page, results) {
  window.scrollTo(0, 0);
  const main = results[0];
  const many = results.length > 1;
  const box = h('div', { class: 'result card' });
  box.append(h('div', { class: 'result-ok', html: icon('check', 36) }), h('h2', {}, 'Hoàn tất!'));
  if (results.note) box.append(h('p', { class: 'result-note' }, results.note));
  if (results.sizes) {
    box.append(h('div', { class: 'size-compare' },
      h('div', {}, h('small', {}, 'Trước'), h('strong', {}, formatSize(results.sizes.before))),
      h('span', { html: icon('arrow-right', 20) }),
      h('div', {}, h('small', {}, 'Sau'), h('strong', { class: 'accent' }, formatSize(results.sizes.after)))));
  }
  box.append(h('div', { class: 'result-file', html: `${icon('file', 18)} ${escapeHtml(main.name)} · ${formatSize(main.blob.size)}` }));
  box.append(h('button', { class: 'btn btn-primary btn-lg', onclick: () => downloadBlob(main.blob, main.name), html: `${icon('download', 20)} Tải xuống${many ? ' tất cả (.zip)' : ''}` }));

  if (results.text != null) {
    const ta = h('textarea', { class: 'input text-out', readonly: true, rows: 10 }); ta.value = results.text;
    box.append(ta, h('div', { class: 'row-btns' },
      h('button', { class: 'btn btn-ghost', html: `${icon('copy', 18)} Sao chép`, onclick: async () => { try { await navigator.clipboard.writeText(results.text); toast('Đã sao chép', 'success'); } catch { ta.select(); document.execCommand('copy'); toast('Đã sao chép', 'success'); } } }),
      h('a', { class: 'btn btn-ghost', href: 'https://claude.ai/new', target: '_blank', rel: 'noopener' }, 'Mở Claude'),
      h('a', { class: 'btn btn-ghost', href: 'https://gemini.google.com', target: '_blank', rel: 'noopener' }, 'Mở Gemini'),
      h('a', { class: 'btn btn-ghost', href: 'https://chatgpt.com', target: '_blank', rel: 'noopener' }, 'Mở ChatGPT')));
  }

  if (many) {
    const list = h('ul', { class: 'result-list' });
    results.slice(1).forEach((r) => list.append(h('li', {}, h('span', {}, r.name), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => downloadBlob(r.blob, r.name), html: icon('download', 16) }))));
    box.append(h('details', { class: 'result-more' }, h('summary', {}, `Tải từng file (${results.length - 1})`), list));
  }

  // Tiếp tục với công cụ khác
  const outIsPdf = !many && main.name.endsWith('.pdf');
  const next = h('div', { class: 'next' });
  if (outIsPdf) {
    const f = new File([main.blob], main.name, { type: 'application/pdf' });
    const nextTools = TOOLS.filter((t) => t.accept === 'pdf' && t.id !== tool.id && !t.allowLocked).slice(0, 12);
    next.append(h('h3', {}, 'Tiếp tục với file này'), h('div', { class: 'chips' }, nextTools.map((t) => {
      const a = h('a', { class: 'chip', href: `#/${t.id}` }, toolIcon(t, 16), t.name);
      a.addEventListener('click', () => { carry = [f]; });
      return a;
    })));
  }
  page.replaceChildren(toolHeader(tool), box, next,
    h('div', { class: 'restart' }, h('button', { class: 'btn btn-ghost', onclick: () => renderTool(tool) }, 'Làm lại với file khác'), h('a', { class: 'btn btn-ghost', href: '#/' }, 'Về trang chủ')));
}

/* ================= Khởi động ================= */
buildShell();
route();
