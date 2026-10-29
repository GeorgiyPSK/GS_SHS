/* ============================================================
   GS Smart — логика страницы /app (упрощённый просмотр).
   Использует общие модули: core.js, ui/devices.js, ui/charts.js.
   ============================================================ */

const API = '';

/* ---------- Локальное состояние (своё, т.к. страница автономна) ---------- */
const viewState = {
  devices: [],
  rooms: [],
  planMain: null,
  planRooms: {},
  currentRoomId: null,
  selectedDeviceId: null,
  currentTab: 'plans',
  pending: false,
  lastDevicesHash: '',
};

const TOGGLE_TYPES = new Set(['light', 'light_switch', 'button']);

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = '', 2200);
}

/* ---------- Локальный refresh статуса ---------- */
function setViewStatus(ok) {
  const el = document.getElementById('status');
  if (!el) return;
  el.className = 'status ' + (ok ? 'online' : 'offline');
  el.textContent = ok ? 'онлайн' : 'офлайн';
}

/* ---------- Загрузка ---------- */
async function loadDevices()  { viewState.devices = await api('/api/devices'); window.devicesCache = viewState.devices; }
async function loadRooms()    { viewState.rooms   = await api('/api/rooms'); }
async function loadPlanImages() {
  try {
    const plan = await api('/api/plan');
    viewState.planMain = (plan.main && plan.main.image) || null;
    viewState.planRooms = {};
    for (const [rid, entry] of Object.entries(plan.rooms || {})) {
      if (entry && entry.image) viewState.planRooms[rid] = entry.image;
    }
  } catch (e) {
    viewState.planMain = null;
    viewState.planRooms = {};
  }
}

async function refreshAll() {
  if (viewState.pending) return;
  viewState.pending = true;
  try {
    await Promise.all([loadDevices(), loadRooms(), loadPlanImages(), loadPlanCharts()]);
    viewState.lastDevicesHash = JSON.stringify(viewState.devices);
    setViewStatus(true);
    renderViewAll();
  } catch (e) {
    setViewStatus(false);
    toast('Ошибка загрузки: ' + e.message, true);
  } finally {
    viewState.pending = false;
  }
}

async function refreshDevices() {
  if (viewState.pending) return;
  viewState.pending = true;
  try {
    const devs = await api('/api/devices');
    const hash = JSON.stringify(devs);
    if (hash === viewState.lastDevicesHash) {
      setViewStatus(true);
      return;
    }
    viewState.devices = devs;
    window.devicesCache = viewState.devices;
    viewState.lastDevicesHash = hash;
    setViewStatus(true);
    if (viewState.currentTab === 'plans')   renderViewPlan();
    if (viewState.currentTab === 'devices') renderViewDevices();
    if (viewState.selectedDeviceId) {
      const d = viewState.devices.find(x => x.id === viewState.selectedDeviceId);
      const el = document.querySelector(`.pin[data-id="${viewState.selectedDeviceId}"]`);
      if (d) openViewDeviceModal(d, el);
      else closeViewDeviceModal();
    }
  } catch (e) {
    setViewStatus(false);
  } finally {
    viewState.pending = false;
  }
}

/* ---------- Главные вкладки ---------- */
function switchTab(tab) {
  viewState.currentTab = tab;
  const tp = document.getElementById('tab-plans');
  const td = document.getElementById('tab-devices');
  if (tp) tp.classList.toggle('active', tab === 'plans');
  if (td) td.classList.toggle('active', tab === 'devices');
  const vp = document.getElementById('view-plans');
  const vd = document.getElementById('view-devices');
  if (vp) vp.style.display = tab === 'plans' ? 'block' : 'none';
  if (vd) vd.style.display = tab === 'devices' ? 'block' : 'none';
  closeViewDeviceModal();
  if (tab === 'plans') renderViewPlan();
  if (tab === 'devices') renderViewDevices();
}

/* ---------- Общая отрисовка ---------- */
function renderViewAll() {
  renderRoomSelect();
  renderBreadcrumb();
  renderViewPlan();
  if (viewState.currentTab === 'devices') renderViewDevices();
}

function renderRoomSelect() {
  const sel = document.getElementById('roomSelect');
  if (!sel) return;
  const cur = viewState.currentRoomId;
  sel.innerHTML = '<option value="">Общий план</option>';
  for (const r of viewState.rooms) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = (r.icon ? r.icon + ' ' : '') + r.name;
    if (r.id === cur) opt.selected = true;
    sel.appendChild(opt);
  }
}

function renderBreadcrumb() {
  const box = document.getElementById('breadcrumb');
  if (!box) return;
  const parts = [];
  const mainActive = viewState.currentRoomId === null;
  parts.push(`<span class="crumb ${mainActive ? 'active' : ''}"
    onclick="${mainActive ? '' : 'openViewMain()'}">Общий план</span>`);
  if (viewState.currentRoomId !== null) {
    parts.push('<span class="sep">›</span>');
    if (viewState.currentRoomId === '') {
      parts.push('<span class="crumb active">📦 Без комнаты</span>');
    } else {
      const r = viewState.rooms.find(x => x.id === viewState.currentRoomId);
      parts.push(`<span class="crumb active">${r && r.icon ? r.icon + ' ' : ''}${esc(r ? r.name : '—')}</span>`);
    }
  }
  box.innerHTML = parts.join('');
}

/* ---------- Отрисовка плана ---------- */
function currentViewPlanKey() {
  return viewState.currentRoomId === null ? 'main' : (viewState.currentRoomId || 'main');
}

function viewDevicePos(d) {
  const key = currentViewPlanKey();
  const positions = d.positions || {};
  if (positions[key] && Number.isFinite(positions[key].x) && Number.isFinite(positions[key].y)) {
    return { x: positions[key].x, y: positions[key].y };
  }
  if (key === 'main') {
    return {
      x: Number.isFinite(d.x) ? d.x : 50,
      y: Number.isFinite(d.y) ? d.y : 50,
    };
  }
  return { x: 50, y: 50 };
}

function renderViewPlan() {
  const wrap = document.getElementById('planWrap');
  if (!wrap) return;

  if (viewState.currentRoomId === null) {
    if (!viewState.planMain) {
      wrap.innerHTML = '<div class="plan-empty">Общий план не загружен</div>';
      return;
    }
    wrap.innerHTML = `<img src="${viewState.planMain}" alt="Общий план">`;
    for (const r of viewState.rooms) {
      const zone = document.createElement('div');
      zone.className = 'room-zone';
      zone.style.left   = (r.x ?? 0) + '%';
      zone.style.top    = (r.y ?? 0) + '%';
      zone.style.width  = (r.w ?? 20) + '%';
      zone.style.height = (r.h ?? 20) + '%';
      zone.innerHTML = `<span class="room-label">${r.icon ? r.icon + ' ' : ''}${esc(r.name)}</span>`;
      zone.onclick = () => openViewRoom(r.id);
      wrap.appendChild(zone);
    }
    renderPlanCharts(wrap);
    return;
  }

  const image = viewState.planRooms[viewState.currentRoomId];
  if (!image) {
    wrap.innerHTML = '<div class="plan-empty">План комнаты не загружен</div>';
    return;
  }
  wrap.innerHTML = `<img src="${image}" alt="План комнаты">`;

  const rid = viewState.currentRoomId;
  const visible = viewState.devices.filter(d => {
    if (!d.on_plan) return false;
    return (d.room_id === rid) ||
           (Array.isArray(d.extra_rooms) && d.extra_rooms.includes(rid));
  });

  for (const d of visible) wrap.appendChild(makeViewPin(d));
  renderPlanCharts(wrap);
}

function makeViewPin(d) {
  const pos = viewDevicePos(d);
  const pin = document.createElement('div');
  pin.className = 'pin ' + stateClass(d);
  pin.style.left = pos.x + '%';
  pin.style.top  = pos.y + '%';
  pin.dataset.id = d.id;

  const val = pinValue(d);
  pin.innerHTML =
    `<span>${pickDeviceIcon(d)}</span>` +
    `<span class="label">${esc(d.name || d.id)}</span>` +
    (val ? `<span class="val ${val.cls}">${val.text}</span>` : '');

  pin.addEventListener('click', (e) => {
    e.stopPropagation();
    onViewPinClick(d, pin);
  });
  return pin;
}

function onViewPinClick(d, pinEl) {
  if (TOGGLE_TYPES.has(d.type)) {
    toggleViewDevice(d);
    return;
  }

  const meta = (window.TYPES && window.TYPES[d.type]) || {};
  if (meta.custom && meta.raw && Array.isArray(meta.raw.fields)) {
    const onoffField = meta.raw.fields.find(f => f.control === 'onoff' && f.label);
    if (onoffField) {
      const cur = !!(d.state && d.state[onoffField.name]);
      setViewState(d.id, { [onoffField.name]: !cur });
      return;
    }
    const btnField = meta.raw.fields.find(f => f.control === 'button' && f.label);
    if (btnField) {
      const trigger = btnField.default ?? true;
      setViewState(d.id, { [btnField.name]: trigger });
      return;
    }
  }

  openViewDeviceModal(d, pinEl);
}

/* ---------- Вкладка «Устройства» ---------- */
function renderViewDevices() {
  const box = document.getElementById('roomsSections');
  if (!box) return;
  box.innerHTML = '';

  const byRoom = new Map();
  for (const r of viewState.rooms) byRoom.set(r.id, []);
  const noRoom = [];
  for (const d of viewState.devices) {
    if (d.room_id && byRoom.has(d.room_id)) byRoom.get(d.room_id).push(d);
    else noRoom.push(d);
  }

  for (const [rid, list] of byRoom.entries()) {
    if (!list.length) continue;
    const room = viewState.rooms.find(r => r.id === rid);
    box.appendChild(makeRoomSection(room, list));
  }
  if (noRoom.length) box.appendChild(makeRoomSection(null, noRoom));
  if (!viewState.devices.length) {
    box.innerHTML = '<div class="plan-empty">Нет устройств</div>';
  }
}

function makeRoomSection(room, devices) {
  const sec = document.createElement('div');
  sec.className = 'room-section' + (room ? '' : ' no-room-section');

  const head = document.createElement('div');
  head.className = 'room-section-head';
  head.innerHTML = `
    <span class="icon">${room ? (room.icon || '🏠') : '📦'}</span>
    <span class="name">${room ? esc(room.name) : 'Без комнаты'}</span>
    <span class="count">${devices.length}</span>
  `;
  sec.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'cards-grid';
  for (const d of devices) grid.appendChild(makeViewDeviceCard(d));
  sec.appendChild(grid);
  return sec;
}

function makeViewDeviceCard(d) {
  const card = document.createElement('div');
  card.className = 'dev-card';
  card.dataset.id = d.id;

  const s = d.state || {};
  let valueText = '';
  let subText = '';
  let controlsHtml = '';

  switch (d.type) {
    case 'light': {
      valueText = s.on ? `Вкл · ${s.brightness}%` : 'Выкл';
      subText = 'Яркость';
      controlsHtml = `
        <input type="range" min="0" max="100" value="${s.brightness ?? 0}"
               oninput="this.nextElementSibling.textContent = this.value + '%'"
               onchange="setViewState('${d.id}', {brightness: parseInt(this.value), on: parseInt(this.value) > 0})">
        <div class="dc-sub" style="margin:0 0 .4rem">${s.brightness ?? 0}%</div>
        <div class="dc-controls">
          <button class="${s.on ? 'on' : 'off'}" onclick="setViewState('${d.id}', {on: ${!s.on}})">${s.on ? 'Выключить' : 'Включить'}</button>
        </div>`;
      break;
    }
    case 'light_switch': {
      valueText = s.on ? 'Включён' : 'Выключен';
      controlsHtml = `
        <div class="dc-controls">
          <button class="${s.on ? 'on' : 'off'}" onclick="setViewState('${d.id}', {on: ${!s.on}})">${s.on ? 'Выключить' : 'Включить'}</button>
        </div>`;
      break;
    }
    case 'button': {
      valueText = s.pressed ? 'Нажата' : 'Отпущена';
      controlsHtml = `
        <div class="dc-controls">
          <button onclick="pressViewButton('${d.id}')">▶ Нажать</button>
        </div>`;
      break;
    }
    case 'fan': {
      valueText = s.on ? `Вкл · скорость ${s.speed}` : 'Выкл';
      controlsHtml = `
        <input type="range" min="0" max="3" step="1" value="${s.speed ?? 0}"
               oninput="this.nextElementSibling.textContent = this.value"
               onchange="setViewState('${d.id}', {speed: parseInt(this.value), on: parseInt(this.value) > 0})">
        <div class="dc-sub" style="margin:0 0 .4rem">Скорость: ${s.speed ?? 0}</div>
        <div class="dc-controls">
          <button class="${s.on ? 'on' : 'off'}" onclick="setViewState('${d.id}', {on: ${!s.on}, speed: ${s.on ? 0 : 1}})">${s.on ? 'Выключить' : 'Включить'}</button>
        </div>`;
      break;
    }
    case 'curtain': {
      valueText = s.open ? `Открыто на ${s.position}%` : 'Закрыто';
      controlsHtml = `
        <input type="range" min="0" max="100" value="${s.position ?? 0}"
               oninput="this.nextElementSibling.textContent = this.value + '%'"
               onchange="setViewState('${d.id}', {position: parseInt(this.value), open: parseInt(this.value) > 0})">
        <div class="dc-sub" style="margin:0 0 .4rem">Позиция: ${s.position ?? 0}%</div>
        <div class="dc-controls">
          <button onclick="setViewState('${d.id}', {open: true, position: 100})">Открыть</button>
          <button onclick="setViewState('${d.id}', {open: false, position: 0})">Закрыть</button>
        </div>`;
      break;
    }
    case 'thermostat': {
      valueText = `${(+s.current).toFixed(1)} °C`;
      subText = `Цель: ${(+s.target).toFixed(1)} °C · ${s.mode === 'heat' ? '🔥 нагрев' : s.mode === 'cool' ? '❄️ охлажд.' : s.mode}`;
      controlsHtml = `
        <input type="range" min="10" max="30" step="0.5" value="${s.target ?? 22}"
               oninput="this.nextElementSibling.textContent = parseFloat(this.value).toFixed(1) + ' °C'"
               onchange="setViewState('${d.id}', {target: parseFloat(this.value)})">
        <div class="dc-sub" style="margin:0 0 .4rem">Новая цель: ${(+s.target).toFixed(1)} °C</div>
        <div class="dc-controls">
          <button class="${s.mode === 'heat' ? 'on' : 'off'}" onclick="setViewState('${d.id}', {mode: 'heat'})">🔥 Нагрев</button>
          <button class="${s.mode === 'cool' ? 'on' : 'off'}" onclick="setViewState('${d.id}', {mode: 'cool'})">❄️ Охлажд.</button>
        </div>`;
      break;
    }
    case 'climate': {
      valueText = `${(+s.temp).toFixed(1)} °C`;
      subText = `Влажность: ${(+s.humidity).toFixed(0)} %`;
      break;
    }
    case 'door':  { valueText = s.open ? 'Открыто' : 'Закрыто'; break; }
    case 'leak':  { valueText = s.leak ? 'ПРОТЕЧКА!' : 'Сухо'; break; }
    case 'motion':{ valueText = s.motion ? 'Движение' : 'Тихо'; break; }
    case 'text': {
      valueText = s.text ? s.text.slice(0, 40) : '— пусто —';
      controlsHtml = `
        <div class="dc-controls" style="flex-direction:column;align-items:stretch;">
          <textarea onchange="setViewState('${d.id}', {text: this.value})"
            style="min-height:60px;resize:vertical;padding:.4rem;border-radius:8px;border:1px solid var(--input-border);background:var(--input-bg);color:var(--text);font-family:inherit;">${(s.text || '').replace(/</g,'&lt;')}</textarea>
        </div>`;
      break;
    }
    default: {
      const meta = (window.TYPES && window.TYPES[d.type]) || {};
      if (meta.custom && meta.raw && Array.isArray(meta.raw.fields)) {
        valueText = '';
        subText = meta.label || d.type;
        const parts = [];
        for (const f of meta.raw.fields) {
          if (!f.name || f.label === undefined) continue;
          const v = s[f.name];
          const control = f.control || (f.type === 'bool' ? 'switch'
                         : f.type === 'number' ? 'number' : 'text');
          const label = f.label;

          if (control === 'onoff') {
            const on = !!v;
            parts.push(`
              <div class="dc-controls" style="margin-bottom:.3rem; align-items:center;">
                <span style="flex:0 0 90px; font-size:.85rem; opacity:.8;">${esc(label)}</span>
                <button class="${on ? 'on' : 'off'}"
                  onclick="setViewState('${d.id}', {${f.name}: ${!on}})">
                  ${on ? 'Выключить' : 'Включить'}
                </button>
              </div>`);
            continue;
          }
          if (control === 'button') {
            const trigger = f.default ?? true;
            parts.push(`
              <div class="dc-controls" style="margin-bottom:.3rem; align-items:center;">
                <span style="flex:0 0 90px; font-size:.85rem; opacity:.8;">${esc(label)}</span>
                <button onclick="setViewState('${d.id}', {${f.name}: ${JSON.stringify(trigger)}})">
                  ▶ ${esc(label)}
                </button>
              </div>`);
            continue;
          }
          if (control === 'switch' || f.type === 'bool') {
            const on = !!v;
            parts.push(`
              <div class="dc-controls" style="margin-bottom:.3rem; align-items:center;">
                <span style="flex:0 0 90px; font-size:.85rem; opacity:.8;">${esc(label)}</span>
                <input type="checkbox" ${on ? 'checked' : ''}
                  onchange="setViewState('${d.id}', {${f.name}: this.checked})">
              </div>`);
            continue;
          }
          if (control === 'slider') {
            const min = Number.isFinite(f.min) ? f.min : 0;
            const max = Number.isFinite(f.max) ? f.max : 100;
            const step = Number.isFinite(f.step) ? f.step : 1;
            const cur = (v ?? min);
            parts.push(`
              <div style="margin-bottom:.4rem;">
                <div style="display:flex; justify-content:space-between; font-size:.85rem; opacity:.8; margin-bottom:.15rem;">
                  <span>${esc(label)}</span>
                  <span>${cur}</span>
                </div>
                <input type="range" min="${min}" max="${max}" step="${step}" value="${cur}"
                  oninput="this.previousElementSibling.querySelector('span:last-child').textContent = this.value"
                  onchange="setViewState('${d.id}', {${f.name}: parseFloat(this.value)})">
              </div>`);
            continue;
          }
          if (control === 'select') {
            const opts = Array.isArray(f.options) ? f.options : [];
            const optionsHtml = opts.map(o =>
              `<option value="${esc(o)}" ${String(v) === String(o) ? 'selected' : ''}>${esc(o)}</option>`
            ).join('');
            parts.push(`
              <div class="dc-controls" style="margin-bottom:.3rem; align-items:center;">
                <span style="flex:0 0 90px; font-size:.85rem; opacity:.8;">${esc(label)}</span>
                <select style="flex:1; padding:.3rem .5rem;"
                  onchange="setViewState('${d.id}', {${f.name}: this.value})">
                  ${optionsHtml || '<option value="">— нет вариантов —</option>'}
                </select>
              </div>`);
            continue;
          }
          if (control === 'number' || f.type === 'number') {
            const cur = (v ?? 0);
            parts.push(`
              <div class="dc-controls" style="margin-bottom:.3rem; align-items:center;">
                <span style="flex:0 0 90px; font-size:.85rem; opacity:.8;">${esc(label)}</span>
                <input type="number" step="any" value="${cur}" style="flex:1; padding:.3rem .5rem;"
                  onchange="setViewState('${d.id}', {${f.name}: parseFloat(this.value)})">
              </div>`);
            continue;
          }
          const vt = (v === undefined || v === null) ? '—' : String(v);
          parts.push(`
            <div class="dc-field" style="margin:.4rem 0;">
              <div style="font-size:.85rem; opacity:.8;">${esc(label)}</div>
              <div style="font-size:1.05rem; font-weight:600; margin-top:.1rem;">${esc(vt)}</div>
            </div>`);
        }
        controlsHtml = parts.join('');
      }
      break;
    }
  }

  const graphBtn = deviceHasLogs(d)
    ? `<div class="dc-controls" style="margin-top:.5rem;">
         <button class="btn small gray"
           onclick="event.stopPropagation(); openChartModal('${d.id}', '${(devFieldsFirst(d) || '')}')">
           📊 График
         </button>
       </div>`
    : '';

  card.innerHTML = `
    <div class="dc-head">
      <span class="dc-icon">${pickDeviceIcon(d)}</span>
      <div style="flex:1;min-width:0">
        <div class="dc-name">${d.name || d.id}</div>
        <div class="dc-type">${TYPES[d.type]?.label || d.type}</div>
      </div>
    </div>
    <div class="dc-value">${valueText}</div>
    ${subText ? `<div class="dc-sub">${subText}</div>` : ''}
    ${controlsHtml}
    ${graphBtn}
  `;
  return card;
}

function pressViewButton(id) {
  setViewState(id, { pressed: true });
}

/* ---------- Управление состоянием ---------- */
async function toggleViewDevice(d) {
  const patch = d.type === 'button' ? { pressed: true } : { on: !d.state.on };
  const prev = JSON.parse(JSON.stringify(d.state));
  Object.assign(d.state, patch);
  viewState.lastDevicesHash = '';
  if (viewState.currentTab === 'plans')   renderViewPlan();
  if (viewState.currentTab === 'devices') renderViewDevices();

  try {
    const updated = await api(`/api/devices/${d.id}/state`, {
      method: 'POST',
      body: JSON.stringify(patch),
    });
    const idx = viewState.devices.findIndex(x => x.id === d.id);
    if (idx >= 0) viewState.devices[idx] = updated;
    viewState.lastDevicesHash = JSON.stringify(viewState.devices);
    renderViewAll();
  } catch (e) {
    Object.assign(d.state, prev);
    renderViewAll();
    toast('Ошибка: ' + e.message, true);
  }
}

async function setViewState(id, patch) {
  const d = viewState.devices.find(x => x.id === id);
  if (d) {
    Object.assign(d.state, patch);
    viewState.lastDevicesHash = '';
    if (viewState.currentTab === 'plans')   renderViewPlan();
    if (viewState.currentTab === 'devices') renderViewDevices();
  }
  try {
    const updated = await api(`/api/devices/${id}/state`, {
      method: 'POST',
      body: JSON.stringify(patch),
    });
    const idx = viewState.devices.findIndex(x => x.id === id);
    if (idx >= 0) viewState.devices[idx] = updated;
    viewState.lastDevicesHash = JSON.stringify(viewState.devices);
    if (viewState.currentTab === 'plans')   renderViewPlan();
    if (viewState.currentTab === 'devices') renderViewDevices();
    if (viewState.selectedDeviceId === id) {
      const el = document.querySelector(`.pin[data-id="${id}"]`);
      if (el) openViewDeviceModal(updated || d, el);
    }
  } catch (e) {
    toast('Ошибка: ' + e.message, true);
  }
}

/* ---------- Модалка устройства ---------- */
function openViewDeviceModal(d, anchorEl) {
  viewState.selectedDeviceId = d.id;
  const modal = document.getElementById('modal');
  if (!modal) return;
  const mTitle = document.getElementById('mTitle');
  const mSub = document.getElementById('mSub');
  const body = document.getElementById('mBody');
  const btns = document.getElementById('mBtns');
  if (mTitle) mTitle.innerHTML = `${pickDeviceIcon(d)} <span>${d.name || d.id}</span>`;
  if (mSub)   mSub.textContent = `${TYPES[d.type]?.label || d.type}${d.room ? ' · ' + d.room : ''}`;
  body.innerHTML = '';
  btns.innerHTML = '';
  const s = d.state || {};

  if (d.type === 'light') {
    body.appendChild(rangeRow('brightness', 'Яркость', 0, 100, s.brightness, '%', v => {
      setViewState(d.id, { brightness: v, on: v > 0 });
    }));
    btns.appendChild(btn(s.on ? 'Выключить' : 'Включить', () => setViewState(d.id, { on: !s.on }), 'primary'));
  } else if (d.type === 'light_switch') {
    btns.appendChild(btn(s.on ? 'Выключить' : 'Включить', () => setViewState(d.id, { on: !s.on }), 'primary'));
  } else if (d.type === 'fan') {
    body.appendChild(rangeRow('speed', 'Скорость', 0, 3, s.speed, '', v => {
      setViewState(d.id, { speed: v, on: v > 0 });
    }));
  } else if (d.type === 'curtain') {
    body.appendChild(rangeRow('position', 'Позиция', 0, 100, s.position, '%', v => {
      setViewState(d.id, { position: v, open: v > 0 });
    }));
    btns.appendChild(btn('Открыть', () => setViewState(d.id, { open: true, position: 100 }), 'primary'));
    btns.appendChild(btn('Закрыть', () => setViewState(d.id, { open: false, position: 0 }), 'danger'));
  } else if (d.type === 'thermostat') {
    const modeLabel = s.mode === 'heat' ? '🔥 Нагрев'
                    : s.mode === 'cool' ? '❄️ Охлаждение'
                    : (s.mode ? String(s.mode) : '— не задан');
    body.innerHTML += `<div class="row"><label>Режим</label><span class="val">${modeLabel}</span></div>`;
    if (Number.isFinite(+s.current)) {
      body.innerHTML += `<div class="row"><label>Текущая</label><span class="val">${(+s.current).toFixed(1)} °C</span></div>`;
    }
    body.appendChild(rangeRow('target', 'Цель', 10, 30, s.target, '°', v => {
      setViewState(d.id, { target: v });
    }, 0.5));
    btns.appendChild(btn('🔥 Нагрев', () => setViewState(d.id, { mode: 'heat' }), s.mode === 'heat' ? 'primary' : ''));
    btns.appendChild(btn('❄️ Охлажд.', () => setViewState(d.id, { mode: 'cool' }), s.mode === 'cool' ? 'primary' : ''));
  } else if (d.type === 'door') {
    body.innerHTML = `<div class="row"><label>Состояние</label>
      <span class="val">${s.open ? '🔓 открыто' : '🔒 закрыто'}</span></div>`;
  } else if (d.type === 'leak') {
    body.innerHTML = `<div class="row"><label>Протечка</label>
      <span class="val">${s.leak ? '💧 ЕСТЬ' : '✅ нет'}</span></div>`;
  } else if (d.type === 'motion') {
    body.innerHTML = `<div class="row"><label>Движение</label>
      <span class="val">${s.motion ? '👁️ есть' : '— нет'}</span></div>`;
  } else if (d.type === 'climate') {
    body.innerHTML = `
      <div class="row"><label>Температура</label><span class="val">${(+s.temp).toFixed(1)} °C</span></div>
      <div class="row"><label>Влажность</label><span class="val">${(+s.humidity).toFixed(0)} %</span></div>`;
  } else if (d.type === 'text') {
    const ta = document.createElement('textarea');
    ta.value = s.text || '';
    ta.style.cssText = 'width:100%;min-height:60px;padding:.4rem;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.25);color:#fff;font-family:inherit;';
    ta.onchange = () => setViewState(d.id, { text: ta.value });
    body.appendChild(ta);
  } else {
    /* кастомные типы — упрощённо: только кнопки/чекбоксы/поля */
    const meta = window.TYPES && window.TYPES[d.type];
    if (meta && meta.custom && meta.raw && Array.isArray(meta.raw.fields)) {
      for (const f of meta.raw.fields) {
        if (!f.name || f.label === undefined) continue;
        const v = s[f.name];
        const control = f.control || (f.type === 'bool' ? 'switch'
                       : f.type === 'number' ? 'number' : 'text');
        const label = f.label;

        if (control === 'onoff') {
          const on = !!v;
          const row = document.createElement('div');
          row.className = 'row';
          row.style.cssText = 'display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;';
          row.innerHTML = `
            <label style="flex:0 0 90px; font-size:.85rem; opacity:.8;">${esc(label)}</label>
            <button class="btn small ${on ? 'green' : 'gray'}"
              onclick="setViewState('${d.id}', {${f.name}: ${!on}})">
              ${on ? 'Выключить' : 'Включить'}
            </button>
            <span style="opacity:.7; min-width:40px;">${on ? 'вкл' : 'выкл'}</span>
          `;
          body.appendChild(row);
        } else if (control === 'button') {
          const trigger = f.default ?? true;
          const row = document.createElement('div');
          row.className = 'row';
          row.style.cssText = 'display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;';
          row.innerHTML = `
            <label style="flex:0 0 90px; font-size:.85rem; opacity:.8;">${esc(label)}</label>
            <button class="btn small gray"
              onclick="setViewState('${d.id}', {${f.name}: ${JSON.stringify(trigger)}})">
              ▶ ${esc(label)}
            </button>
          `;
          body.appendChild(row);
        } else if (control === 'switch' || f.type === 'bool') {
          const on = !!v;
          const row = document.createElement('div');
          row.className = 'row';
          row.style.cssText = 'display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;';
          row.innerHTML = `
            <label style="flex:0 0 90px; font-size:.85rem; opacity:.8;">${esc(label)}</label>
            <input type="checkbox" ${on ? 'checked' : ''}
              onchange="setViewState('${d.id}', {${f.name}: this.checked})">
          `;
          body.appendChild(row);
        } else if (control === 'slider') {
          const min = Number.isFinite(f.min) ? f.min : 0;
          const max = Number.isFinite(f.max) ? f.max : 100;
          const step = Number.isFinite(f.step) ? f.step : 1;
          const cur = (v ?? min);
          const row = document.createElement('div');
          row.className = 'row';
          row.style.cssText = 'display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;';
          row.innerHTML = `
            <label style="flex:0 0 90px; font-size:.85rem; opacity:.8;">${esc(label)}</label>
            <input type="range" min="${min}" max="${max}" step="${step}" value="${cur}"
              style="flex:1;"
              oninput="this.nextElementSibling.textContent = this.value"
              onchange="setViewState('${d.id}', {${f.name}: parseFloat(this.value)})">
            <span style="opacity:.8; min-width:40px; text-align:right;">${cur}</span>
          `;
          body.appendChild(row);
        } else if (control === 'select') {
          const opts = Array.isArray(f.options) ? f.options : [];
          const optionsHtml = opts.map(o =>
            `<option value="${esc(o)}" ${String(v) === String(o) ? 'selected' : ''}>${esc(o)}</option>`
          ).join('');
          const row = document.createElement('div');
          row.className = 'row';
          row.style.cssText = 'display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;';
          row.innerHTML = `
            <label style="flex:0 0 90px; font-size:.85rem; opacity:.8;">${esc(label)}</label>
            <select style="flex:1; padding:.4rem .6rem;"
              onchange="setViewState('${d.id}', {${f.name}: this.value})">
              ${optionsHtml || '<option value="">— нет вариантов —</option>'}
            </select>
          `;
          body.appendChild(row);
        } else if (control === 'number' || f.type === 'number') {
          const cur = (v ?? 0);
          const row = document.createElement('div');
          row.className = 'row';
          row.style.cssText = 'display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;';
          row.innerHTML = `
            <label style="flex:0 0 90px; font-size:.85rem; opacity:.8;">${esc(label)}</label>
            <input type="number" step="any" value="${cur}" style="flex:1;"
              onchange="setViewState('${d.id}', {${f.name}: parseFloat(this.value)})">
          `;
          body.appendChild(row);
        } else {
          const vt = (v === undefined || v === null) ? '—' : String(v);
          const row = document.createElement('div');
          row.className = 'row';
          row.style.cssText = 'display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;';
          row.innerHTML = `
            <label style="flex:0 0 90px; font-size:.85rem; opacity:.8;">${esc(label)}</label>
            <span class="val" style="flex:1; font-size:1.05rem; font-weight:600;">${esc(vt)}</span>
          `;
          body.appendChild(row);
        }
      }
    }
  }

  /* Позиционирование — упрощённое */
  const isMobile = window.matchMedia('(max-width: 700px)').matches;
  if (isMobile) {
    modal.style.left = '';
    modal.style.top  = '';
  } else {
    modal.style.left = '0px';
    modal.style.top  = '0px';
    modal.style.visibility = 'hidden';
    const mw = modal.offsetWidth  || 320;
    const mh = modal.offsetHeight || 200;
    let left, top;
    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect();
      left = r.right + 12;
      top  = r.top;
      if (left + mw > window.innerWidth - 8) left = r.left - mw - 12;
      if (left < 8) left = Math.max(8, (window.innerWidth - mw) / 2);
    } else {
      left = (window.innerWidth  - mw) / 2;
      top  = (window.innerHeight - mh) / 2;
    }
    if (top + mh > window.innerHeight - 8) top = window.innerHeight - mh - 8;
    if (top < 8) top = 8;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    if (left < 8) left = 8;
    modal.style.left = left + 'px';
    modal.style.top  = top + 'px';
    modal.style.visibility = '';
  }
  modal.classList.add('open');
}

function closeViewDeviceModal() {
  const modal = document.getElementById('modal');
  if (modal) modal.classList.remove('open');
  viewState.selectedDeviceId = null;
}

/* Алиас для модалки — если view.js/другой модуль вызывает closeDeviceModal */
function closeDeviceModal() { closeViewDeviceModal(); }

function rangeRow(field, label, min, max, value, suffix, onChange, step) {
  const row = document.createElement('div');
  row.className = 'row';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'range';
  inp.min = min; inp.max = max;
  if (step) inp.step = step;
  inp.value = value ?? min;
  const out = document.createElement('span');
  out.className = 'val';
  out.textContent = (value ?? min) + (suffix || '');
  inp.oninput = () => { out.textContent = inp.value + (suffix || ''); };
  inp.onchange = () => onChange(parseFloat(inp.value));
  row.appendChild(lbl);
  row.appendChild(inp);
  row.appendChild(out);
  return row;
}

function btn(text, onClick, cls) {
  const b = document.createElement('button');
  b.textContent = text;
  if (cls) b.className = cls;
  b.onclick = onClick;
  return b;
}

/* ---------- Навигация ---------- */
function openViewMain() {
  viewState.currentRoomId = null;
  closeViewDeviceModal();
  renderViewAll();
}
function openViewRoom(rid) {
  viewState.currentRoomId = rid;
  closeViewDeviceModal();
  renderViewAll();
}

/* ---------- Обработчики ---------- */
function bindViewUI() {
  const sel = document.getElementById('roomSelect');
  if (sel) {
    sel.onchange = (e) => {
      viewState.currentRoomId = e.target.value || null;
      closeViewDeviceModal();
      renderViewAll();
    };
  }

  document.addEventListener('click', (e) => {
    const modal = document.getElementById('modal');
    if (modal && modal.classList.contains('open')) {
      if (!modal.contains(e.target)
          && !e.target.closest('.pin')
          && !e.target.closest('.plan-chart')) {
        closeViewDeviceModal();
      }
    }

    const chartModal = document.getElementById('chart-modal-overlay');
    if (chartModal && chartModal.classList.contains('open')) {
      if (e.target === chartModal) closeChartModal();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const chartModal = document.getElementById('chart-modal-overlay');
    if (chartModal && chartModal.classList.contains('open')) {
      closeChartModal();
      return;
    }
    closeViewDeviceModal();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshDevices();
  });
}

/* ---------- SSE + fallback-опрос ---------- */
let _viewSSE = null;
let _viewSSERetry = null;

function startViewSSE() {
  if (_viewSSE) return;
  try {
    _viewSSE = new EventSource(API + '/api/events/stream');
    _viewSSE.onopen = () => setViewStatus(true);
    _viewSSE.onmessage = () => { refreshDevices(); };
    _viewSSE.onerror = () => {
      try { _viewSSE.close(); } catch (e) {}
      _viewSSE = null;
      setViewStatus(false);
      clearTimeout(_viewSSERetry);
      _viewSSERetry = setTimeout(startViewSSE, 3000);
    };
  } catch (e) {
    _viewSSE = null;
    clearTimeout(_viewSSERetry);
    _viewSSERetry = setTimeout(startViewSSE, 3000);
  }
}

let _viewFallbackTimer = null;
function startViewFallbackPolling() {
  if (_viewFallbackTimer) clearInterval(_viewFallbackTimer);
  _viewFallbackTimer = setInterval(() => {
    if (document.hidden) return;
    if (_viewSSE && _viewSSE.readyState === EventSource.OPEN) return;
    refreshDevices();
  }, 10000);
}

/* ---------- Кастомные типы (для отображения) ---------- */
async function loadViewCustomTypes() {
  try {
    const types = await api('/api/custom_types');
    for (const [tid, info] of Object.entries(types || {})) {
      window.TYPES[tid] = {
        icon: info.icon || '📦',
        label: info.label || info.name || tid,
        fields: (info.fields || []).map(f => f.name),
        custom: true,
        raw: info,
      };
    }
  } catch (e) {
    console.warn('[custom_types] load error:', e);
  }
}

/* ---------- Инициализация ---------- */
(async function initAppView() {
  bindViewUI();
  await loadViewCustomTypes();
  await refreshAll();
  startViewSSE();
  startViewFallbackPolling();
})();