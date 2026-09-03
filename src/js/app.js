import { WIDGETS } from './widgets.js';
import { TIMEZONES } from './widgets-clocks.js';
import { ICONS } from './icons.js';
import { findFreeSlot, tryPlace, assignSlots, clampToColumns, overlaps } from './layout.js';

const dash = window.dashboard;
const $ = (s) => document.querySelector(s);

const grid = $('#grid');
const canvas = $('#canvas');
const canvasScroll = $('#canvas-scroll');
const btnAdd = $('#btn-add');
const btnEdit = $('#btn-edit');
const btnPreview = $('#btn-preview');
const btnSave = $('#btn-save');
const btnSettings = $('#btn-settings');
const toast = $('#toast');
const desktopBg = $('#desktop-bg');
const previewHint = $('#preview-hint');
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
  openPath: (p) => dash.openPath(p),
  readProc: (path) => dash.readProc(path),
  getNetStats: () => dash.getNetStats(),
  getDiskStats: () => dash.getDiskStats(),
  getCpuTemp: () => dash.getCpuTemp(),
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
  const layout = ['digitalClock', 'analogClock', 'systemMonitor', 'calendar', 'worldClock', 'todo', 'notes', 'quickLinks'].map(mkItem);
  assignSlots(layout, 6);
  return layout;
}

function defaultConfig() {
  return {
    version: 1,
    theme: 'dark',
    accent: '',
    accent2: '',
    accentGradient: '',
    fontScale: 1,
    borderRadius: 'medium',
    glassIntensity: 'medium',
    animations: true,
    reducedMotion: false,
    animSpeed: 1,
    animEntrance: true,
    animHover: true,
    desktop: { enabled: false, cols: 6, margin: 40, opacity: 80, rowH: 100, padL: 120, padR: 200, gap: 16, gridColor: '#88aaff', gridOpacity: 0.05, gridStyle: 'dashed' },
    background: { type: 'wallpaper', opacity: 50, blur: 0, customColor: '#1a1a2e', customGradient: '' },
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
  const icon = toast.querySelector('.toast-icon');
  const text = toast.querySelector('.toast-text');
  if (icon) icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  if (text) text.textContent = msg;
  else toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function applyTheme() {
  document.body.dataset.theme = config.theme || 'dark';
  document.documentElement.style.setProperty('--accent', config.accent || '#4da3ff');
  document.documentElement.style.setProperty('--accent2', config.accent2 || '#a78bfa');
  if (config.accentGradient) {
    document.documentElement.style.setProperty('--accent-gradient', config.accentGradient);
  } else {
    document.documentElement.style.setProperty('--accent-gradient', `linear-gradient(135deg, ${config.accent || '#4da3ff'}, ${config.accent2 || '#a78bfa'})`);
  }
  document.documentElement.style.setProperty('--font-scale', config.fontScale || 1);
  document.documentElement.style.setProperty('--glass-intensity', config.glassIntensity === 'high' ? '0.8' : config.glassIntensity === 'low' ? '0.3' : '0.55');
  const radiusMap = { small: '10px', medium: '18px', large: '26px', full: '999px' };
  document.documentElement.style.setProperty('--radius', radiusMap[config.borderRadius] || '18px');
  document.documentElement.style.setProperty('--radius-sm', radiusMap[config.borderRadius] === '999px' ? '999px' : `calc(${radiusMap[config.borderRadius] || '18px'} * 0.67)`);
  document.documentElement.style.setProperty('--radius-xs', radiusMap[config.borderRadius] === '999px' ? '999px' : `calc(${radiusMap[config.borderRadius] || '18px'} * 0.44)`);
  if (!config.animations || config.reducedMotion) {
    document.documentElement.style.setProperty('--transition-fast', '0.01ms');
    document.documentElement.style.setProperty('--transition-med', '0.01ms');
    document.documentElement.style.setProperty('--transition-spring', '0.01ms');
  } else {
    const speed = config.animSpeed || 1;
    document.documentElement.style.setProperty('--transition-fast', `${0.15 / speed}s`);
    document.documentElement.style.setProperty('--transition-med', `${0.25 / speed}s`);
    document.documentElement.style.setProperty('--transition-spring', `${0.35 / speed}s`);
  }
  document.body.classList.toggle('no-entrance', config.animEntrance === false);
  document.body.classList.toggle('no-hover', config.animHover === false);
  applyBackground();
}

function computeCols() {
  const cfgCols = Number(config && config.desktop && config.desktop.cols);
  if (cfgCols) return clamp(cfgCols, 2, 8);
  const w = canvas ? canvas.clientWidth : window.innerWidth;
  return w >= 1280 ? 6 : w >= 900 ? 4 : 2;
}

function applyDesktopStyles() {
  const d = (config && config.desktop) || {};
  cols = computeCols();
  grid.style.setProperty('--cols', cols);
  grid.style.setProperty('--rowh', `${clamp(Number(d.rowH) || 100, 70, 200)}px`);
  grid.style.setProperty('--gap', `${clamp(Number(d.gap) || 16, 4, 48)}px`);
  grid.style.setProperty('--grid-guide-color', d.gridColor || '#88aaff');
  grid.style.setProperty('--grid-guide-opacity', d.gridOpacity || 0.05);
  grid.style.setProperty('--grid-guide-style', d.gridStyle || 'dashed');
  const pt = 14;
  const pl = clamp(Number(d.padL) || 120, 40, 400);
  const pr = clamp(Number(d.padR) || 200, 40, 600);
  const pb = Math.max(28, Number(d.margin) || 44);
  grid.style.padding = `${pt}px ${pr}px ${pb}px ${pl}px`;
  grid.style.setProperty('--pad-t', pt + 'px');
  grid.style.setProperty('--pad-l', pl + 'px');
  grid.style.setProperty('--pad-r', pr + 'px');
  grid.style.setProperty('--pad-b', pb + 'px');
  document.documentElement.style.setProperty('--widget-op', clamp(Number(d.opacity ?? 100), 10, 100));
  requestAnimationFrame(updateGuides);
}

function updateGuides() {
  if (!grid || !grid.clientWidth) return;
  const cs = getComputedStyle(grid);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const padT = parseFloat(cs.paddingTop) || 0;
  const padB = parseFloat(cs.paddingBottom) || 0;
  const gap = parseFloat(cs.getPropertyValue('--gap')) || 16;
  const gapX = gap;
  const gapY = gap;
  const inner = Math.max(0, grid.clientWidth - padL - padR);
  const colW = (inner - (cols - 1) * gapX) / cols;
  const rowH = parseFloat(cs.gridAutoRows) || 100;
  grid.style.setProperty('--step-x', (colW + gapX) + 'px');
  grid.style.setProperty('--step-y', (rowH + gapY) + 'px');
}

let lastWallpaperPath = '';

async function loadWallpaper() {
  const bg = config.background || { type: 'wallpaper' };
  if (bg.type !== 'wallpaper') {
    document.body.classList.remove('has-wallpaper');
    return;
  }
  try {
    const wp = await dash.getWallpaper();
    const newPath = wp && wp.file ? wp.file : '';
    if (newPath === lastWallpaperPath && document.body.classList.contains('has-wallpaper')) return;
    lastWallpaperPath = newPath;
    if (wp && wp.dataUrl) {
      desktopBg.style.backgroundImage = `url("${wp.dataUrl}")`;
      document.body.classList.add('has-wallpaper');
      document.body.classList.remove('has-custom-bg');
    }
  } catch {}
}

function applyBackground() {
  const bg = config.background || { type: 'wallpaper', opacity: 50, blur: 0, customColor: '', customGradient: '' };
  const desktopBg = $('#desktop-bg');
  if (!desktopBg) return;

  desktopBg.style.removeProperty('background-image');
  desktopBg.style.removeProperty('background-color');
  desktopBg.style.setProperty('--bg-opacity', bg.opacity / 100);
  desktopBg.style.setProperty('--bg-blur', `${bg.blur}px`);

  if (bg.type === 'wallpaper') {
    // Wallpaper will be loaded by loadWallpaper()
    document.body.classList.remove('has-custom-bg');
  } else if (bg.type === 'color' && bg.customColor) {
    desktopBg.style.backgroundColor = bg.customColor;
    desktopBg.style.setProperty('opacity', bg.opacity / 100);
    document.body.classList.add('has-custom-bg');
    document.body.classList.remove('has-wallpaper');
  } else if (bg.type === 'gradient' && bg.customGradient) {
    desktopBg.style.backgroundImage = bg.customGradient;
    desktopBg.style.setProperty('opacity', bg.opacity / 100);
    document.body.classList.add('has-custom-bg');
    document.body.classList.remove('has-wallpaper');
  }

  if (bg.blur > 0) {
    desktopBg.style.backdropFilter = `blur(${bg.blur}px)`;
  } else {
    desktopBg.style.removeProperty('backdrop-filter');
  }
}

function updatePreviewHint() {
  const enabled = !!(config && config.desktop && config.desktop.enabled);
  previewHint.textContent = !enabled
    ? 'Tip: enable desktop mode in Settings to pin widgets to your homescreen'
    : 'Live preview of your desktop — drag to arrange, Save puts it on your screen';
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
  const s = item.settings || {};
  if (s.opacity !== undefined) el.style.setProperty('--widget-opacity', s.opacity);
  const radiusMap = { small: '10px', medium: '18px', large: '26px', full: '999px', none: '0px', default: 'var(--radius)' };
  el.style.setProperty('--widget-radius', radiusMap[s.borderRadius] || 'var(--radius)');
  el.style.setProperty('--widget-blur', s.blur === false ? '0px' : '20px');
  if (s.shadow !== undefined) el.style.setProperty('--widget-shadow', s.shadow);
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
  btnEdit.classList.toggle('active', v);
  btnPreview.classList.toggle('active', !v);
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

  const grip = document.createElement('span');
  grip.className = 'w-grip';
  grip.innerHTML = ICONS.grip;
  head.appendChild(grip);

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
  const dup = iconBtn(ICONS.copy, 'icon-btn', 'Duplicate widget (Ctrl+D)');
  dup.addEventListener('click', (e) => {
    e.stopPropagation();
    duplicateWidget(item.id);
  });
  const del = iconBtn(ICONS.trash, 'icon-btn red', 'Remove widget');
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
  actions.append(lock, gear, dup, del);
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
  const gap = parseFloat(cs.getPropertyValue('--gap')) || 16;
  const gapX = gap;
  const gapY = gap;
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
  const canvasRect = canvas.getBoundingClientRect();
  drag = {
    id: item.id,
    item,
    el: card,
    startX: e.clientX,
    startY: e.clientY,
    offX: e.clientX - rect.left,
    offY: e.clientY - rect.top,
    baseLeft: rect.left,
    baseTop: rect.top,
    baseRight: rect.right,
    baseBottom: rect.bottom,
    canvasLeft: canvasRect.left,
    canvasTop: canvasRect.top,
    canvasRight: canvasRect.right,
    canvasBottom: canvasRect.bottom,
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
  let dx = e.clientX - drag.startX;
  let dy = e.clientY - drag.startY;
  if (!drag.started) {
    if (Math.hypot(dx, dy) < 6) return;
    startDragVisual();
  }

  const minDx = drag.canvasLeft - drag.baseLeft;
  const maxDx = drag.canvasRight - drag.baseRight;
  const minDy = drag.canvasTop - drag.baseTop;
  const maxDy = drag.canvasBottom - drag.baseBottom;
  dx = clamp(dx, minDx, maxDx);
  dy = clamp(dy, minDy, maxDy);
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

  const prevRect = d.el.getBoundingClientRect();

  d.el.classList.remove('dragging');
  document.body.classList.remove('drag-active');
  if (d.placeholder) d.placeholder.remove();

  if (!d.started) {
    d.el.style.transform = '';
    selectItem(d.id);
    return;
  }
  if (d.valid && d.sim) {
    applySim(d.sim);
    syncPositions();
    scheduleSave();
    d.el.style.transform = '';
    flipTo(d.el, prevRect);
  } else {
    d.el.style.transform = '';
    if (d.valid === false) showToast('No room there — placement blocked');
  }
  selectItem(d.id);
}

function flipTo(el, prevRect) {
  if (!prevRect) return;
  requestAnimationFrame(() => {
    const last = el.getBoundingClientRect();
    const dx = prevRect.left - last.left;
    const dy = prevRect.top - last.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    el.style.transition = 'none';
    el.offsetHeight;
    el.style.transition = 'transform .2s cubic-bezier(.2,.9,.25,1.12)';
    el.style.transform = '';
    setTimeout(() => { el.style.transition = ''; }, 220);
  });
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

function duplicateWidget(id) {
  const item = config.layout.find((i) => i.id === id);
  if (!item) return;
  const def = WIDGETS[item.type];
  const copy = {
    ...item,
    id: uid(),
    x: null,
    y: null,
    settings: JSON.parse(JSON.stringify(item.settings))
  };
  config.layout.push(copy);
  normalizeLayout();
  renderAll();
  selectItem(copy.id);
  scheduleSave();
  showToast(`${def.name} duplicated`);
  requestAnimationFrame(() => {
    canvasScroll.scrollTo({ top: canvasScroll.scrollHeight, behavior: 'smooth' });
  });
}

function deleteSelectedWidget() {
  const item = config.layout.find((i) => i.id === selectedId);
  if (!item) return;
  const def = WIDGETS[item.type];
  if (!confirm(`Remove "${def.name}" from the dashboard?`)) return;
  disposeItem(item.id);
  cardBodies.delete(item.id);
  config.layout = config.layout.filter((i) => i.id !== item.id);
  if (selectedId === item.id) clearSelection();
  showEmptyHintIfNeeded();
  scheduleSave();
  renderAll();
}

function getFocusableWidgets() {
  return config.layout
    .filter(i => !i.locked || i.id === selectedId)
    .map(i => i.id);
}

function scrollToWidget(id) {
  const el = grid.querySelector(`.widget[data-id="${id}"]`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }
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
    canvasScroll.scrollTo({ top: canvasScroll.scrollHeight, behavior: 'smooth' });
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

function openSettingsModal() {
  const d = { enabled: false, cols: 6, margin: 40, padL: 120, padR: 200, opacity: 80, rowH: 100, gap: 16, ...(config.desktop || {}) };
  const dBg = { type: 'wallpaper', opacity: 50, blur: 0, customColor: '#1a1a2e', customGradient: '', ...(config.background || {}) };

  const build = (container) => {
    /* --- Appearance --- */
    const secApp = document.createElement('div');
    secApp.className = 'modal-section';
    const titleApp = document.createElement('div');
    titleApp.className = 'modal-section-title';
    titleApp.textContent = 'Appearance';
    secApp.appendChild(titleApp);

    const themeWrap = document.createElement('div');
    themeWrap.className = 'field';
    const themeLbl = document.createElement('label');
    themeLbl.textContent = 'Theme';
    const themeSel = document.createElement('select');
    for (const [v, l] of [['dark','Dark'],['midnight','Midnight'],['nord','Nord'],['light','Light']]) {
      const o = document.createElement('option');
      o.value = v; o.textContent = l;
      themeSel.appendChild(o);
    }
    themeSel.value = config.theme || 'dark';
    themeWrap.append(themeLbl, themeSel);
    secApp.appendChild(themeWrap);

    const accWrap = document.createElement('div');
    accWrap.className = 'field';
    const accLbl = document.createElement('label');
    accLbl.textContent = 'Primary accent';
    const accIn = document.createElement('input');
    accIn.type = 'color';
    accIn.value = config.accent || '#4da3ff';
    accWrap.append(accLbl, accIn);
    secApp.appendChild(accWrap);

    const acc2Wrap = document.createElement('div');
    acc2Wrap.className = 'field';
    const acc2Lbl = document.createElement('label');
    acc2Lbl.textContent = 'Secondary accent';
    const acc2In = document.createElement('input');
    acc2In.type = 'color';
    acc2In.value = config.accent2 || '#a78bfa';
    acc2Wrap.append(acc2Lbl, acc2In);
    secApp.appendChild(acc2Wrap);

    const fontWrap = document.createElement('div');
    fontWrap.className = 'field';
    const fontLbl = document.createElement('label');
    fontLbl.textContent = 'UI scale';
    const fontSel = document.createElement('select');
    for (const [v, l] of [['0.85','Small (85%)'],['1','Default (100%)'],['1.15','Large (115%)'],['1.3','Extra Large (130%)']]) {
      const o = document.createElement('option');
      o.value = v; o.textContent = l;
      fontSel.appendChild(o);
    }
    fontSel.value = String(config.fontScale || 1);
    fontWrap.append(fontLbl, fontSel);
    secApp.appendChild(fontWrap);

    const radiusWrap = document.createElement('div');
    radiusWrap.className = 'field';
    const radiusLbl = document.createElement('label');
    radiusLbl.textContent = 'Border radius';
    const radiusSel = document.createElement('select');
    for (const [v, l] of [['small','Small (10px)'],['medium','Medium (18px)'],['large','Large (26px)'],['full','Pill (999px)']]) {
      const o = document.createElement('option');
      o.value = v; o.textContent = l;
      radiusSel.appendChild(o);
    }
    radiusSel.value = config.borderRadius || 'medium';
    radiusWrap.append(radiusLbl, radiusSel);
    secApp.appendChild(radiusWrap);

    const glassWrap = document.createElement('div');
    glassWrap.className = 'field';
    const glassLbl = document.createElement('label');
    glassLbl.textContent = 'Glass intensity';
    const glassSel = document.createElement('select');
    for (const [v, l] of [['low','Subtle'],['medium','Balanced'],['high','Prominent']]) {
      const o = document.createElement('option');
      o.value = v; o.textContent = l;
      glassSel.appendChild(o);
    }
    glassSel.value = config.glassIntensity || 'medium';
    glassWrap.append(glassLbl, glassSel);
    secApp.appendChild(glassWrap);

    const animWrap = document.createElement('div');
    animWrap.className = 'field field-check';
    const animCb = document.createElement('input');
    animCb.type = 'checkbox';
    animCb.id = 'anim-enabled';
    animCb.checked = config.animations !== false;
    const animLbl = document.createElement('label');
    animLbl.htmlFor = 'anim-enabled';
    animLbl.textContent = 'Enable animations';
    animWrap.append(animCb, animLbl);
    secApp.appendChild(animWrap);

    const animSpeedWrap = document.createElement('div');
    animSpeedWrap.className = 'field';
    animSpeedWrap.style.display = config.animations !== false ? 'block' : 'none';
    const animSpeedLbl = document.createElement('label');
    animSpeedLbl.textContent = 'Animation speed: ';
    const animSpeedVal = document.createElement('span');
    animSpeedVal.textContent = `${config.animSpeed || 1}x`;
    animSpeedLbl.appendChild(animSpeedVal);
    const animSpeedRange = document.createElement('input');
    animSpeedRange.type = 'range';
    animSpeedRange.min = '0.2';
    animSpeedRange.max = '2';
    animSpeedRange.step = '0.1';
    animSpeedRange.value = config.animSpeed || '1';
    animSpeedRange.style.width = '100%';
    animSpeedRange.addEventListener('input', () => { animSpeedVal.textContent = `${animSpeedRange.value}x`; });
    animSpeedWrap.append(animSpeedLbl, animSpeedRange);
    secApp.appendChild(animSpeedWrap);

    const entranceWrap = document.createElement('div');
    entranceWrap.className = 'field field-check';
    entranceWrap.style.display = config.animations !== false ? 'block' : 'none';
    const entranceCb = document.createElement('input');
    entranceCb.type = 'checkbox';
    entranceCb.id = 'anim-entrance';
    entranceCb.checked = config.animEntrance !== false;
    const entranceLbl = document.createElement('label');
    entranceLbl.htmlFor = 'anim-entrance';
    entranceLbl.textContent = 'Widget entrance animation';
    entranceWrap.append(entranceCb, entranceLbl);
    secApp.appendChild(entranceWrap);

    const hoverWrap = document.createElement('div');
    hoverWrap.className = 'field field-check';
    hoverWrap.style.display = config.animations !== false ? 'block' : 'none';
    const hoverCb = document.createElement('input');
    hoverCb.type = 'checkbox';
    hoverCb.id = 'anim-hover';
    hoverCb.checked = config.animHover !== false;
    const hoverLbl = document.createElement('label');
    hoverLbl.htmlFor = 'anim-hover';
    hoverLbl.textContent = 'Hover lift effect';
    hoverWrap.append(hoverCb, hoverLbl);
    secApp.appendChild(hoverWrap);

    const motionWrap = document.createElement('div');
    motionWrap.className = 'field field-check';
    const motionCb = document.createElement('input');
    motionCb.type = 'checkbox';
    motionCb.id = 'motion-reduced';
    motionCb.checked = !!config.reducedMotion;
    const motionLbl = document.createElement('label');
    motionLbl.htmlFor = 'motion-reduced';
    motionLbl.textContent = 'Respect reduced motion (system preference)';
    motionWrap.append(motionCb, motionLbl);
    secApp.appendChild(motionWrap);

    themeSel.addEventListener('change', () => {
      config.theme = themeSel.value;
      applyTheme();
      scheduleSave();
    });
    accIn.addEventListener('input', () => {
      config.accent = accIn.value;
      applyTheme();
      scheduleSave();
    });
    acc2In.addEventListener('input', () => {
      config.accent2 = acc2In.value;
      applyTheme();
      scheduleSave();
    });
    fontSel.addEventListener('change', () => {
      config.fontScale = Number(fontSel.value);
      applyTheme();
      scheduleSave();
    });
    radiusSel.addEventListener('change', () => {
      config.borderRadius = radiusSel.value;
      applyTheme();
      scheduleSave();
    });
    glassSel.addEventListener('change', () => {
      config.glassIntensity = glassSel.value;
      applyTheme();
      scheduleSave();
    });
    animCb.addEventListener('change', () => {
      config.animations = animCb.checked;
      applyTheme();
      scheduleSave();
      animSpeedWrap.style.display = animCb.checked ? 'block' : 'none';
      entranceWrap.style.display = animCb.checked ? 'block' : 'none';
      hoverWrap.style.display = animCb.checked ? 'block' : 'none';
    });
    animSpeedRange.addEventListener('input', () => {
      config.animSpeed = Number(animSpeedRange.value);
      applyTheme();
      scheduleSave();
    });
    entranceCb.addEventListener('change', () => {
      config.animEntrance = entranceCb.checked;
      applyTheme();
      scheduleSave();
    });
    hoverCb.addEventListener('change', () => {
      config.animHover = hoverCb.checked;
      applyTheme();
      scheduleSave();
    });
    motionCb.addEventListener('change', () => {
      config.reducedMotion = motionCb.checked;
      applyTheme();
      scheduleSave();
    });
    container.appendChild(secApp);

    /* --- Desktop widgets --- */
    const secDesk = document.createElement('div');
    secDesk.className = 'modal-section';
    const titleDesk = document.createElement('div');
    titleDesk.className = 'modal-section-title';
    titleDesk.textContent = 'Desktop Widgets';
    secDesk.appendChild(titleDesk);

    const note = document.createElement('p');
    note.style.cssText = 'font-size:12px;color:var(--muted);margin:0 0 12px;';
    note.textContent = 'These widgets are drawn directly on your desktop (behind your windows). Requires the companion GNOME extension.';
    secDesk.appendChild(note);

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
    secDesk.appendChild(enabledWrap);

    const mkSelect = (labelText, key, options) => {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const lbl = document.createElement('label');
      lbl.textContent = labelText;
      const sel = document.createElement('select');
      for (const o of options) {
        const opt = document.createElement('option');
        opt.value = o; opt.textContent = o;
        sel.appendChild(opt);
      }
      sel.value = d[key];
      sel.dataset.deskkey = key;
      wrap.append(lbl, sel);
      secDesk.appendChild(wrap);
      return sel;
    };
    mkSelect('Columns', 'cols', [3, 4, 5, 6, 7, 8]);

    const mkRange = (labelText, key, min, max, step, unit) => {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const lbl = document.createElement('label');
      lbl.textContent = labelText + ': ';
      const val = document.createElement('span');
      val.textContent = `${d[key]}${unit}`;
      lbl.appendChild(val);
      const range = document.createElement('input');
      range.type = 'range'; range.min = min; range.max = max; range.step = step; range.value = d[key];
      range.style.width = '100%';
      range.dataset.deskkey = key;
      range.addEventListener('input', () => { val.textContent = `${range.value}${unit}`; });
      wrap.append(lbl, range);
      secDesk.appendChild(wrap);
    };
    mkRange('Screen margin', 'margin', 0, 300, 10, 'px');
    mkRange('Left padding (dock)', 'padL', 0, 400, 10, 'px');
    mkRange('Right padding (icons)', 'padR', 0, 600, 10, 'px');
    mkRange('Panel opacity', 'opacity', 20, 100, 5, '%');
    mkRange('Row height', 'rowH', 70, 180, 5, 'px');
    mkRange('Widget gap', 'gap', 4, 48, 2, 'px');

    const gridColorWrap = document.createElement('div');
    gridColorWrap.className = 'field';
    const gridColorLbl = document.createElement('label');
    gridColorLbl.textContent = 'Grid line color';
    const gridColorIn = document.createElement('input');
    gridColorIn.type = 'color';
    gridColorIn.value = d.gridColor || '#88aaff';
    gridColorIn.dataset.deskkey = 'gridColor';
    gridColorWrap.append(gridColorLbl, gridColorIn);
    secDesk.appendChild(gridColorWrap);

    const gridOpacityWrap = document.createElement('div');
    gridOpacityWrap.className = 'field';
    const gridOpacityLbl = document.createElement('label');
    gridOpacityLbl.textContent = 'Grid line opacity: ';
    const gridOpacityVal = document.createElement('span');
    gridOpacityVal.textContent = `${Math.round((d.gridOpacity || 0.05) * 100)}%`;
    gridOpacityLbl.appendChild(gridOpacityVal);
    const gridOpacityRange = document.createElement('input');
    gridOpacityRange.type = 'range'; gridOpacityRange.min = 0; gridOpacityRange.max = 1; gridOpacityRange.step = 0.01; gridOpacityRange.value = d.gridOpacity || 0.05;
    gridOpacityRange.dataset.deskkey = 'gridOpacity';
    gridOpacityRange.style.width = '100%';
    gridOpacityRange.addEventListener('input', () => { gridOpacityVal.textContent = `${Math.round(gridOpacityRange.value * 100)}%`; });
    gridOpacityWrap.append(gridOpacityLbl, gridOpacityRange);
    secDesk.appendChild(gridOpacityWrap);

    const gridStyleWrap = document.createElement('div');
    gridStyleWrap.className = 'field';
    const gridStyleLbl = document.createElement('label');
    gridStyleLbl.textContent = 'Grid line style';
    const gridStyleSel = document.createElement('select');
    gridStyleSel.dataset.deskkey = 'gridStyle';
    for (const [v, l] of [['dashed', 'Dashed'], ['dotted', 'Dotted'], ['solid', 'Solid']]) {
      const o = document.createElement('option');
      o.value = v; o.textContent = l;
      gridStyleSel.appendChild(o);
    }
    gridStyleSel.value = d.gridStyle || 'dashed';
    gridStyleWrap.append(gridStyleLbl, gridStyleSel);
    secDesk.appendChild(gridStyleWrap);

    container.appendChild(secDesk);

    /* --- Background --- */
    const secBg = document.createElement('div');
    secBg.className = 'modal-section';
    const titleBg = document.createElement('div');
    titleBg.className = 'modal-section-title';
    titleBg.textContent = 'Dashboard Background';
    secBg.appendChild(titleBg);

    const bgTypeWrap = document.createElement('div');
    bgTypeWrap.className = 'field';
    const bgTypeLbl = document.createElement('label');
    bgTypeLbl.textContent = 'Background type';
    const bgTypeSel = document.createElement('select');
    for (const [v, l] of [['wallpaper', 'System wallpaper'], ['color', 'Solid color'], ['gradient', 'Custom gradient']]) {
      const o = document.createElement('option');
      o.value = v; o.textContent = l;
      bgTypeSel.appendChild(o);
    }
    bgTypeSel.value = dBg.type || 'wallpaper';
    bgTypeWrap.append(bgTypeLbl, bgTypeSel);
    secBg.appendChild(bgTypeWrap);

    const customColorWrap = document.createElement('div');
    customColorWrap.className = 'field';
    customColorWrap.style.display = (dBg.type || 'wallpaper') === 'color' ? 'block' : 'none';
    const customColorLbl = document.createElement('label');
    customColorLbl.textContent = 'Background color';
    const customColorIn = document.createElement('input');
    customColorIn.type = 'color';
    customColorIn.value = dBg.customColor || '#1a1a2e';
    customColorWrap.append(customColorLbl, customColorIn);
    secBg.appendChild(customColorWrap);

    const customGradWrap = document.createElement('div');
    customGradWrap.className = 'field';
    customGradWrap.style.display = (dBg.type || 'wallpaper') === 'gradient' ? 'block' : 'none';
    const customGradLbl = document.createElement('label');
    customGradLbl.textContent = 'CSS Gradient (e.g. linear-gradient(135deg, #667eea 0%, #764ba2 100%))';
    const customGradIn = document.createElement('input');
    customGradIn.type = 'text';
    customGradIn.placeholder = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    customGradIn.value = dBg.customGradient || '';
    customGradIn.style.width = '100%';
    customGradWrap.append(customGradLbl, customGradIn);
    secBg.appendChild(customGradWrap);

    const bgOpacityWrap = document.createElement('div');
    bgOpacityWrap.className = 'field';
    const bgOpacityLbl = document.createElement('label');
    bgOpacityLbl.textContent = 'Background opacity: ';
    const bgOpacityVal = document.createElement('span');
    bgOpacityVal.textContent = `${dBg.opacity || 50}%`;
    bgOpacityLbl.appendChild(bgOpacityVal);
    const bgOpacityRange = document.createElement('input');
    bgOpacityRange.type = 'range'; bgOpacityRange.min = 0; bgOpacityRange.max = 100; bgOpacityRange.step = 5; bgOpacityRange.value = dBg.opacity || 50;
    bgOpacityRange.style.width = '100%';
    bgOpacityRange.addEventListener('input', () => { bgOpacityVal.textContent = `${bgOpacityRange.value}%`; });
    bgOpacityWrap.append(bgOpacityLbl, bgOpacityRange);
    secBg.appendChild(bgOpacityWrap);

    const bgBlurWrap = document.createElement('div');
    bgBlurWrap.className = 'field';
    const bgBlurLbl = document.createElement('label');
    bgBlurLbl.textContent = 'Background blur: ';
    const bgBlurVal = document.createElement('span');
    bgBlurVal.textContent = `${dBg.blur || 0}px`;
    bgBlurLbl.appendChild(bgBlurVal);
    const bgBlurRange = document.createElement('input');
    bgBlurRange.type = 'range'; bgBlurRange.min = 0; bgBlurRange.max = 50; bgBlurRange.step = 1; bgBlurRange.value = dBg.blur || 0;
    bgBlurRange.style.width = '100%';
    bgBlurRange.addEventListener('input', () => { bgBlurVal.textContent = `${bgBlurRange.value}px`; });
    bgBlurWrap.append(bgBlurLbl, bgBlurRange);
    secBg.appendChild(bgBlurWrap);

    container.appendChild(secBg);

    bgTypeSel.addEventListener('change', () => {
      customColorWrap.style.display = bgTypeSel.value === 'color' ? 'block' : 'none';
      customGradWrap.style.display = bgTypeSel.value === 'gradient' ? 'block' : 'none';
    });

    /* --- Behavior --- */
    const secBehavior = document.createElement('div');
    secBehavior.className = 'modal-section';
    const titleBehavior = document.createElement('div');
    titleBehavior.className = 'modal-section-title';
    titleBehavior.textContent = 'Behavior';
    secBehavior.appendChild(titleBehavior);

    const autosaveWrap = document.createElement('div');
    autosaveWrap.className = 'field field-check';
    const autosaveCb = document.createElement('input');
    autosaveCb.type = 'checkbox';
    autosaveCb.id = 'autosave-enabled';
    autosaveCb.checked = true;
    const autosaveLbl = document.createElement('label');
    autosaveLbl.htmlFor = 'autosave-enabled';
    autosaveLbl.textContent = 'Auto-save layout changes (300ms debounce)';
    autosaveWrap.append(autosaveCb, autosaveLbl);
    secBehavior.appendChild(autosaveWrap);

    const snapWrap = document.createElement('div');
    snapWrap.className = 'field field-check';
    const snapCb = document.createElement('input');
    snapCb.type = 'checkbox';
    snapCb.id = 'snap-enabled';
    snapCb.checked = true;
    const snapLbl = document.createElement('label');
    snapLbl.htmlFor = 'snap-enabled';
    snapLbl.textContent = 'Snap widgets to grid';
    snapWrap.append(snapCb, snapLbl);
    secBehavior.appendChild(snapWrap);

    container.appendChild(secBehavior);

    /* --- Selected Widget Settings --- */
    const secWidget = document.createElement('div');
    secWidget.className = 'modal-section';
    const titleWidget = document.createElement('div');
    titleWidget.className = 'modal-section-title';
    titleWidget.textContent = 'Selected Widget Settings';
    secWidget.appendChild(titleWidget);

    const widgetNote = document.createElement('p');
    widgetNote.style.cssText = 'font-size:12px;color:var(--muted);margin:0 0 12px;';
    widgetNote.textContent = 'Select a widget in the dashboard to edit its settings here.';
    secWidget.appendChild(widgetNote);

    const widgetSettingsContainer = document.createElement('div');
    widgetSettingsContainer.id = 'widget-settings-container';
    widgetSettingsContainer.style.minHeight = '100px';
    secWidget.appendChild(widgetSettingsContainer);

    container.appendChild(secWidget);

    function updateWidgetSettingsPanel() {
      widgetSettingsContainer.replaceChildren();
      if (!selectedId) {
        const hint = document.createElement('p');
        hint.style.cssText = 'color:var(--muted);font-size:13px;padding:20px;text-align:center;';
        hint.textContent = 'No widget selected. Click a widget in the dashboard to see its settings.';
        widgetSettingsContainer.appendChild(hint);
        return;
      }
      const item = config.layout.find(i => i.id === selectedId);
      if (!item) return;
      const def = WIDGETS[item.type];
      const widgetTitle = document.createElement('h4');
      widgetTitle.style.cssText = 'margin:0 0 12px;font-size:14px;font-weight:600;color:var(--text);';
      widgetTitle.textContent = def.name;
      widgetSettingsContainer.appendChild(widgetTitle);

      for (const field of def.settings) {
        const wrap = document.createElement('div');
        wrap.className = 'field';
        if (field.type === 'bool') {
          wrap.classList.add('field-check');
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = !!item.settings[field.key];
          cb.dataset.key = field.key;
          const lbl = document.createElement('label');
          lbl.textContent = field.label;
          wrap.append(cb, lbl);
          widgetSettingsContainer.appendChild(wrap);
          cb.addEventListener('change', () => {
            item.settings[field.key] = cb.checked;
            scheduleSave();
            remountItem(item);
          });
        } else {
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
            input.value = item.settings[field.key];
          } else if (field.type === 'number') {
            input = document.createElement('input');
            input.type = 'number';
            input.value = item.settings[field.key];
          } else if (field.type === 'tz') {
            input = document.createElement('input');
            input.type = 'text';
            input.setAttribute('list', 'global-tzlist');
            input.placeholder = 'system';
            input.value = item.settings[field.key] || 'system';
          } else if (field.type === 'zonelist') {
            continue; // Skip in panel, use widget's own settings
          } else {
            input = document.createElement('input');
            input.type = 'text';
            input.value = item.settings[field.key] ?? '';
          }
          input.dataset.key = field.key;
          wrap.appendChild(input);
          widgetSettingsContainer.appendChild(wrap);
          input.addEventListener('change', () => {
            if (input.type === 'checkbox') item.settings[field.key] = input.checked;
            else if (input.type === 'number') item.settings[field.key] = Number(input.value);
            else if (field.key === 'timezone') item.settings[field.key] = input.value.trim() || 'system';
            else item.settings[field.key] = input.value;
            scheduleSave();
            remountItem(item);
          });
        }
      }
    }

    // Update widget settings when selection changes
    const origSelectItem = selectItem;
    selectItem = (id) => {
      origSelectItem(id);
      updateWidgetSettingsPanel();
    };

    /* --- Layout Import/Export --- */
    const secLayout = document.createElement('div');
    secLayout.className = 'modal-section';
    const titleLayout = document.createElement('div');
    titleLayout.className = 'modal-section-title';
    titleLayout.textContent = 'Layout Import/Export';
    secLayout.appendChild(titleLayout);

    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn';
    exportBtn.type = 'button';
    exportBtn.textContent = 'Export Layout';
    exportBtn.style.marginRight = '8px';
    exportBtn.addEventListener('click', () => {
      const exportData = {
        version: 1,
        theme: config.theme,
        accent: config.accent,
        accent2: config.accent2,
        accentGradient: config.accentGradient,
        fontScale: config.fontScale,
        borderRadius: config.borderRadius,
        glassIntensity: config.glassIntensity,
        animations: config.animations,
        reducedMotion: config.reducedMotion,
        animSpeed: config.animSpeed,
        animEntrance: config.animEntrance,
        animHover: config.animHover,
        desktop: config.desktop,
        background: config.background,
        layout: config.layout
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dashboard-layout-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Layout exported');
    });
    secLayout.appendChild(exportBtn);

    const importLabel = document.createElement('label');
    importLabel.style.display = 'inline-flex';
    importLabel.style.alignItems = 'center';
    importLabel.style.gap = '8px';
    importLabel.style.cursor = 'pointer';
    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = '.json';
    importInput.style.display = 'none';
    importInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const imported = JSON.parse(ev.target.result);
          if (imported.layout && Array.isArray(imported.layout)) {
            config.layout = imported.layout.filter(i => i && WIDGETS[i.type]);
            if (imported.theme) config.theme = imported.theme;
            if (imported.accent) config.accent = imported.accent;
            if (imported.accent2) config.accent2 = imported.accent2;
            if (imported.accentGradient) config.accentGradient = imported.accentGradient;
            if (imported.fontScale) config.fontScale = imported.fontScale;
            if (imported.borderRadius) config.borderRadius = imported.borderRadius;
            if (imported.glassIntensity) config.glassIntensity = imported.glassIntensity;
            if (imported.animations !== undefined) config.animations = imported.animations;
            if (imported.reducedMotion !== undefined) config.reducedMotion = imported.reducedMotion;
            if (imported.animSpeed) config.animSpeed = imported.animSpeed;
            if (imported.animEntrance !== undefined) config.animEntrance = imported.animEntrance;
            if (imported.animHover !== undefined) config.animHover = imported.animHover;
            if (imported.desktop) config.desktop = { ...config.desktop, ...imported.desktop };
            if (imported.background) config.background = { ...config.background, ...imported.background };
            applyTheme();
            applyDesktopStyles();
            normalizeLayout();
            renderAll();
            scheduleSave();
            showToast('Layout imported successfully');
            closeModal();
          } else {
            showToast('Invalid layout file');
          }
        } catch {
          showToast('Failed to import layout');
        }
        importInput.value = '';
      };
      reader.readAsText(file);
    });
    importInput.addEventListener('click', (e) => e.stopPropagation());
    const importBtn = document.createElement('button');
    importBtn.className = 'btn ghost';
    importBtn.type = 'button';
    importBtn.textContent = 'Import Layout';
    importBtn.addEventListener('click', () => importInput.click());
    importLabel.append(importBtn, importInput);
    secLayout.appendChild(importLabel);

    container.appendChild(secLayout);

    /* --- Reset --- */
    const secReset = document.createElement('div');
    secReset.className = 'modal-section';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn danger';
    resetBtn.type = 'button';
    resetBtn.textContent = 'Reset layout to defaults';
    resetBtn.addEventListener('click', () => {
      if (!confirm('Reset the dashboard to its default layout?')) return;
      config.layout = defaultLayout();
      clearSelection();
      renderAll();
      scheduleSave();
      closeModal();
      showToast('Layout reset to defaults');
    });
    secReset.appendChild(resetBtn);

    const resetAllBtn = document.createElement('button');
    resetAllBtn.className = 'btn danger';
    resetAllBtn.type = 'button';
    resetAllBtn.style.marginTop = '8px';
    resetAllBtn.textContent = 'Reset ALL settings (theme, layout, everything)';
    resetAllBtn.addEventListener('click', () => {
      if (!confirm('This will reset everything to defaults. Continue?')) return;
      config = defaultConfig();
      applyTheme();
      applyDesktopStyles();
      renderAll();
      scheduleSave();
      closeModal();
      showToast('All settings reset to defaults');
    });
    secReset.appendChild(resetAllBtn);
    container.appendChild(secReset);

    return () => {
      const next = { ...d };
      next.enabled = enabled.checked;
      container.querySelectorAll('[data-deskkey]').forEach((el) => {
        next[el.dataset.deskkey] = Number(el.value);
      });
      config.desktop = next;

      const nextBg = { ...dBg };
      nextBg.type = bgTypeSel.value;
      nextBg.opacity = Number(bgOpacityRange.value);
      nextBg.blur = Number(bgBlurRange.value);
      nextBg.customColor = customColorIn.value;
      nextBg.customGradient = customGradIn.value.trim();
      config.background = nextBg;
    };
  };

  openModal('Settings', build);
}

$('#btn-settings').addEventListener('click', openSettingsModal);
$('#btn-refresh-wallpaper').addEventListener('click', () => {
  lastWallpaperPath = '';
  loadWallpaper();
});
window.addEventListener('focus', () => { lastWallpaperPath = ''; loadWallpaper(); });

$('#btn-modal-save').addEventListener('click', () => {
  if (modalCollector) modalCollector();
  closeModal();
  updatePreviewHint();
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

btnEdit.addEventListener('click', () => setEditing(true));
btnPreview.addEventListener('click', () => setEditing(false));
btnAdd.addEventListener('click', openDrawer);
btnSave.addEventListener('click', saveNow);
$('#btn-drawer-close').addEventListener('click', closeDrawer);

/* Window controls (guard for non-Electron environments) */
$('#win-min').addEventListener('click', () => { try { dash.winMinimize?.(); } catch {} });
$('#win-max').addEventListener('click', () => { try { dash.winMaximize?.(); } catch {} });
$('#win-close').addEventListener('click', () => { try { dash.winClose?.(); } catch {} });

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
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    if (editMode && selectedId) {
      duplicateWidget(selectedId);
    }
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!typing && editMode && selectedId) {
      e.preventDefault();
      deleteSelectedWidget();
    }
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
    let handled = false;
    if (!e.shiftKey) {
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
      handled = true;
    } else {
      const deltas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const [dx, dy] = deltas[e.key] || [0, 0];
      if (!dx && !dy) return;
      e.preventDefault();
      const nw = clamp(item.w + dx, 1, cols - item.x);
      const nh = clamp(item.h + dy, 1, 6);
      if (nw === item.w && nh === item.h) return;
      const sim = tryPlace(config.layout, item.id, item.x, item.y, nw, nh);
      if (sim) {
        applySim(sim);
        syncPositions();
        scheduleSave();
      }
      handled = true;
    }
    if (handled) return;
  }
  if (!typing && (e.key === 'Tab' || (e.shiftKey && e.key === 'Tab'))) {
    e.preventDefault();
    const focusable = getFocusableWidgets();
    if (focusable.length === 0) return;
    const currentIdx = selectedId ? focusable.findIndex(id => id === selectedId) : -1;
    const nextIdx = e.shiftKey ? currentIdx - 1 : currentIdx + 1;
    const nextId = focusable[(nextIdx + focusable.length) % focusable.length];
    selectItem(nextId);
    scrollToWidget(nextId);
    return;
  }
  if (!typing && e.key === 'Enter' && editMode && selectedId) {
    const item = config.layout.find((i) => i.id === selectedId);
    if (item) openSettings(item);
    return;
  }
  if (!typing && e.key === ' ' && editMode && selectedId) {
    e.preventDefault();
    const item = config.layout.find((i) => i.id === selectedId);
    if (item) {
      item.locked = !item.locked;
      scheduleSave();
      renderAll();
    }
    return;
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

const SIDEBAR_ICON_MAP = {
  home: ICONS.home,
  documents: ICONS.folder,
  downloads: ICONS.folder,
  music: ICONS.folder,
  pictures: ICONS.folder,
  videos: ICONS.folder
};

async function buildSidebar() {
  const list = $('#sidebar-list');
  if (!list) return;
  list.replaceChildren();
  let dirs = [];
  try { dirs = await dash.listDirs(); } catch {}
  if (!Array.isArray(dirs) || !dirs.length) {
    dirs = [
      { key: 'home', name: 'Home', path: '' },
      { key: 'documents', name: 'Documents', path: '' },
      { key: 'downloads', name: 'Downloads', path: '' }
    ];
  }
  for (const d of dirs) {
    const btn = document.createElement('button');
    btn.className = 'sidebar-item';
    btn.type = 'button';
    btn.title = d.path || d.name;
    const ic = document.createElement('span');
    ic.className = 'side-icon';
    ic.innerHTML = SIDEBAR_ICON_MAP[d.key] || ICONS.folder;
    const nm = document.createElement('span');
    nm.className = 'side-name';
    nm.textContent = d.name;
    btn.append(ic, nm);
    btn.addEventListener('click', () => {
      if (d.path) { try { dash.openPath?.(d.path); } catch {} }
    });
    list.appendChild(btn);
  }
}

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
          accent2: loaded.accent2 || '',
          accentGradient: loaded.accentGradient || '',
          fontScale: loaded.fontScale || 1,
          borderRadius: loaded.borderRadius || 'medium',
          glassIntensity: loaded.glassIntensity || 'medium',
          animations: loaded.animations !== false,
          reducedMotion: !!loaded.reducedMotion,
          desktop: {
            enabled: false,
            cols: 6,
            margin: 40,
            opacity: 80,
            rowH: 100,
            padL: 120,
            padR: 200,
            gap: 16,
            ...(loaded.desktop || {})
          },
          background: {
            type: 'wallpaper',
            opacity: 50,
            blur: 0,
            customColor: '#1a1a2e',
            customGradient: '',
            ...(loaded.background || {})
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

  if (!config.layout.some(i => i.type === 'quickLinks')) {
    const ql = mkItem('quickLinks');
    config.layout.push(ql);
    normalizeLayout();
    scheduleSave();
  }

  applyTheme();
  updatePreviewHint();
  applyDesktopStyles();
  normalizeLayout();
  renderAll();
  setEditing(true);
  loadWallpaper();
  buildSidebar();

  btnSettings.innerHTML = ICONS.gear;
  const dc = $('#btn-drawer-close');
  if (dc) dc.innerHTML = ICONS.x;
  const mc = $('#btn-modal-close');
  if (mc) mc.innerHTML = ICONS.x;
}

boot();
