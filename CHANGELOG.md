# Changelog

All notable changes to the Linux Dashboard project, newest first.

## 3.0 — Glassmorphic UI redesign

Complete visual overhaul while preserving the full customization engine.

### Layout architecture
- **Viewport fix**: Dashboard content now lives inside a clearly defined canvas
  region (header → canvas + sidebar) so widgets can never be positioned behind
  the header or sidebar.
- **Three-region layout**: Header (52 px), Dashboard Canvas (scrollable), and a
  fixed right-side Sidebar for desktop folder shortcuts.
- Grid guides appear as subtle dashed lines only in Edit Mode; invisible in
  Preview Mode.

### Application header
- Modern compact header with brand (icon + "Dashboard" / "Customize your desktop").
- Segmented **Edit Mode / Preview Mode** switch (replaces the single toggle).
- Actions always visible: **+ Add Widget**, **Save Layout**, **Settings** (gear).
- Native Linux window controls (minimize, maximize, close).

### Right sidebar
- Desktop shortcut tiles for Home, Documents, Downloads, Music, Pictures, Videos
  (only directories that exist on the machine).
- Opens folders in the system file manager via `shell.openPath`.

### Settings modal
- Unified modal replacing the old inline theme/accent/desktop controls.
- **Appearance**: Theme selector + accent color picker (live preview on change).
- **Desktop Widgets**: enabled toggle, columns, margin, opacity, row height.
- **Layout**: Reset button with confirmation.

### Widget card redesign
- Glassmorphic cards: translucent backdrop-filter blur, soft borders, rounded
  corners, subtle hover glow/lift animation.
- **Drag handle** (`⠿` grip icon) visible in Edit Mode at the start of each
  widget header.
- Lock / Settings / Delete icon buttons restyled as transparent icon buttons
  that appear on hover in Preview Mode and always in Edit Mode.
- **Delete** now uses a trash icon (🗑).

### Digital Clock
- Premium monospace typography, accent-colored seconds, subtle date line.

### Analog Clock
- Dark radial face gradient, thin tick marks, glow on second hand and center
  dot, minimal numbers (12/3/6/9 only).

### System Monitor
- **CPU sparkline**: live canvas bar chart showing the last ~48 samples with
  rounded bars and per-bar opacity scaling.
- **Memory bar**: segmented fill that turns amber (>75%) or red (>90%).
- Footer with hostname + uptime.

### To-do List
- Custom circular checkboxes (accent fill + check mark).
- **Priority cycling**: hover reveals a flag button; cycles none → low →
  medium → high → none. Color-coded sub-labels (green / amber / red).
- Modern add-row with accent `+` button.

### Sticky Notes
- Warm translucent surface with subtle gold accent border and
  `focus-within` glow.

### Calendar
- Today cell rendered as a circular accent indicator (border-radius: 50%).
- Day-of-week labels uppercased, clean typography.

### World Clock
- Globe watermark in the top-right corner (low-opacity SVG).
- Rows with subtle bottom borders and hover highlight.

### Edit mode visual feedback
- Grid guide lines (CSS repeating-linear-gradient, computed from actual column
  and row dimensions).
- Drop placeholder with pulsing animation.
- Selected widget gets accent outline glow.
- FLIP animation on widget snap (0.2 s ease with slight overshoot).

### Animations
- Widget hover: subtle `translate: 0 -2px` lift + stronger shadow (Preview
  Mode only; Edit Mode keeps cursor grab).
- Dragging: accent border + brightness(1.04) + elevated shadow.
- Button hover: subtle glow background transition.
- Modal: scale-fade pop-in. Drawer: slide-from-right. Toast: slide-up.
- Respects `prefers-reduced-motion`.

### Color system
- Primary accent: `#4da3ff` (electric blue).
- Secondary: `#a78bfa` (purple), success: `#34d399`, warning: `#fbbf24`,
  danger: `#f87171`.
- Theme-aware glass tokens for all four themes (Dark, Midnight, Nord, Light).

### Responsive behavior
- Sidebar collapses to 140 px at ≤1180 px, icon-only rail (56 px) at ≤1000 px,
  hidden at ≤820 px.
- Mode-switch labels and button text hide progressively at narrow widths.
- Dashboard canvas is its own scroll container so widgets stay within bounds.

### Window controls IPC
- New preload APIs: `winMinimize()`, `winMaximize()`, `winClose()`.
- New main-process IPC: `win:minimize`, `win:maximize`, `win:close`.

### Sidebar IPC
- New preload APIs: `listDirs()`, `openPath()`.
- New main-process IPC: `sys:dirs` (returns existing XDG directories),
  `fs:openPath` (opens folder in system file manager, restricted to user
  home and /media /mnt).

### Fixes
- Widgets can no longer be dragged behind the header or sidebar.
- The dashboard canvas dimensions are now used for column calculation instead
  of `window.innerWidth`.
- Grid guide CSS variables are recomputed on resize.
- `addItem` scrolls the canvas container instead of the window.

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
