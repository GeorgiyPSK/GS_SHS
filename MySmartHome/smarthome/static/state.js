/* ============================================================
   Глобальные переменные (кеши, флаги, состояние UI)
   ============================================================ */

let _knxprojFile = null;
let knxGaCache = [];
let _luaEditorDirty = false;
let luaScriptsCache = [];
let luaSelectedId = null;
let luaLogs = {};
let currentView = 'grid';
let currentMode = 'user';
let planMainImage = null;
let planRoomImages = {};
let currentRoomId = null;
let devicesCache = [];
const iconRulesDraft = {};
let eventsCache = [];
let groupsCache = [];
let scenariosCache = [];
let timersCache = [];
let roomsCache = [];
let activeGroup = 'all';
let currentViewView = 'rooms';
let viewRoomId = null;
let _lastInteraction = 0;
let _modalDeviceId = null;
const bulkSelected = new Set();
const _detailsOpen = new Set();
const _groupOpenState = {};
let _refreshPaused = false;
let placeholdersCache = {};
let mqttSettingsCache = {};
let mqttStatusCache = { available: false, connected: false };
let mqttTriggersCache = [];
let z2mFieldsCache = {};
let _planMeta = { main: { has_image: false }, rooms: {} };
let _lastSlowFetch = 0;
const SLOW_INTERVAL = 10000;
let _refreshTimer = null;
let _sse = null;
let _lastVersion = 0;
let devicesLayout = 'grid';
let _chart = null;
let _chartModalSeries = [];
let _planCharts = {};
let _planChartsList = [];
let _chartAddSeries = [];
let _ct_editing_id = null;
let _ct_field_idx = 0;
let _serverLogs = [];
let _logsAutoScroll = true;
const MAX_LOGS = 1000;
let _phTargetEl = null;
let _emojiPickerResolve = null;
let _knxGaAddModalCallback = null;

const INTERACTION_PAUSE = 1500;

window.devicesCache = devicesCache;
window.mqttSettingsCache = mqttSettingsCache;

/* ============================================================
   Кастомные поля (для renderCard)
   ============================================================ */

function renderCustomField(d, f, v) {
  if (!f || !f.name) return '';
  const label = f.label || f.name;
  const name = f.name;

  const control = f.control || (f.type === 'bool' ? 'switch'
                   : f.type === 'number' ? 'number' : 'text');

  if (control === 'onoff') {
    const on = !!v;
    return `<div style="display:flex; gap:.4rem; align-items:center; flex-wrap:wrap;">
      <span style="min-width:110px; opacity:.8; font-size:.85rem;">${esc(label)}</span>
      <button class="btn small ${on ? 'on' : 'off'}"
        onclick="setState('${d.id}', {${name}: ${!on}})">
        ${on ? 'Выключить' : 'Включить'}
      </button>
    </div>`;
  }

  if (control === 'button') {
    const triggerValue = f.default ?? true;
    return `<div style="display:flex; gap:.4rem; align-items:center; flex-wrap:wrap;">
      <span style="min-width:110px; opacity:.8; font-size:.85rem;">${esc(label)}</span>
      <button class="btn small gray"
        onclick="setState('${d.id}', {${name}: ${JSON.stringify(triggerValue)}})">
        ▶ ${esc(label)}
      </button>
    </div>`;
  }

  if (control === 'slider') {
    const min = Number.isFinite(f.min) ? f.min : 0;
    const max = Number.isFinite(f.max) ? f.max : 100;
    const step = Number.isFinite(f.step) ? f.step : 1;
    const cur = (v ?? min);
    return `<div style="margin-bottom:.4rem;">
      <div style="display:flex; justify-content:space-between; font-size:.85rem; opacity:.8;">
        <span>${esc(label)}</span>
        <span class="cf-slider-val">${cur}</span>
      </div>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${cur}"
        oninput="this.previousElementSibling.querySelector('.cf-slider-val').textContent = this.value"
        onchange="setState('${d.id}', {${name}: parseFloat(this.value)})">
    </div>`;
  }

  if (control === 'switch' || f.type === 'bool') {
    const on = !!v;
    return `<div style="display:flex; gap:.4rem; align-items:center; flex-wrap:wrap;">
      <span style="min-width:110px; opacity:.8; font-size:.85rem;">${esc(label)}</span>
      <button class="btn small ${on ? 'green' : 'gray'}"
        onclick="setState('${d.id}', {${name}: ${!on}})">${on ? 'Вкл' : 'Выкл'}</button>
    </div>`;
  }

  let valueText = (v === undefined || v === null) ? '—' : String(v);
  if (typeof v === 'boolean') valueText = v ? 'вкл' : 'выкл';
  else if (typeof v === 'number') valueText = String(Math.round(v * 100) / 100);

  return `<div class="cf-field" style="margin:.4rem 0; padding:.3rem 0; border-bottom:1px solid rgba(255,255,255,.08);">
    <div style="font-size:.85rem; opacity:.8;">${esc(label)}</div>
    <div style="font-size:1.05rem; font-weight:600; margin-top:.1rem;">${esc(valueText)}</div>
  </div>`;
}

/* ============================================================
   Стандартные поля (для renderGenericFields)
   ============================================================ */

function renderStandardField(d, f, v) {
  const isEdit = currentMode === 'edit';
  if (typeof v === 'boolean') {
    return `<label style="display:flex; gap:.4rem; align-items:center;">
      <span style="min-width:110px; opacity:.8;">${esc(f)}</span>
      <input type="checkbox" ${v ? 'checked' : ''} ${isEdit ? '' : 'disabled'}
        onchange="setState('${d.id}', {${f}: this.checked})">
    </label>`;
  }
  if (typeof v === 'number') {
    return `<label style="display:flex; gap:.4rem; align-items:center;">
      <span style="min-width:110px; opacity:.8;">${esc(f)}</span>
      <input type="number" step="any" value="${v}" ${isEdit ? '' : 'disabled'}
        onchange="setState('${d.id}', {${f}: parseFloat(this.value)})" style="flex:1;">
    </label>`;
  }
  return `<label style="display:flex; gap:.4rem; align-items:center;">
    <span style="min-width:110px; opacity:.8;">${esc(f)}</span>
    <input type="text" value="${esc(v)}" ${isEdit ? '' : 'disabled'}
      onchange="setState('${d.id}', {${f}: this.value})" style="flex:1;">
  </label>`;
}

function wrapGenericFields(parts) {
  return `<details style="margin-top:.6rem; font-size:.85rem;" open>
    <summary style="cursor:pointer; user-select:none; opacity:.85;">Дополнительные поля</summary>
    <div style="display:flex; flex-direction:column; gap:.4rem; margin-top:.4rem;">
      ${parts.join('')}
    </div>
  </details>`;
}

function renderGenericFields(d) {
  const meta = window.TYPES[d.type] || {};
  const handled = new Set(HANDLED_FIELDS[d.type] || []);
  const allFields = Object.keys(d.state || {});

  const customFields = (meta.custom && meta.raw && Array.isArray(meta.raw.fields))
    ? meta.raw.fields : null;

  if (customFields) {
    const parts = [];
    for (const f of customFields) {
      const name = f.name;
      if (!name) continue;
      if (handled.has(name)) continue;
      if (f.label === undefined) continue;
      const v = d.state[name];
      parts.push(renderCustomField(d, f, v));
    }
    if (!parts.length) return '';
    return wrapGenericFields(parts);
  }

  const fields = allFields.filter(f => !handled.has(f));
  if (!fields.length) return '';
  const parts = fields.map(f => renderStandardField(d, f, d.state[f]));
  return wrapGenericFields(parts);
}

/* ============================================================
   Редактор правил иконки
   ============================================================ */

function ensureIconRulesDraft(id) {
  if (!iconRulesDraft[id]) {
    const d = devicesCache.find(x => x.id === id);
    iconRulesDraft[id] = JSON.parse(JSON.stringify(d?.icon_rules || []));
  }
  return iconRulesDraft[id];
}

function updateIconRuleDraft(id, idx, key, value) {
  const draft = ensureIconRulesDraft(id);
  if (!draft[idx]) draft[idx] = { field: '', op: '==', value: '', icon: '❓' };
  if (key === 'value') {
    let v = value;
    try { v = JSON.parse(value); } catch (e) { /* оставляем строкой */ }
    draft[idx].value = v;
  } else {
    draft[idx][key] = value;
  }
}

function renderIconRulesEditor(d) {
  const draft = (typeof iconRulesDraft !== 'undefined' && iconRulesDraft[d.id])
    ? iconRulesDraft[d.id]
    : (d.icon_rules || []);
  const fields = Object.keys(d.state || {});

  const rowsHtml = draft.map((r, i) => `
    <div class="field-row" style="display:flex;gap:.3rem;align-items:center;flex-wrap:wrap;">
      <select data-ir-field="${i}" onchange="updateIconRuleDraft('${d.id}', ${i}, 'field', this.value)">
        ${fields.map(f => `<option value="${esc(f)}" ${r.field === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}
      </select>
      <select data-ir-op="${i}" onchange="updateIconRuleDraft('${d.id}', ${i}, 'op', this.value)">
        ${['==','!=','>','<','>=','<=','contains','between'].map(op =>
          `<option value="${op}" ${r.op === op ? 'selected' : ''}>${op}</option>`).join('')}
      </select>
      <input type="text" data-ir-value="${i}"
        value="${esc(typeof r.value === 'object' ? JSON.stringify(r.value) : (r.value ?? ''))}"
        placeholder="значение" style="flex:1;min-width:80px;"
        oninput="updateIconRuleDraft('${d.id}', ${i}, 'value', this.value)">
      <button type="button" class="btn small gray"
        data-ir-icon-btn="${i}"
        data-ir-icon-value="${i}"
        title="Выбрать иконку"
        style="min-width:44px;text-align:center;font-size:1.2rem;line-height:1;"
        onclick="pickRuleIcon(this, '${d.id}')">
        ${esc(r.icon || '❓')}
      </button>
      <button type="button" class="btn small danger"
        onclick="removeIconRule('${d.id}', ${i})">✕</button>
    </div>
  `).join('');

  return rowsHtml || '<div style="opacity:.7;">Правил пока нет — используется стандартная иконка.</div>';
}

async function pickRuleIcon(btn, id) {
  const idx = btn.dataset.irIconValue;
  const cur = (btn.textContent || '').trim();
  const emoji = await openEmojiPicker(
    cur === '❓' ? null : cur,
    DEVICE_ICONS
  );
  if (emoji === null) return;
  btn.textContent = emoji;
  updateIconRuleDraft(id, +idx, 'icon', emoji);
}

async function addIconRule(id) {
  const d = devicesCache.find(x => x.id === id);
  if (!d) return;
  const draft = ensureIconRulesDraft(id);
  draft.push({
    field: Object.keys(d.state || {})[0] || '',
    op: '==',
    value: true,
    icon: '❓',
  });
  const box = document.querySelector(`#icon-rules-${id}`);
  if (box) box.innerHTML = renderIconRulesEditor(d);
}

async function removeIconRule(id, idx) {
  const draft = ensureIconRulesDraft(id);
  draft.splice(idx, 1);
  const d = devicesCache.find(x => x.id === id);
  const box = document.querySelector(`#icon-rules-${id}`);
  if (box && d) box.innerHTML = renderIconRulesEditor(d);
}

async function saveIconRules(id) {
  const draft = iconRulesDraft[id];
  if (!draft) { alert('Нечего сохранять'); return; }
  const rules = draft
    .filter(r => r.field && r.icon)
    .map(r => ({ field: r.field, op: r.op || '==', value: r.value, icon: r.icon }));

  try {
    const updated = await api('/api/devices/' + id + '/icon_rules', 'POST', { icon_rules: rules });
    const idx = devicesCache.findIndex(x => x.id === id);
    if (idx >= 0) devicesCache[idx] = updated;
    delete iconRulesDraft[id];
    renderCurrentView();
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

/* ============================================================
   Драйверы (бейджи на карточке)
   ============================================================ */

function deviceDrivers(d) {
  const out = [];

  const mqtt = d.mqtt || {};
  if ((mqtt.sub_topic || '').trim() || (mqtt.state_topic || '').trim()) {
    out.push({ id: 'mqtt', label: 'MQTT', title: 'MQTT' });
  }
  if ((d.z2m_name || '').trim()) {
    out.push({ id: 'z2m', label: 'Z2M', title: 'Zigbee2MQTT' });
  }
  const knx = d.knx || {};
  if (knx.enabled && knx.fields && Object.keys(knx.fields).length) {
    out.push({ id: 'knx', label: 'KNX', title: 'KNX/IP' });
  }
  const mb = d.modbus || {};
  if (mb.enabled && mb.fields && Object.keys(mb.fields).length) {
    out.push({ id: 'modbus', label: 'MB', title: 'Modbus' });
  }
  if (d.http_hits && d.http_hits > 0) {
    out.push({ id: 'http', label: 'HTTP', title: 'HTTP-управление' });
  }
  return out;
}

/* ============================================================
   Логирование устройств
   ============================================================ */

async function saveDeviceLogging(id, patch) {
  const updated = await api('/api/devices/' + id + '/logging', 'POST', patch);
  const i = devicesCache.findIndex(x => x.id === id);
  if (i >= 0) devicesCache[i].logging = updated;
  renderCurrentView();
}