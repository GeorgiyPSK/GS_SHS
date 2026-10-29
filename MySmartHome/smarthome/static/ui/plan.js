/* ============================================================
   План, комнаты, пины
   ============================================================ */

function currentPlanKey() {
  if (currentMode === 'user') {
    return (viewRoomId !== null && viewRoomId !== undefined)
      ? (viewRoomId || 'main')
      : 'main';
  }
  return currentRoomId || 'main';
}

function getDevicePos(d) {
  const key = currentPlanKey();
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

async function saveDevicePos(id, x, y) {
  const plan = currentPlanKey();
  try {
    const updated = await api('/api/devices/' + id + '/position', 'POST', {
      x, y, plan,
    });
    const idx = devicesCache.findIndex(d => d.id === id);
    if (idx >= 0) devicesCache[idx] = updated;
  } catch (e) {
    console.error('[saveDevicePos]', e);
  }
}

async function loadPlanImages() {
  try {
    const plan = await api('/api/plan');
    planMainImage  = (plan.main && plan.main.image) || null;
    planRoomImages = plan.rooms || {};
  } catch (e) { /* ignore */ }
}

/* --- Комнаты --- */
async function addRoomPrompt() {
  const name = prompt('Название комнаты:', 'Комната');
  if (!name) return;
  const icon = await openEmojiPicker('🏠');
  if (icon === null) return;
  const color = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  await api('/api/rooms', 'POST', {
    name, icon: icon || '🏠', color, x: 10, y: 10, w: 25, h: 25,
  });
  refresh();
}

async function renameRoom(rid) {
  const r = roomsCache.find(x => x.id === rid); if (!r) return;
  const name = prompt('Новое название комнаты:', r.name);
  if (!name) return;
  const icon = await openEmojiPicker(r.icon || '🏠');
  if (icon === null) return;
  await api('/api/rooms/' + rid, 'POST', { name, icon: icon || r.icon || '🏠' });
  refresh();
}

async function removeRoom(rid) {
  if (!confirm('Удалить комнату? Устройства останутся, но потеряют привязку.')) return;
  await api('/api/rooms/' + rid, 'DELETE');
  if (currentRoomId === rid) currentRoomId = null;
  refresh();
}

/* --- Загрузка/удаление планов --- */
function uploadMainPlan(input) {
  if (currentMode !== 'edit') { input.value = ''; return; }
  const file = input.files[0]; if (!file) return;
  if (!file.type.startsWith('image/')) { alert('Нужна картинка'); return; }
  const reader = new FileReader();
  reader.onload = async () => {
    await api('/api/plan/main', 'POST', { image: reader.result });
    await loadPlanImages();
    input.value = ''; refresh();
  };
  reader.readAsDataURL(file);
}
async function deleteMainPlan() {
  if (currentMode !== 'edit') return;
  if (!confirm('Удалить общий план?')) return;
  await api('/api/plan/main', 'DELETE');
  await loadPlanImages();
  refresh();
}
function uploadRoomPlan(input, rid) {
  if (currentMode !== 'edit') { input.value = ''; return; }
  const file = input.files[0]; if (!file) return;
  if (!file.type.startsWith('image/')) { alert('Нужна картинка'); return; }
  const reader = new FileReader();
  reader.onload = async () => {
    await api('/api/plan/rooms/' + rid, 'POST', { image: reader.result });
    await loadPlanImages();
    input.value = ''; refresh();
  };
  reader.readAsDataURL(file);
}
async function deleteRoomPlan(rid) {
  if (currentMode !== 'edit') return;
  if (!confirm('Удалить план комнаты?')) return;
  await api('/api/plan/rooms/' + rid, 'DELETE');
  await loadPlanImages();
  refresh();
}

/* --- Отрисовка плана (редактор) --- */
function renderPlanView() {
  renderPlanBreadcrumb();
  renderPlanActions();
  renderRoomsChips();
  if (currentRoomId) {
    document.getElementById('plan-main-wrap').style.display = 'none';
    document.getElementById('plan-room-wrap').style.display = 'block';
    renderRoomPlan(currentRoomId);
  } else {
    document.getElementById('plan-main-wrap').style.display = 'block';
    document.getElementById('plan-room-wrap').style.display = 'none';
    renderMainPlan();
  }
  renderChipsForCurrentPlan();
}
function renderPlanBreadcrumb() {
  const box = document.getElementById('plan-breadcrumb');
  const parts = [];
  parts.push(`<span class="crumb ${currentRoomId ? '' : 'active'}"
    onclick="${currentRoomId ? 'openMainPlan()' : ''}">Общий план</span>`);
  if (currentRoomId) {
    const room = roomsCache.find(r => r.id === currentRoomId);
    parts.push('<span class="sep">›</span>');
    parts.push(`<span class="crumb active">${room && room.icon ? room.icon + ' ' : ''}${esc(room ? room.name : '—')}</span>`);
  }
  box.innerHTML = parts.join('');
}
function renderPlanActions() {
  const box = document.getElementById('plan-actions');
  if (currentMode !== 'edit') { box.innerHTML = ''; return; }
  if (!currentRoomId) {
    box.innerHTML = `
      <label class="btn gray" style="cursor:pointer;">
        📁 Загрузить общий план
        <input type="file" accept="image/*" style="display:none"
               onchange="uploadMainPlan(this)">
      </label>
      <button class="btn danger" onclick="deleteMainPlan()">🗑️ Удалить план</button>
      <button class="btn" onclick="addRoomPrompt()">➕ Новая комната</button>
      <button class="btn" onclick="openAddChartModal()">📈 График</button>
    `;
  } else {
    box.innerHTML = `
      <button class="btn gray" onclick="openMainPlan()">← Назад к общему</button>
      <label class="btn gray" style="cursor:pointer;">
        📁 Загрузить план комнаты
        <input type="file" accept="image/*" style="display:none"
               onchange="uploadRoomPlan(this, '${currentRoomId}')">
      </label>
      <button class="btn danger" onclick="deleteRoomPlan('${currentRoomId}')">🗑️ Удалить план</button>
      <button class="btn" onclick="openAddChartModal()">📈 График</button>
    `;
  }
}
function renderRoomsChips() {
  const box = document.getElementById('rooms-chips');
  if (!roomsCache.length) {
    box.innerHTML = '<span style="opacity:.7">Комнат пока нет</span>';
    return;
  }
  box.innerHTML = roomsCache.map(r => `
    <span class="chip ${currentRoomId === r.id ? 'on' : ''}" onclick="openRoomPlan('${r.id}')">
      ${r.icon || '🏠'} ${esc(r.name)}
      ${currentMode === 'edit' ? `<span onclick="event.stopPropagation(); renameRoom('${r.id}')" style="margin-left:.3rem;opacity:.7">✎</span>
      <span onclick="event.stopPropagation(); removeRoom('${r.id}')" style="margin-left:.3rem;opacity:.7">✕</span>` : ''}
    </span>
  `).join('');
}
function renderChipsForCurrentPlan() {
  const box = document.getElementById('plan-chips');
  const titleEl = document.getElementById('plan-devices-title');
  let list;
  if (currentRoomId) {
    list = devicesCache.filter(d => d.room_id === currentRoomId);
    const r = roomsCache.find(x => x.id === currentRoomId);
    titleEl.textContent = 'Устройства комнаты: ' + (r ? r.name : '');
  } else {
    list = devicesCache;
    titleEl.textContent = 'Все устройства';
  }
  if (!list.length) { box.innerHTML = '<span style="opacity:.7">Нет устройств</span>'; return; }
  box.innerHTML = list.map(d => {
    const meta = TYPES[d.type] || { icon: '❓' };
    const onPlan = !!d.on_plan;
    const val = pinValue(d);
    const valHtml = val
      ? `<small style="margin-left:.4rem; padding:1px 6px; border-radius:6px;
          background:rgba(255,255,255,.12); font-size:.75rem;">${esc(val.text)}</small>`
      : '';
    return `<span class="chip ${onPlan ? 'on' : ''}" onclick="toggleOnPlan('${d.id}', ${!onPlan})">
      ${meta.icon} ${esc(d.name)} ${valHtml} <small>${esc(d.room || '')}</small>
    </span>`;
  }).join('');
}
function openMainPlan() { destroyAllPlanCharts(); currentRoomId = null; renderPlanView(); }
function openRoomPlan(rid) { destroyAllPlanCharts(); currentRoomId = rid; renderPlanView(); }

function renderMainPlan() {
  const wrap = document.getElementById('plan-main-wrap');
  if (!planMainImage) {
    wrap.innerHTML = '<div class="plan-empty">Общий план не загружен.' +
      '<small>Переключитесь в режим редактирования, чтобы загрузить изображение.</small></div>';
    return;
  }
  let img = wrap.querySelector('img[data-plan-img]');
  if (!img || img.src !== planMainImage) {
    wrap.innerHTML = '';
    img = document.createElement('img');
    img.dataset.planImg = '1';
    img.src = planMainImage;
    wrap.appendChild(img);
  }
  wrap.querySelectorAll('.room-zone').forEach(z => z.remove());
  roomsCache.forEach(r => wrap.appendChild(makeRoomZone(r, wrap)));
  wrap.querySelectorAll('.pin').forEach(p => p.remove());
  loadPlanCharts().then(() => renderPlanCharts(wrap));
}

function makeRoomZone(r, wrap) {
  const isEdit = (currentMode === 'edit');
  const zone = document.createElement('div');
  zone.className = 'room-zone' + (isEdit ? ' editable' : ' invisible');
  zone.style.left   = r.x + '%';
  zone.style.top    = r.y + '%';
  zone.style.width  = r.w + '%';
  zone.style.height = r.h + '%';

  if (isEdit) {
    zone.style.background = hexToRgba(r.color || '#4caf50', 0.25);
    zone.style.borderColor = r.color || '#4caf50';
    zone.innerHTML = `
      <span class="room-label">${r.icon ? r.icon + ' ' : ''}${esc(r.name)}</span>
      <button class="room-remove" title="Удалить"
        onclick="event.stopPropagation(); removeRoom('${r.id}')">✕</button>
      <div class="room-resize" title="Потянуть для изменения размера"></div>
    `;
  } else {
    zone.innerHTML = '';
  }

  let dragging = false;
  let moved = false;
  let startX = 0, startY = 0, origX = 0, origY = 0;
  let moveHandler = null;
  let upHandler = null;

  function onMouseDown(e) {
    if (e.target.classList.contains('room-resize')) return;
    if (e.target.classList.contains('room-remove')) return;
    noteInteraction();
    dragging = true;
    moved = false;
    startX = e.clientX; startY = e.clientY;
    origX = parseFloat(r.x) || 0;
    origY = parseFloat(r.y) || 0;
    zone.classList.add('dragging');
    e.preventDefault();

    moveHandler = (ev) => {
      if (!dragging) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      const rect = wrap.getBoundingClientRect();
      const ddx = (dx / rect.width)  * 100;
      const ddy = (dy / rect.height) * 100;
      r.x = Math.max(0, Math.min(100 - r.w, origX + ddx));
      r.y = Math.max(0, Math.min(100 - r.h, origY + ddy));
      zone.style.left = r.x + '%';
      zone.style.top  = r.y + '%';
    };

    upHandler = async () => {
      if (!dragging) return;
      dragging = false;
      zone.classList.remove('dragging');
      document.removeEventListener('mousemove', moveHandler);
      document.removeEventListener('mouseup', upHandler);
      moveHandler = null;
      upHandler = null;
      if (moved) {
        zone.dataset.justDragged = '1';
        await api('/api/rooms/' + r.id, 'POST', { x: r.x, y: r.y });
        refresh();
        setTimeout(() => { delete zone.dataset.justDragged; }, 0);
      }
    };

    document.addEventListener('mousemove', moveHandler);
    document.addEventListener('mouseup', upHandler);
  }

  if (isEdit) {
    zone.addEventListener('mousedown', onMouseDown);
  }

  const resize = zone.querySelector('.room-resize');
  if (resize) {
    let resizing = false, sx = 0, sy = 0, ow = 0, oh = 0;
    let rMove = null, rUp = null;
    resize.addEventListener('mousedown', e => {
      e.stopPropagation();
      e.preventDefault();
      resizing = true;
      sx = e.clientX; sy = e.clientY;
      ow = parseFloat(r.w) || 0;
      oh = parseFloat(r.h) || 0;

      rMove = (ev) => {
        if (!resizing) return;
        const rect = wrap.getBoundingClientRect();
        const dw = ((ev.clientX - sx) / rect.width)  * 100;
        const dh = ((ev.clientY - sy) / rect.height) * 100;
        r.w = Math.max(3, Math.min(100 - r.x, ow + dw));
        r.h = Math.max(3, Math.min(100 - r.y, oh + dh));
        zone.style.width  = r.w + '%';
        zone.style.height = r.h + '%';
      };

      rUp = async () => {
        if (!resizing) return;
        resizing = false;
        document.removeEventListener('mousemove', rMove);
        document.removeEventListener('mouseup', rUp);
        rMove = null; rUp = null;
        await api('/api/rooms/' + r.id, 'POST', { w: r.w, h: r.h });
        refresh();
      };

      document.addEventListener('mousemove', rMove);
      document.addEventListener('mouseup', rUp);
    });
  }

  zone.addEventListener('mousedown', noteInteraction);
  zone.addEventListener('touchstart', noteInteraction, { passive: true });

  zone.addEventListener('click', e => {
    if (zone.dataset.justDragged === '1') {
      e.stopPropagation();
      return;
    }
    if (e.target.classList.contains('room-remove')) return;
    if (e.target.classList.contains('room-resize')) return;
    noteInteraction();
    openRoomPlan(r.id);
  });

  return zone;
}

function renderRoomPlan(rid) {
  const wrap = document.getElementById('plan-room-wrap');
  const image = planRoomImages[rid] && planRoomImages[rid].image;
  if (!image) { wrap.innerHTML = '…'; return; }

  let img = wrap.querySelector('img[data-plan-img]');
  if (!img) {
    wrap.innerHTML = '';
    img = document.createElement('img');
    img.dataset.planImg = '1';
    wrap.appendChild(img);
  }
  if (img.src !== image) img.src = image;

  const visibleIds = new Set(
    devicesCache
      .filter(d => {
        if (!d.on_plan) return false;
        const inThisRoom = (d.room_id === rid) ||
                           (Array.isArray(d.extra_rooms) && d.extra_rooms.includes(rid));
        return inThisRoom;
      })
      .map(d => d.id)
  );

  wrap.querySelectorAll('.pin').forEach(p => {
    if (!visibleIds.has(p.dataset.id)) p.remove();
  });

  devicesCache
    .filter(d => visibleIds.has(d.id))
    .forEach(d => {
      let pin = wrap.querySelector(`.pin[data-id="${d.id}"]`);
      if (!pin) {
        pin = makePin(d, wrap);
        wrap.appendChild(pin);
        return;
      }
      pin.className = 'pin ' + stateClass(d);
      const pos = getDevicePos(d);
      pin.style.left = pos.x + '%';
      pin.style.top  = pos.y + '%';

      const val = pinValue(d);
      const oldVal = pin.querySelector('.val');
      if (val) {
        if (oldVal) { oldVal.className = 'val ' + val.cls; oldVal.textContent = val.text; }
        else {
          const s = document.createElement('span');
          s.className = 'val ' + val.cls;
          s.textContent = val.text;
          pin.appendChild(s);
        }
      } else if (oldVal) {
        oldVal.remove();
      }
    });
  loadPlanCharts().then(() => renderPlanCharts(wrap));
  renderPlanCharts(wrap);
}

function makePin(d, parentWrap) {
  const icon = pickDeviceIcon(d);
  const pin = document.createElement('div');
  pin.className = 'pin ' + stateClass(d);
  const pos = getDevicePos(d);
  pin.style.left = pos.x + '%';
  pin.style.top  = pos.y + '%';
  pin.dataset.id = d.id;

  const val = pinValue(d);
  pin.innerHTML =
    `<span>${icon}</span>` +
    `<span class="label">${esc(d.name)}</span>` +
    (val ? `<span class="val ${val.cls}">${esc(val.text)}</span>` : '');

  let dragging = false;
  let moveHandler = null, upHandler = null;

  pin.addEventListener('mousedown', (e) => {
    e.preventDefault();
    noteInteraction();
    dragging = true;
    pin.classList.add('dragging');
    delete pin.dataset.nx; delete pin.dataset.ny;

    moveHandler = (ev) => {
      if (!dragging) return;
      const rect = parentWrap.getBoundingClientRect();
      const x = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
      pin.style.left = x + '%'; pin.style.top = y + '%';
      pin.dataset.nx = x; pin.dataset.ny = y;
    };
    upHandler = async () => {
      if (!dragging) return;
      dragging = false;
      pin.classList.remove('dragging');
      document.removeEventListener('mousemove', moveHandler);
      document.removeEventListener('mouseup', upHandler);

      const x = parseFloat(pin.dataset.nx);
      const y = parseFloat(pin.dataset.ny);
      if (!isNaN(x) && !isNaN(y) && currentMode === 'edit') {
        await saveDevicePos(d.id, x, y);
        refresh();
      } else {
        openDeviceModal(d.id);
      }
    };
    document.addEventListener('mousemove', moveHandler);
    document.addEventListener('mouseup', upHandler);
  });
  pin.addEventListener('touchstart', noteInteraction, { passive: true });
  return pin;
}

/* --- Рендер плана в user-режиме (просмотр) --- */
function renderViewUI() {
  if (currentMode !== 'user') return;
  if (currentViewView === 'rooms')      renderViewRooms();
  else if (currentViewView === 'plan')  renderViewPlan();
  else if (currentViewView === 'all')   renderViewAllDevices();
}

function renderViewRooms() {
  const box = document.getElementById('view-rooms-grid');
  if (!box) return;
  const cards = roomsCache.map(r => {
    const devices = devicesCache.filter(d => d.room_id === r.id);
    const preview = devices.slice(0, 5).map(d => TYPES[d.type]?.icon || '❓').join(' ');
    const more = devices.length > 5 ? ` +${devices.length - 5}` : '';
    return `
      <div class="room-card" onclick="openViewRoom('${r.id}')">
        <div class="r-icon">${r.icon || '🏠'}</div>
        <div class="r-name">${esc(r.name)}</div>
        <div class="r-count">${devices.length} устройств${devices.length === 1 ? 'о' : ''}</div>
        <div class="r-preview">${preview}${more}</div>
        <div class="r-arrow">→</div>
      </div>`;
  });
  const withoutRoom = devicesCache.filter(d => !d.room_id);
  if (withoutRoom.length) {
    const preview = withoutRoom.slice(0, 5).map(d => TYPES[d.type]?.icon || '❓').join(' ');
    const more = withoutRoom.length > 5 ? ` +${withoutRoom.length - 5}` : '';
    cards.push(`
      <div class="room-card no-room" onclick="openViewRoom('')">
        <div class="r-icon">📦</div>
        <div class="r-name">Без комнаты</div>
        <div class="r-count">${withoutRoom.length} устройств</div>
        <div class="r-preview">${preview}${more}</div>
        <div class="r-arrow">→</div>
      </div>`);
  }
  box.innerHTML = cards.length ? cards.join('') : '<div class="empty">Комнат пока нет</div>';
}

function switchViewView(v) {
  currentViewView = v;
  ['rooms','plan','all'].forEach(k => {
    const t = document.getElementById('vtab-' + k);
    if (t) t.classList.toggle('active', k === v);
    const el = document.getElementById('view-' + k + '-view');
    if (el) el.style.display = (k === v) ? 'block' : 'none';
  });
  if (v === 'plan') {
    renderViewUI();
    loadPlanImages().then(() => { renderViewUI(); });
  } else {
    renderViewUI();
  }
}

function openViewRoom(rid) {
  viewRoomId = rid;
  switchViewView('plan');
}

function renderViewPlan() {
  renderViewPlanBreadcrumb();
  const mainWrap = document.getElementById('view-plan-main-wrap');
  const roomWrap = document.getElementById('view-plan-room-wrap');
  if (!mainWrap || !roomWrap) return;
  if (viewRoomId === null) {
    mainWrap.style.display = 'block';
    roomWrap.style.display = 'none';
    renderViewMainPlan();
  } else {
    mainWrap.style.display = 'none';
    roomWrap.style.display = 'block';
    renderViewRoomPlan(viewRoomId);
  }
}

function renderViewPlanBreadcrumb() {
  const box = document.getElementById('view-plan-breadcrumb');
  if (!box) return;
  const parts = [];
  const mainActive = (viewRoomId === null);
  parts.push(`<span class="crumb ${mainActive ? 'active' : ''}"
    onclick="${mainActive ? '' : 'openViewMainPlan()'}">Общий план</span>`);
  if (viewRoomId !== null) {
    parts.push('<span class="sep">›</span>');
    if (viewRoomId === '') {
      parts.push(`<span class="crumb active">📦 Без комнаты</span>`);
    } else {
      const r = roomsCache.find(x => x.id === viewRoomId);
      parts.push(`<span class="crumb active">${r && r.icon ? r.icon + ' ' : ''}${esc(r ? r.name : '—')}</span>`);
    }
  }
  box.innerHTML = parts.join('');
}

function openViewMainPlan() { viewRoomId = null; renderViewPlan(); }

function renderViewMainPlan() {
  const wrap = document.getElementById('view-plan-main-wrap');
  if (!wrap) return;
  if (!planMainImage) {
    wrap.innerHTML = '<div class="plan-empty">Общий план не загружен</div>';
    return;
  }
  wrap.innerHTML = `<img src="${planMainImage}" alt="Общий план">`;
  roomsCache.forEach(r => wrap.appendChild(makeViewRoomZone(r)));
  loadPlanCharts().then(() => renderPlanCharts(wrap));
}

function makeViewRoomZone(r) {
  const zone = document.createElement('div');
  zone.className = 'room-zone invisible';
  zone.style.left   = r.x + '%';
  zone.style.top    = r.y + '%';
  zone.style.width  = r.w + '%';
  zone.style.height = r.h + '%';
  zone.title = (r.icon ? r.icon + ' ' : '') + r.name;
  zone.innerHTML = '';
  zone.addEventListener('mousedown', () => { noteInteraction(); openViewRoom(r.id); });
  zone.addEventListener('touchstart', () => { noteInteraction(); openViewRoom(r.id); }, { passive: true });
  zone.addEventListener('click', () => { noteInteraction(); openViewRoom(r.id); });
  return zone;
}

function renderViewRoomPlan(rid) {
  const wrap = document.getElementById('view-plan-room-wrap');
  if (!wrap) return;
  const image = rid ? (planRoomImages[rid] && planRoomImages[rid].image) : null;

  if (!rid) {
    wrap.innerHTML = '<div class="plan-empty">Комната «Без комнаты» не имеет картинки' +
      '<small>Список устройств ниже</small></div>';
    const list = devicesCache.filter(d => !d.room_id);
    if (!list.length) return;
    const box = document.createElement('div');
    box.style.cssText = 'display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center;padding:1rem;';
    box.innerHTML = list.map(d => {
      const meta = TYPES[d.type] || { icon: '❓' };
      const val = pinValue(d);
      const valHtml = val
        ? `<small style="margin-left:.4rem; padding:1px 6px; border-radius:6px;
            background:rgba(255,255,255,.12); font-size:.75rem;">${esc(val.text)}</small>`
        : '';
      const icon = pickDeviceIcon(d);
      return `<span class="chip" onclick="openDeviceModal('${d.id}')">${icon} ${esc(d.name)} ${valHtml}</span>`;
    }).join('');
    wrap.appendChild(box);
    loadPlanCharts().then(() => renderPlanCharts(wrap));
    return;
  }

  if (!image) {
    wrap.innerHTML = '<div class="plan-empty">План комнаты не загружен</div>';
    return;
  }

  let img = wrap.querySelector('img[data-plan-img]');
  if (!img) {
    wrap.innerHTML = '';
    img = document.createElement('img');
    img.dataset.planImg = '1';
    wrap.appendChild(img);
  }
  if (img.src !== image) img.src = image;

  const visibleIds = new Set(
    devicesCache
      .filter(d => {
        if (!d.on_plan) return false;
        return (d.room_id === rid)
            || (Array.isArray(d.extra_rooms) && d.extra_rooms.includes(rid));
      })
      .map(d => d.id)
  );

  wrap.querySelectorAll('.pin').forEach(p => {
    if (!visibleIds.has(p.dataset.id)) p.remove();
  });

  devicesCache
    .filter(d => visibleIds.has(d.id))
    .forEach(d => {
      let pin = wrap.querySelector(`.pin[data-id="${d.id}"]`);
      if (!pin) {
        pin = makeViewPin(d);
        wrap.appendChild(pin);
        return;
      }
      pin.className = 'pin ' + stateClass(d);
      const pos = getDevicePos(d);
      pin.style.left = pos.x + '%';
      pin.style.top  = pos.y + '%';

      const val = pinValue(d);
      const oldVal = pin.querySelector('.val');
      if (val) {
        if (oldVal) { oldVal.className = 'val ' + val.cls; oldVal.textContent = val.text; }
        else {
          const s = document.createElement('span');
          s.className = 'val ' + val.cls;
          s.textContent = val.text;
          pin.appendChild(s);
        }
      } else if (oldVal) oldVal.remove();
    });
  loadPlanCharts().then(() => renderPlanCharts(wrap));
}

function makeViewPin(d) {
  const icon = pickDeviceIcon(d);
  const pin = document.createElement('div');
  pin.className = 'pin ' + stateClass(d);
  const pos = getDevicePos(d);
  pin.style.left = pos.x + '%';
  pin.style.top  = pos.y + '%';
  pin.dataset.id = d.id;
  const val = pinValue(d);
  pin.innerHTML =
    `<span>${icon}</span>` +
    `<span class="label">${esc(d.name)}</span>` +
    (val ? `<span class="val ${val.cls}">${esc(val.text)}</span>` : '');
  pin.addEventListener('mousedown', () => { noteInteraction(); openDeviceModal(d.id); });
  pin.addEventListener('touchstart', () => { noteInteraction(); openDeviceModal(d.id); }, { passive: true });
  pin.addEventListener('click', () => { noteInteraction(); openDeviceModal(d.id); });
  return pin;
}

function renderViewAllDevices() {
  const box = document.getElementById('view-all-grid');
  if (!box) return;
  box.innerHTML = devicesCache.length
    ? devicesCache.map(renderViewCard).join('')
    : '<div class="empty">Нет устройств</div>';
}