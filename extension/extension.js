import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Cairo from 'gi://cairo';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const CONFIG_PATH = `${GLib.get_user_config_dir()}/linux-dashboard/dashboard-config.json`;
const GAP = 14;

const WIDGET_NAMES = {
  analogClock: 'Analog Clock',
  digitalClock: 'Digital Clock',
  worldClock: 'World Clock',
  calendar: 'Calendar',
  systemMonitor: 'System Monitor',
  todo: 'To-do List',
  notes: 'Sticky Notes',
  quickLinks: 'Quick Links',
  shortcuts: 'Shortcuts'
};

const THEMES = {
  dark: {
    bg: '#10131a', panel: '#151a24', panel2: '#1c2230',
    text: '#e8ecf3', muted: '#93a0b4', accent: '#4da3ff',
    border: 'rgba(255,255,255,0.08)'
  },
  midnight: {
    bg: '#07080c', panel: '#0e121b', panel2: '#151c2b',
    text: '#e6e9f2', muted: '#7d879c', accent: '#7c5cff',
    border: 'rgba(255,255,255,0.07)'
  },
  nord: {
    bg: '#2e3440', panel: '#3b4252', panel2: '#434c5e',
    text: '#eceff4', muted: '#aeb8cc', accent: '#88c0d0',
    border: 'rgba(236,239,244,0.12)'
  },
  light: {
    bg: '#f3f5f9', panel: '#ffffff', panel2: '#eef1f6',
    text: '#17202e', muted: '#5c6b80', accent: '#2563eb',
    border: 'rgba(15,23,42,0.09)'
  }
};

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, (n & 255)];
}

function rgbaStr(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function cairoRgba(hex, alpha = 1) {
  const [r, g, b] = hexToRgb(hex);
  return [r / 255, g / 255, b / 255, alpha];
}

function flowLayout(items, cols, cellW, cellH, gap) {
  const occupied = new Set();
  const out = [];
  let row = 0;
  for (const item of items) {
    const w = clamp(item.w || 2, 1, cols);
    const h = clamp(item.h || 2, 1, 4);
    let r = row;
    let placed = null;
    while (placed === null) {
      for (let c = 0; c + w <= cols; c++) {
        let free = true;
        for (let dy = 0; dy < h && free; dy++)
          for (let dx = 0; dx < w && free; dx++)
            if (occupied.has((r + dy) * cols + c + dx)) free = false;
        if (free) { placed = { r, c }; break; }
      }
      if (placed === null) r++;
    }
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++)
        occupied.add((placed.r + dy) * cols + placed.c + dx);
    out.push({
      item,
      x: placed.c * (cellW + gap),
      y: placed.r * (cellH + gap),
      w: w * cellW + (w - 1) * gap,
      h: h * cellH + (h - 1) * gap
    });
    row = placed.r;
  }
  return out;
}

function readProcFile(path) {
  try {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok) return null;
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function cpuTimes() {
  const txt = readProcFile('/proc/stat');
  if (!txt) return null;
  const line = txt.split('\n')[0];
  if (!line.startsWith('cpu')) return null;
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = (parts[3] || 0) + (parts[4] || 0);
  const total = parts.slice(0, 8).reduce((a, b) => a + (b || 0), 0);
  return { idle, total };
}

function memInfo() {
  const txt = readProcFile('/proc/meminfo');
  if (!txt) return null;
  const map = {};
  for (const line of txt.split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)/);
    if (m) map[m[1]] = Number(m[2]);
  }
  if (!map.MemTotal) return null;
  const available = map.MemAvailable ?? map.MemFree ?? 0;
  return { total: map.MemTotal, available };
}

function sysInfo(prev) {
  const cur = cpuTimes();
  let cpu = null;
  if (cur && prev && prev.cpu) {
    const dt = cur.total - prev.cpu.total;
    const di = cur.idle - prev.cpu.idle;
    cpu = dt > 0 ? clamp((1 - di / dt) * 100, 0, 100) : 0;
  }
  const mem = memInfo();
  const upTxt = readProcFile('/proc/uptime');
  return {
    cpu,
    memPct: mem ? ((mem.total - mem.available) / mem.total) * 100 : null,
    uptime: upTxt ? Number(upTxt.split(' ')[0]) || 0 : 0,
    hostname: GLib.get_host_name(),
    _cur: cur
  };
}

function wrapLabel(label) {
  const ct = label.get_clutter_text();
  ct.set_line_wrap(true);
  ct.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
  return label;
}

export default class LinuxDashboardExtension extends Extension {
  enable() {
    this._config = null;
    this._root = new St.Widget({ reactive: false });
    Main.layoutManager._backgroundGroup.add_child(this._root);
    this._refs = { time: [], sys: [], rebuildCalendar: null };
    this._timeouts = [];
    this._debounce = 0;
    this._monitor = null;
    this._lastDayKey = '';
    this._prevCpu = null;

    log('linux-dashboard: extension enabled');
    this._loadAndRender();
    this._setupMonitor();
    this._startTimers();

    this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => this._loadAndRender());
    this._timeouts.push(GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
      this._render();
      return GLib.SOURCE_REMOVE;
    }));
  }

  disable() {
    if (this._monitorsChangedId) {
      Main.layoutManager.disconnect(this._monitorsChangedId);
      this._monitorsChangedId = null;
    }
    for (const id of this._timeouts) GLib.source_remove(id);
    this._timeouts = [];
    if (this._debounce) {
      GLib.source_remove(this._debounce);
      this._debounce = 0;
    }
    if (this._monitor) {
      this._monitor.cancel();
      this._monitor = null;
    }
    if (this._root) {
      this._root.destroy();
      this._root = null;
    }
    this._refs = { time: [], sys: [], rebuildCalendar: null };
    this._config = null;
    log('linux-dashboard: extension disabled');
  }

  _loadConfig() {
    try {
      const [ok, bytes] = GLib.file_get_contents(CONFIG_PATH);
      if (!ok) {
        this._config = null;
        return;
      }
      this._config = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      this._config = null;
    }
  }

  _setupMonitor() {
    try {
      const file = Gio.File.new_for_path(CONFIG_PATH);
      this._monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
      this._monitor.connect('changed', () => {
        if (this._debounce) GLib.source_remove(this._debounce);
        this._debounce = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
          this._debounce = 0;
          this._loadAndRender();
          return GLib.SOURCE_REMOVE;
        });
      });
    } catch {
      this._monitor = null;
    }
  }

  _startTimers() {
    const layout = (this._config && this._config.layout) || [];
    const smooth = layout.some(i => i.type === 'analogClock' && i.settings && i.settings.smooth);
    if (smooth) {
      this._timeouts.push(GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        this._tickTime();
        return GLib.SOURCE_CONTINUE;
      }));
    } else {
      this._timeouts.push(GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        this._tickTime();
        return GLib.SOURCE_CONTINUE;
      }));
    }
    this._timeouts.push(GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
      this._tickSys();
      return GLib.SOURCE_CONTINUE;
    }));
  }

  _loadAndRender() {
    this._loadConfig();
    this._render();
    this._tickTime();
    this._tickSys();
  }

  _palette() {
    const cfg = this._config || {};
    const pal = { ...(THEMES[cfg.theme] || THEMES.dark) };
    if (cfg.accent) pal.accent = cfg.accent;
    return pal;
  }

  _render() {
    const cfg = this._config;
    const desktop = (cfg && cfg.desktop) || {};
    const layout = (cfg && cfg.layout) || [];
    const monitor = Main.layoutManager.primaryMonitor
      || (Main.layoutManager.monitors && Main.layoutManager.monitors[0])
      || null;
    const geo = monitor || (() => {
      try {
        const [w, h] = global.display.get_size();
        return { x: 0, y: 0, width: w, height: h };
      } catch {
        return null;
      }
    })();

    if (!geo || !desktop.enabled || layout.length === 0) {
      log(`linux-dashboard: hidden (monitor=${!!geo} enabled=${!!desktop.enabled} widgets=${layout.length})`);
      this._root.visible = false;
      return;
    }

    const pal = this._palette();
    const cols = clamp(desktop.cols || 6, 2, 8);
    const margin = desktop.margin ?? 40;
    const padL = clamp(desktop.padL || 120, 0, 400);
    const padR = clamp(desktop.padR || 200, 0, 600);
    const rowH = clamp(desktop.rowH || 100, 70, 200);
    const bgAlpha = clamp((desktop.opacity ?? 80) / 100, 0.1, 1);

    const cellW = Math.floor((geo.width - padL - padR - (cols - 1) * GAP) / cols);
    if (cellW < 120) {
      log(`linux-dashboard: hidden (cellW ${cellW} too small for screen ${geo.width})`);
      this._root.visible = false;
      return;
    }

    this._root.remove_all_children();
    this._refs = { time: [], sys: [], rebuildCalendar: null };
    this._lastDayKey = '';

    const panelH = Main.layoutManager.panelBox ? Main.layoutManager.panelBox.height : 32;
    this._root.set_position(geo.x + padL, geo.y + panelH + margin);

    let positioned;
    const allExplicit = layout.every((i) => Number.isInteger(i.x) && Number.isInteger(i.y));
    if (allExplicit) {
      positioned = layout.map((item) => {
        const w = clamp(item.w || 2, 1, cols);
        const h = clamp(item.h || 1, 1, 4);
        const x = clamp(item.x, 0, cols - w);
        const y = Math.max(0, item.y || 0);
        return {
          item,
          x: x * (cellW + GAP),
          y: y * (rowH + GAP),
          w: w * cellW + (w - 1) * GAP,
          h: h * rowH + (h - 1) * GAP
        };
      });
    } else {
      positioned = flowLayout(layout, cols, cellW, rowH, GAP);
    }

    let built = 0;
    for (const pos of positioned) {
      const builder = BUILDERS[pos.item.type];
      if (!builder) continue;
      try {
        const actor = builder(this, pos.item, pos.w, pos.h, pal, bgAlpha);
        if (actor) {
          actor.set_position(pos.x, pos.y);
          this._root.add_child(actor);
          built++;
        }
      } catch (e) {
        console.error(`linux-dashboard: widget ${pos.item.type} failed: ${e}`);
      }
    }

    this._root.visible = built > 0;
    log(`linux-dashboard: rendered ${built}/${layout.length} widgets (${cols} cols, cell ${cellW}x${rowH})`);
  }

  _tickTime() {
    if (!this._root || !this._root.visible) return;
    const now = GLib.DateTime.new_now_local();
    const dayKey = now.format('%Y-%m-%d');
    if (dayKey !== this._lastDayKey) {
      this._lastDayKey = dayKey;
      if (this._refs.rebuildCalendar) {
        try { this._refs.rebuildCalendar(now); } catch (e) { console.error(e); }
      }
    }
    for (const fn of this._refs.time) {
      try { fn(now); } catch (e) { console.error(e); }
    }
  }

  _tickSys() {
    if (!this._root || !this._root.visible) return;
    const info = sysInfo(this._prevCpu);
    this._prevCpu = { cpu: info._cur };
    delete info._cur;
    for (const fn of this._refs.sys) {
      try { fn(info); } catch (e) { console.error(e); }
    }
  }

  _frame(title, w, h, pal, bgAlpha) {
    const box = new St.BoxLayout({
      vertical: true,
      style: `
        background-color: ${rgbaStr(pal.panel, bgAlpha * 0.55)};
        border: 1px solid ${rgbaStr(pal.accent, 0.12)};
        border-radius: 16px;
        padding: 10px 14px 12px;
        box-shadow: 0 8px 32px -8px rgba(0,0,0,0.45);
      `
    });
    box.set_size(w, h);
    box.set_clip_to_allocation(true);
    if (title) {
      box.add_child(new St.Label({
        text: title.toUpperCase(),
        style: `font-size: 10px; font-weight: 700; color: ${pal.muted}; letter-spacing: 1px;`
      }));
    }
    return box;
  }

  _zone(tzName) {
    if (!tzName || tzName === 'system') return null;
    try {
      return GLib.TimeZone.new(tzName);
    } catch {
      return null;
    }
  }
}

const BUILDERS = {
  digitalClock(ext, item, w, h, pal, bgAlpha) {
    const s = item.settings || {};
    const box = ext._frame('Digital Clock', w, h, pal, bgAlpha);

    const timeLabel = new St.Label({
      style: `font-size: 38px; font-weight: 700; font-family: 'DejaVu Sans Mono', monospace; color: ${pal.text}; text-shadow: 0 0 20px ${rgbaStr(pal.accent, 0.25)};`
    });
    const ampmLabel = new St.Label({
      style: `font-size: 14px; font-weight: 600; color: ${pal.muted}; margin-top: 20px; margin-left: 6px;`
    });
    const timeRow = new St.BoxLayout();
    timeRow.set_x_align(Clutter.ActorAlign.CENTER);
    timeRow.add_child(timeLabel);
    timeRow.add_child(ampmLabel);
    box.add_child(timeRow);

    const dateLabel = new St.Label({
      style: `font-size: 13px; color: ${pal.muted}; margin-top: 4px;`
    });
    dateLabel.set_x_align(Clutter.ActorAlign.CENTER);
    box.add_child(dateLabel);

    const tzObj = ext._zone(s.timezone);

    ext._refs.time.push((now) => {
      const dt = tzObj ? GLib.DateTime.new_now(tzObj) : now;
      let fmt = s.format === '12h' ? '%I:%M' : '%H:%M';
      if (s.seconds !== false) fmt += ':%S';
      let t = dt.format(fmt);
      if (s.format === '12h') t = t.replace(/^0/, '');
      timeLabel.text = t;
      ampmLabel.text = s.format === '12h' ? dt.format('%p') : '';
      if (s.showDate !== false) {
        dateLabel.text = dt.format('%A, %B %-d');
        dateLabel.show();
      } else {
        dateLabel.hide();
      }
    });
    return box;
  },

  analogClock(ext, item, w, h, pal, bgAlpha) {
    const s = item.settings || {};
    const box = ext._frame('Analog Clock', w, h, pal, bgAlpha);
    const size = Math.max(60, Math.min(w - 28, h - 44));

    const area = new St.DrawingArea();
    area.set_x_align(Clutter.ActorAlign.CENTER);
    area.set_size(size, size);

    const tzObj = ext._zone(s.timezone);
    const numbers = s.numbers !== false;
    const textCol = cairoRgba(pal.text);
    const mutedCol = cairoRgba(pal.muted, 0.6);
    const accentCol = cairoRgba(pal.accent);

    area.connect('repaint', () => {
      const cr = area.get_context();
      const cx = size / 2;
      const cy = size / 2;
      const r = size / 2 - 4;
      const now = tzObj ? GLib.DateTime.new_now(tzObj) : GLib.DateTime.new_now_local();
      const hh = now.get_hour() % 12;
      const mm = now.get_minute();
      const ss = now.get_second();

      cr.setSourceRGBA(...mutedCol);
      cr.setLineWidth(1.5);
      cr.arc(cx, cy, r, 0, Math.PI * 2);
      cr.stroke();

      // Subtle inner glow
      const glowCol = [...accentCol.slice(0, 3), 0.06];
      cr.setSourceRGBA(...glowCol);
      cr.setLineWidth(6);
      cr.arc(cx, cy, r - 2, 0, Math.PI * 2);
      cr.stroke();

      for (let i = 0; i < 60; i++) {
        const major = i % 5 === 0;
        const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
        const outer = r - 6;
        const inner = r - (major ? 14 : 9);
        cr.setSourceRGBA(...(major ? textCol : mutedCol));
        cr.setLineWidth(major ? 2.4 : 1.2);
        cr.moveTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
        cr.lineTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
        cr.stroke();

        if (major && numbers) {
          const num = i === 0 ? 12 : i / 5;
          cr.setSourceRGBA(...textCol);
          cr.selectFontFace('DejaVu Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
          cr.setFontSize(Math.max(10, r * 0.13));
          const te = cr.textExtents(String(num));
          const nx = cx + Math.cos(a) * (r - 26);
          const ny = cy + Math.sin(a) * (r - 26);
          cr.moveTo(nx - te.width / 2 - te.x_bearing, ny - te.height / 2 - te.y_bearing);
          cr.showText(String(num));
        }
      }

      const secA = (ss / 60) * Math.PI * 2;
      const minA = ((mm + ss / 60) / 60) * Math.PI * 2;
      const hourA = ((hh + mm / 60) / 12) * Math.PI * 2;

      const hand = (angle, len, width, color) => {
        cr.save();
        cr.translate(cx, cy);
        cr.rotate(angle);
        cr.setSourceRGBA(...color);
        cr.setLineWidth(width);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.moveTo(0, len * 0.15);
        cr.lineTo(0, -len);
        cr.stroke();
        cr.restore();
      };

      hand(hourA, r * 0.48, Math.max(3.5, r * 0.05), textCol);
      hand(minA, r * 0.7, Math.max(2.5, r * 0.035), textCol);
      hand(secA, r * 0.82, Math.max(1.5, r * 0.02), accentCol);

      cr.setSourceRGBA(...accentCol);
      cr.arc(cx, cy, Math.max(3, r * 0.045), 0, Math.PI * 2);
      cr.fill();
      cr.$dispose();
    });

    box.add_child(area);
    ext._refs.time.push(() => area.queue_repaint());
    return box;
  },

  worldClock(ext, item, w, h, pal, bgAlpha) {
    const box = ext._frame('World Clock', w, h, pal, bgAlpha);
    const zones = (item.settings && item.settings.zones) || [];
    const rows = [];

    for (const zone of zones) {
      const row = new St.BoxLayout({
        style: `padding: 5px 4px; border-bottom: 1px solid ${rgbaStr(pal.accent, 0.08)};`
      });
      const city = zone.split('/').pop().replace(/_/g, ' ') || zone;
      const cityLabel = new St.Label({
        text: city,
        style: `font-size: 12px; color: ${pal.muted};`
      });
      cityLabel.set_x_expand(true);
      row.add_child(cityLabel);
      const time = new St.Label({
        style: `font-size: 15px; font-weight: 600; font-family: 'DejaVu Sans Mono', monospace; color: ${pal.text};`
      });
      row.add_child(time);
      box.add_child(row);
      rows.push({ tz: ext._zone(zone), label: time });
    }

    ext._refs.time.push((now) => {
      for (const r of rows) {
        const dt = r.tz ? GLib.DateTime.new_now(r.tz) : now;
        r.label.text = dt.format('%H:%M');
      }
    });
    return box;
  },

  calendar(ext, item, w, h, pal, bgAlpha) {
    const s = item.settings || {};
    const box = ext._frame('Calendar', w, h, pal, bgAlpha);
    const label = new St.Label({
      style: `font-size: 13px; font-weight: 700; color: ${pal.text}; margin-bottom: 4px;`
    });
    label.set_x_align(Clutter.ActorAlign.CENTER);
    box.add_child(label);

    const innerW = w - 28;
    const grid = new St.Widget();
    const lm = new Clutter.GridLayout();
    lm.set_column_spacing(2);
    lm.set_row_spacing(2);
    grid.set_layout_manager(lm);
    box.add_child(grid);

    const dow = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const order = s.startOfWeek === 'mon' ? dow.slice(1).concat(dow[0]) : dow;

    const cellWd = Math.floor(innerW / 7);
    const dayStyle = `font-size: 11px; color: ${pal.text};`;
    const todayStyle = `font-size: 11px; font-weight: 700; color: #ffffff; background-color: ${pal.accent}; border-radius: 8px; box-shadow: 0 0 10px ${rgbaStr(pal.accent, 0.35)};`;

    const build = (now) => {
      label.text = now.format('%B %Y');
      grid.remove_all_children();
      const y = now.get_year();
      const m = now.get_month();
      for (let i = 0; i < 7; i++) {
        const l = new St.Label({
          text: order[i],
          style: `font-size: 9px; font-weight: 700; color: ${pal.muted};`
        });
        l.set_size(cellWd, 14);
        l.set_x_align(Clutter.ActorAlign.CENTER);
        lm.attach(l, i, 0, 1, 1);
      }
      const first = GLib.DateTime.new_local(y, m, 1, 0, 0, 0);
      const dowFirst = first.get_day_of_week();
      const offset = s.startOfWeek === 'mon' ? (dowFirst + 6) % 7 : dowFirst % 7;
      const ny = m === 12 ? y + 1 : y;
      const nm = m === 12 ? 1 : m + 1;
      const daysInMonth = GLib.DateTime.new_local(ny, nm, 1, 0, 0, 0).add_days(-1).get_day_of_month();
      const todayNow = GLib.DateTime.new_now_local();
      const isCurrentMonth = y === todayNow.get_year() && m === todayNow.get_month();
      const today = todayNow.get_day_of_month();

      let col = offset;
      let rowI = 1;
      for (let d = 1; d <= daysInMonth; d++) {
        if (col >= 7) {
          col = 0;
          rowI++;
        }
        const isToday = isCurrentMonth && d === today;
        const l = new St.Label({
          text: String(d),
          style: isToday ? todayStyle : dayStyle
        });
        l.set_size(cellWd, 18);
        l.set_x_align(Clutter.ActorAlign.CENTER);
        l.set_y_align(Clutter.ActorAlign.CENTER);
        lm.attach(l, col, rowI, 1, 1);
        col++;
      }
    };

    build(GLib.DateTime.new_now_local());
    ext._refs.rebuildCalendar = build;
    return box;
  },

  systemMonitor(ext, item, w, h, pal, bgAlpha) {
    const box = ext._frame('System Monitor', w, h, pal, bgAlpha);
    const innerW = w - 28;
    const rows = {};

    const mkRow = (name) => {
      const wrap = new St.BoxLayout({ vertical: true, style: 'margin-top: 6px;' });
      const labels = new St.BoxLayout();
      const nameLabel = new St.Label({
        text: name,
        style: `font-size: 11px; color: ${pal.muted};`
      });
      nameLabel.set_x_expand(true);
      labels.add_child(nameLabel);
      const value = new St.Label({
        style: `font-size: 11px; font-weight: 700; font-family: 'DejaVu Sans Mono', monospace; color: ${pal.text};`
      });
      labels.add_child(value);
      const bar = new St.Widget({
        style: `background-color: ${rgbaStr(pal.panel2, 0.7)}; border-radius: 4px;`
      });
      bar.set_size(innerW, 8);
      const fill = new St.Widget({
        style: `background-color: ${pal.accent}; border-radius: 4px; box-shadow: 0 0 8px ${rgbaStr(pal.accent, 0.3)};`
      });
      fill.set_size(2, 8);
      bar.add_child(fill);
      wrap.add_child(labels);
      wrap.add_child(bar);
      box.add_child(wrap);
      return { value, fill };
    };

    rows.cpu = mkRow('CPU');
    rows.mem = mkRow('Memory');
    const foot = new St.Label({
      style: `font-size: 10px; color: ${pal.muted}; margin-top: 8px;`
    });
    box.add_child(foot);

    const fmtUp = (s) => {
      const d = Math.floor(s / 86400);
      const hrs = Math.floor((s % 86400) / 3600);
      const mnt = Math.floor((s % 3600) / 60);
      return `${d ? d + 'd ' : ''}${hrs}h ${mnt}m`;
    };

    ext._refs.sys.push((info) => {
      if (info.cpu !== null) {
        rows.cpu.value.text = `${Math.round(info.cpu * 10) / 10}%`;
        rows.cpu.fill.set_size(Math.max(3, innerW * info.cpu / 100), 8);
      }
      if (info.memPct !== null) {
        rows.mem.value.text = `${info.memPct.toFixed(1)}%`;
        rows.mem.fill.set_size(Math.max(3, innerW * info.memPct / 100), 8);
      }
      foot.text = `${info.hostname} • up ${fmtUp(info.uptime)}`;
    });
    return box;
  },

  todo(ext, item, w, h, pal, bgAlpha) {
    const box = ext._frame('To-do List', w, h, pal, bgAlpha);
    const items = (item.settings && item.settings.items) || [];

    for (const task of items.slice(0, 8)) {
      const row = wrapLabel(new St.Label({
        text: `${task.done ? '✓' : '○'}  ${task.text}`,
        style: `font-size: 12px; color: ${task.done ? pal.muted : pal.text}; padding: 3px 2px; ${task.done ? 'text-decoration: line-through;' : ''}`
      }));
      row.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
      box.add_child(row);
    }

    if (items.length === 0) {
      box.add_child(new St.Label({
        text: 'No tasks — add them in the app',
        style: `font-size: 12px; color: ${pal.muted}; padding: 4px 2px;`
      }));
    }
    return box;
  },

  notes(ext, item, w, h, pal, bgAlpha) {
    const box = ext._frame('Sticky Notes', w, h, pal, bgAlpha);
    const text = (item.settings && item.settings.text) || '';
    const label = wrapLabel(new St.Label({
      text: text || '—',
      opacity: text ? 255 : 110,
      style: `font-size: 13px; color: ${pal.text}; padding: 4px 2px; line-height: 1.5;`
    }));
    label.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.NONE);
    box.add_child(label);
    return box;
  },

  shortcuts(ext, item, w, h, pal, bgAlpha) {
    const box = ext._frame('Shortcuts', w, h, pal, bgAlpha);
    const items = (item.settings && item.settings.items) || [];

    const grid = new St.Widget({
      style: 'padding: 4px 0;'
    });
    const lm = new Clutter.GridLayout();
    lm.set_column_spacing(8);
    lm.set_row_spacing(8);
    grid.set_layout_manager(lm);

    const cols = clamp(Math.floor(w / 90), 2, 6);
    items.forEach((sc, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);

      const btn = new St.BoxLayout({
        vertical: true,
        x_align: Clutter.ActorAlign.CENTER,
        style: `
          background-color: ${rgbaStr(pal.panel2, 0.6)};
          border: 1px solid ${rgbaStr(pal.accent, 0.1)};
          border-radius: 10px;
          padding: 8px 4px 6px;
          spacing: 4px;
        `
      });
      btn.set_size(Math.floor((w - 28 - (cols - 1) * 8) / cols), 52);

      const iconLabel = new St.Label({
        text: sc.label ? sc.label.charAt(0).toUpperCase() : '?',
        style: `font-size: 18px; font-weight: 700; color: ${pal.accent};`
      });
      iconLabel.set_x_align(Clutter.ActorAlign.CENTER);
      btn.add_child(iconLabel);

      const nameLabel = new St.Label({
        text: sc.label || sc.path || '?',
        style: `font-size: 9px; font-weight: 600; color: ${pal.muted};`
      });
      nameLabel.set_x_align(Clutter.ActorAlign.CENTER);
      const ct = nameLabel.get_clutter_text();
      ct.set_ellipsize(Pango.EllipsizeMode.END);
      btn.add_child(nameLabel);

      lm.attach(btn, col, row, 1, 1);
    });

    if (items.length === 0) {
      box.add_child(new St.Label({
        text: 'No shortcuts — add them in the app',
        style: `font-size: 12px; color: ${pal.muted}; padding: 4px 2px;`
      }));
    } else {
      box.add_child(grid);
    }
    return box;
  }
};
