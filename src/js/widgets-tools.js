import { ICONS } from './icons.js';
import { el, iconButton } from './widgets-clocks.js';

export const toolWidgets = {
  calendar: {
    name: 'Calendar',
    desc: 'Month view with today highlighted',
    defaultSize: { w: 2, h: 2 },
    defaults: { startOfWeek: 'sun' },
    settings: [
      { key: 'startOfWeek', label: 'Week starts on', type: 'select', options: [{ v: 'sun', l: 'Sunday' }, { v: 'mon', l: 'Monday' }] }
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
          grid.appendChild(el('div', 'cal-dow', d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2)));
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
    defaultSize: { w: 2, h: 1 },
    defaults: {},
    settings: [],
    mount(body, item, api) {
      const mkRow = (name) => {
        const row = el('div', 'sys-row');
        const labels = el('div', 'sys-labels');
        labels.appendChild(el('span', null, name));
        const pct = el('b', null, '—');
        labels.appendChild(pct);
        const bar = el('div', 'bar');
        const fill = el('i');
        bar.appendChild(fill);
        row.append(labels, bar);
        body.appendChild(row);
        return { pct, fill };
      };

      const cpu = mkRow('CPU');
      const mem = mkRow('Memory');
      const foot = el('div', 'sys-foot');
      body.appendChild(foot);

      const fmtUptime = (s) => {
        const d = Math.floor(s / 86400);
        const h = Math.floor((s % 86400) / 3600);
        const m = Math.floor((s % 3600) / 60);
        return `${d ? `${d}d ` : ''}${h}h ${m}m`;
      };

      const tick = async () => {
        try {
          const s = await api.getStats();
          if (typeof s.cpuUsage === 'number') {
            cpu.pct.textContent = `${s.cpuUsage}%`;
            cpu.fill.style.width = `${Math.max(2, s.cpuUsage)}%`;
          }
          const usedPct = ((s.memTotal - s.memFree) / s.memTotal) * 100;
          mem.pct.textContent = `${usedPct.toFixed(1)}%`;
          mem.fill.style.width = `${usedPct}%`;
          foot.textContent = `${s.hostname} • up ${fmtUptime(s.uptime)}`;
        } catch {}
      };

      tick();
      const iv = setInterval(tick, 2000);
      return () => clearInterval(iv);
    }
  },

  todo: {
    name: 'To-do List',
    desc: 'Checkable tasks saved automatically',
    defaultSize: { w: 2, h: 2 },
    defaults: { items: [{ text: 'Double-click a task to rename it', done: false }] },
    settings: [],
    mount(body, item, api) {
      const list = el('ul', 'todo-list');
      const addRow = el('div', 'todo-add');
      const input = el('input');
      input.type = 'text';
      input.placeholder = 'Add a task…';
      input.setAttribute('aria-label', 'New task');
      const addBtn = el('button', 'btn', 'Add');
      addBtn.type = 'button';
      addRow.append(input, addBtn);
      body.append(list, addRow);

      const renderItems = () => {
        list.replaceChildren();
        item.settings.items.forEach((task, idx) => {
          const li = el('li', 'todo-item' + (task.done ? ' done' : ''));
          const cb = el('input');
          cb.type = 'checkbox';
          cb.checked = task.done;
          cb.addEventListener('change', () => {
            task.done = cb.checked;
            li.classList.toggle('done', task.done);
            api.save();
          });
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
              if (val !== task.text) {
                task.text = val;
                api.save();
              }
            } else {
              item.settings.items.splice(idx, 1);
              renderItems();
              api.save();
            }
          });
          txt.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              txt.blur();
            }
          });
          const del = iconButton(ICONS.x, 'icon-btn red todo-del', 'Remove task');
          del.addEventListener('click', () => {
            item.settings.items.splice(idx, 1);
            renderItems();
            api.save();
          });
          li.append(cb, txt, del);
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
    defaults: { text: '', placeholder: 'Write something…' },
    settings: [
      { key: 'placeholder', label: 'Placeholder text', type: 'text' }
    ],
    mount(body, item, api) {
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
      body.appendChild(ta);
    }
  },

  quickLinks: {
    name: 'Quick Links',
    desc: 'Launcher buttons for your favorite sites',
    defaultSize: { w: 2, h: 1 },
    defaults: { links: [] },
    settings: [],
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
  }
};
