export function overlaps(a, b) {
  return (
    a.x < b.x + b.w &&
    b.x < a.x + a.w &&
    a.y < b.y + b.h &&
    b.y < a.y + a.h
  );
}

export function findFreeSlot(placed, w, h, cols) {
  for (let y = 0; y < 400; y++) {
    for (let x = 0; x + w <= cols; x++) {
      const r = { x, y, w, h };
      if (!placed.some((p) => overlaps(r, p))) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

export function assignSlots(layout, cols) {
  const missing = layout.filter((i) => !Number.isInteger(i.x) || !Number.isInteger(i.y));
  if (missing.length === 0) return false;
  const placed = layout.filter((i) => Number.isInteger(i.x) && Number.isInteger(i.y));
  for (const item of missing) {
    const slot = findFreeSlot(placed, item.w, item.h, cols);
    item.x = slot.x;
    item.y = slot.y;
    placed.push(item);
  }
  return true;
}

export function clampToColumns(layout, cols) {
  for (const item of layout) {
    item.w = clampInt(item.w, 1, cols);
    item.h = clampInt(item.h, 1, 6);
    if (Number.isInteger(item.x)) item.x = clampInt(item.x, 0, cols - item.w);
    if (Number.isInteger(item.y)) item.y = Math.max(0, item.y);
    item.locked = !!item.locked;
  }
  return layout;
}

function clampInt(v, lo, hi) {
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) return lo;
  return Math.min(Math.max(v, lo), hi);
}

export function tryPlace(layout, id, x, y, w, h) {
  const items = layout.map((i) => ({ ...i }));
  const me = items.find((i) => i.id === id);
  if (!me) return null;

  me.x = x;
  me.y = y;
  me.w = w;
  me.h = h;

  const inter = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  const lockedOthers = items.filter((i) => i.locked && i.id !== id);
  if (lockedOthers.some((l) => inter(me, l))) return null;

  let guard = 0;
  let movedAny = true;
  while (movedAny && guard++ < 300) {
    movedAny = false;
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    for (const a of items) {
      if (a.locked || a.id === id) continue;
      for (const b of items) {
        if (b.id === a.id || !inter(a, b)) continue;
        const bIsAnchor = b.locked || b.id === id || b.y <= a.y;
        if (bIsAnchor) {
          a.y = b.y + b.h;
          movedAny = true;
          break;
        }
      }
      if (a.y < 0) a.y = 0;
    }
  }

  for (const a of items) {
    if (a.locked) continue;
    for (const b of items) {
      if (b.id === a.id) continue;
      if (inter(a, b)) return null;
    }
  }
  return items;
}
