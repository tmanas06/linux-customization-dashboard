# Changelog

All notable changes to the Linux Dashboard project, newest first.

## 2.0 — Grid layout engine & real drag-and-drop

The headline release: the dashboard became a true desktop-layout editor.

### Layout engine (`src/js/layout.js`)
- Every widget now stores an **explicit grid position and size**:
  `{ id, type, x, y, w, h, locked, settings }` — the layout state is the single
  source of truth for where things render (app *and* desktop).
- **Placement engine**: collision detection, automatic push-down of neighbors,
  rejection of placements that would overlap locked widgets.
- **Free-slot finder**: new widgets always spawn in the first genuinely empty
  area — never on top of an existing widget. Multiple instances supported.
- **Bounds clamping**: positions/sizes are validated against the column count on
  load; legacy configs without positions are migrated automatically.
- Unit-tested (15 assertions: moves, pushes, lock rejection, resize pushes,
  free slots, migration, clamping).

### Real mouse dragging (editor)
- Pointer-based dragging: press and move ≥ 6 px to pick a widget up (plain
  clicks never move anything).
- The widget follows the mouse smoothly while a **dashed drop-zone preview**
  shows the exact target cells and size (`Calendar — 2 × 2`).
- Invalid targets show a red **Blocked** preview; release snaps to the nearest
  valid grid cell and updates the real layout state (not just visuals).
- Buttons, inputs, textareas and editable labels never initiate a drag.
- `Esc` cancels a drag mid-flight; nothing is written to disk while dragging.

### Resizing
- Drag handles on every unlocked widget: bottom-right corner, right edge,
  bottom edge.
- Live grid-snapped resizing with per-widget minimums; blocked resizes revert
  with a toast explanation.

### Locking
- Per-widget lock (padlock button in the header, or checkbox in settings).
- Locked widgets cannot be dragged or resized, block other widgets from
  overlapping them, and persist their state.

### Selection & keyboard
- Click a widget to select it (accent outline); click empty space or `Esc` to
  deselect.
- **Arrow keys** nudge the selected widget one cell (collision-checked).

### Persistence
- `Save` / `Ctrl+S` persists positions, sizes, order, types, ids, settings and
  lock states to the shared config; autosave (~0.3 s debounced) backs it up.
- Restart restores the dashboard exactly as saved — verified end-to-end.

### Desktop extension parity
- The GNOME extension now renders widgets at the **exact stored positions**
  (with a fallback flow layout for legacy configs) — the desktop mirrors the
  editor pixel-for-pixel. Verified 7/7 widgets in a real GNOME Shell instance.

### Fixes during development
- `clampToColumns` no longer coerces missing positions to (0,0) before slot
  assignment (widgets stacked on top of each other).
- Missing `btnReset` declaration crashed the whole editor module on boot.

## 1.4 — Live desktop preview
- The editor now shows **your actual wallpaper** behind the widgets — it is a
  faithful preview of the real desktop (same columns, margins, opacity, row
  height as the renderer).
- Wallpaper is read from GNOME settings (`picture-uri` / `picture-uri-dark`).
- Status hint bar reflects desktop-mode state.

## 1.3 — Always-on customization + explicit Save
- The app opens **directly in edit mode**; `Done` previews, `Ctrl+E` returns.
- **Save** button + `Ctrl+S` push the layout to the desktop immediately with a
  confirmation toast; debounced autosave remains as a safety net.

## 1.2 — Real desktop rendering (GNOME Shell extension)
- `extension/` renders all widgets directly on the desktop (behind windows):
  analog clock (Cairo via `St.DrawingArea`), digital clock, world clock,
  calendar, CPU/RAM monitor from `/proc`, to-do, notes.
- Watches the shared config file and re-renders live (~1 s after any change).
- Themes/accent from config; click-through, desktop-icon friendly.
- Installer handles GNOME version patching, gsettings enable, config seeding.
- Verified in an isolated headless GNOME Shell: 7/7 widgets, zero JS errors.

## 1.1 — Proper Linux app integration
- `.desktop` menu entry + icon (`npm run install:app`), autostart at login
  (`npm run install:autostart`), single-instance lock, native menu removed.
- Config storage unified at `~/.config/linux-dashboard/` (shared by app and
  extension), with automatic migration from the legacy Electron path.
- Continuous CPU sampling (no more "—" on first paint).

## 1.0 — Initial dashboard app
- Electron editor with 8 widgets: Digital Clock, Analog Clock, World Clock,
  Calendar, System Monitor, To-do List, Sticky Notes, Quick Links.
- Per-widget settings modals, widget library drawer, add/remove.
- Themes (Dark / Midnight / Nord / Light) + custom accent color.
- JSON persistence, reset-to-defaults, fullscreen, keyboard shortcuts.
