import { ICONS } from './icons.js';
import { el, iconButton } from './widgets-clocks.js';

export const toolWidgets = {
  calendar: {
    name: 'Calendar',
    desc: 'Month view with today highlighted',
    defaultSize: { w: 2, h: 2 },
    defaults: { startOfWeek: 'sun', opacity: 100, borderRadius: 'default', blur: true, shadow: 1 },
    settings: [
      { key: 'startOfWeek', label: 'Week starts on', type: 'select', options: [{ v: 'sun', l: 'Sunday' }, { v: 'mon', l: 'Monday' }] },
      { key: 'opacity', label: 'Opacity', type: 'number' },
      { key: 'borderRadius', label: 'Border radius', type: 'select', options: [{ v: 'default', l: 'Default' }, { v: 'small', l: 'Small (10px)' }, { v: 'medium', l: 'Medium (18px)' }, { v: 'large', l: 'Large (26px)' }, { v: 'full', l: 'Pill (999px)' }, { v: 'none', l: 'None (0px)' }] },
      { key: 'blur', label: 'Background blur', type: 'bool' },
      { key: 'shadow', label: 'Shadow intensity', type: 'number' }
    ],
    mount(body) {
      const head = el('div', 'cal-head');
      const prevBtn = iconButton(ICONS.chevLeft, 'icon-btn', 'Previous month');
      const label = el('div', 'cal-label');
      const nextBtn = iconButton(ICONS.chevRight, 'icon-btn', 'Next month');
      head.append(prevBtn, label, nextBtn);
      const grid = el('div', 'cal-grid');
      body.append(head, grid);

      const today = new Date();
      let vy = today.getFullYear();
      let vm = today.getMonth();

      const render = () => {
        label.textContent = new Date(vy, vm, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        grid.replaceChildren();

        const offset = this.defaults.startOfWeek === 'mon' ? 1 : 0;
        for (let i = 0; i < 7; i++) {
          const d = new Date(2023, 0, 1 + ((i + offset) % 7));
          const dow = el('div', 'cal-dow', d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase().slice(0, 2));
          grid.appendChild(dow);
        }

        const firstDow = (new Date(vy, vm, 1).getDay() - offset + 7) % 7;
        const daysInMonth = new Date(vy, vm + 1, 0).getDate();
        const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;

        for (let i = 0; i < totalCells; i++) {
          const dayNum = i - firstDow + 1;
          const cellDate = new Date(vy, vm, dayNum);
          const cell = el('div', 'cal-day', String(cellDate.getDate()));
          if (dayNum < 1 || dayNum > daysInMonth) cell.classList.add('other');
          if (
            cellDate.getFullYear() === today.getFullYear() &&
            cellDate.getMonth() === today.getMonth() &&
            cellDate.getDate() === today.getDate()
          ) cell.classList.add('today');
          grid.appendChild(cell);
        }
      };

      prevBtn.addEventListener('click', () => { vm--; if (vm < 0) { vm = 11; vy--; } render(); });
      nextBtn.addEventListener('click', () => { vm++; if (vm > 11) { vm = 0; vy++; } render(); });
      render();
    }
  },

  systemMonitor: {
    name: 'System Monitor',
    desc: 'CPU and memory usage with uptime',
    defaultSize: { w: 2, h: 2 },
    defaults: {
      showPerCore: false,
      showNetwork: false,
      showDisk: false,
      showTemperature: false,
      historyLength: 60,
      opacity: 100,
      borderRadius: 'default',
      blur: true,
      shadow: 1
    },
    settings: [
      { key: 'showPerCore', label: 'Show per-core CPU', type: 'bool' },
      { key: 'showNetwork', label: 'Show network I/O', type: 'bool' },
      { key: 'showDisk', label: 'Show disk I/O', type: 'bool' },
      { key: 'showTemperature', label: 'Show CPU temperature', type: 'bool' },
      { key: 'historyLength', label: 'History length (seconds)', type: 'number' },
      { key: 'opacity', label: 'Opacity', type: 'number' },
      { key: 'borderRadius', label: 'Border radius', type: 'select', options: [{ v: 'default', l: 'Default' }, { v: 'small', l: 'Small (10px)' }, { v: 'medium', l: 'Medium (18px)' }, { v: 'large', l: 'Large (26px)' }, { v: 'full', l: 'Pill (999px)' }, { v: 'none', l: 'None (0px)' }] },
      { key: 'blur', label: 'Background blur', type: 'bool' },
      { key: 'shadow', label: 'Shadow intensity', type: 'number' }
    ],
    mount(body, item, api) {
      const cpuHist = [];
      const memHist = [];
      const netHist = { rx: [], tx: [] };
      const diskHist = { read: [], write: [] };

      const mkRow = (labelText) => {
        const row = el('div', 'sys-row');
        const top = el('div', 'sys-top');
        top.appendChild(el('span', null, labelText));
        const pct = el('b', null, '—');
        top.appendChild(pct);
        const bar = el('div', 'bar');
        const fill = el('i');
        bar.appendChild(fill);
        row.append(top, bar);
        body.appendChild(row);
        return { pct, fill, bar: fill.parentElement };
      };

      const mkSpark = (labelText, history, colorVar) => {
        const row = el('div', 'sys-row');
        const top = el('div', 'sys-top');
        top.appendChild(el('span', null, labelText));
        const pct = el('b', null, '—');
        top.appendChild(pct);
        const spark = document.createElement('canvas');
        spark.className = 'sys-spark';
        spark.dataset.colorVar = colorVar;
        row.append(top, spark);
        body.appendChild(row);
        return { pct, spark, history };
      };

      const cpu = mkSpark('CPU Usage', cpuHist, '--accent');
      const mem = mkRow('Memory Usage');

      const perCoreContainer = el('div', 'sys-percore');
      perCoreContainer.style.display = item.settings.showPerCore ? 'block' : 'none';
      body.appendChild(perCoreContainer);

      let netRow = null, diskRow = null;
      if (item.settings.showNetwork) {
        netRow = mkSpark('Network I/O', netHist, '--accent2');
        netRow.spark.dataset.dual = 'true';
        netRow.rxHistory = netHist.rx;
        netRow.txHistory = netHist.tx;
      }
      if (item.settings.showDisk) {
        diskRow = mkSpark('Disk I/O', diskHist, '--warn');
        diskRow.spark.dataset.dual = 'true';
        diskRow.readHistory = diskHist.read;
        diskRow.writeHistory = diskHist.write;
      }

      const foot = el('div', 'sys-foot');
      body.appendChild(foot);

      const cssVar = (name, fallback) => getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;

      const drawSpark = (obj) => {
        const cv = obj.spark;
        if (!cv || !cv.clientWidth) return;
        const dpr = window.devicePixelRatio || 1;
        const w = cv.clientWidth;
        const h = cv.clientHeight || 34;
        cv.width = w * dpr;
        cv.height = h * dpr;
        const ctx = cv.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const isDual = cv.dataset.dual === 'true';
        const histories = isDual ? [obj.rxHistory || obj.readHistory, obj.txHistory || obj.writeHistory] : [obj.history];
        const colors = isDual
          ? [cssVar('--accent', '#4da3ff'), cssVar('--accent2', '#a78bfa')]
          : [cssVar(cv.dataset.colorVar || '--accent', '#4da3ff')];

        const count = Math.min(obj.history.length, item.settings.historyLength || 60);
        const barW = Math.max(2, (w - (count - 1) * 2) / count);
        const gap = 2;
        const maxH = h - 4;
        const startX = (w - count * (barW + gap)) / 2;

        histories.forEach((hist, hi) => {
          if (hist.length < 2) return;
          const data = hist.slice(-count);
          const color = colors[hi % colors.length];
          for (let i = 0; i < count; i++) {
            const v = Math.min(1, Math.max(0, data[i] / 100));
            const bh = Math.max(2, v * maxH);
            const x = startX + i * (barW + gap);
            const y = h - 2 - bh;
            const alpha = 0.25 + 0.75 * (i / count);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = color;
            ctx.beginPath();
            const radius = Math.min(barW / 2, 3);
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + barW - radius, y);
            ctx.quadraticCurveTo(x + barW, y, x + barW, y + radius);
            ctx.lineTo(x + barW, h - 2);
            ctx.lineTo(x, h - 2);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
            ctx.fill();
          }
        });
        ctx.globalAlpha = 1;
      };

      const drawPerCore = () => {
        perCoreContainer.replaceChildren();
        const cores = item._lastPerCore || [];
        if (!cores.length) return;
        const grid = el('div', 'sys-percore-grid');
        cores.forEach((usage, i) => {
          const cell = el('div', 'sys-percore-cell');
          const label = el('span', 'sys-percore-label', `Core ${i}`);
          const bar = el('div', 'bar');
          const fill = el('i');
          fill.style.width = `${usage}%`;
          if (usage > 75 && usage <= 90) bar.classList.add('warm');
          else if (usage > 90) bar.classList.add('hot');
          bar.appendChild(fill);
          const val = el('span', 'sys-percore-val', `${usage.toFixed(1)}%`);
          cell.append(label, bar, val);
          grid.appendChild(cell);
        });
        perCoreContainer.appendChild(grid);
      };

      const fmtUptime = (s) => {
        const d = Math.floor(s / 86400);
        const h = Math.floor((s % 86400) / 3600);
        const m = Math.floor((s % 3600) / 60);
        return `${d ? `${d}d ` : ''}${h}h ${m}m`;
      };

      const fmtBytes = (b) => {
        if (b < 1024) return `${b}B/s`;
        if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB/s`;
        return `${(b / 1024 / 1024).toFixed(1)}MB/s`;
      };

      let prevNet = { rx: 0, tx: 0 };
      let prevDisk = { read: 0, write: 0 };

      const readProc = (path) => api.readProc(path);

      const getNetStats = () => api.getNetStats();

      const getDiskStats = () => api.getDiskStats();

      const getTemp = () => api.getCpuTemp();

      const tick = async () => {
        try {
          const s = await api.getStats();
          if (typeof s.cpuUsage === 'number') {
            cpu.pct.textContent = `${s.cpuUsage}%`;
            cpu.history.push(s.cpuUsage);
            if (cpu.history.length > (item.settings.historyLength || 60)) cpu.history.shift();
            drawSpark(cpu);
          }
          if (s.cpuPerCore && item.settings.showPerCore) {
            item._lastPerCore = s.cpuPerCore;
            drawPerCore();
          }
          const usedPct = ((s.memTotal - s.memFree) / s.memTotal) * 100;
          mem.pct.textContent = `${usedPct.toFixed(1)}%`;
          mem.fill.style.width = `${usedPct}%`;
          mem.bar.classList.toggle('warm', usedPct > 75 && usedPct <= 90);
          mem.bar.classList.toggle('hot', usedPct > 90);
          mem.history.push(usedPct);
          if (mem.history.length > (item.settings.historyLength || 60)) mem.history.shift();
          drawSpark(mem);

          if (netRow) {
            const net = getNetStats();
            if (net && prevNet.rx > 0) {
              const rxRate = (net.rx - prevNet.rx) / 2;
              const txRate = (net.tx - prevNet.tx) / 2;
              netRow.pct.textContent = `↓ ${fmtBytes(rxRate)} ↑ ${fmtBytes(txRate)}`;
              netRow.rxHistory.push(Math.min(100, (rxRate / 1024 / 1024) * 100));
              netRow.txHistory.push(Math.min(100, (txRate / 1024 / 1024) * 100));
              if (netRow.rxHistory.length > (item.settings.historyLength || 60)) netRow.rxHistory.shift();
              if (netRow.txHistory.length > (item.settings.historyLength || 60)) netRow.txHistory.shift();
              drawSpark(netRow);
            }
            prevNet = net;
          }
          if (diskRow) {
            const disk = getDiskStats();
            if (disk && prevDisk.read > 0) {
              const rRate = (disk.read - prevDisk.read) / 2;
              const wRate = (disk.write - prevDisk.write) / 2;
              diskRow.pct.textContent = `R ${fmtBytes(rRate)} W ${fmtBytes(wRate)}`;
              diskRow.readHistory.push(Math.min(100, (rRate / 1024 / 1024) * 100));
              diskRow.writeHistory.push(Math.min(100, (wRate / 1024 / 1024) * 100));
              if (diskRow.readHistory.length > (item.settings.historyLength || 60)) diskRow.readHistory.shift();
              if (diskRow.writeHistory.length > (item.settings.historyLength || 60)) diskRow.writeHistory.shift();
              drawSpark(diskRow);
            }
            prevDisk = disk;
          }

          let footText = `${s.hostname} • up ${fmtUptime(s.uptime)}`;
          if (item.settings.showTemperature) {
            const temp = getTemp();
            if (temp !== null) footText += ` • CPU ${temp.toFixed(1)}°C`;
          }
          foot.textContent = footText;
        } catch {}
      };

      tick();
      const iv = setInterval(tick, 1000);

      let ro = null;
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => {
          drawSpark(cpu);
          drawSpark(mem);
          if (netRow) drawSpark(netRow);
          if (diskRow) drawSpark(diskRow);
        });
        ro.observe(cpu.spark);
        ro.observe(mem.fill.parentElement);
        if (netRow) ro.observe(netRow.spark);
        if (diskRow) ro.observe(diskRow.spark);
      }

      return () => {
        clearInterval(iv);
        if (ro) ro.disconnect();
      };
    }
  },

  todo: {
    name: 'To-do List',
    desc: 'Checkable tasks saved automatically',
    defaultSize: { w: 2, h: 2 },
    defaults: { items: [{ text: 'Double-click a task to rename it', done: false }], opacity: 100, borderRadius: 'default', blur: true, shadow: 1 },
    settings: [
      { key: 'opacity', label: 'Opacity', type: 'number' },
      { key: 'borderRadius', label: 'Border radius', type: 'select', options: [{ v: 'default', l: 'Default' }, { v: 'small', l: 'Small (10px)' }, { v: 'medium', l: 'Medium (18px)' }, { v: 'large', l: 'Large (26px)' }, { v: 'full', l: 'Pill (999px)' }, { v: 'none', l: 'None (0px)' }] },
      { key: 'blur', label: 'Background blur', type: 'bool' },
      { key: 'shadow', label: 'Shadow intensity', type: 'number' }
    ],
    mount(body, item, api) {
      const list = el('ul', 'todo-list');
      const addRow = el('div', 'todo-add');
      const input = el('input');
      input.type = 'text';
      input.placeholder = 'Add a new task…';
      input.setAttribute('aria-label', 'New task');
      const addBtn = document.createElement('button');
      addBtn.className = 'todo-add-btn';
      addBtn.type = 'button';
      addBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
      addRow.append(input, addBtn);
      body.append(list, addRow);

      const PRIORITY_ORDER = [undefined, 'low', 'medium', 'high'];
      const PRIORITY_LABELS = { low: 'Low Priority', medium: 'Medium Priority', high: 'High Priority' };

      const renderItems = () => {
        list.replaceChildren();
        item.settings.items.forEach((task, idx) => {
          const li = el('li', 'todo-item' + (task.done ? ' done' : ''));

          const cb = el('input');
          cb.className = 'todo-cb';
          cb.type = 'checkbox';
          cb.checked = task.done;
          cb.addEventListener('change', () => {
            task.done = cb.checked;
            li.classList.toggle('done', task.done);
            api.save();
          });

          const main = el('div', 'todo-main');
          const txt = el('span', 'todo-text', task.text);
          txt.title = 'Double-click to edit';
          txt.addEventListener('dblclick', () => {
            txt.contentEditable = 'true';
            txt.focus();
          });
          txt.addEventListener('blur', () => {
            txt.contentEditable = 'false';
            const val = txt.textContent.trim();
            if (val) {
              if (val !== task.text) { task.text = val; api.save(); }
            } else {
              item.settings.items.splice(idx, 1);
              renderItems();
              api.save();
            }
          });
          txt.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); txt.blur(); }
          });
          main.appendChild(txt);

          if (task.priority && PRIORITY_LABELS[task.priority]) {
            const prio = el('span', `todo-prio prio-${task.priority}`, PRIORITY_LABELS[task.priority]);
            main.appendChild(prio);
          }

          const flagBtn = iconButton(ICONS.flag, 'icon-btn todo-flag', 'Cycle priority');
          flagBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const ci = PRIORITY_ORDER.indexOf(task.priority);
            task.priority = PRIORITY_ORDER[(ci + 1) % PRIORITY_ORDER.length];
            renderItems();
            api.save();
          });

          const del = iconButton(ICONS.x, 'icon-btn red todo-del', 'Remove task');
          del.addEventListener('click', () => {
            item.settings.items.splice(idx, 1);
            renderItems();
            api.save();
          });

          li.append(cb, main, flagBtn, del);
          list.appendChild(li);
        });
      };

      const addTask = () => {
        const val = input.value.trim();
        if (!val) return;
        item.settings.items.push({ text: val, done: false });
        input.value = '';
        renderItems();
        api.save();
        list.scrollTop = list.scrollHeight;
      };

      addBtn.addEventListener('click', addTask);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addTask();
      });

      renderItems();
    }
  },

  notes: {
    name: 'Sticky Notes',
    desc: 'Quick scratchpad text, autosaved',
    defaultSize: { w: 2, h: 2 },
    defaults: { text: '', placeholder: 'Write something…', opacity: 100, borderRadius: 'default', blur: true, shadow: 1 },
    settings: [
      { key: 'placeholder', label: 'Placeholder text', type: 'text' },
      { key: 'opacity', label: 'Opacity', type: 'number' },
      { key: 'borderRadius', label: 'Border radius', type: 'select', options: [{ v: 'default', l: 'Default' }, { v: 'small', l: 'Small (10px)' }, { v: 'medium', l: 'Medium (18px)' }, { v: 'large', l: 'Large (26px)' }, { v: 'full', l: 'Pill (999px)' }, { v: 'none', l: 'None (0px)' }] },
      { key: 'blur', label: 'Background blur', type: 'bool' },
      { key: 'shadow', label: 'Shadow intensity', type: 'number' }
    ],
    mount(body, item, api) {
      const surface = el('div', 'notes-surface');
      const ta = document.createElement('textarea');
      ta.className = 'notes';
      ta.spellcheck = false;
      ta.placeholder = item.settings.placeholder || 'Write something…';
      ta.value = item.settings.text || '';
      ta.setAttribute('aria-label', 'Notes');
      let t = null;
      ta.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          item.settings.text = ta.value;
          api.save();
        }, 400);
      });
      surface.appendChild(ta);
      body.appendChild(surface);
    }
  },

  quickLinks: {
    name: 'Quick Links',
    desc: 'Launcher buttons for your favorite sites',
    defaultSize: { w: 2, h: 2 },
    defaults: { links: [], opacity: 100, borderRadius: 'default', blur: true, shadow: 1 },
    settings: [
      { key: 'opacity', label: 'Opacity', type: 'number' },
      { key: 'borderRadius', label: 'Border radius', type: 'select', options: [{ v: 'default', l: 'Default' }, { v: 'small', l: 'Small (10px)' }, { v: 'medium', l: 'Medium (18px)' }, { v: 'large', l: 'Large (26px)' }, { v: 'full', l: 'Pill (999px)' }, { v: 'none', l: 'None (0px)' }] },
      { key: 'blur', label: 'Background blur', type: 'bool' },
      { key: 'shadow', label: 'Shadow intensity', type: 'number' }
    ],
    mount(body, item, api) {
      const wrap = el('div', 'links-wrap');
      body.appendChild(wrap);

      const normalize = (url) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

      const renderLinks = () => {
        wrap.replaceChildren();
        item.settings.links.forEach((link, idx) => {
          const a = el('a', 'chip', link.label || link.url);
          a.href = link.url;
          a.addEventListener('click', (e) => {
            e.preventDefault();
            api.openExternal(link.url);
          });
          if (api.isEditing()) {
            const x = document.createElement('button');
            x.className = 'chip-x';
            x.type = 'button';
            x.textContent = '×';
            x.title = 'Remove link';
            x.addEventListener('click', () => {
              item.settings.links.splice(idx, 1);
              api.save();
              renderLinks();
              renderAddForm();
            });
            a.appendChild(x);
          }
          wrap.appendChild(a);
        });
      };

      let form = null;
      const renderAddForm = () => {
        if (form) {
          form.remove();
          form = null;
        }
        if (!api.isEditing()) return;
        form = el('div', 'links-add');
        const label = el('input', 'l-label');
        label.type = 'text';
        label.placeholder = 'Label';
        const url = el('input', 'l-url');
        url.type = 'text';
        url.placeholder = 'example.com';
        const btn = el('button', 'btn', 'Add');
        btn.type = 'button';
        btn.addEventListener('click', () => {
          if (!url.value.trim()) return;
          item.settings.links.push({
            label: label.value.trim() || url.value.trim(),
            url: normalize(url.value.trim())
          });
          api.save();
          label.value = '';
          url.value = '';
          renderLinks();
          renderAddForm();
        });
        form.append(label, url, btn);
        body.appendChild(form);
      };

      renderLinks();
      renderAddForm();
    }
  },

  shortcuts: {
    name: 'Shortcuts',
    desc: 'Quick-launch apps, folders, and files',
    defaultSize: { w: 2, h: 2 },
    defaults: {
      items: [
        { label: 'Home', path: '~', icon: 'home' },
        { label: 'Documents', path: '~/Documents', icon: 'docs' },
        { label: 'Downloads', path: '~/Downloads', icon: 'download' },
        { label: 'Pictures', path: '~/Pictures', icon: 'image' },
        { label: 'Music', path: '~/Music', icon: 'music' },
        { label: 'Videos', path: '~/Videos', icon: 'monitor' },
        { label: 'Terminal', path: 'terminal', icon: 'terminal' }
      ],
      opacity: 100,
      borderRadius: 'default',
      blur: true,
      shadow: 1
    },
    settings: [
      { key: 'opacity', label: 'Opacity', type: 'number' },
      { key: 'borderRadius', label: 'Border radius', type: 'select', options: [{ v: 'default', l: 'Default' }, { v: 'small', l: 'Small (10px)' }, { v: 'medium', l: 'Medium (18px)' }, { v: 'large', l: 'Large (26px)' }, { v: 'full', l: 'Pill (999px)' }, { v: 'none', l: 'None (0px)' }] },
      { key: 'blur', label: 'Background blur', type: 'bool' },
      { key: 'shadow', label: 'Shadow intensity', type: 'number' }
    ],
    mount(body, item, api) {
      const grid = el('div', 'sc-grid');
      body.appendChild(grid);

      const iconChoices = ['home','folder','docs','download','image','music','monitor','terminal','file','globe','flag'];

      const iconSvg = (name) => ICONS[name] || ICONS.file;

      const render = () => {
        grid.replaceChildren();
        item.settings.items.forEach((sc, idx) => {
          const btn = el('button', 'sc-item');
          btn.type = 'button';
          btn.title = sc.path;

          const ic = el('span', 'sc-icon');
          ic.innerHTML = iconSvg(sc.icon);
          const lb = el('span', 'sc-label', sc.label || sc.path.split('/').pop() || sc.path);
          btn.append(ic, lb);

          btn.addEventListener('click', () => {
            if (sc.path === 'terminal') {
              api.openExternal('x-terminal-emulator');
            } else if (/^https?:\/\//i.test(sc.path)) {
              api.openExternal(sc.path);
            } else {
              api.openPath(sc.path);
            }
          });

          if (api.isEditing()) {
            const rm = el('button', 'sc-rm');
            rm.type = 'button';
            rm.innerHTML = ICONS.x;
            rm.title = 'Remove shortcut';
            rm.addEventListener('click', (e) => {
              e.stopPropagation();
              item.settings.items.splice(idx, 1);
              api.save();
              render();
              renderForm();
            });
            btn.appendChild(rm);
          }

          grid.appendChild(btn);
        });
      };

      let form = null;
      const renderForm = () => {
        if (form) { form.remove(); form = null; }
        if (!api.isEditing()) return;

        form = el('div', 'sc-form');

        const labelIn = el('input', 'sc-input');
        labelIn.type = 'text';
        labelIn.placeholder = 'Label';

        const pathIn = el('input', 'sc-input');
        pathIn.type = 'text';
        pathIn.placeholder = '~/Documents or https://...';

        const iconSel = el('select', 'sc-select');
        iconChoices.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c;
          opt.textContent = c.charAt(0).toUpperCase() + c.slice(1);
          iconSel.appendChild(opt);
        });

        const addBtn = el('button', 'btn sc-add-btn');
        addBtn.type = 'button';
        addBtn.textContent = 'Add';
        addBtn.addEventListener('click', () => {
          const p = pathIn.value.trim();
          if (!p) return;
          item.settings.items.push({
            label: labelIn.value.trim() || p.split('/').pop() || p,
            path: p,
            icon: iconSel.value
          });
          api.save();
          labelIn.value = '';
          pathIn.value = '';
          render();
          renderForm();
        });

        form.append(labelIn, pathIn, iconSel, addBtn);
        body.appendChild(form);
      };

      render();
      renderForm();
    }
  }
};
