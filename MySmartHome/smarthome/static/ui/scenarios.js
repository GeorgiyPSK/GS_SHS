/* ============================================================
   Сценарии: условия, действия, группы
   ============================================================ */

const OPS = ['==', '!=', '>', '<', '>=', '<=', 'contains'];

function opOptions(sel) {
  return OPS.map(o => `<option value="${o}" ${o === sel ? 'selected' : ''}>${o}</option>`).join('');
}

function deviceOptions(selectedId) {
  return devicesCache.map(d =>
    `<option value="${d.id}" ${d.id === selectedId ? 'selected' : ''}>${esc(d.name)}</option>`
  ).join('');
}

function fieldOptions(deviceId, selectedField) {
  const dev = devicesCache.find(d => d.id === deviceId);
  if (!dev) return '';

  const meta = window.TYPES[dev.type] || {};
  let fields;

  if (meta.custom && meta.raw && Array.isArray(meta.raw.fields)) {
    fields = meta.raw.fields
      .filter(f => f && f.name)
      .map(f => ({ name: f.name, label: f.label || f.name }));
    const known = new Set(fields.map(x => x.name));
    for (const k of Object.keys(dev.state || {})) {
      if (!known.has(k)) fields.push({ name: k, label: k });
    }
  } else {
    fields = Object.keys(dev.state || {}).map(k => ({ name: k, label: k }));
  }

  return fields.map(f =>
    `<option value="${esc(f.name)}" ${f.name === selectedField ? 'selected' : ''}>${esc(f.label)}</option>`
  ).join('');
}

function rebuildFieldOptions(deviceSelect) {
  const key = deviceSelect.dataset.key || '';
  let prefix;
  if (key.endsWith('-device'))     prefix = key.slice(0, -'-device'.length) + '-';
  else if (key.endsWith('_device')) prefix = key.slice(0, -'_device'.length) + '_';
  else return;

  const fieldKey = prefix + 'field';
  const row = deviceSelect.closest('.field-row') || deviceSelect.parentElement;
  const fieldSelect = row.querySelector(`select[data-key="${fieldKey}"]`);
  if (!fieldSelect) return;

  const deviceId = deviceSelect.value;
  const selectedField = fieldSelect.value;

  if (!deviceId) {
    fieldSelect.innerHTML = '<option value="">— поле —</option>';
    return;
  }
  const dev = devicesCache.find(d => d.id === deviceId);
  if (!dev) {
    fieldSelect.innerHTML = '<option value="">— поле —</option>';
    return;
  }

  const meta = window.TYPES[dev.type] || {};
  let fields;

  if (meta.custom && meta.raw && Array.isArray(meta.raw.fields)) {
    fields = meta.raw.fields
      .filter(f => f && f.name)
      .map(f => ({ name: f.name, label: f.label || f.name }));
    const known = new Set(fields.map(x => x.name));
    for (const k of Object.keys(dev.state || {})) {
      if (!known.has(k)) fields.push({ name: k, label: k });
    }
  } else {
    fields = Object.keys(dev.state || {}).map(k => ({ name: k, label: k }));
  }

  fieldSelect.innerHTML =
    '<option value="">— поле —</option>' +
    fields.map(f =>
      `<option value="${esc(f.name)}" ${f.name === selectedField ? 'selected' : ''}>${esc(f.label)}</option>`
    ).join('');
}

/* ---------- Рендер списка сценариев ---------- */

function renderScenarios() {
  renderGroupTabs();
  const box = document.getElementById('scenarios-list');
  let list = scenariosCache;
  if (activeGroup !== 'all') list = list.filter(s => (s.group || '') === activeGroup);
  if (!list.length) { box.innerHTML = '<div class="empty">Сценариев нет.</div>'; return; }

  box.innerHTML = list.map(sc => {
    const conds = sc.conditions || [];
    const condHtml = conds.map((c, i) => `
      <div class="field-row">
        <label>Если</label>
        <select data-key="cond-${i}-device"
                onchange="rebuildFieldOptions(this); markRowDirty(this)">
          <option value="">— устройство —</option>
          ${deviceOptions(c.device)}
        </select>
        <select data-key="cond-${i}-field"
                onchange="markRowDirty(this)">
          <option value="">— поле —</option>
          ${fieldOptions(c.device, c.field)}
        </select>
        <select data-key="cond-${i}-op" onchange="markRowDirty(this)">${opOptions(c.op || '==')}</select>
        <input type="text" value="${esc(c.value ?? '')}" placeholder="значение"
          data-key="cond-${i}-value" oninput="markRowDirty(this)">
        <label style="display:flex;gap:.3rem;align-items:center;font-size:.85rem;">
          <input type="checkbox" ${c.negate ? 'checked' : ''}
            data-key="cond-${i}-negate" onchange="markRowDirty(this)"> NOT
        </label>
        <button class="btn small danger edit-only"
          onclick="removeConditionLocal('${sc.id}', ${i})">✕</button>
      </div>`).join('');

    const acts = sc.actions || [];
    const actHtml = acts.map((a, i) => `
      <div class="action-block" data-action-index="${i}">
        ${renderActionBlock(a, i, sc.id, 'scenario')}
      </div>
    `).join('');

    const groupOpts = [`<option value="">— без группы —</option>`]
      .concat(groupsCache.map(g => `<option value="${g.id}" ${sc.group === g.id ? 'selected' : ''}>${esc(g.name)}</option>`))
      .join('');

    return `
      <div class="row" data-id="${sc.id}">
        <div class="row-head">
          <label style="display:flex;gap:.4rem;align-items:center;font-size:.9rem;">
            пауза перед стартом:
            <input type="number" min="0" step="0.1" value="${sc.initial_delay ?? 0}"
              data-key="initial_delay" oninput="markRowDirty(this)"
              style="width:80px;"> сек
          </label>
          <input type="text" value="${esc(sc.name || '')}"
            data-key="name" oninput="markRowDirty(this)"
            style="background:transparent;border:none;color:#fff;font-size:1.1rem;font-weight:600;flex:1;">
          <label style="display:flex;gap:.4rem;align-items:center;font-size:.9rem;">
            группа: <select data-key="group" onchange="markRowDirty(this)">${groupOpts}</select>
          </label>
          <label style="display:flex;gap:.4rem;align-items:center;font-size:.9rem;">
            логика:
            <select data-key="logic" onchange="markRowDirty(this)">
              <option value="AND" ${sc.logic === 'AND' ? 'selected' : ''}>AND</option>
              <option value="OR"  ${sc.logic === 'OR'  ? 'selected' : ''}>OR</option>
              <option value="NOT" ${sc.logic === 'NOT' ? 'selected' : ''}>NOT (все)</option>
            </select>
          </label>
          <label style="display:flex;align-items:center;gap:.4rem;font-size:.9rem;">
            <input type="checkbox" ${sc.enabled !== false ? 'checked' : ''}
              data-key="enabled" onchange="markRowDirty(this)"> вкл
          </label>
          <button class="btn small green btn-save" onclick="saveScenario('${sc.id}')">💾 Сохранить</button>
          <button class="btn small danger edit-only" onclick="removeScenario('${sc.id}')">🗑</button>
        </div>
        <div class="row-body">
          ${condHtml}
          <div><button class="btn small gray edit-only" onclick="addConditionLocal('${sc.id}')">➕ условие</button></div>
          <div class="hr"></div>
          ${actHtml}
          <div><button class="btn small gray edit-only" onclick="addActionLocal('${sc.id}')">➕ действие</button></div>
        </div>
      </div>`;
  }).join('');
}

/* ---------- Универсальный блок действия ---------- */

function renderActionBlock(a, i, ownerId, ownerKind = 'scenario') {
  const onType = ownerKind === 'timer'
    ? `onTimerActionTypeChange(this, '${ownerId}', ${i})`
    : `onActionTypeChange(this, '${ownerId}', ${i})`;

  const typeSel = (curType) => `
  <select data-key="a${i}-type" onchange="${onType}">
    <option value="set_state"   ${curType === 'set_state'   ? 'selected' : ''}>установить состояние</option>
    <option value="request"     ${curType === 'request'     ? 'selected' : ''}>HTTP-запрос</option>
    <option value="mqtt_publish" ${curType === 'mqtt_publish' ? 'selected' : ''}>MQTT-публикация</option>
    <option value="delay"       ${curType === 'delay'       ? 'selected' : ''}>⏱ задержка</option>
    <option value="notify"      ${curType === 'notify'      ? 'selected' : ''}>🔔 Уведомление</option>
    <option value="lua" ${curType === 'lua' ? 'selected' : ''}>🐍 Lua-скрипт</option>
  </select>`;

  const removeBtn = `
    <button class="btn small danger edit-only"
      onclick="${ownerKind === 'timer'
        ? `removeTimerActionLocal('${ownerId}', ${i})`
        : `removeActionLocal('${ownerId}', ${i})`}">✕</button>`;

  if (a.type === 'set_state') {
    const src = a.value_source || {};
    const mode = src.mode || 'const';

    const modeRow = `
      <div class="field-row">
        <label>Значение</label>
        <select data-key="a${i}-vs-mode" onchange="onSetStateModeChange(this, '${ownerId}', ${i})">
          <option value="const"  ${mode === 'const'  ? 'selected' : ''}>константа</option>
          <option value="device" ${mode === 'device' ? 'selected' : ''}>из устройства</option>
          <option value="expr"   ${mode === 'expr'   ? 'selected' : ''}>выражение</option>
        </select>
        ${mode === 'device' ? `
          <select data-key="a${i}-vs-device"
                  onchange="rebuildFieldOptions(this); markRowDirty(this)">
            <option value="">— устройство —</option>
            ${deviceOptions(src.device)}
          </select>
          <select data-key="a${i}-vs-field" onchange="markRowDirty(this)">
            <option value="">— поле —</option>
            ${fieldOptions(src.device, src.field)}
          </select>
        ` : ''}
        ${mode === 'expr' ? `
          <input type="text" value="${esc(src.expr || '')}"
            data-key="a${i}-vs-expr" oninput="markRowDirty(this)"
            placeholder="{dev:...:temp} * 1.8 + 32" style="flex:1;min-width:200px;">
          <button class="btn small gray" title="Вставить плейсхолдер"
            onclick="openPhModal(this.previousElementSibling)">🧩</button>
        ` : ''}
        ${mode === 'const' ? `
          <input type="text" value="${esc(a.value ?? '')}"
            placeholder="значение" data-key="a${i}-value" oninput="markRowDirty(this)">
        ` : ''}
      </div>`;

    return `
      <div class="field-row">
        <label>Тогда</label>
        ${typeSel('set_state')}
        <select data-key="a${i}-device"
                onchange="rebuildFieldOptions(this); markRowDirty(this)">
          <option value="">— устройство —</option>
          ${deviceOptions(a.device)}
        </select>
        <select data-key="a${i}-field" onchange="markRowDirty(this)">
          <option value="">— поле —</option>
          ${fieldOptions(a.device, a.field)}
        </select>
        ${removeBtn}
      </div>
      ${modeRow}`;
  }

  if (a.type === 'delay') {
    return `
      <div class="field-row">
        <label>Тогда</label>
        ${typeSel('delay')}
        ${removeBtn}
      </div>
      <div class="field-row">
        <label>Пауза</label>
        <input type="number" min="0" step="0.1" value="${a.seconds ?? 1}"
          data-key="a${i}-seconds" oninput="markRowDirty(this)"
          style="min-width:90px;">
        <span>сек</span>
      </div>`;
  }

  if (a.type === 'mqtt_publish') {
    return `
      <div class="field-row">
        <label>Тогда</label>
        ${typeSel('mqtt_publish')}
        ${removeBtn}
      </div>
      <div class="field-row">
        <label>Топик</label>
        <input type="text" value="${esc(a.topic || '')}"
          data-key="a${i}-topic" oninput="markRowDirty(this)">
        <button class="btn small gray" title="Вставить плейсхолдер"
          onclick="openPhModal(this.previousElementSibling)">🧩</button>
      </div>
      <div class="field-row">
        <label>Payload</label>
        <textarea data-key="a${i}-payload" oninput="markRowDirty(this)"
          placeholder='{"event":"triggered"}'>${esc(a.payload || '')}</textarea>
        <button class="btn small gray" title="Вставить плейсхолдер"
          onclick="openPhModal(this.previousElementSibling)">🧩</button>
      </div>
      <div class="field-row">
        <label>retain</label>
        <input type="checkbox" ${a.retain ? 'checked' : ''}
          data-key="a${i}-retain" onchange="markRowDirty(this)">
        <label>QoS</label>
        <input type="number" min="0" max="2" value="${a.qos || 0}"
          data-key="a${i}-qos" onchange="markRowDirty(this)" style="min-width:60px;">
      </div>`;
  }

  if (a.type === 'notify') {
    return `
      <div class="field-row">
        <label>Тогда</label>
        ${typeSel('notify')}
        ${removeBtn}
      </div>
      <div class="field-row">
        <label>Заголовок</label>
        <input type="text" value="${esc(a.title || '')}"
          data-key="a${i}-title" oninput="markRowDirty(this)"
          placeholder="Уведомление">
        <button class="btn small gray" title="Вставить плейсхолдер"
          onclick="openPhModal(this.previousElementSibling)">🧩</button>
      </div>
      <div class="field-row">
        <label>Текст</label>
        <textarea data-key="a${i}-body" oninput="markRowDirty(this)"
          placeholder="Температура: {dev:sensor1:temp} °C"
          style="flex:1;min-height:60px;">${esc(a.body || '')}</textarea>
        <button class="btn small gray" title="Вставить плейсхолдер"
          onclick="openPhModal(this.previousElementSibling)">🧩</button>
      </div>
      <div class="field-row">
        <label>Уровень</label>
        <select data-key="a${i}-level" onchange="markRowDirty(this)">
          <option value="info"    ${a.level === 'info'    ? 'selected' : ''}>info</option>
          <option value="warning" ${a.level === 'warning' ? 'selected' : ''}>warning</option>
          <option value="error"   ${a.level === 'error'   ? 'selected' : ''}>error</option>
        </select>
        <label>tag</label>
        <input type="text" value="${esc(a.tag || '')}"
          data-key="a${i}-tag" oninput="markRowDirty(this)"
          placeholder="(необязательно)">
        <label style="display:flex;gap:.4rem;align-items:center;font-size:.85rem;">
          <input type="checkbox" ${a.enabled !== false ? 'checked' : ''}
            data-key="a${i}-enabled" onchange="markRowDirty(this)"> вкл
        </label>
      </div>`;
  }

  if (a.type === 'lua') {
    const opts = (luaScriptsCache || []).map(s =>
      `<option value="${s.id}" ${a.script_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`
    ).join('');
    return `
      <div class="field-row">
        <label>Тогда</label>
        ${typeSel('lua')}
        ${removeBtn}
      </div>
      <div class="field-row">
        <label>Скрипт</label>
        <select data-key="a${i}-script_id" onchange="markRowDirty(this)">
          <option value="">— выберите —</option>
          ${opts}
        </select>
      </div>`;
  }

  return `
    <div class="field-row">
      <label>Тогда</label>
      ${typeSel('request')}
      ${removeBtn}
    </div>
    ${requestBox(a, i, i)}`;
}

/* ---------- Смена типа действия и value_source ---------- */

function onSetStateModeChange(selectEl, ownerId, idx) {
  const newMode = selectEl.value;
  const row = selectEl.closest('.row');
  if (!row) return;
  const block = row.querySelector(`.action-block[data-action-index="${idx}"]`);
  if (!block) return;

  const isTimer = row.dataset.timer === '1' || !!timersCache.find(t => t.id === ownerId);
  const owner = isTimer
    ? timersCache.find(t => t.id === ownerId)
    : scenariosCache.find(s => s.id === ownerId);
  const oldAction = (owner && owner.actions && owner.actions[idx]) || {};

  const domFields = collectActionFieldsFromBlock(block, idx);
  const vs = (oldAction.value_source || {});
  vs.mode = newMode;
  if (newMode === 'const') {
    delete vs.device;
    delete vs.field;
    delete vs.expr;
  } else if (newMode === 'device') {
    vs.device = domFields['vs-device'] || '';
    vs.field  = domFields['vs-field']  || '';
    delete vs.expr;
  } else if (newMode === 'expr') {
    vs.expr = domFields['vs-expr'] || '';
    delete vs.device;
    delete vs.field;
  }

  const newAction = { ...oldAction, ...domFields, value_source: vs, type: 'set_state' };
  block.innerHTML = renderActionBlock(newAction, idx, ownerId, isTimer ? 'timer' : 'scenario');

  const save = row.querySelector('.row-head .btn-save');
  if (save) save.classList.add('dirty');
}

function onActionTypeChange(selectEl, scId, idx) {
  const newType = selectEl.value;
  const row = selectEl.closest('.row');
  if (!row) return;
  const block = row.querySelector(`.action-block[data-action-index="${idx}"]`);
  if (!block) return;

  const sc = scenariosCache.find(s => s.id === scId);
  const oldAction = (sc && sc.actions && sc.actions[idx]) ? sc.actions[idx] : {};

  const domFields = collectActionFieldsFromBlock(block, idx);
  const newAction = { ...oldAction, ...domFields, type: newType };
  cleanActionFields(newAction, newType);

  block.innerHTML = renderActionBlock(newAction, idx, scId, 'scenario');
  const save = row.querySelector('.row-head .btn-save');
  if (save) save.classList.add('dirty');
}

function onTimerActionTypeChange(selectEl, timerId, idx) {
  const newType = selectEl.value;
  const row = selectEl.closest('.row');
  if (!row) return;
  const block = row.querySelector(`.action-block[data-action-index="${idx}"]`);
  if (!block) return;

  const t = timersCache.find(x => x.id === timerId);
  const oldAction = (t && t.actions && t.actions[idx]) ? t.actions[idx] : {};

  const domFields = collectActionFieldsFromBlock(block, idx);
  const newAction = { ...oldAction, ...domFields, type: newType };
  cleanActionFields(newAction, newType);

  block.innerHTML = renderActionBlock(newAction, idx, timerId, 'timer');
  const save = row.querySelector('.row-head .btn-save');
  if (save) save.classList.add('dirty');
}

function collectActionFieldsFromBlock(block, idx) {
  const out = {};
  block.querySelectorAll(`[data-key^="a${idx}-"]`).forEach(el => {
    const key = el.dataset.key.slice(`a${idx}-`.length);
    if (el.type === 'checkbox') out[key] = el.checked;
    else if (el.type === 'number') out[key] = el.value === '' ? '' : Number(el.value);
    else out[key] = el.value;
  });
  const vs = {};
  for (const k of Object.keys(out)) {
    if (k.startsWith('vs-')) {
      vs[k.slice(3)] = out[k];
      delete out[k];
    }
  }
  if (Object.keys(vs).length) out.__value_source = vs;
  return out;
}

function cleanActionFields(action, newType) {
  if (newType === 'set_state') {
    delete action.method; delete action.url;
    delete action.body_type; delete action.body; delete action.headers;
    delete action.topic; delete action.payload;
    delete action.retain; delete action.qos; delete action.device_id;
  } else if (newType === 'mqtt_publish') {
    delete action.method; delete action.url;
    delete action.body_type; delete action.body; delete action.headers;
    delete action.device; delete action.field; delete action.value;
  } else if (newType === 'request') {
    delete action.device; delete action.field; delete action.value;
    delete action.topic; delete action.payload;
    delete action.retain; delete action.qos; delete action.device_id;
  } else if (newType === 'delay') {
    delete action.method; delete action.url;
    delete action.body_type; delete action.body; delete action.headers;
    delete action.device; delete action.field; delete action.value;
    delete action.topic; delete action.payload;
    delete action.retain; delete action.qos; delete action.device_id;
  } else if (newType === 'notify') {
    delete action.method; delete action.url;
    delete action.body_type; delete action.body; delete action.headers;
    delete action.device; delete action.field; delete action.value;
    delete action.topic; delete action.payload;
    delete action.retain; delete action.qos; delete action.device_id;
    delete action.value_source;
  } else if (newType === 'lua') {
    delete action.method; delete action.url;
    delete action.body_type; delete action.body; delete action.headers;
    delete action.device; delete action.field; delete action.value;
    delete action.topic; delete action.payload;
    delete action.retain; delete action.qos; delete action.device_id;
    delete action.value_source;
  }
}

/* ---------- Условия и действия: add/remove ---------- */

async function addConditionLocal(scId) {
  const sc = scenariosCache.find(s => s.id === scId); if (!sc) return;
  const conditions = JSON.parse(JSON.stringify(sc.conditions || []));
  conditions.push({device: '', field: '', op: '==', value: '', negate: false});
  await api('/api/scenarios/' + scId, 'POST', {conditions});
  scenariosCache = await api('/api/scenarios');
  renderScenarios();
}
async function removeConditionLocal(scId, idx) {
  const sc = scenariosCache.find(s => s.id === scId); if (!sc) return;
  const conditions = JSON.parse(JSON.stringify(sc.conditions || []));
  conditions.splice(idx, 1);
  await api('/api/scenarios/' + scId, 'POST', {conditions});
  scenariosCache = await api('/api/scenarios');
  renderScenarios();
}

async function addActionLocal(scId) {
  const sc = scenariosCache.find(s => s.id === scId); if (!sc) return;
  const actions = JSON.parse(JSON.stringify(sc.actions || []));
  actions.push({type: 'set_state', device: '', field: '', value: ''});
  await api('/api/scenarios/' + scId, 'POST', {actions});
  scenariosCache = await api('/api/scenarios');
  renderScenarios();
}
async function removeActionLocal(scId, idx) {
  const sc = scenariosCache.find(s => s.id === scId); if (!sc) return;
  const actions = JSON.parse(JSON.stringify(sc.actions || []));
  actions.splice(idx, 1);
  await api('/api/scenarios/' + scId, 'POST', {actions});
  scenariosCache = await api('/api/scenarios');
  renderScenarios();
}

/* ---------- CRUD сценариев ---------- */

async function addScenario() {
  await api('/api/scenarios', 'POST', {
    name: 'Новый сценарий', enabled: true, logic: 'AND',
    group: (activeGroup && activeGroup !== 'all') ? activeGroup : '',
    conditions: [], actions: []
  });
  refresh();
}
async function removeScenario(id) {
  if (!confirm('Удалить сценарий?')) return;
  try {
    await api('/api/scenarios/' + id, 'DELETE');
    scenariosCache = scenariosCache.filter(s => s.id !== id);
    renderGroupTabs();
    renderScenarios();
    api('/api/scenarios').then(r => {
      scenariosCache = r; renderGroupTabs(); renderScenarios();
    }).catch(() => {});
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

/* ---------- Сохранение ---------- */

function buildConditionsFromFields(fields, template) {
  const byIdx = {};
  for (const key in fields) {
    const m = key.match(/^cond-(\d+)-(.+)$/); if (!m) continue;
    const idx = +m[1]; byIdx[idx] = byIdx[idx] || {}; byIdx[idx][m[2]] = fields[key];
  }
  const presentIdx = Object.keys(byIdx).map(n => +n).sort((a, b) => a - b);
  if (!presentIdx.length) return template && template.length ? [] : (template || []);
  const out = [];
  for (const i of presentIdx) {
    const t = template[i] || {}; const f = byIdx[i];
    out.push({
      device: f.device ?? t.device ?? '',
      field:  f.field  ?? t.field  ?? '',
      op:     f.op     ?? t.op     ?? '==',
      value:  f.value  ?? t.value  ?? '',
      negate: f.negate !== undefined ? !!f.negate : !!t.negate,
    });
  }
  return out;
}

function buildActionsFromFields(fields, template) {
  const byIdx = {};
  for (const key in fields) {
    const m = key.match(/^a(\d+)-(.+)$/);
    if (!m) continue;
    const idx = +m[1];
    byIdx[idx] = byIdx[idx] || {};
    const rest = m[2];
    const hm = rest.match(/^h(\d+)-(k|v)$/);
    if (hm) {
      byIdx[idx].__headers = byIdx[idx].__headers || {};
      const hi = +hm[1];
      byIdx[idx].__headers[hi] = byIdx[idx].__headers[hi] || {};
      byIdx[idx].__headers[hi][hm[2]] = fields[key];
    } else {
      byIdx[idx][rest] = fields[key];
    }
  }

  const presentIdx = Object.keys(byIdx).map(n => +n).sort((a, b) => a - b);
  if (!presentIdx.length) {
    return template && template.length ? [] : (template || []);
  }

  const out = [];
  for (const i of presentIdx) {
    const t = template[i] || {};
    const f = byIdx[i];

    const type = f.type || t.type || (('method' in f) || ('url' in f) ? 'request' : 'set_state');
    const merged = JSON.parse(JSON.stringify(t));
    merged.type = type;

    if (type === 'delay') {
      merged.seconds = ('seconds' in f)
        ? (parseFloat(f.seconds) || 0)
        : (t.seconds ?? 1);
      delete merged.method; delete merged.url;
      delete merged.body_type; delete merged.body; delete merged.headers;
      delete merged.device; delete merged.field; delete merged.value;
      delete merged.topic; delete merged.payload;
      delete merged.retain; delete merged.qos; delete merged.device_id;
      delete merged.value_source;
      out.push(merged);
      continue;
    }

    if (type === 'set_state') {
      merged.device = ('device' in f) ? f.device : (t.device ?? '');
      merged.field  = ('field'  in f) ? f.field  : (t.field  ?? '');

      const vsMode = f['vs-mode'];
      if (vsMode && vsMode !== 'const') {
        if (vsMode === 'device') {
          merged.value_source = {
            mode: 'device',
            device: f['vs-device'] || '',
            field:  f['vs-field']  || '',
          };
          delete merged.value;
        } else if (vsMode === 'expr') {
          merged.value_source = {
            mode: 'expr',
            expr: f['vs-expr'] || '',
          };
          delete merged.value;
        } else {
          delete merged.value_source;
        }
      } else {
        merged.value = ('value' in f) ? f.value : (t.value ?? '');
        delete merged.value_source;
      }

      delete merged.method; delete merged.url;
      delete merged.body_type; delete merged.body; delete merged.headers;
      delete merged.topic; delete merged.payload;
      delete merged.device_id; delete merged.retain; delete merged.qos;
      out.push(merged);
      continue;
    }

    if (type === 'lua') {
      merged.script_id = ('script_id' in f) ? f.script_id : (t.script_id ?? '');
      delete merged.method; delete merged.url;
      delete merged.body_type; delete merged.body; delete merged.headers;
      delete merged.device; delete merged.field; delete merged.value;
      delete merged.topic; delete merged.payload;
      delete merged.retain; delete merged.qos; delete merged.device_id;
      delete merged.value_source;
      out.push(merged);
      continue;
    }

    if (type === 'mqtt_publish') {
      merged.topic     = ('topic'     in f) ? f.topic     : (t.topic     ?? '');
      merged.payload   = ('payload'   in f) ? f.payload   : (t.payload   ?? '');
      merged.device_id = ('device_id' in f) ? f.device_id : (t.device_id ?? '');
      merged.retain    = ('retain'    in f) ? !!f.retain  : (t.retain !== false);
      merged.qos       = ('qos'       in f) ? (parseInt(f.qos, 10) || 0) : (t.qos ?? 0);

      delete merged.method; delete merged.url;
      delete merged.body; delete merged.body_type; delete merged.headers;
      delete merged.device; delete merged.field; delete merged.value;
      delete merged.value_source;
      out.push(merged);
      continue;
    }

    if (type === 'notify') {
      merged.title   = ('title'   in f) ? f.title   : (t.title   ?? '');
      merged.body    = ('body'    in f) ? f.body    : (t.body    ?? '');
      merged.level   = ('level'   in f) ? f.level   : (t.level   ?? 'info');
      merged.tag     = ('tag'     in f) ? f.tag     : (t.tag     ?? '');
      merged.enabled = ('enabled' in f) ? !!f.enabled : (t.enabled !== false);

      delete merged.method; delete merged.url;
      delete merged.body_type; delete merged.headers;
      delete merged.device; delete merged.field; delete merged.value;
      delete merged.value_source;
      delete merged.topic; delete merged.payload;
      delete merged.device_id; delete merged.retain; delete merged.qos;
      out.push(merged);
      continue;
    }

    // request (по умолчанию)
    merged.method    = ('method'    in f) ? f.method    : (t.method    ?? 'GET');
    merged.url       = ('url'       in f) ? f.url       : (t.url       ?? '');
    merged.body_type = ('body_type' in f) ? f.body_type : (t.body_type ?? 'none');
    merged.body      = ('body'      in f) ? f.body      : (t.body      ?? '');
    merged.enabled   = ('enabled'   in f) ? !!f.enabled : (t.enabled !== false);

    if (f.__headers) {
      const hs = [];
      const keys = Object.keys(f.__headers).map(n => +n).sort((a, b) => a - b);
      for (const hi of keys) {
        hs.push({ k: f.__headers[hi].k || '', v: f.__headers[hi].v || '' });
      }
      merged.headers = hs;
    } else if (!merged.headers) {
      merged.headers = [];
    }

    delete merged.device; delete merged.field; delete merged.value;
    delete merged.topic; delete merged.payload;
    delete merged.device_id; delete merged.retain; delete merged.qos;
    delete merged.value_source;
    out.push(merged);
  }
  return out;
}

function buildWeekdaysFromFields(fields, template) {
  const present = Object.keys(fields).filter(k => /^weekday-\d+$/.test(k));
  if (!present.length) return (template || []).slice();
  const days = [];
  for (const k of present) if (fields[k]) days.push(parseInt(k.replace('weekday-', ''), 10));
  return days.sort((a, b) => a - b);
}

async function saveScenario(id) {
  const row = document.querySelector(`.row[data-id="${id}"]`); if (!row) return;
  const fields = collectRowFields(row);
  const sc = scenariosCache.find(x => x.id === id) || { conditions: [], actions: [] };
  const patch = {
    name:  fields['name'] ?? sc.name ?? '',
    enabled: fields['enabled'] !== undefined ? fields['enabled'] : (sc.enabled !== false),
    logic: fields['logic'] ?? sc.logic ?? 'AND',
    group: fields['group'] ?? sc.group ?? '',
    initial_delay: fields['initial_delay'] !== undefined ? (parseFloat(fields['initial_delay']) || 0) : (sc.initial_delay ?? 0),
    conditions: buildConditionsFromFields(fields, sc.conditions || []),
    actions:    buildActionsFromFields(fields, sc.actions || []),
  };
  await api('/api/scenarios/' + id, 'POST', patch);
  scenariosCache = await api('/api/scenarios');
  renderScenarios();
}

/* ---------- Группы ---------- */

async function addGroup() {
  const name = prompt('Название группы:', 'Новая группа');
  if (!name) return;
  await api('/api/scenario_groups', 'POST', { name });
  refresh();
}
async function renameGroup(id) {
  const g = groupsCache.find(x => x.id === id); if (!g) return;
  const name = prompt('Переименовать группу:', g.name);
  if (!name) return;
  await api('/api/scenario_groups/' + id, 'POST', { name });
  refresh();
}
async function removeGroup(id) {
  if (!confirm('Удалить группу? Сценарии перейдут в «Без группы».')) return;
  try {
    await api('/api/scenario_groups/' + id, 'DELETE');
    groupsCache = groupsCache.filter(g => g.id !== id);
    scenariosCache = scenariosCache.map(s => s.group === id ? { ...s, group: '' } : s);
    if (activeGroup === id) activeGroup = 'all';
    renderGroupTabs();
    renderScenarios();
    Promise.all([api('/api/scenario_groups'), api('/api/scenarios')])
      .then(([g, s]) => { groupsCache = g; scenariosCache = s; renderGroupTabs(); renderScenarios(); })
      .catch(() => {});
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

function renderGroupTabs() {
  const box = document.getElementById('group-tabs');
  const counts = {};
  scenariosCache.forEach(s => { const g = s.group || ''; counts[g] = (counts[g] || 0) + 1; });
  const total = scenariosCache.length;
  const parts = [`<span class="group-tab ${activeGroup === 'all' ? 'active' : ''}" onclick="setGroup('all')">
    Все <span class="cnt">${total}</span></span>`];
  groupsCache.forEach(g => {
    parts.push(`<span class="group-tab ${activeGroup === g.id ? 'active' : ''}" onclick="setGroup('${g.id}')">
      ${esc(g.name)} <span class="cnt">${counts[g.id] || 0}</span>
      ${currentMode === 'edit' ? `<span onclick="event.stopPropagation();renameGroup('${g.id}')" style="margin-left:.3rem;opacity:.7">✎</span>
      <span onclick="event.stopPropagation();removeGroup('${g.id}')" style="margin-left:.3rem;opacity:.7">✕</span>` : ''}
    </span>`);
  });
  const noGroup = counts[''] || 0;
  if (noGroup) parts.push(`<span class="group-tab ${activeGroup === '' ? 'active' : ''}" onclick="setGroup('')">
    Без группы <span class="cnt">${noGroup}</span></span>`);
  box.innerHTML = parts.join('');
}

function setGroup(id) {
  activeGroup = id;
  renderGroupTabs();
  renderScenarios();
}