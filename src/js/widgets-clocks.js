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
        const r = size / 2 - 6;
        const text = cssVar('--text', '#fff');
        const muted = cssVar('--muted', '#888');
        const accent = cssVar('--accent', '#4da3ff');

        /* Dark face background */
        const faceGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        faceGrad.addColorStop(0, 'rgba(20,24,34,.25)');
        faceGrad.addColorStop(0.7, 'rgba(12,16,24,.12)');
        faceGrad.addColorStop(1, 'rgba(12,16,24,.04)');
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = faceGrad;
        ctx.fill();

        /* Outer ring */
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,.08)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        /* Tick marks */
        for (let i = 0; i < 60; i++) {
          const major = i % 5 === 0;
          const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
          const outer = r - 5;
          const inner = r - (major ? 14 : 8);
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
          ctx.lineTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
          ctx.strokeStyle = major ? text : muted;
          ctx.globalAlpha = major ? 0.8 : 0.2;
          ctx.lineWidth = major ? 1.8 : 0.8;
          ctx.lineCap = 'round';
          ctx.stroke();
          ctx.globalAlpha = 1;

          /* Minimal numbers (12, 3, 6, 9) */
          if (major && st.numbers) {
            const hourIdx = i === 0 ? 12 : i / 5;
            if ([12, 3, 6, 9].includes(hourIdx)) {
              ctx.fillStyle = muted;
              ctx.font = `600 ${Math.max(10, r * 0.12)}px system-ui, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(
                String(hourIdx),
                cx + Math.cos(a) * (r - 24),
                cy + Math.sin(a) * (r - 24)
              );
            }
          }
        }

        const t = zonedNow(st.timezone);
        const secA = ((t.s + (st.smooth ? t.ms / 1000 : 0)) / 60) * Math.PI * 2 - Math.PI / 2;
        const minA = ((t.m + t.s / 60) / 60) * Math.PI * 2 - Math.PI / 2;
        const hourA = (((t.h % 12) + t.m / 60) / 12) * Math.PI * 2 - Math.PI / 2;

        /* Glow helper */
        const glowHand = (angle, len, width, color, glow) => {
          if (glow) {
            ctx.shadowColor = glow;
            ctx.shadowBlur = 8;
          }
          ctx.beginPath();
          ctx.moveTo(cx - Math.cos(angle) * len * 0.12, cy - Math.sin(angle) * len * 0.12);
          ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
          ctx.strokeStyle = color;
          ctx.lineCap = 'round';
          ctx.lineWidth = width;
          ctx.stroke();
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
        };

        /* Hour hand */
        glowHand(hourA, r * 0.45, Math.max(3, r * 0.045), text, null);
        /* Minute hand */
        glowHand(minA, r * 0.68, Math.max(2, r * 0.03), text, null);
        /* Second hand — accent with glow */
        glowHand(secA, r * 0.78, Math.max(1.2, r * 0.016), accent, accent);

        /* Center dot */
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(3, r * 0.04), 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.shadowColor = accent;
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(1.5, r * 0.02), 0, Math.PI * 2);
        ctx.fillStyle = '#000';
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
    defaults: { zones: ['UTC', 'America/New_York', 'Asia/Tokyo'], format: '12h' },
    settings: [
      { key: 'zones', label: 'Timezones', type: 'zonelist' },
      { key: 'format', label: 'Time format', type: 'select', options: [{ v: '12h', l: '12-hour (AM/PM)' }, { v: '24h', l: '24-hour' }] }
    ],
    mount(body, item, api) {
      body.style.position = 'relative';
      const list = el('div', 'zone-list');

      const globe = document.createElement('div');
      globe.className = 'zone-globe';
      globe.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
      body.appendChild(globe);

      const tzSearchWrap = el('div', 'zone-search-wrap');
      const tzSearch = el('input', 'zone-search');
      tzSearch.type = 'text';
      tzSearch.placeholder = 'Search timezone to add…';
      tzSearch.setAttribute('aria-label', 'Search timezone');
      const tzDropdown = el('div', 'zone-dropdown');
      tzSearchWrap.append(tzSearch, tzDropdown);
      body.appendChild(tzSearchWrap);
      body.appendChild(list);

      const is12h = () => item.settings.format !== '24h';
      let zones = [...(item.settings.zones || [])];
      let rows = [];
      let highlightedIdx = -1;
      let suppressBlur = false;

      const popularZones = [
        'UTC', 'America/New_York', 'America/Chicago', 'America/Denver',
        'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
        'America/Toronto', 'America/Vancouver', 'America/Sao_Paulo',
        'America/Argentina/Buenos_Aires', 'America/Mexico_City',
        'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
        'Europe/Rome', 'Europe/Amsterdam', 'Europe/Moscow', 'Europe/Istanbul',
        'Europe/Athens', 'Europe/Warsaw', 'Europe/Stockholm', 'Europe/Zurich',
        'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok',
        'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
        'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Jakarta', 'Asia/Karachi',
        'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane',
        'Australia/Perth', 'Australia/Adelaide', 'Pacific/Auckland',
        'Pacific/Fiji', 'Africa/Cairo', 'Africa/Lagos', 'Africa/Johannesburg',
        'Africa/Nairobi', 'Africa/Casablanca'
      ];

      const filterZones = (q) => {
        const lower = q.toLowerCase();
        const all = TIMEZONES.length ? TIMEZONES : popularZones;
        const filtered = all.filter(tz =>
          tz.toLowerCase().includes(lower) && !zones.includes(tz)
        );
        const popular = popularZones.filter(tz =>
          tz.toLowerCase().includes(lower) && !zones.includes(tz)
        );
        const merged = [...new Set([...popular, ...filtered])];
        return merged.slice(0, 20);
      };

      const closeDropdown = () => {
        tzDropdown.classList.remove('open');
        highlightedIdx = -1;
      };

      const renderDropdown = (query) => {
        tzDropdown.replaceChildren();
        highlightedIdx = -1;
        if (!query && zones.length >= 12) {
          closeDropdown();
          return;
        }
        const matches = filterZones(query || '');
        if (!matches.length) {
          closeDropdown();
          return;
        }
        matches.forEach((tz, i) => {
          const opt = el('div', 'zone-option');
          const city = el('span', 'zone-option-city', cityOf(tz));
          const full = el('span', 'zone-option-tz', tz);
          opt.append(city, full);
          opt.addEventListener('mouseenter', () => {
            highlightedIdx = i;
            tzDropdown.querySelectorAll('.zone-option').forEach((n, j) =>
              n.classList.toggle('highlighted', j === i)
            );
          });
          opt.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            suppressBlur = true;
            addZone(tz);
            tzSearch.value = '';
            closeDropdown();
            setTimeout(() => { suppressBlur = false; }, 50);
          });
          tzDropdown.appendChild(opt);
        });
        tzDropdown.classList.add('open');
      };

      tzSearch.addEventListener('input', () => renderDropdown(tzSearch.value));
      tzSearch.addEventListener('focus', () => renderDropdown(tzSearch.value));
      tzSearch.addEventListener('keydown', (e) => {
        const opts = tzDropdown.querySelectorAll('.zone-option');
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          highlightedIdx = Math.min(highlightedIdx + 1, opts.length - 1);
          opts.forEach((n, i) => n.classList.toggle('highlighted', i === highlightedIdx));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          highlightedIdx = Math.max(highlightedIdx - 1, 0);
          opts.forEach((n, i) => n.classList.toggle('highlighted', i === highlightedIdx));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (highlightedIdx >= 0 && opts[highlightedIdx]) {
            opts[highlightedIdx].dispatchEvent(new Event('mousedown', { bubbles: true }));
          } else if (opts.length === 1) {
            opts[0].dispatchEvent(new Event('mousedown', { bubbles: true }));
          }
        } else if (e.key === 'Escape') {
          tzSearch.blur();
          closeDropdown();
        }
      });
      tzSearch.addEventListener('blur', () => {
        if (suppressBlur) return;
        setTimeout(() => closeDropdown(), 150);
      });

      const showToast = (msg) => {
        const t = document.getElementById('toast');
        if (!t) return;
        const icon = t.querySelector('.toast-icon');
        const text = t.querySelector('.toast-text');
        if (icon) icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        if (text) text.textContent = msg;
        t.classList.add('show');
        clearTimeout(t._tt);
        t._tt = setTimeout(() => t.classList.remove('show'), 2200);
      };

      const addZone = (tz) => {
        if (!tz) return;
        if (zones.includes(tz)) {
          showToast(`${cityOf(tz)} is already in your list`);
          return;
        }
        zones.push(tz);
        item.settings.zones = zones;
        api.save();
        renderRows();
        showToast(`Added ${cityOf(tz)}`);
      };

      const removeZone = (tz) => {
        zones = zones.filter(z => z !== tz);
        item.settings.zones = zones;
        api.save();
        renderRows();
        showToast(`Removed ${cityOf(tz)}`);
      };

      const renderRows = () => {
        list.replaceChildren();
        rows = [];
        if (zones.length === 0) {
          const empty = el('div', 'zone-empty', 'No timezones added yet. Search above to add one.');
          list.appendChild(empty);
          return;
        }
        zones.forEach((tz) => {
          const row = el('div', 'zone-row');
          const cityEl = el('span', 'zone-city', cityOf(tz));
          const tzLabel = el('span', 'zone-tz-label', tz === 'system' ? 'Local' : tz.split('/').pop().replace(/_/g, ' '));
          const time = el('span', 'zone-time');
          const rmBtn = document.createElement('button');
          rmBtn.className = 'zone-rm';
          rmBtn.type = 'button';
          rmBtn.title = 'Remove timezone';
          rmBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
          rmBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeZone(tz);
          });
          row.append(cityEl, tzLabel, time, rmBtn);
          list.appendChild(row);
          rows.push({ tz, time });
        });
      };

      const update = () => {
        const now = new Date();
        const use12 = is12h();
        for (const r of rows) {
          const p = timeParts(now, r.tz, use12);
          if (use12) {
            r.time.innerHTML = '';
            r.time.appendChild(document.createTextNode(`${p.h}:${p.m}`));
            const ampm = el('span', 'zone-ampm', p.dayPeriod);
            r.time.appendChild(ampm);
          } else {
            r.time.textContent = `${p.h}:${p.m}`;
          }
        }
      };

      renderRows();
      update();
      const iv = setInterval(update, 2000);
      return () => clearInterval(iv);
    }
  }
};
