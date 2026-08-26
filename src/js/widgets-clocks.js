export const TIMEZONES = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC', 'America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Tokyo'];
  }
})();

export function timeParts(date, tz, hour12) {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12,
      timeZone: tz === 'system' ? undefined : tz
    });
    const p = {};
    for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
    return { h: p.hour, m: p.minute, s: p.second, dayPeriod: (p.dayPeriod || '').toLowerCase() };
  } catch {
    return {
      h: String(hour12 ? ((date.getHours() % 12) || 12) : date.getHours()).padStart(2, '0'),
      m: String(date.getMinutes()).padStart(2, '0'),
      s: String(date.getSeconds()).padStart(2, '0'),
      dayPeriod: date.getHours() >= 12 ? 'pm' : 'am'
    };
  }
}

function zonedNow(tz) {
  const date = new Date();
  const p = timeParts(date, tz, false);
  return { h: +p.h % 24, m: +p.m, s: +p.s, ms: date.getMilliseconds() };
}

export function cityOf(tz) {
  if (!tz || tz === 'system') return 'Local time';
  const parts = tz.split('/');
  return parts[parts.length - 1].replace(/_/g, ' ');
}

export function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function iconButton(icon, cls, title) {
  const b = el('button', cls);
  b.innerHTML = icon;
  b.title = title || '';
  b.type = 'button';
  return b;
}

const cssVar = (name, fallback) => getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;

export const clockWidgets = {
  analogClock: {
    name: 'Analog Clock',
    desc: 'Classic clock face with smooth sweep option',
    defaultSize: { w: 2, h: 2 },
    defaults: { timezone: 'system', numbers: true, smooth: false },
    settings: [
      { key: 'timezone', label: 'Timezone', type: 'tz' },
      { key: 'numbers', label: 'Show hour numbers', type: 'bool' },
      { key: 'smooth', label: 'Smooth sweeping hand', type: 'bool' }
    ],
    mount(body, item) {
      body.classList.add('center');
      const st = item.settings;
      const cv = el('canvas', 'analog');
      cv.setAttribute('aria-label', 'Analog clock');
      body.appendChild(cv);

      const draw = () => {
        const size = Math.min(body.clientWidth, body.clientHeight) - 8;
        if (size <= 10) return;
        const dpr = window.devicePixelRatio || 1;
        cv.width = size * dpr;
        cv.height = size * dpr;
        cv.style.height = `${size}px`;
        const ctx = cv.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size, size);

        const cx = size / 2;
        const cy = size / 2;
        const r = size / 2 - 4;
        const text = cssVar('--text', '#fff');
        const muted = cssVar('--muted', '#888');
        const accent = cssVar('--accent', '#4da3ff');

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = muted;
        ctx.lineWidth = 2;
        ctx.stroke();

        for (let i = 0; i < 60; i++) {
          const major = i % 5 === 0;
          const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
          const outer = r - 6;
          const inner = r - (major ? 14 : 9);
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
          ctx.lineTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
          ctx.strokeStyle = major ? text : muted;
          ctx.globalAlpha = major ? 0.9 : 0.35;
          ctx.lineWidth = major ? 2.4 : 1.2;
          ctx.stroke();
          ctx.globalAlpha = 1;

          if (major && st.numbers) {
            const num = i === 0 ? 12 : i / 5;
            ctx.fillStyle = text;
            ctx.font = `600 ${Math.max(10, r * 0.13)}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(num), cx + Math.cos(a) * (r - 26), cy + Math.sin(a) * (r - 26));
          }
        }

        const t = zonedNow(st.timezone);
        const secA = ((t.s + (st.smooth ? t.ms / 1000 : 0)) / 60) * Math.PI * 2 - Math.PI / 2;
        const minA = ((t.m + t.s / 60) / 60) * Math.PI * 2 - Math.PI / 2;
        const hourA = (((t.h % 12) + t.m / 60) / 12) * Math.PI * 2 - Math.PI / 2;

        const hand = (angle, len, width, color) => {
          ctx.beginPath();
          ctx.moveTo(cx - Math.cos(angle) * len * 0.15, cy - Math.sin(angle) * len * 0.15);
          ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
          ctx.strokeStyle = color;
          ctx.lineCap = 'round';
          ctx.lineWidth = width;
          ctx.stroke();
        };

        hand(hourA, r * 0.48, Math.max(3.5, r * 0.05), text);
        hand(minA, r * 0.7, Math.max(2.5, r * 0.035), text);
        hand(secA, r * 0.82, Math.max(1.5, r * 0.02), accent);

        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(3, r * 0.045), 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
      };

      draw();
      const iv = setInterval(draw, st.smooth ? 50 : 250);
      const raf = requestAnimationFrame(draw);
      let ro = null;
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => draw());
        ro.observe(body);
      }
      return () => {
        clearInterval(iv);
        cancelAnimationFrame(raf);
        if (ro) ro.disconnect();
      };
    }
  },

  digitalClock: {
    name: 'Digital Clock',
    desc: 'Large numeric clock with date',
    defaultSize: { w: 2, h: 1 },
    defaults: { format: '24h', seconds: true, showDate: true, timezone: 'system' },
    settings: [
      { key: 'format', label: 'Format', type: 'select', options: [{ v: '24h', l: '24-hour' }, { v: '12h', l: '12-hour' }] },
      { key: 'seconds', label: 'Show seconds', type: 'bool' },
      { key: 'showDate', label: 'Show date', type: 'bool' },
      { key: 'timezone', label: 'Timezone', type: 'tz' }
    ],
    mount(body, item) {
      body.classList.add('center');
      const st = item.settings;
      const timeEl = el('div', 'clock-time');
      const dateEl = el('div', 'clock-date');
      body.append(timeEl, dateEl);

      const update = () => {
        const now = new Date();
        const p = timeParts(now, st.timezone, st.format === '12h');
        timeEl.replaceChildren(
          document.createTextNode(`${p.h}:${p.m}`),
          ...(st.seconds ? [Object.assign(el('span', 'sec'), { textContent: `:${p.s}` })] : []),
          ...(st.format === '12h' ? [Object.assign(el('span', 'ampm'), { textContent: p.dayPeriod })] : [])
        );
        if (st.showDate) {
          let ds;
          try {
            ds = now.toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              timeZone: st.timezone === 'system' ? undefined : st.timezone
            });
          } catch {
            ds = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
          }
          dateEl.textContent = ds;
          dateEl.hidden = false;
        } else {
          dateEl.hidden = true;
        }
      };

      update();
      const iv = setInterval(update, 500);
      return () => clearInterval(iv);
    }
  },

  worldClock: {
    name: 'World Clock',
    desc: 'Track time across multiple timezones',
    defaultSize: { w: 2, h: 2 },
    defaults: { zones: ['UTC', 'America/New_York', 'Asia/Tokyo'] },
    settings: [
      { key: 'zones', label: 'Timezones', type: 'zonelist' }
    ],
    mount(body, item) {
      const list = el('div', 'zone-list');
      body.appendChild(list);
      const rows = item.settings.zones.map((tz) => {
        const row = el('div', 'zone-row');
        row.appendChild(el('span', 'zone-city', cityOf(tz)));
        const time = el('span', 'zone-time');
        row.appendChild(time);
        list.appendChild(row);
        return { tz, time };
      });

      const update = () => {
        const now = new Date();
        for (const r of rows) {
          const p = timeParts(now, r.tz, false);
          r.time.textContent = `${p.h}:${p.m}`;
        }
      };

      update();
      const iv = setInterval(update, 5000);
      return () => clearInterval(iv);
    }
  }
};
