/* ============================================================
   Таймеры: расписание, действия
   ============================================================ */

function renderTimerSched(t, kind) {
  kind = kind || t.kind || 'interval';

  if (kind === 'interval') {
    return `<div class="field-row">
      <label>Каждые</label>
      <input type="number" min="1" value="${t.interval_sec || 60}"
        data-key="interval_sec" onchange="markRowDirty(this)" style="min-width:90px;">
      <span>сек</span>
    </div>`;
  }

  if (kind === 'daily') {
    return `<div class="field-row">
      <label>Время</label>
      <input type="time" value="${t.time || '08:00'}"
        data-key="time" onchange="markRowDirty(this)">
    </div>`;
  }

  if (kind === 'weekly') {
    const days = t.weekdays || [];
    return `<div class="field-row">
      <label>Время</label>
      <input type="time" value="${t.time || '08:00'}"
        data-key="time" onchange="markRowDirty(this)">
      <label>Дни</label>
      ${WEEKDAYS.map((d, i) => `
        <label style="display:flex;gap:.2rem;align-items:center;font-size:.85rem;">
          <input type="checkbox" ${days.includes(i) ? 'checked' : ''}
            data-key="weekday-${i}" onchange="markRowDirty(this)"> ${d}
        </label>`).join('')}
    </div>`;
  }

  if (kind === 'once') {
    return `<div class="field-row">
      <label>Дата/время</label>
      <input type="datetime-local" value="${(t.at_iso || '').slice(0, 16)}"
        data-key="at_iso" onchange="markRowDirty(this)">
      ${t.last_fired_iso
        ? `<span style="opacity:.7;font-size:.85rem;">сработал: ${esc(t.last_fired_iso)}</span>`
        : ''}
    </div>`;
  }

  return '';
}

function onTimerKindChange(selectEl, timerId) {
  const newKind = selectEl.value;
  const row = selectEl.closest('.row');
  if (!row) return;

  const block = row.querySelector('.sched-block');
  if (!block) return;

  const t = timersCache.find(x => x.id === timerId) || {};
  const current = { ...t };

  block.querySelectorAll('[data-key]').forEach(el => {
    const k = el.dataset.key;
    if (k.startsWith('weekday-')) {
      const idx = parseInt(k.replace('weekday-', ''), 10);
      current.weekdays = current.weekdays || [];
      if (el.checked) {
        if (!current.weekdays.includes(idx)) current.weekdays.push(idx);
      } else {
        current.weekdays = current.weekdays.filter(d => d !== idx);
      }
      current.weekdays.sort((a, b) => a - b);
    } else if (el.type === 'number') {
      current[k] = el.value === '' ? '' : Number(el.value);
    } else if (el.type === 'checkbox') {
      current[k] = el.checked;
    } else {
      current[k] = el.value;
    }
  });

  current.kind = newKind;
  block.innerHTML = renderTimerSched(current, newKind);

  const save = row.querySelector('.row-head .btn-save');
  if (save) save.classList.add('dirty');
}

function renderTimers() {
  const box = document.getElementById('timers-list');
  if (!timersCache.length) { box.innerHTML = '<div class="empty">Таймеров нет.</div>'; return; }

  box.innerHTML = timersCache.map(t => {
    const kind = t.kind || 'interval';
    const actions = t.actions || [];

    const actHtml = actions.map((a, i) => `
      <div class="action-block" data-action-index="${i}">
        ${renderActionBlock(a, i, t.id, 'timer')}
      </div>
    `).join('');

    const sched = renderTimerSched(t, kind);

    return `
      <div class="row" data-id="${t.id}">
        <div class="row-head">
          <input type="text" value="${esc(t.name || '')}"
            data-key="name" oninput="markRowDirty(this)"
            style="background:transparent;border:none;color:#fff;font-size:1.1rem;font-weight:600;flex:1;">
          <label style="display:flex;gap:.4rem;align-items:center;font-size:.9rem;">
            тип:
            <select data-key="kind" onchange="onTimerKindChange(this, '${t.id}')">
              <option value="interval" ${kind === 'interval' ? 'selected' : ''}>интервал</option>
              <option value="daily"    ${kind === 'daily'    ? 'selected' : ''}>ежедневно</option>
              <option value="weekly"   ${kind === 'weekly'   ? 'selected' : ''}>еженедельно</option>
              <option value="once"     ${kind === 'once'     ? 'selected' : ''}>разово</option>
            </select>
          </label>
          <label style="display:flex;align-items:center;gap:.4rem;font-size:.9rem;">
            <input type="checkbox" ${t.enabled !== false ? 'checked' : ''}
              data-key="enabled" onchange="markRowDirty(this)"> вкл
          </label>
          <button class="btn small green btn-save" onclick="saveTimer('${t.id}')">💾 Сохранить</button>
          <button class="btn small danger edit-only" onclick="removeTimer('${t.id}')">🗑</button>
        </div>
        <div class="row-body">
          <div class="sched-block" data-timer-id="${t.id}">
            ${sched}
          </div>
          ${t.last_fired_iso ? `<div style="font-size:.85rem;opacity:.7;">последний запуск: ${esc(t.last_fired_iso)}</div>` : ''}
          <div class="hr"></div>
          ${actHtml}
          <div><button class="btn small gray edit-only" onclick="addTimerActionLocal('${t.id}')">➕ действие</button></div>
        </div>
      </div>`;
  }).join('');
}

async function addTimerActionLocal(tid) {
  const t = timersCache.find(x => x.id === tid); if (!t) return;
  const actions = JSON.parse(JSON.stringify(t.actions || []));
  actions.push({type: 'set_state', device: '', field: '', value: ''});
  await api('/api/timers/' + tid, 'POST', {actions});
  timersCache = await api('/api/timers');
  renderTimers();
}
async function removeTimerActionLocal(tid, idx) {
  const t = timersCache.find(x => x.id === tid); if (!t) return;
  const actions = JSON.parse(JSON.stringify(t.actions || []));
  actions.splice(idx, 1);
  await api('/api/timers/' + tid, 'POST', {actions});
  timersCache = await api('/api/timers');
  renderTimers();
}

async function addTimer() {
  await api('/api/timers', 'POST', {
    name: 'Новый таймер', kind: 'interval', interval_sec: 60, enabled: true, actions: []
  });
  refresh();
}
async function removeTimer(id) {
  if (!confirm('Удалить таймер?')) return;
  try {
    await api('/api/timers/' + id, 'DELETE');
    timersCache = timersCache.filter(t => t.id !== id);
    renderTimers();
    api('/api/timers').then(r => { timersCache = r; renderTimers(); }).catch(() => {});
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

async function saveTimer(id) {
  const row = document.querySelector(`.row[data-id="${id}"]`); if (!row) return;
  const fields = collectRowFields(row);
  const t = timersCache.find(x => x.id === id) || {actions: []};
  const kind = fields['kind'] ?? t.kind ?? 'interval';
  const patch = {
    name: fields['name'] ?? t.name ?? '',
    enabled: fields['enabled'] !== undefined ? fields['enabled'] : (t.enabled !== false),
    kind,
    interval_sec: fields['interval_sec'] !== undefined ? Math.max(1, parseInt(fields['interval_sec'], 10) || 60) : (t.interval_sec ?? 60),
    time: fields['time'] ?? t.time ?? '08:00',
    weekdays: buildWeekdaysFromFields(fields, t.weekdays || []),
    at_iso: fields['at_iso'] ?? t.at_iso ?? '',
    actions: buildActionsFromFields(fields, t.actions || []),
  };
  await api('/api/timers/' + id, 'POST', patch);
  timersCache = await api('/api/timers');
  renderTimers();
}