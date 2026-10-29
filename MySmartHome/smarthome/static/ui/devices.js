/* ============================================================
   Карточка устройства (режим «Плитка» / модалка)
   ============================================================ */

const HANDLED_FIELDS = {
  thermostat:   ['current', 'target', 'mode'],
  climate:      ['temp', 'humidity'],
  door:         ['open'],
  leak:         ['leak'],
  motion:       ['motion'],
  light:        ['on', 'brightness'],
  light_switch: ['on'],
  curtain:      ['open', 'position'],
  fan:          ['on', 'speed'],
  button:       ['pressed'],
  text:         ['text', 'width'],
};

/* ============================================================
   Модальное окно устройства
   ============================================================ */
function openDeviceModal(id) {
  const d = devicesCache.find(x => x.id === id);
  if (!d) return;
  _modalDeviceId = id;
  const body = document.getElementById('modal-body');
  body.innerHTML = renderCard(d);
  restoreDetails();
  document.getElementById('modal-overlay').classList.add('open');
  document.addEventListener('keydown', _modalEscHandler, { once: true });
}

function closeDeviceModal() {
  _modalDeviceId = null;
  document.getElementById('modal-overlay').classList.remove('open');
  document.getElementById('modal-body').innerHTML = '';
}

function _modalEscHandler(e) {
  if (e.key === 'Escape') closeDeviceModal();
}

function refreshDeviceModal() {
  if (!_modalDeviceId) return;
  const body = document.getElementById('modal-body');
  if (!body) return;

  const ae = document.activeElement;

  if (ae && body.contains(ae) &&
      (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) {
    return;
  }
  if (ae && ae.tagName === 'INPUT' && ae.type === 'range' && body.contains(ae)) {
    return;
  }
  if (body.querySelector('.card[data-id] details[open] input:focus, ' +
                         '.card[data-id] details[open] textarea:focus, ' +
                         '.card[data-id] details[open] select:focus')) {
    return;
  }

  const d = devicesCache.find(x => x.id === _modalDeviceId);
  if (!d) { closeDeviceModal(); return; }
  withDetailsPreserved(() => { body.innerHTML = renderCard(d); });
}

/* Точечное обновление .value/.sub в открытой модалке */
function updateLiveFieldsInModal() {
  if (!_modalDeviceId) return;
  const body = document.getElementById('modal-body');
  if (!body) return;
  const d = devicesCache.find(x => x.id === _modalDeviceId);
  if (!d) return;

  const ae = document.activeElement;
  if (ae && ae.tagName === 'INPUT' && ae.type === 'range' && body.contains(ae)) return;

  const valueEl = body.querySelector('.card[data-id] .value');
  const subEl   = body.querySelector('.card[data-id] .sub');

  const tmp = document.createElement('div');
  tmp.innerHTML = renderCard(d);
  const newValue = tmp.querySelector('.value');
  const newSub   = tmp.querySelector('.sub');

  if (valueEl && newValue && valueEl.innerHTML !== newValue.innerHTML) {
    valueEl.innerHTML = newValue.innerHTML;
  }
  if (subEl && newSub && subEl.innerHTML !== newSub.innerHTML) {
    subEl.innerHTML = newSub.innerHTML;
  }
}

function renderCard(d) {
  const meta = TYPES[d.type] || { icon: '❓', label: d.type };
  const s = d.state || {};
  let value = '', sub = '', controls = '';

  if (d.type === 'thermostat') {
    value = `${(+s.current).toFixed(1)} °C`;
    sub = `Цель: ${(+s.target).toFixed(1)} °C • ${s.mode === 'heat' ? 'нагрев' : 'охлаждение'}`;
    controls = `
      <input type="range" min="10" max="30" step="0.5" value="${s.target}"
        data-key="target-range"
        oninput="this.nextElementSibling.querySelector('span').textContent = parseFloat(this.value).toFixed(1) + ' °C'; this.dataset.dirty='1'"
        onchange="if (this.dataset.dirty) { delete this.dataset.dirty; setState('${d.id}', {target: parseFloat(this.value)}) }">
      <div style="font-size:.85rem; opacity:.8; margin-top:.3rem;">Новая цель: <span>${(+s.target).toFixed(1)} °C</span></div>
      <div class="controls">
        <button class="${s.mode === 'heat' ? 'on' : 'off'}" onclick="setState('${d.id}', {mode:'heat'})">🔥 Нагрев</button>
        <button class="${s.mode === 'cool' ? 'on' : 'off'}" onclick="setState('${d.id}', {mode:'cool'})">❄️ Охлажд.</button>
      </div>`;
  } else if (d.type === 'climate') {
    value = `${(+s.temp).toFixed(1)} °C`;
    sub = `Влажность: ${(+s.humidity).toFixed(0)} %`;
  } else if (d.type === 'door') {
    const open = toBool(s.open);
    value = open ? 'Открыто' : 'Закрыто';
    sub = open ? '<span class="badge warn">Открыто</span>' : '<span class="badge ok">Закрыто</span>';
  } else if (d.type === 'leak') {
    const leak = toBool(s.leak);
    value = leak ? 'ПРОТЕЧКА!' : 'Сухо';
    sub = leak ? '<span class="badge alert">⚠️ Протечка</span>' : '<span class="badge ok">Норма</span>';
    controls = `<div class="controls"><button class="${leak ? 'on' : 'off'}" onclick="setState('${d.id}', {leak: ${!leak}})">${leak ? 'Сбросить' : 'Симулировать'}</button></div>`;
  } else if (d.type === 'motion') {
    const motion = toBool(s.motion);
    value = motion ? 'Движение' : 'Тихо';
    sub = motion ? '<span class="badge warn">👤 Движение</span>' : '<span class="badge ok">Нет движения</span>';
    controls = `<div class="controls"><button class="${motion ? 'on' : 'off'}" onclick="setState('${d.id}', {motion: ${!motion}})">${motion ? 'Сбросить' : 'Симулировать'}</button></div>`;
  } else if (d.type === 'light') {
    const on = toBool(s.on);
    value = on ? `Вкл • ${s.brightness}%` : 'Выкл';
    sub = on ? '<span class="badge ok">Включён</span>' : '<span class="badge off">Выключен</span>';
    controls = `
      <input type="range" min="0" max="100" value="${s.brightness}"
        data-key="brightness-range"
        oninput="this.nextElementSibling.querySelector('span').textContent = this.value + ' %'; this.dataset.dirty='1'"
        onchange="if (this.dataset.dirty) { delete this.dataset.dirty; setState('${d.id}', {brightness: parseInt(this.value)}) }">
      <div style="font-size:.85rem; opacity:.8; margin-top:.3rem;">Яркость: <span>${s.brightness} %</span></div>
      <div class="controls"><button class="${on ? 'on' : 'off'}" onclick="setState('${d.id}', {on: ${!on}})">${on ? 'Выключить' : 'Включить'}</button></div>`;
  } else if (d.type === 'light_switch') {
    const on = toBool(s.on);
    value = on ? 'Включён' : 'Выключен';
    sub = on ? '<span class="badge ok">Включён</span>' : '<span class="badge off">Выключен</span>';
    controls = `<div class="controls"><button class="${on ? 'on' : 'off'}" onclick="setState('${d.id}', {on: ${!on}})">${on ? 'Выключить' : 'Включить'}</button></div>`;
  } else if (d.type === 'curtain') {
    const open = toBool(s.open);
    const pos  = Math.max(0, Math.min(100, parseInt(s.position) || 0));
    value = open ? `Открыто на ${pos}%` : 'Закрыто';
    sub = open ? `<span class="badge ok">Открыто</span> <span style="opacity:.7">позиция: ${pos}%</span>` : '<span class="badge off">Закрыто</span>';
    controls = `
      <input type="range" min="0" max="100" value="${pos}"
        data-key="position-range"
        oninput="this.nextElementSibling.querySelector('span').textContent = this.value + ' %'; this.dataset.dirty='1'"
        onchange="if (this.dataset.dirty) { delete this.dataset.dirty; setState('${d.id}', {position: parseInt(this.value), open: parseInt(this.value) > 0}) }">
      <div style="font-size:.85rem; opacity:.8; margin-top:.3rem;">Позиция: <span>${pos} %</span></div>
      <div class="controls">
        <button class="${open ? 'on' : 'off'}" onclick="setState('${d.id}', {open: true, position: 100})">Открыть</button>
        <button class="${!open ? 'on' : 'off'}" onclick="setState('${d.id}', {open: false, position: 0})">Закрыть</button>
      </div>`;
  } else if (d.type === 'fan') {
    const on = toBool(s.on);
    const sp = Math.max(0, Math.min(3, parseInt(s.speed) || 0));
    value = on ? `Вкл • скорость ${sp}` : 'Выкл';
    sub = on ? `<span class="badge ok">Включён</span>` : `<span class="badge off">Выключен</span>`;
    controls = `
      <input type="range" min="0" max="3" step="1" value="${sp}"
        data-key="speed-range"
        oninput="this.nextElementSibling.querySelector('span').textContent = this.value; this.dataset.dirty='1'"
        onchange="if (this.dataset.dirty) { delete this.dataset.dirty; setState('${d.id}', {speed: parseInt(this.value), on: parseInt(this.value) > 0}) }">
      <div style="font-size:.85rem; opacity:.8; margin-top:.3rem;">Скорость: <span>${sp}</span> (0 — выкл)</div>
      <div class="controls"><button class="${on ? 'on' : 'off'}" onclick="setState('${d.id}', {on: ${!on}, speed: ${on ? 0 : 1}})">${on ? 'Выключить' : 'Включить'}</button></div>`;
  } else if (d.type === 'button') {
    const pressed = toBool(s.pressed);
    value = pressed ? 'Нажата' : 'Отпущена';
    sub = pressed ? '<span class="badge warn">⏺ нажата</span>' : '<span class="badge ok">не нажата</span>';
    controls = `<div class="controls"><button class="${pressed ? 'on' : 'off'}" onclick="pressButton('${d.id}')">▶ Нажать</button></div>`;
  } else if (d.type === 'text') {
    const txt = String(s.text ?? '');
    const w = Math.max(1, Math.min(200, parseInt(s.width) || 40));
    value = txt ? esc(txt.slice(0, w)) : '— пусто —';
    sub = `Макс. длина строки: ${w} симв.`;
    controls = `
      <div class="controls" style="flex-direction:column; align-items:stretch; gap:.4rem;">
        <textarea data-key="text-value" maxlength="${w}"
          oninput="this.dataset.dirty='1'"
          onchange="if (this.dataset.dirty) { delete this.dataset.dirty; setState('${d.id}', {text: this.value}) }"
          style="min-height:60px; resize:vertical;"
          placeholder="Введите текст…">${esc(txt)}</textarea>
        <div style="font-size:.85rem; opacity:.8;">Длина: <span>${txt.length}</span> / ${w}</div>
      </div>`;
  }

  // Кастомные поля
  let customFieldsHtml = '';
  {
    const meta2 = window.TYPES[d.type] || {};
    if (meta2.custom && meta2.raw && Array.isArray(meta2.raw.fields)) {
      const parts = [];
      for (const f of meta2.raw.fields) {
        if (!f.name) continue;
        const v = d.state ? d.state[f.name] : undefined;
        parts.push(renderCustomField(d, f, v));
      }
      if (parts.length) {
        customFieldsHtml = `<div class="cf-fields" style="margin-top:.5rem;">${parts.join('')}</div>`;
      }
    }
  }

  // Z2M поля
  function z2mToOur(d, z2mName) {
    const dtype = (d.type || '').toLowerCase();
    const common = {
      'temperature': 'temp', 'humidity': 'humidity', 'pressure': 'pressure',
      'battery': 'battery', 'voltage': 'voltage', 'linkquality': 'linkquality',
      'illuminance': 'illuminance', 'occupancy': 'motion', 'water_leak': 'leak',
      'current_heating_setpoint': 'target', 'local_temperature': 'current',
      'system_mode': 'mode', 'brightness': 'brightness', 'position': 'position',
    };
    if (z2mName in common) return common[z2mName];
    if (z2mName === 'state') return dtype === 'curtain' ? 'open' : 'on';
    if (z2mName === 'contact') return 'open';
    return z2mName;
  }

  let z2mFieldsHtml = '';
  if (currentMode === 'edit' && d.z2m_name) {
    const fields = z2mFieldsCache[d.id] || [];
    if (fields.length) {
      const rows = fields.map(f => {
        const ourField = z2mToOur(d, f.name);
        const cur = ourField && (ourField in (d.state || {}))
          ? d.state[ourField]
          : f.current_value;
        const curText = (cur === undefined || cur === null)
          ? '<span style="opacity:.5;">—</span>'
          : `<span style="font-weight:600;">${esc(String(cur))}</span>`;
        const access = f.access === 1 ? 'ro' : f.access === 2 ? 'wo' : f.access === 3 ? 'rw' : '';
        const unit = f.unit ? ' ' + esc(f.unit) : '';
        const range = (f.value_min !== undefined && f.value_max !== undefined)
          ? ` <small style="opacity:.6;">${f.value_min}…${f.value_max}</small>` : '';
        const vals = Array.isArray(f.values) && f.values.length
          ? ` <small style="opacity:.6;">[${f.values.map(esc).join(', ')}]</small>` : '';
        return `
          <div style="display:flex;justify-content:space-between;gap:.5rem;
                      font-size:.8rem;padding:.15rem 0;border-bottom:1px solid rgba(255,255,255,.06);">
            <span style="font-family:monospace;opacity:.85;">${esc(f.name)}</span>
            <span style="text-align:right;">
              ${curText}${unit}
              ${access ? `<small style="opacity:.55;"> ${access}</small>` : ''}
              ${range}${vals}
            </span>
          </div>`;
      }).join('');
      z2mFieldsHtml = `
        <details style="margin-top:.6rem; font-size:.8rem;" open>
          <summary style="cursor:pointer; user-select:none; opacity:.85;">🐝 Zigbee2MQTT: ${fields.length} полей</summary>
          <div style="margin-top:.35rem; max-height:280px; overflow-y:auto;">${rows}</div>
        </details>`;
    } else {
      z2mFieldsHtml = `
        <details style="margin-top:.6rem; font-size:.8rem;">
          <summary style="cursor:pointer; user-select:none; opacity:.7;">🐝 Zigbee2MQTT: поля не загружены</summary>
          <div style="margin-top:.35rem; opacity:.7; font-size:.75rem;">
            Устройство привязано к Z2M, но список полей пока пуст.
            <div style="margin-top:.4rem;">
              <button class="btn small gray" onclick="refreshZ2MFields('${d.id}')">🔄 Загрузить поля</button>
            </div>
          </div>
        </details>`;
    }
  }

  const roomOptions = roomsCache.map(r =>
    `<option value="${r.id}" ${d.room_id === r.id ? 'selected' : ''}>${r.icon ? r.icon + ' ' : ''}${esc(r.name)}</option>`
  ).join('');

  const cardHtml = `
    <div class="card" data-id="${d.id}">
      <div class="top">
        <div class="icon">${pickDeviceIcon(d)}</div>
        ${currentMode === 'edit' ? `<button class="remove" title="Удалить" onclick="removeDevice('${d.id}')">✕</button>` : ''}
      </div>
      ${deviceHasLogs(d) ? `
        <div style="margin:.2rem 0 .4rem;">
          <button class="btn small gray"
            onclick="event.stopPropagation(); openChartForDevice('${d.id}')"
            title="Открыть график">📊 График</button>
        </div>` : ''}
      <div class="name">
        ${esc(d.name)}
        ${currentMode === 'edit' ? `<span class="edit-name" title="Переименовать"
          onclick="renameDevice('${d.id}')" style="cursor:pointer;opacity:.6;margin-left:.3rem;">✎</span>` : ''}
      </div>
      <div class="room">
        <span style="font-family:monospace; font-size:.8rem; background:rgba(0,0,0,0.3); padding:1px 6px; border-radius:6px; cursor:pointer;"
              onclick="navigator.clipboard.writeText('${d.id}'); this.textContent='скопировано'; setTimeout(()=>this.textContent='${d.id}', 1000);"
              title="Клик — скопировать ID">${esc(d.id)}</span>
        ${d.room ? `<span style="margin-left:.4rem;">${esc(d.room)}</span>` : ''}
        ${d.on_plan ? `<span style="margin-left:.4rem;">📍</span>` : ''}
        ${(d.extra_rooms && d.extra_rooms.length) ? `<span style="margin-left:.4rem; opacity:.7; font-size:.8rem;">+${d.extra_rooms.length}</span>` : ''}
      </div>

      ${(() => {
        const drivers = deviceDrivers(d);
        if (!drivers.length) return '';
        return `<div class="card-drivers">
          ${drivers.map(x => `<span class="drv ${x.id}" title="${esc(x.title)}">${esc(x.label)}</span>`).join('')}
        </div>`;
      })()}

      <div class="value">${value}</div>
      <div class="sub">${sub}</div>

      ${customFieldsHtml}
      ${z2mFieldsHtml}

      ${currentMode === 'edit' ? `
        <details style="margin-top:.6rem; font-size:.8rem;">
          <summary style="cursor:pointer; user-select:none;">🎨 Иконка по значению (${(d.icon_rules || []).length})</summary>
          <div id="icon-rules-${d.id}" style="margin-top:.4rem;display:flex;flex-direction:column;gap:.3rem;">
            ${renderIconRulesEditor(d)}
          </div>
          <div style="margin-top:.4rem;display:flex;gap:.4rem;">
            <button class="btn small gray" onclick="addIconRule('${d.id}')">➕ Правило</button>
            <button class="btn small green" onclick="saveIconRules('${d.id}')">💾 Сохранить</button>
          </div>
        </details>` : ''}

      ${(window.TYPES[d.type] && window.TYPES[d.type].custom) ? '' : renderGenericFields(d)}
      ${controls}

      ${currentMode === 'edit' ? `
        <div style="margin-top:.5rem; font-size:.85rem;">
          Комната:
          <select onchange="setDeviceRoom('${d.id}', this.value)" style="margin-left:.3rem;">
            <option value="">— без комнаты —</option>
            ${roomOptions}
          </select>
        </div>
        <div style="margin-top:.5rem; font-size:.8rem;">
          <div style="opacity:.8; margin-bottom:.3rem;">Показывать также на планах:</div>
          ${roomsCache.map(r => `
            <label style="display:inline-flex; align-items:center; gap:.25rem; margin-right:.5rem; margin-bottom:.25rem;">
              <input type="checkbox"
                ${(d.extra_rooms || []).includes(r.id) ? 'checked' : ''}
                onchange="toggleExtraRoom('${d.id}', '${r.id}', this.checked)">
              ${r.icon ? r.icon + ' ' : ''}${esc(r.name)}
            </label>`).join('')}
        </div>` : ''}

      ${currentMode === 'edit' ? `
        <details style="margin-top:.6rem; font-size:.75rem; opacity:.85;">
          <summary style="cursor:pointer; user-select:none;">📡 MQTT</summary>
          <div class="dev-form" style="margin-top:.4rem;">
            <div class="field-row">
              <label>state_topic:</label>
              <input type="text" value="${esc((d.mqtt && d.mqtt.state_topic) || '')}"
                onchange="setDeviceMqtt('${d.id}', 'state_topic', this.value)">
            </div>
            <div class="field-row">
              <label>sub_topic:</label>
              <input type="text" value="${esc((d.mqtt && d.mqtt.sub_topic) || '')}"
                onchange="setDeviceMqtt('${d.id}', 'sub_topic', this.value)">
            </div>
            <div style="opacity:.7; font-size:.75rem;">
              По командам — топик <code>${esc((mqttSettingsCache.base_topic || 'smarthome'))}/${d.id}/&lt;field&gt;/set</code>
            </div>
          </div>
        </details>` : ''}

      ${currentMode === 'edit' ? `
        <details style="margin-top:.6rem; font-size:.75rem; opacity:.75;">
          <summary style="cursor:pointer; user-select:none;">HTTP-управление</summary>
          <div style="font-family:monospace; word-break:break-all; margin-top:.4rem; line-height:1.5;">
            ${Object.keys(d.state).map(field => {
              const cur = d.state[field];
              let example;
              if (typeof cur === 'boolean') example = 'true';
              else if (typeof cur === 'number') example = cur;
              else example = 'значение';
              return `<div>GET <a href="/set?id=${d.id}&field=${field}&value=${example}" target="_blank"
                style="color:#9fd3ff; text-decoration:none;"
              >/set?id=${d.id}&field=${field}&value=${example}</a></div>`;
            }).join('')}
          </div>
        </details>` : ''}

      ${currentMode === 'edit' ? `
        <details style="margin-top:.6rem; font-size:.75rem; opacity:.85;">
          <summary style="cursor:pointer; user-select:none;">🔗 KNX</summary>
          <div style="display:flex; flex-direction:column; gap:.4rem; margin-top:.4rem;">
            <label style="display:flex; gap:.4rem; align-items:center;">
              <input type="checkbox" ${(d.knx && d.knx.enabled) ? 'checked' : ''}
                onchange="saveDeviceKnx('${d.id}', {enabled: this.checked})"> включить
            </label>
            <div class="knx-form">
              <div class="knx-row">
                <label>Поле:</label>
                <select id="knx-field-sel-${d.id}" onchange="knxOnFieldChange('${d.id}')">
                  ${Object.keys(d.state || {}).map(f =>
                    `<option value="${esc(f)}">${esc(f)}</option>`).join('')}
                </select>
              </div>
              <div class="knx-row">
                <label>Режим:</label>
                <select id="knx-mode-sel-${d.id}">
                  <option value="single">общий адрес (read+write)</option>
                  <option value="rw">разные read/write</option>
                </select>
              </div>
              <div class="knx-row">
                <label>Групповой адрес:</label>
                <input type="text" id="knx-addr-${d.id}" placeholder="1/2/3" value="1/2/1">
              </div>
              <div class="knx-row">
                <label>DPT:</label>
                <input type="text" id="knx-dpt-${d.id}" placeholder="DPT-1.001" value="DPT-1.001">
              </div>
              <div class="knx-row">
                <label>Адрес write:</label>
                <input type="text" id="knx-waddr-${d.id}" placeholder="1/2/4">
              </div>
              <div class="knx-row">
                <label>DPT write:</label>
                <input type="text" id="knx-wdpt-${d.id}" placeholder="DPT-1.001">
              </div>
              <div class="knx-actions">
                <button class="btn small gray" onclick="openKnxLinkModal('', {device_id: '${d.id}'})">🔗 Привязать</button>
                <button class="btn small green" onclick="knxApplyField('${d.id}')">💾 Применить</button>
                <button class="btn small gray"  onclick="knxRemoveField('${d.id}')">🗑 Удалить</button>
              </div>
            </div>
            <div class="knx-subtitle">Добавленные поля:</div>
            <div id="knx-fields-list-${d.id}" class="knx-fields">${renderKnxFieldsList(d)}</div>
            <details style="margin-top:.4rem;">
              <summary style="cursor:pointer; opacity:.75;">JSON (продвинутый режим)</summary>
              <textarea id="knx-json-${d.id}" class="knx-json"
                onchange="saveDeviceKnxFields('${d.id}', this.value)"
                >${esc(JSON.stringify((d.knx && d.knx.fields) || {}, null, 2))}</textarea>
            </details>
            <button class="btn small gray" onclick="readDeviceKnx('${d.id}')">🔄 Прочитать с шины</button>
          </div>
        </details>` : ''}

      ${currentMode === 'edit' ? `
        <details style="margin-top:.6rem; font-size:.75rem; opacity:.85;">
          <summary style="cursor:pointer; user-select:none;">🔌 Modbus</summary>
          <div class="knx-form" style="margin-top:.4rem;">
            <label style="display:flex; gap:.4rem; align-items:center;">
              <input type="checkbox" ${(d.modbus && d.modbus.enabled) ? 'checked' : ''}
                onchange="saveDeviceModbus('${d.id}', {enabled: this.checked})"> включить
            </label>
            <div class="knx-row">
              <label>Транспорт:</label>
              <select onchange="saveDeviceModbusConn('${d.id}', {transport: this.value})">
                <option value="tcp" ${((d.modbus && d.modbus.conn && d.modbus.conn.transport) || 'tcp') === 'tcp' ? 'selected' : ''}>TCP</option>
                <option value="rtu" ${((d.modbus && d.modbus.conn && d.modbus.conn.transport) || '') === 'rtu' ? 'selected' : ''}>RTU</option>
              </select>
            </div>
            <div class="knx-row">
              <label>Unit:</label>
              <input type="number" min="1" max="247"
                value="${(d.modbus && d.modbus.conn && d.modbus.conn.unit) || 1}"
                onchange="saveDeviceModbusConn('${d.id}', {unit: parseInt(this.value,10) || 1})">
            </div>
            <div class="knx-row">
              <label>Host:</label>
              <input type="text" value="${esc((d.modbus && d.modbus.conn && d.modbus.conn.host) || '')}"
                onchange="saveDeviceModbusConn('${d.id}', {host: this.value})">
            </div>
            <div class="knx-row">
              <label>TCP port:</label>
              <input type="number"
                value="${(d.modbus && d.modbus.conn && d.modbus.conn.tcp_port) || 502}"
                onchange="saveDeviceModbusConn('${d.id}', {tcp_port: parseInt(this.value,10) || 502})">
            </div>
            <div class="knx-row">
              <label>COM:</label>
              <input type="text" value="${esc((d.modbus && d.modbus.conn && d.modbus.conn.port) || '')}"
                onchange="saveDeviceModbusConn('${d.id}', {port: this.value})">
            </div>
            <div class="knx-row">
              <label>Baud:</label>
              <input type="number"
                value="${(d.modbus && d.modbus.conn && d.modbus.conn.baudrate) || 9600}"
                onchange="saveDeviceModbusConn('${d.id}', {baudrate: parseInt(this.value,10) || 9600})">
            </div>
            <div class="knx-row">
              <label>Parity:</label>
              <select onchange="saveDeviceModbusConn('${d.id}', {parity: this.value})">
                ${['N', 'E', 'O'].map(p => `<option value="${p}" ${((d.modbus && d.modbus.conn && d.modbus.conn.parity) || 'N') === p ? 'selected' : ''}>${p}</option>`).join('')}
              </select>
            </div>
            <div style="font-size:.75rem; opacity:.75; margin-top:.3rem;">
              Поля (JSON): <code>{"on": {"kind":"coil","address":0,"type":"bool","rw":"rw"}}</code>
            </div>
            <textarea onchange="saveDeviceModbusFields('${d.id}', this.value)"
              placeholder='{"temp": {"kind":"holding","address":10,"type":"int16","scale":0.1,"rw":"r"}}'
            >${esc(JSON.stringify((d.modbus && d.modbus.fields) || {}, null, 2))}</textarea>
            <div class="knx-actions">
              <button class="btn small gray" onclick="readDeviceModbus('${d.id}')">🔄 Прочитать сейчас</button>
            </div>
          </div>
        </details>` : ''}

      ${currentMode === 'edit' ? `
        <details style="margin-top:.6rem; font-size:.75rem; opacity:.85;">
          <summary style="cursor:pointer; user-select:none;">📈 Логи</summary>
          <div class="dev-form" style="margin-top:.4rem;">
            <label class="check-row">
              <input type="checkbox" ${(d.logging && d.logging.enabled) ? 'checked' : ''}
                onchange="saveDeviceLogging('${d.id}', {enabled: this.checked})">
              <span>вести журнал</span>
            </label>
            <div style="font-size:.75rem; opacity:.75; margin-top:.2rem;">Поля (через запятую; пусто = все):</div>
            <input type="text" placeholder="on,temp,battery"
              value="${esc(((d.logging && d.logging.fields) || []).join(','))}"
              onchange="saveDeviceLogging('${d.id}', {fields: this.value.split(',').map(s=>s.trim()).filter(Boolean)})">
            <div class="dev-actions">
              <button class="btn small gray" onclick="showDeviceLogs('${d.id}')">📖 Показать журнал</button>
              <button class="btn small gray" onclick="openChartModal('${d.id}')">📊 График</button>
              <button class="btn small danger" onclick="clearDeviceLogs('${d.id}')">🗑 Очистить</button>
            </div>
          </div>
        </details>` : ''}

    </div>`;

  if (devicesLayout === 'list') {
    return `<div class="list-item" data-id="${d.id}">${cardHtml}</div>`;
  }
  return cardHtml;
}

/* ============================================================
   Вкладка «Без комнаты»
   ============================================================ */

function renderUnassigned() {
  const box = document.getElementById('unassigned-list');
  const sel = document.getElementById('bulk-room-select');
  if (!box) return;

  if (sel) {
    sel.innerHTML = ['<option value="">— без комнаты —</option>']
      .concat(roomsCache.map(r =>
        `<option value="${r.id}">${r.icon ? r.icon + ' ' : ''}${esc(r.name)}</option>`))
      .join('');
  }

  const list = devicesCache.filter(d => !d.room_id);
  if (!list.length) {
    box.innerHTML = '<div class="empty">Все устройства привязаны к комнатам</div>';
    updateBulkCounter();
    return;
  }

  box.innerHTML = list.map(d => {
    const icon = pickDeviceIcon(d);
    const meta = window.TYPES[d.type] || { icon: '📦', label: d.type };
    const checked = bulkSelected.has(d.id) ? 'checked' : '';
    const val = pinValue(d);
    const valHtml = val
      ? `<div class="v" style="font-size:.8rem; opacity:.85; margin-top:.15rem;">${esc(val.text)}</div>`
      : '';
    return `
      <div class="row" data-id="${d.id}">
        <div class="unassigned-item">
          <input type="checkbox" ${checked}
                 onchange="toggleBulk('${d.id}', this.checked)">
          <span class="icon">${icon}</span>
          <div class="meta">
            <div class="n">${esc(d.name)}</div>
            <div class="t">${esc(meta.label || d.type)} · id: ${esc(d.id)}</div>
            ${valHtml}
          </div>
        </div>
      </div>`;
  }).join('');

  updateBulkCounter();
}

function toggleBulk(id, on) {
  if (on) bulkSelected.add(id); else bulkSelected.delete(id);
  updateBulkCounter();
}

function selectAllUnassigned() {
  const list = devicesCache.filter(d => !d.room_id);
  if (!list.length) {
    alert('Нет устройств без комнаты');
    return;
  }
  bulkSelected.clear();
  for (const d of list) bulkSelected.add(d.id);
  renderUnassigned();
  updateBulkCounter();
}

function clearBulkSelection() {
  bulkSelected.clear();
  renderUnassigned();
}

function updateBulkCounter() {
  const el = document.getElementById('bulk-counter');
  if (!el) return;
  el.textContent = bulkSelected.size ? `Выбрано: ${bulkSelected.size}` : '';
}

async function applyBulkRoom() {
  if (currentMode !== 'edit') return;
  if (!bulkSelected.size) { alert('Ничего не выбрано'); return; }
  const rid = document.getElementById('bulk-room-select').value;
  await api('/api/devices/bulk_room', 'POST', { ids: Array.from(bulkSelected), room_id: rid });
  bulkSelected.clear();
  refresh();
}

async function deleteBulkDevices() {
  if (currentMode !== 'edit') return;
  const ids = Array.from(bulkSelected);
  if (!ids.length) { alert('Ничего не выбрано'); return; }

  const names = ids.map(id => {
    const d = devicesCache.find(x => x.id === id);
    return d ? d.name : id;
  });
  const preview = names.slice(0, 5).join('\n');
  const more = names.length > 5 ? `\n…и ещё ${names.length - 5}` : '';
  if (!confirm(
    `Удалить ${ids.length} устройств(о)?\n\n${preview}${more}\n\n` +
    `Будут также очищены ссылки в:\n` +
    `• событиях\n• сценариях\n• таймерах\n• MQTT-триггерах\n` +
    `• привязках KNX\n• графиках на плане`
  )) return;

  for (const id of ids) {
    const i = devicesCache.findIndex(x => x.id === id);
    if (i >= 0) devicesCache.splice(i, 1);
  }
  bulkSelected.clear();
  updateBulkCounter();
  renderUnassigned();

  try {
    const rep = await api('/api/devices/bulk_delete', 'POST', { ids });
    const lines = [];
    if (rep.deleted)       lines.push(`Удалено устройств: ${rep.deleted}`);
    if (rep.events)        lines.push(`Удалено событий: ${rep.events}`);
    if (rep.scenarios)     lines.push(`Затронуто сценариев: ${rep.scenarios}`);
    if (rep.timers)        lines.push(`Затронуто таймеров: ${rep.timers}`);
    if (rep.mqtt_triggers) lines.push(`Очищено MQTT-триггеров: ${rep.mqtt_triggers}`);
    if (rep.knx_links)     lines.push(`Очищено KNX-привязок: ${rep.knx_links}`);
    if (rep.plan_charts)   lines.push(`Удалено графиков: ${rep.plan_charts}`);
    console.log('[bulk_delete]', rep);
    if (lines.length && lines.length > 1) alert('Готово:\n\n' + lines.join('\n'));
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }

  try {
    devicesCache = await api('/api/devices');
    window.devicesCache = devicesCache;
  } catch (e) { /* ignore */ }

  refresh();
  renderUnassigned();
}

/* ============================================================
   Список устройств с группировкой по комнатам (режим «Список»)
   ============================================================ */

function renderDeviceListGrouped() {
  const roomsIndex = {};
  (roomsCache || []).forEach(r => { roomsIndex[r.id] = r; });

  const groups = {};
  for (const d of devicesCache) {
    const key = d.room_id || '';
    (groups[key] = groups[key] || []).push(d);
  }

  const orderedKeys = Object.keys(groups).sort((a, b) => {
    if (a === '' && b !== '') return -1;
    if (a !== '' && b === '') return 1;
    const na = (roomsIndex[a] && roomsIndex[a].name) || '';
    const nb = (roomsIndex[b] && roomsIndex[b].name) || '';
    return na.localeCompare(nb, 'ru');
  });

  const parts = [];
  for (const key of orderedKeys) {
    const list = groups[key];
    let title, icon;
    if (key === '') {
      title = 'Без комнаты';
      icon = '📦';
    } else {
      const r = roomsIndex[key];
      title = r ? r.name : '—';
      icon = (r && r.icon) ? r.icon : '🏠';
    }

    const openAttr = _groupOpenState[key] === false ? '' : ' open';

    parts.push(`
      <details class="device-group" data-room="${esc(key)}"${openAttr}>
        <summary class="device-group-header">
          <span class="dg-icon">${icon}</span>
          <span class="dg-name">${esc(title)}</span>
          <span class="dg-count">${list.length}</span>
        </summary>
        ${list.map(renderDeviceListRow).join('')}
      </details>
    `);
  }
  return parts.join('');
}

function renderDeviceListRow(d) {
  const icon = pickDeviceIcon(d);
  const val  = pinValue(d);
  const valHtml = val
    ? `<span class="list-val ${val.cls}">${esc(val.text)}</span>`
    : '';

  const drivers = deviceDrivers(d);
  const driversHtml = drivers.length
    ? `<span class="list-drivers">
         ${drivers.map(x =>
             `<span class="drv ${x.id}" title="${esc(x.title)}">${esc(x.label)}</span>`
           ).join('')}
       </span>`
    : '';

  const chartBtn = deviceHasLogs(d)
    ? `<button class="list-chart" title="График"
         onclick="event.stopPropagation(); openChartForDevice('${d.id}')">📊</button>`
    : '';

  return `
    <div class="device-list-row" data-id="${d.id}"
         onclick="openDeviceModal('${d.id}')">
      <span class="list-icon">${icon}</span>
      <span class="list-name">${esc(d.name)}</span>
      <span class="list-id"
            title="Клик — скопировать id"
            onclick="event.stopPropagation(); copyDeviceId('${d.id}', this)">${esc(d.id)}</span>
      ${driversHtml}
      ${valHtml}
      ${chartBtn}
      ${currentMode === 'edit'
        ? `<button class="list-remove" title="Удалить"
             onclick="event.stopPropagation(); removeDevice('${d.id}')">✕</button>`
        : ''}
    </div>`;
}

/* ============================================================
   Сохранение состояния <details> и групп при перерисовке
   ============================================================ */



function detailsKeyFromEl(detailsEl) {
  const card = detailsEl.closest('.card[data-id]');
  if (!card) return null;
  const s = detailsEl.querySelector('summary');
  const label = s ? s.textContent.trim().slice(0, 20) : '';
  return card.dataset.id + '::' + label;
}

function snapshotDetails() {
  document.querySelectorAll('.card[data-id] details').forEach(d => {
    const k = detailsKeyFromEl(d);
    if (!k) return;
    if (d.open) _detailsOpen.add(k); else _detailsOpen.delete(k);
  });
}

function restoreDetails() {
  document.querySelectorAll('.card[data-id] details').forEach(d => {
    const k = detailsKeyFromEl(d);
    if (!k) return;
    if (_detailsOpen.has(k)) d.open = true;
    if (d.dataset.detailsBound === '1') return;
    d.dataset.detailsBound = '1';
    d.addEventListener('toggle', () => {
      const kk = detailsKeyFromEl(d);
      if (!kk) return;
      if (d.open) _detailsOpen.add(kk); else _detailsOpen.delete(kk);
    });
  });
}

function withDetailsPreserved(renderFn) {
  snapshotDetails();
  renderFn();
  restoreDetails();
}

function hasOpenDetails(viewId) {
  const view = document.getElementById(viewId);
  if (!view) return false;
  return !!view.querySelector('.card[data-id] details[open]');
}

function snapshotGroupState() {
  document.querySelectorAll('.device-group').forEach(det => {
    const key = det.dataset.room || '';
    _groupOpenState[key] = det.open;
  });
}

function restoreGroupState() {
  document.querySelectorAll('.device-group').forEach(det => {
    const key = det.dataset.room || '';
    if (Object.prototype.hasOwnProperty.call(_groupOpenState, key)) {
      det.open = _groupOpenState[key];
    }
    if (det.dataset.groupBound !== '1') {
      det.dataset.groupBound = '1';
      det.addEventListener('toggle', () => {
        _groupOpenState[det.dataset.room || ''] = det.open;
      });
    }
  });
}

/* ============================================================
   Вспомогательные функции для карточек
   ============================================================ */
   
   function deviceLogFields(d) {
  const out = [];
  const seen = new Set();
  const push = (f) => {
    if (!f) return;
    if (seen.has(f)) return;
    seen.add(f);
    out.push(f);
  };

  const lg = d.logging || {};
  const lgFields = Array.isArray(lg.fields) ? lg.fields : [];
  if (lg.enabled) {
    if (lgFields.length) lgFields.forEach(push);
    else Object.keys(d.state || {}).forEach(push);
  }

  const knx = d.knx || {};
  if (knx.enabled && knx.fields) Object.keys(knx.fields).forEach(push);

  const mb = d.modbus || {};
  if (mb.enabled && mb.fields) Object.keys(mb.fields).forEach(push);

  // запасной вариант: если журнал включён, но полей не нашли — отдаём все state
  if (!out.length && d.logging && d.logging.enabled) {
    Object.keys(d.state || {}).forEach(push);
  }
  return out;
}

function deviceLogSeries(d) {
  const fields = deviceLogFields(d);
  const series = [];
  for (const f of fields) {
    series.push({
      device_id: d.id,
      field: f,
      type: (window.TYPES && window.TYPES[d.type] && window.TYPES[d.type].label) || d.type,
    });
  }
  return series;
}



function deviceHasLogs(d) {
  const lg = d.logging || {};
  if (lg.enabled) return true;
  const knx = d.knx || {};
  if (knx.enabled && knx.fields && Object.keys(knx.fields).length) return true;
  const mb = d.modbus || {};
  if (mb.enabled && mb.fields && Object.keys(mb.fields).length) return true;
  return false;
}

function pinValue(d) {
  const meta = window.TYPES[d.type] || {};
  const s = d.state || {};

  if (meta.custom && meta.raw && meta.raw.display_field) {
    const fname = meta.raw.display_field;
    const v = s[fname];
    if (v === undefined || v === null) return null;
    let cls = 'ok';
    if (typeof v === 'boolean') cls = v ? 'ok' : 'off';
    let text = String(v);
    if (typeof v === 'boolean') text = v ? 'вкл' : 'выкл';
    else if (typeof v === 'number') text = String(Math.round(v * 100) / 100);
    return { text, cls };
  }

  const cls = stateClass(d);
  switch (d.type) {
    case 'thermostat':   return { text: `${(+s.current).toFixed(1)}°`, cls };
    case 'climate':      return { text: `${(+s.temp).toFixed(1)}°`, cls };
    case 'light':        return { text: toBool(s.on) ? `${s.brightness}%` : 'off', cls };
    case 'light_switch': return { text: toBool(s.on) ? 'вкл' : 'выкл', cls };
    case 'curtain':      return { text: toBool(s.open) ? `${s.position}%` : '0%', cls };
    case 'fan':          return { text: toBool(s.on) ? `${s.speed}` : 'off', cls };
    case 'door':         return { text: toBool(s.open) ? 'откр' : 'закр', cls };
    case 'leak':         return { text: toBool(s.leak) ? '⚠' : 'ok', cls };
    case 'motion':       return { text: toBool(s.motion) ? '•' : '—', cls };
    case 'button':       return { text: toBool(s.pressed) ? '▶' : '—', cls };
    case 'text':         return { text: (String(s.text || '').slice(0, 12)) || '—', cls: 'ok' };
    default: return null;
  }
}

function stateClass(d) {
  const meta = window.TYPES[d.type] || {};
  if (meta.custom) {
    const s = d.state || {};
    const df = (meta.raw && meta.raw.display_field) || '';
    if (df && typeof s[df] === 'boolean') {
      return s[df] ? 'ok' : 'off';
    }
    return 'ok';
  }
  const s = d.state || {};
  if (d.type === 'leak')         return toBool(s.leak) ? 'alert' : 'ok';
  if (d.type === 'door')         return toBool(s.open) ? 'warn'  : 'ok';
  if (d.type === 'motion')       return toBool(s.motion) ? 'warn' : 'ok';
  if (d.type === 'light')        return toBool(s.on) ? 'ok' : 'off';
  if (d.type === 'light_switch') return toBool(s.on) ? 'ok' : 'off';
  if (d.type === 'curtain')      return toBool(s.open) ? 'ok' : 'off';
  if (d.type === 'fan')          return toBool(s.on) ? 'ok' : 'off';
  if (d.type === 'thermostat')   return Math.abs(s.current - s.target) > 2 ? 'warn' : 'ok';
  if (d.type === 'button')       return toBool(s.pressed) ? 'warn' : 'ok';
  return 'ok';
}

function devFieldsFirst(d) {
  const lg = d.logging || {};
  const lgFields = Array.isArray(lg.fields) ? lg.fields : [];
  if (lg.enabled && lgFields.length) return lgFields[0];
  const knx = d.knx || {};
  if (knx.enabled && knx.fields) {
    const k = Object.keys(knx.fields)[0];
    if (k) return k;
  }
  const mb = d.modbus || {};
  if (mb.enabled && mb.fields) {
    const m = Object.keys(mb.fields)[0];
    if (m) return m;
  }
  const s = Object.keys(d.state || {});
  return s[0] || '';
}

function devFieldsFirst(d) {
  const lg = d.logging || {};
  const lgFields = Array.isArray(lg.fields) ? lg.fields : [];
  if (lg.enabled && lgFields.length) return lgFields[0];
  const knx = d.knx || {};
  if (knx.enabled && knx.fields) {
    const k = Object.keys(knx.fields)[0];
    if (k) return k;
  }
  const mb = d.modbus || {};
  if (mb.enabled && mb.fields) {
    const m = Object.keys(mb.fields)[0];
    if (m) return m;
  }
  const s = Object.keys(d.state || {});
  return s[0] || '';
}

/* ============================================================
   Карточка устройства в режиме просмотра (user)
   ============================================================ */

function renderViewCard(d) {
  const meta = window.TYPES[d.type] || { icon: '❓', label: d.type };
  const deviceIcon = pickDeviceIcon(d);
  const s = d.state || {};
  let value = '', sub = '', controls = '';

  if (d.type === 'thermostat') {
    value = `${(+s.current).toFixed(1)} °C`;
    sub = `Цель: ${(+s.target).toFixed(1)} °C • ${s.mode === 'heat' ? 'нагрев' : 'охлаждение'}`;
    controls = `
      <input type="range" min="10" max="30" step="0.5" value="${s.target}"
        oninput="this.nextElementSibling.querySelector('span').textContent = parseFloat(this.value).toFixed(1) + ' °C'; this.dataset.dirty='1'"
        onchange="if (this.dataset.dirty) { delete this.dataset.dirty; setState('${d.id}', {target: parseFloat(this.value)}) }">
      <div style="font-size:.85rem; opacity:.8; margin-top:.3rem;">Новая цель: <span>${(+s.target).toFixed(1)} °C</span></div>`;
  } else if (d.type === 'climate') {
    value = `${(+s.temp).toFixed(1)} °C`;
    sub = `Влажность: ${(+s.humidity).toFixed(0)} %`;
  } else if (d.type === 'door') {
    const open = toBool(s.open);
    value = open ? 'Открыто' : 'Закрыто';
    controls = '';
  } else if (d.type === 'leak') {
    const leak = toBool(s.leak);
    value = leak ? 'ПРОТЕЧКА!' : 'Сухо';
  } else if (d.type === 'motion') {
    const motion = toBool(s.motion);
    value = motion ? 'Движение' : 'Тихо';
  } else if (d.type === 'light') {
    const on = toBool(s.on);
    value = on ? `Вкл • ${s.brightness}%` : 'Выкл';
    controls = `
      <input type="range" min="0" max="100" value="${s.brightness}"
        oninput="this.nextElementSibling.querySelector('span').textContent = this.value + ' %'; this.dataset.dirty='1'"
        onchange="if (this.dataset.dirty) { delete this.dataset.dirty; setState('${d.id}', {brightness: parseInt(this.value)}) }">
      <div style="font-size:.85rem; opacity:.8; margin-top:.3rem;">Яркость: <span>${s.brightness} %</span></div>
      <div class="vc-controls"><button class="${on ? 'on' : 'off'}" onclick="setState('${d.id}', {on: ${!on}})">${on ? 'Выключить' : 'Включить'}</button></div>`;
  } else if (d.type === 'light_switch') {
    const on = toBool(s.on);
    value = on ? 'Включён' : 'Выключен';
    controls = `<div class="vc-controls"><button class="${on ? 'on' : 'off'}" onclick="setState('${d.id}', {on: ${!on}})">${on ? 'Выключить' : 'Включить'}</button></div>`;
  } else if (d.type === 'curtain') {
    const open = toBool(s.open);
    const pos  = Math.max(0, Math.min(100, parseInt(s.position) || 0));
    value = open ? `Открыто на ${pos}%` : 'Закрыто';
    controls = `
      <input type="range" min="0" max="100" value="${pos}"
        oninput="this.nextElementSibling.querySelector('span').textContent = this.value + ' %'; this.dataset.dirty='1'"
        onchange="if (this.dataset.dirty) { delete this.dataset.dirty; setState('${d.id}', {position: parseInt(this.value), open: parseInt(this.value) > 0}) }">
      <div style="font-size:.85rem; opacity:.8; margin-top:.3rem;">Позиция: <span>${pos} %</span></div>
      <div class="vc-controls">
        <button class="${open ? 'on' : 'off'}" onclick="setState('${d.id}', {open: true, position: 100})">Открыть</button>
        <button class="${!open ? 'on' : 'off'}" onclick="setState('${d.id}', {open: false, position: 0})">Закрыть</button>
      </div>`;
  } else if (d.type === 'fan') {
    const on = toBool(s.on);
    const sp = Math.max(0, Math.min(3, parseInt(s.speed) || 0));
    value = on ? `Вкл • скорость ${sp}` : 'Выкл';
    controls = `
      <input type="range" min="0" max="3" step="1" value="${sp}"
        oninput="this.nextElementSibling.querySelector('span').textContent = this.value; this.dataset.dirty='1'"
        onchange="if (this.dataset.dirty) { delete this.dataset.dirty; setState('${d.id}', {speed: parseInt(this.value), on: parseInt(this.value) > 0}) }">
      <div style="font-size:.85rem; opacity:.8; margin-top:.3rem;">Скорость: <span>${sp}</span> (0 — выкл)</div>
      <div class="vc-controls"><button class="${on ? 'on' : 'off'}" onclick="setState('${d.id}', {on: ${!on}, speed: ${on ? 0 : 1}})">${on ? 'Выключить' : 'Включить'}</button></div>`;
  } else if (d.type === 'button') {
    const pressed = toBool(s.pressed);
    value = pressed ? 'Нажата' : 'Отпущена';
    controls = `
      <div class="vc-controls">
        <button class="${pressed ? 'on' : 'off'}"
          onclick="pressButton('${d.id}')">▶ Нажать</button>
      </div>`;
  } else if (d.type === 'text') {
    const txt = String(s.text ?? '');
    const w = Math.max(1, Math.min(200, parseInt(s.width) || 40));
    value = txt ? esc(txt.slice(0, w)) : '— пусто —';
    sub = `Макс. длина строки: ${w} симв.`;
    controls = `
      <div class="vc-controls" style="flex-direction:column; align-items:stretch; gap:.4rem;">
        <textarea maxlength="${w}"
          onchange="if (this.dataset.dirty) { delete this.dataset.dirty; setState('${d.id}', {text: this.value}) }"
          oninput="this.dataset.dirty='1'"
          style="min-height:60px; resize:vertical;"
          placeholder="Введите текст…">${esc(txt)}</textarea>
        <div style="font-size:.85rem; opacity:.8;">
          Длина: <span>${txt.length}</span> / ${w}
        </div>
      </div>`;
  }

  return `
    <div class="view-card" data-id="${d.id}">
      <div class="vc-head">
        <div class="vc-icon">${deviceIcon}</div>
        <div style="text-align:right;">
          <div class="vc-name">${esc(d.name)}</div>
          <div class="vc-room">${esc(d.room || meta.label)}</div>
        </div>
      </div>
      <div class="vc-value">${value}</div>
      <div class="vc-sub">${sub}</div>
      ${controls}
      ${renderCustomFieldsView(d)}
      ${deviceHasLogs(d) ? `
        <div class="vc-controls" style="margin-top:.4rem;">
          <button class="btn small gray"
            onclick="event.stopPropagation(); openChartForDevice('${d.id}')">
            📊 График
          </button>
        </div>` : ''}
    </div>`;
}

/* Отображение кастомных полей в режиме просмотра */
function renderCustomFieldsView(d) {
  const meta = window.TYPES[d.type] || {};
  if (!meta.custom || !meta.raw || !Array.isArray(meta.raw.fields)) return '';
  const parts = [];
  for (const f of meta.raw.fields) {
    if (!f.name) continue;
    if (f.label === undefined) continue;
    parts.push(renderCustomField(d, f, d.state[f.name]));
  }
  if (!parts.length) return '';
  return wrapGenericFields(parts);
}