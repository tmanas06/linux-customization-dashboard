import { WIDGETS } from './widgets.js';
import { TIMEZONES } from './widgets-clocks.js';
import { ICONS } from './icons.js';
import { findFreeSlot, tryPlace, assignSlots, clampToColumns, overlaps } from './layout.js';

const dash = window.dashboard;
const $ = (s) => document.querySelector(s);

const grid = $('#grid');
const btnAdd = $('#btn-add');
const btnEdit = $('#btn-edit');
const btnReset = $('#btn-reset');
const btnDesktop = $('#btn-desktop');
const btnSave = $('#btn-save');
const toast = $('#toast');
const desktopBg = $('#desktop-bg');
const previewHint = $('#preview-hint');
const selTheme = $('#sel-theme');
const inAccent = $('#in-accent');
const drawer = $('#drawer');
const drawerList = $('#drawer-list');
const overlay = $('#modal-overlay');
const modalTitle = $('#modal-title');
const modalBody = $('#modal-body');

let config = null;
let editMode = false;
let saveTimer = null;
let toastTimer = null;
let cols = 6;
let modalCollector = null;
let selectedId = null;
let drag = null;
let resize = null;

const disposers = new Map();
const cardBodies = new Map();

const api = {
  isEditing: () => editMode,
  save: () => scheduleSave(),
  getStats: () => dash.getStats(),
  openExternal: (url) => dash.openExternal(url),
  remount: (item) => remountItem(item)
};

function uid() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

function mkItem(type) {
  const def = WIDGETS[type];
  return {
    id: uid(),
    type,
    x: null,
    y: null,
    w: def.defaultSize.w,
    h: def.defaultSize.h,
    locked: false,
    settings: JSON.parse(JSON.stringify(def.defaults))
  };
}

function defaultLayout() {
  const layout = ['digitalClock', 'analogClock', 'systemMonitor', 'calendar', 'worldClock', 'todo', 'notes'].map(mkItem);
  assignSlots(layout, 6);
  return layout;
}

function defaultConfig() {
  return {
    version: 1,
    theme: 'dark',
    accent: '',
    desktop: { enabled: false, cols: 6, margin: 40, opacity: 80, rowH: 100 },
    layout: defaultLayout()
  };
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => dash.saveConfig(config), 300);
}

function saveNow() {
  clearTimeout(saveTimer);
  dash.saveConfig(config);
  showToast('Saved — your desktop is up to date');
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function applyTheme() {
  document.body.dataset.theme = config.theme || 'dark';
  document.documentElement.style.setProperty('--accent', config.accent || '');
  selTheme.value = config.theme || 'dark';
  inAccent.value = config.accent || '#4da3ff';
}

function computeCols() {
  const cfgCols = Number(config && config.desktop && config.desktop.cols);
  if (cfgCols) return clamp(cfgCols, 2, 8);
  const w = window.innerWidth;
  return w >= 1280 ? 6 : w >= 900 ? 4 : 2;
}

function applyDesktopStyles() {
  const d = (config && config.desktop) || {};
  cols = computeCols();
  grid.style.setProperty('--cols', cols);
  grid.style.setProperty('--rowh', `${clamp(Number(d.rowH) || 100, 70, 200)}px`);
  const m = clamp(Number(d.margin ?? 40), 0, 300);
  grid.style.padding = `6px ${Math.min(m, 60)}px ${Math.max(24, m)}px`;
  document.documentElement.style.setProperty('--widget-op', clamp(Number(d.opacity ?? 100), 10, 100));
}

async function loadWallpaper() {
  try {
    const wp = await dash.getWallpaper();
    if (wp && wp.dataUrl) {
      desktopBg.style.backgroundImage = `url("${wp.dataUrl}")`;
      document.body.classList.add('has-wallpaper');
    }
  } catch {}
}

function updatePreviewHint() {
  const enabled = !!(config && config.desktop && config.desktop.enabled);
  previewHint.textContent = !enabled
    ? 'Desktop mode is off — click "Desktop" to put these widgets on your homescreen'
    : 'Live preview of your desktop — drag to arrange, Save puts it on your screen';
}

function applyDesktopBtn() {
  btnDesktop.classList.toggle('active', !!(config.desktop && config.desktop.enabled));
  updatePreviewHint();
}

function disposeAll() {
  for (const d of disposers.values()) {
    try { d(); } catch {}
  }
  disposers.clear();
  cardBodies.clear();
}

function disposeItem(id) {
  const d = disposers.get(id);
  if (d) {
    try { d(); } catch {}
  }
  disposers.delete(id);
}

function mountWidget(item, body) {
  const def = WIDGETS[item.type];
  try {
    const result = def.mount(body, item, api);
    if (typeof result === 'function') disposers.set(item.id, result);
  } catch (err) {
    body.textContent = `Widget error: ${err.message}`;
  }
}

function remountItem(item) {
  const body = cardBodies.get(item.id);
  if (!body) return;
  disposeItem(item.id);
  body.replaceChildren();
  mountWidget(item, body);
}

function iconBtn(icon, cls, title) {
  const b = document.createElement('button');
  b.className = cls;
  b.type = 'button';
  b.title = title;
  b.innerHTML = icon;
  return b;
}

function applyItemStyle(el, item) {
  el.style.gridColumn = `${item.x + 1} / span ${Math.min(item.w, cols)}`;
  el.style.gridRow = `${item.y + 1} / span ${item.h}`;
}

function syncPositions() {
  for (const item of config.layout) {
    const el = grid.querySelector(`.widget[data-id="${item.id}"]`);
    if (el) applyItemStyle(el, item);
  }
}

function applySim(sim) {
  const map = new Map(sim.map((s) => [s.id, s]));
  for (const item of config.layout) {
    const s = map.get(item.id);
    if (s) {
      item.x = s.x;
      item.y = s.y;
      item.w = s.w;
      item.h = s.h;
    }
  }
}

function selectItem(id) {
  selectedId = id;
  grid.querySelectorAll('.widget.selected').forEach((n) => n.classList.remove('selected'));
  if (id) {
    const el = grid.querySelector(`.widget[data-id="${id}"]`);
    if (el) el.classList.add('selected');
  }
}

function clearSelection() {
  selectItem(null);
}

function normalizeLayout() {
  clampToColumns(config.layout, cols);
  if (assignSlots(config.layout, cols)) scheduleSave();
}

function showEmptyHintIfNeeded() {
  const hint = grid.querySelector('.grid-hint');
  if (config.layout.length === 0 && !hint) {
    const h = document.createElement('div');
    h.className = 'grid-hint';
    h.textContent = editMode
      ? 'Your dashboard is empty. Drag a widget here from the library, or use "Add widget".'
      : 'Your dashboard is empty. Click "Edit dashboard" to add widgets.';
    grid.appendChild(h);
  } else if (config.layout.length > 0 && hint) {
    hint.remove();
  }
}

function renderAll() {
  disposeAll();
  grid.replaceChildren();
  for (const item of config.layout) grid.appendChild(buildCard(item));
  showEmptyHintIfNeeded();
  if (selectedId && !config.layout.some((i) => i.id === selectedId)) selectedId = null;
  selectItem(selectedId);
}

function setEditing(v) {
  editMode = v;
  document.body.classList.toggle('editing', v);
  btnEdit.textContent = v ? 'Done' : 'Edit dashboard';
  btnEdit.classList.toggle('active', v);
  btnAdd.hidden = !v;
  btnSave.hidden = !v;
  if (!v) {
    clearSelection();
    closeDrawer();
  }
  updatePreviewHint();
  renderAll();
}

function buildCard(item) {
  const def = WIDGETS[item.type];
  const card = document.createElement('section');
  card.className = 'widget' + (item.locked ? ' locked' : '') + (item.id === selectedId ? ' selected' : '');
  card.dataset.id = item.id;
  applyItemStyle(card, item);

  const head = document.createElement('header');
  head.className = 'w-head';
  head.appendChild(Object.assign(document.createElement('span'), {
    className: 'w-title',
    textContent: def.name
  }));
  const actions = document.createElement('div');
  actions.className = 'w-actions';

  const lock = iconBtn(item.locked ? ICONS.unlock : ICONS.lock, 'icon-btn' + (item.locked ? ' active' : ''), item.locked ? 'Unlock widget' : 'Lock widget');
  lock.addEventListener('click', (e) => {
    e.stopPropagation();
    item.locked = !item.locked;
    scheduleSave();
    renderAll();
  });

  const gear = iconBtn(ICONS.gear, 'icon-btn', 'Widget settings');
  gear.addEventListener('click', (e) => {
    e.stopPropagation();
    openSettings(item);
  });
  const del = iconBtn(ICONS.x, 'icon-btn red', 'Remove widget');
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm(`Remove "${def.name}" from the dashboard?`)) return;
    disposeItem(item.id);
    cardBodies.delete(item.id);
    config.layout = config.layout.filter((i) => i.id !== item.id);
    if (selectedId === item.id) clearSelection();
    card.remove();
    showEmptyHintIfNeeded();
    scheduleSave();
  });
  actions.append(lock, gear, del);
  head.appendChild(actions);
  card.appendChild(head);

  const body = document.createElement('div');
  body.className = 'w-body';
  card.appendChild(body);
  cardBodies.set(item.id, body);
  mountWidget(item, body);

  for (const dir of ['e', 's', 'se']) {
    const h = document.createElement('div');
    h.className = `rs-handle rs-${dir}`;
    h.dataset.rs = dir;
    card.appendChild(h);
  }

  card.addEventListener('pointerdown', (e) => onCardPointerDown(e, item, card));

  return card;
}

function gridMetrics() {
  const r = grid.getBoundingClientRect();
  const cs = getComputedStyle(grid);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padT = parseFloat(cs.paddingTop) || 0;
  const gapX = parseFloat(cs.columnGap) || 14;
  const gapY = parseFloat(cs.rowGap) || gapX;
  const padR = parseFloat(cs.paddingRight) || 0;
  const inner = Math.max(0, r.width - padL - padR);
  const colW = (inner - (cols - 1) * gapX) / cols;
  const rowH = parseFloat(cs.gridAutoRows) || 100;
  return { left: r.left, top: r.top, padL, padT, gapX, gapY, colW, rowH };
}

function onCardPointerDown(e, item, card) {
  if (!editMode || e.button !== 0) return;
  if (e.target.closest('button, input, textarea, a, select, [contenteditable="true"]')) return;

  if (e.target.closest('.rs-handle')) {
    if (item.locked) return;
    startResize(e, item, card, e.target.dataset.rs);
    return;
  }

  if (item.locked) {
    selectItem(item.id);
    return;
  }

  const rect = card.getBoundingClientRect();
  drag = {
    id: item.id,
    item,
    el: card,
    startX: e.clientX,
    startY: e.clientY,
    offX: e.clientX - rect.left,
    offY: e.clientY - rect.top,
    started: false,
    placeholder: null,
    sim: null,
    target: null
  };
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragUp);
  e.preventDefault();
}

function startDragVisual() {
  drag.started = true;
  drag.el.classList.add('dragging');
  document.body.classList.add('drag-active');
  const ph = document.createElement('div');
  ph.className = 'drop-placeholder';
  ph.textContent = `${WIDGETS[drag.item.type].name} — ${drag.item.w} × ${drag.item.h}`;
  grid.appendChild(ph);
  drag.placeholder = ph;
}

function onDragMove(e) {
  if (!drag) return;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  if (!drag.started) {
    if (Math.hypot(dx, dy) < 6) return;
    startDragVisual();
  }
  drag.el.style.transform = `translate(${dx}px, ${dy}px)`;

  const m = gridMetrics();
  const { item } = drag;
  const w = Math.min(item.w, cols);
  let c = Math.round(((e.clientX - drag.offX) - m.left - m.padL) / (m.colW + m.gapX));
  let r = Math.round(((e.clientY - drag.offY) - m.top - m.padT) / (m.rowH + m.gapY));
  c = clamp(c, 0, cols - w);
  r = Math.max(0, r);

  const key = `${c},${r}`;
  if (key !== drag.target) {
    drag.target = key;
    const sim = tryPlace(config.layout, item.id, c, r, item.w, item.h);
    drag.sim = sim;
    drag.valid = !!sim;
    drag.placeholder.style.gridColumn = `${c + 1} / span ${w}`;
    drag.placeholder.style.gridRow = `${r + 1} / span ${item.h}`;
    drag.placeholder.classList.toggle('invalid', !sim);
    drag.placeholder.textContent = sim
      ? `${WIDGETS[item.type].name} — ${item.w} × ${item.h}`
      : 'Blocked';
  }
}

function onDragUp(e) {
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragUp);
  if (!drag) return;
  const d = drag;
  drag = null;

  d.el.style.transform = '';
  d.el.classList.remove('dragging');
  document.body.classList.remove('drag-active');
  if (d.placeholder) d.placeholder.remove();

  if (!d.started) {
    selectItem(d.id);
    return;
  }
  if (d.valid && d.sim) {
    applySim(d.sim);
    syncPositions();
    scheduleSave();
  } else if (d.valid === false) {
    showToast('No room there — placement blocked');
  }
  selectItem(d.id);
}

function cancelDrag() {
  if (!drag) return;
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragUp);
  drag.el.style.transform = '';
  drag.el.classList.remove('dragging');
  document.body.classList.remove('drag-active');
  if (drag.placeholder) drag.placeholder.remove();
  drag = null;
}

function startResize(e, item, card, dir) {
  const rect = card.getBoundingClientRect();
  resize = {
    id: item.id,
    item,
    el: card,
    dir,
    startX: e.clientX,
    startY: e.clientY,
    origLeft: rect.left,
    origTop: rect.top,
    origW: item.w,
    origH: item.h,
    started: false,
    pendingW: item.w,
    pendingH: item.h
  };
  const def = WIDGETS[item.type];
  resize.minW = Math.min(def.minW || 1, cols);
  resize.minH = def.minH || 1;
  window.addEventListener('pointermove', onResizeMove);
  window.addEventListener('pointerup', onResizeUp);
  e.preventDefault();
  e.stopPropagation();
}

function onResizeMove(e) {
  if (!resize) return;
  const dx = e.clientX - resize.startX;
  const dy = e.clientY - resize.startY;
  if (!resize.started) {
    if (Math.hypot(dx, dy) < 5) return;
    resize.started = true;
    resize.el.classList.add('resizing');
    document.body.classList.add('drag-active');
  }
  const m = gridMetrics();
  const { item } = resize;
  let nw = resize.origW;
  let nh = resize.origH;

  if (resize.dir !== 's') {
    nw = clamp(Math.round((e.clientX - resize.origLeft) / (m.colW + m.gapX)), resize.minW, cols - item.x);
  }
  if (resize.dir !== 'e') {
    nh = clamp(Math.round((e.clientY - resize.origTop) / (m.rowH + m.gapY)), resize.minH, 6);
  }
  resize.pendingW = nw;
  resize.pendingH = nh;
  resize.el.style.gridColumn = `${item.x + 1} / span ${nw}`;
  resize.el.style.gridRow = `${item.y + 1} / span ${nh}`;
}

function onResizeUp() {
  window.removeEventListener('pointermove', onResizeMove);
  window.removeEventListener('pointerup', onResizeUp);
  if (!resize) return;
  const r = resize;
  resize = null;
  r.el.classList.remove('resizing');
  document.body.classList.remove('drag-active');

  if (!r.started) return;

  if (r.pendingW === r.origW && r.pendingH === r.origH) {
    applyItemStyle(r.el, r.item);
    return;
  }
  const sim = tryPlace(config.layout, r.id, r.item.x, r.item.y, r.pendingW, r.pendingH);
  if (sim) {
    applySim(sim);
    syncPositions();
    scheduleSave();
  } else {
    applyItemStyle(r.el, r.item);
    showToast('Not enough room to resize');
  }
}

function cancelResize() {
  if (!resize) return;
  window.removeEventListener('pointermove', onResizeMove);
  window.removeEventListener('pointerup', onResizeUp);
  resize.el.classList.remove('resizing');
  applyItemStyle(resize.el, resize.item);
  document.body.classList.remove('drag-active');
  resize = null;
}

grid.addEventListener('pointerdown', (e) => {
  if (e.target === grid) clearSelection();
});

function addItem(type) {
  if (!WIDGETS[type]) return;
  const item = mkItem(type);
  config.layout.push(item);
  normalizeLayout();
  if (!editMode) setEditing(true);
  else renderAll();
  scheduleSave();
  closeDrawer();
  selectItem(item.id);
  showToast(`${WIDGETS[type].name} added`);
  requestAnimationFrame(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  });
}

function buildDrawer() {
  drawerList.replaceChildren();
  for (const [type, def] of Object.entries(WIDGETS)) {
    const row = document.createElement('div');
    row.className = 'lib-item';
    const info = document.createElement('div');
    info.className = 'lib-info';
    info.appendChild(Object.assign(document.createElement('div'), { className: 'lib-name', textContent: def.name }));
    info.appendChild(Object.assign(document.createElement('div'), { className: 'lib-desc', textContent: def.desc }));
    const btn = document.createElement('button');
    btn.className = 'btn primary';
    btn.type = 'button';
    btn.textContent = 'Add';
    btn.addEventListener('click', () => addItem(type));
    row.append(info, btn);
    drawerList.appendChild(row);
  }
}

function openDrawer() {
  drawer.classList.add('open');
}
function closeDrawer() {
  drawer.classList.remove('open');
}

function openModal(title, buildBody, collector) {
  modalTitle.textContent = title;
  modalBody.replaceChildren();
  modalCollector = null;
  const c = buildBody(modalBody);
  if (c) modalCollector = c;
  else modalCollector = collector || null;
  overlay.hidden = false;
  $('#btn-modal-save').focus();
}
function closeModal() {
  overlay.hidden = true;
  modalBody.replaceChildren();
  modalCollector = null;
}

function buildField(field, values) {
  const wrap = document.createElement('div');
  wrap.className = 'field';

  if (field.type === 'bool') {
    wrap.classList.add('field-check');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!values[field.key];
    cb.dataset.key = field.key;
    const lbl = document.createElement('label');
    lbl.textContent = field.label;
    wrap.append(cb, lbl);
    return { node: wrap, input: cb };
  }

  const lbl = document.createElement('label');
  lbl.textContent = field.label;
  wrap.appendChild(lbl);
  let input;

  if (field.type === 'select') {
    input = document.createElement('select');
    for (const opt of field.options) {
      const o = document.createElement('option');
      o.value = opt.v;
      o.textContent = opt.l;
      input.appendChild(o);
    }
    input.value = values[field.key];
  } else if (field.type === 'number') {
    input = document.createElement('input');
    input.type = 'number';
    input.value = values[field.key];
  } else if (field.type === 'tz') {
    input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('list', 'global-tzlist');
    input.placeholder = 'system';
    input.value = values[field.key] || 'system';
  } else if (field.type === 'zonelist') {
    input = document.createElement('input');
    input.type = 'hidden';
    input.dataset.key = field.key;
    const working = [...(values[field.key] || [])];
    input.value = JSON.stringify(working);
    const rowsBox = document.createElement('div');
    rowsBox.className = 'zonelist-rows';
    const renderRows = () => {
      rowsBox.replaceChildren();
      working.forEach((tz, i) => {
        const row = document.createElement('div');
        row.className = 'zone-edit-row';
        row.appendChild(document.createTextNode(tz));
        const x = iconBtn(ICONS.x, 'icon-btn red', 'Remove');
        x.addEventListener('click', () => {
          working.splice(i, 1);
          input.value = JSON.stringify(working);
          renderRows();
        });
        row.appendChild(x);
        rowsBox.appendChild(row);
      });
    };
    const addRow = document.createElement('div');
    addRow.className = 'zonelist-add';
    const tzInput = document.createElement('input');
    tzInput.type = 'text';
    tzInput.setAttribute('list', 'global-tzlist');
    tzInput.placeholder = 'Type or pick a timezone…';
    const addBtn = document.createElement('button');
    addBtn.className = 'btn';
    addBtn.type = 'button';
    addBtn.textContent = 'Add';
    addBtn.addEventListener('click', () => {
      const v = tzInput.value.trim();
      if (!v || working.includes(v)) return;
      working.push(v);
      input.value = JSON.stringify(working);
      tzInput.value = '';
      renderRows();
    });
    addRow.append(tzInput, addBtn);
    wrap.append(rowsBox, addRow);
    renderRows();
  } else {
    input = document.createElement('input');
    input.type = 'text';
    input.value = values[field.key] ?? '';
  }

  input.dataset.key = field.key;
  wrap.appendChild(input);
  return { node: wrap, input };
}

function openSettings(item) {
  const def = WIDGETS[item.type];

  const build = (container) => {
    const values = { ...item.settings };
    const inputs = [];

    for (const field of def.settings) {
      const f = buildField(field, values);
      container.appendChild(f.node);
      inputs.push(f.input);
    }

    const lockWrap = document.createElement('div');
    lockWrap.className = 'field field-check';
    const lockCb = document.createElement('input');
    lockCb.type = 'checkbox';
    lockCb.checked = !!item.locked;
    lockCb.id = 'set-locked';
    const lockLbl = document.createElement('label');
    lockLbl.htmlFor = 'set-locked';
    lockLbl.textContent = 'Lock widget (cannot be dragged or resized)';
    lockWrap.append(lockCb, lockLbl);
    container.appendChild(lockWrap);

    const sizeRow = document.createElement('div');
    sizeRow.className = 'size-row';
    const mkSize = (labelText, key, min, max) => {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const lbl = document.createElement('label');
      lbl.textContent = labelText;
      const sel = document.createElement('select');
      for (let i = min; i <= max; i++) {
        const o = document.createElement('option');
        o.value = i;
        o.textContent = i;
        sel.appendChild(o);
      }
      sel.value = clamp(item[key], min, max);
      sel.dataset.sizekey = key;
      wrap.append(lbl, sel);
      sizeRow.appendChild(wrap);
      return sel;
    };
    const wSel = mkSize('Width (columns)', 'w', 1, cols);
    const hSel = mkSize('Height (rows)', 'h', 1, 6);
    container.appendChild(sizeRow);

    return () => {
      const next = { ...item.settings };
      for (const input of inputs) {
        if (!(input instanceof HTMLElement) || !input.dataset.key) continue;
        const k = input.dataset.key;
        if (input.type === 'checkbox') next[k] = input.checked;
        else if (input.type === 'number') next[k] = Number(input.value);
        else if (input.type === 'hidden') next[k] = JSON.parse(input.value || '[]');
        else if (k === 'timezone') next[k] = input.value.trim() || 'system';
        else next[k] = input.value;
      }
      item.settings = next;
      item.locked = lockCb.checked;

      const nw = clamp(Number(wSel.value), 1, cols);
      const nh = clamp(Number(hSel.value), 1, 6);
      if (nw !== item.w || nh !== item.h) {
        const sim = tryPlace(config.layout, item.id, item.x, item.y, nw, nh);
        if (sim) {
          applySim(sim);
        } else {
          showToast('Not enough room for that size');
        }
      }
    };
  };

  openModal(`${def.name} — Settings`, build);
}

function openDesktopModal() {
  const d = { enabled: false, cols: 6, margin: 40, opacity: 80, rowH: 100, ...(config.desktop || {}) };

  const build = (container) => {
    const note = document.createElement('p');
    note.style.cssText = 'font-size:12px;color:var(--muted);margin:0 0 14px;';
    note.textContent = 'These widgets are drawn directly on your desktop (behind your windows). Requires the companion GNOME extension: npm run extension:install';
    container.appendChild(note);

    const enabledWrap = document.createElement('div');
    enabledWrap.className = 'field field-check';
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = d.enabled;
    enabled.id = 'desk-enabled';
    const enabledLbl = document.createElement('label');
    enabledLbl.htmlFor = 'desk-enabled';
    enabledLbl.textContent = 'Show widgets on the desktop';
    enabledWrap.append(enabled, enabledLbl);
    container.appendChild(enabledWrap);

    const mkSelect = (labelText, key, options) => {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const lbl = document.createElement('label');
      lbl.textContent = labelText;
      const sel = document.createElement('select');
      for (const o of options) {
        const opt = document.createElement('option');
        opt.value = o;
        opt.textContent = o;
        sel.appendChild(opt);
      }
      sel.value = d[key];
      sel.dataset.deskkey = key;
      wrap.append(lbl, sel);
      container.appendChild(wrap);
      return sel;
    };

    mkSelect('Columns', 'cols', [3, 4, 5, 6, 7, 8]);

    const mkRange = (labelText, key, min, max, step, unit) => {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const lbl = document.createElement('label');
      lbl.textContent = `${labelText}: `;
      const val = document.createElement('span');
      val.textContent = `${d[key]}${unit}`;
      lbl.appendChild(val);
      const range = document.createElement('input');
      range.type = 'range';
      range.min = min;
      range.max = max;
      range.step = step;
      range.value = d[key];
      range.style.width = '100%';
      range.dataset.deskkey = key;
      range.addEventListener('input', () => {
        val.textContent = `${range.value}${unit}`;
      });
      wrap.append(lbl, range);
      container.appendChild(wrap);
    };

    mkRange('Screen margin', 'margin', 0, 300, 10, 'px');
    mkRange('Panel opacity', 'opacity', 20, 100, 5, '%');
    mkRange('Row height', 'rowH', 70, 180, 5, 'px');

    return () => {
      const next = { ...d };
      next.enabled = enabled.checked;
      container.querySelectorAll('[data-deskkey]').forEach((el) => {
        next[el.dataset.deskkey] = Number(el.value);
      });
      config.desktop = next;
    };
  };

  openModal('Desktop widgets', build);
}

btnDesktop.addEventListener('click', openDesktopModal);

$('#btn-modal-save').addEventListener('click', () => {
  if (modalCollector) modalCollector();
  closeModal();
  applyDesktopBtn();
  applyDesktopStyles();
  normalizeLayout();
  renderAll();
  scheduleSave();
});
$('#btn-modal-cancel').addEventListener('click', closeModal);
$('#btn-modal-close').addEventListener('click', closeModal);
overlay.addEventListener('mousedown', (e) => {
  if (e.target === overlay) closeModal();
});

btnEdit.addEventListener('click', () => setEditing(!editMode));
btnAdd.addEventListener('click', openDrawer);
btnSave.addEventListener('click', saveNow);
$('#btn-drawer-close').addEventListener('click', closeDrawer);

btnReset.addEventListener('click', () => {
  if (!confirm('Reset the dashboard to its default layout?')) return;
  config.layout = defaultLayout();
  clearSelection();
  renderAll();
  scheduleSave();
});

selTheme.addEventListener('change', () => {
  config.theme = selTheme.value;
  applyTheme();
  scheduleSave();
});

inAccent.addEventListener('input', () => {
  config.accent = inAccent.value;
  applyTheme();
  scheduleSave();
});

window.addEventListener('keydown', (e) => {
  const typing = e.target.closest('input, textarea, select, [contenteditable="true"]');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
    e.preventDefault();
    setEditing(!editMode);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveNow();
    return;
  }
  if (e.key === 'Escape') {
    if (drag) return cancelDrag();
    if (resize) return cancelResize();
    if (!overlay.hidden) return closeModal();
    if (drawer.classList.contains('open')) return closeDrawer();
    clearSelection();
    return;
  }
  if (editMode && selectedId && !typing && e.key.startsWith('Arrow')) {
    const item = config.layout.find((i) => i.id === selectedId);
    if (!item || item.locked) return;
    const deltas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const [dx, dy] = deltas[e.key] || [0, 0];
    if (!dx && !dy) return;
    e.preventDefault();
    const nx = clamp(item.x + dx, 0, cols - item.w);
    const ny = Math.max(0, item.y + dy);
    if (nx === item.x && ny === item.y) return;
    const sim = tryPlace(config.layout, item.id, nx, ny, item.w, item.h);
    if (sim) {
      applySim(sim);
      syncPositions();
      scheduleSave();
    }
  }
});

window.addEventListener('resize', (() => {
  let t = null;
  return () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const before = cols;
      applyDesktopStyles();
      normalizeLayout();
      if (cols !== before) renderAll();
      else syncPositions();
    }, 150);
  };
})());

async function boot() {
  const dl = document.createElement('datalist');
  dl.id = 'global-tzlist';
  for (const tz of TIMEZONES) {
    const o = document.createElement('option');
    o.value = tz;
    dl.appendChild(o);
  }
  document.body.appendChild(dl);

  buildDrawer();

  let loaded = null;
  try {
    loaded = await dash.loadConfig();
  } catch {
    loaded = null;
  }
  config =
    loaded && Array.isArray(loaded.layout)
      ? {
          version: 1,
          theme: loaded.theme || 'dark',
          accent: loaded.accent || '',
          desktop: {
            enabled: false,
            cols: 6,
            margin: 40,
            opacity: 80,
            rowH: 100,
            ...(loaded.desktop || {})
          },
          layout: loaded.layout.filter((i) => i && WIDGETS[i.type])
        }
      : defaultConfig();

  for (const item of config.layout) {
    const def = WIDGETS[item.type];
    item.settings = { ...JSON.parse(JSON.stringify(def.defaults)), ...(item.settings || {}) };
    item.w = item.w || def.defaultSize.w;
    item.h = item.h || def.defaultSize.h;
    item.id = item.id || uid();
  }

  applyTheme();
  applyDesktopBtn();
  applyDesktopStyles();
  normalizeLayout();
  renderAll();
  setEditing(true);
  loadWallpaper();
}

boot();
