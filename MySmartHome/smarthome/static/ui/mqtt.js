/* ============================================================
   MQTT: настройки, MQTT-триггеры, Zigbee2MQTT
   ============================================================ */

/* ---------- Настройки MQTT ---------- */

async function loadMqttSettings() {
  mqttSettingsCache = await api('/api/mqtt/settings');
  window.mqttSettingsCache = mqttSettingsCache;
  mqttStatusCache   = await api('/api/mqtt/status');
  const $ = id => document.getElementById(id);
  if ($('mqtt-enabled')) $('mqtt-enabled').checked = !!mqttSettingsCache.enabled;
  if ($('mqtt-host'))    $('mqtt-host').value = mqttSettingsCache.host || '';
  if ($('mqtt-port'))    $('mqtt-port').value = mqttSettingsCache.port || 1883;
  if ($('mqtt-user'))    $('mqtt-user').value = mqttSettingsCache.username || '';
  if ($('mqtt-pass'))    $('mqtt-pass').value = mqttSettingsCache.password || '';
  if ($('mqtt-client'))  $('mqtt-client').value = mqttSettingsCache.client_id || '';
  if ($('mqtt-base'))    $('mqtt-base').value = mqttSettingsCache.base_topic || '';
  if ($('mqtt-status'))  $('mqtt-status').value = mqttSettingsCache.status_topic || '';
  const line = $('mqtt-status-line');
  if (line) {
    if (!mqttStatusCache.available) line.textContent = '⚠ paho-mqtt не установлен (pip install paho-mqtt)';
    else if (!mqttSettingsCache.enabled) line.textContent = 'MQTT выключен';
    else line.textContent = mqttStatusCache.connected ? '✅ Подключено' : '⏳ Не подключено';
  }
}

async function saveMqttSettings() {
  const $ = id => document.getElementById(id);
  const patch = {
    enabled:   $('mqtt-enabled')?.checked || false,
    host:      $('mqtt-host')?.value || '',
    port:      parseInt($('mqtt-port')?.value || '1883', 10),
    username:  $('mqtt-user')?.value || '',
    password:  $('mqtt-pass')?.value || '',
    client_id: $('mqtt-client')?.value || '',
    base_topic:$('mqtt-base')?.value || '',
    status_topic: $('mqtt-status')?.value || '',
  };
  await api('/api/mqtt/settings', 'POST', patch);
  await loadMqttSettings();
}

async function setDeviceMqtt(id, key, value) {
  await api('/api/devices/' + id + '/mqtt', 'POST', { [key]: value });
  refresh();
}

/* ---------- MQTT-триггеры ---------- */

function renderMqttTriggers() {
  const box = document.getElementById('mqtt-triggers-list');
  if (!box) return;
  if (!mqttTriggersCache.length) {
    box.innerHTML = '<div class="empty">Триггеров нет.</div>';
    return;
  }
  box.innerHTML = mqttTriggersCache.map(tr => `
    <div class="row" data-id="${tr.id}">
      <div class="row-head">
        <input type="text" value="${esc(tr.name || '')}"
          data-key="name" oninput="markRowDirty(this)"
          style="background:transparent;border:none;color:#fff;font-size:1.1rem;font-weight:600;flex:1;">
        <label style="display:flex;align-items:center;gap:.4rem;font-size:.9rem;">
          <input type="checkbox" ${tr.enabled !== false ? 'checked' : ''}
            data-key="enabled" onchange="markRowDirty(this)"> вкл
        </label>
        <button class="btn small green btn-save" onclick="saveMqttTrigger('${tr.id}')">💾 Сохранить</button>
        <button class="btn small danger edit-only" onclick="removeMqttTrigger('${tr.id}')">🗑</button>
      </div>
      <div class="row-body">
        <div class="field-row">
          <label>Топик</label>
          <input type="text" value="${esc(tr.topic || '')}"
            data-key="topic" oninput="markRowDirty(this)">
        </div>
        <div class="field-row">
          <label>Payload содержит</label>
          <input type="text" value="${esc(tr.payload_match || '')}"
            data-key="payload_match" oninput="markRowDirty(this)"
            placeholder="(пусто — сработает на любое сообщение)">
        </div>
        <div class="field-row">
          <label>Сценарий</label>
          <select data-key="scenario_id" onchange="markRowDirty(this)">
            <option value="">— выберите —</option>
            ${scenariosCache.map(sc => `
              <option value="${sc.id}" ${tr.scenario_id === sc.id ? 'selected' : ''}>
                ${esc(sc.name)}
              </option>`).join('')}
          </select>
        </div>
      </div>
    </div>`).join('');
}

async function addMqttTrigger() {
  await api('/api/mqtt_triggers', 'POST', {
    name: 'Новый триггер', topic: '', payload_match: '',
    scenario_id: '', enabled: true,
  });
  refresh();
}

async function saveMqttTrigger(id) {
  const row = document.querySelector(`#mqtt-triggers-list .row[data-id="${id}"]`);
  if (!row) return;
  const fields = collectRowFields(row);
  await api('/api/mqtt_triggers/' + id, 'POST', {
    name: fields.name ?? '',
    topic: fields.topic ?? '',
    payload_match: fields.payload_match ?? '',
    scenario_id: fields.scenario_id ?? '',
    enabled: !!fields.enabled,
  });
  refresh();
}

async function removeMqttTrigger(id) {
  if (!confirm('Удалить триггер?')) return;
  try {
    await api('/api/mqtt_triggers/' + id, 'DELETE');
    mqttTriggersCache = mqttTriggersCache.filter(t => t.id !== id);
    renderMqttTriggers();
    api('/api/mqtt_triggers').then(r => {
      mqttTriggersCache = r; renderMqttTriggers();
    }).catch(() => {});
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

/* ---------- Zigbee2MQTT ---------- */

async function loadZ2MSettings() {
  try {
    const cfg = await api('/api/zigbee2mqtt/settings');
    const elEnabled = document.getElementById('z2m-enabled');
    const elBase    = document.getElementById('z2m-base');
    const elHost    = document.getElementById('z2m-host');
    if (elEnabled) elEnabled.checked = !!cfg.enabled;
    if (elBase)    elBase.value = cfg.base_topic || 'zigbee2mqtt';
    if (elHost)    elHost.value = cfg.host || 'http://localhost:8080';
    await loadZ2MDevices();
    await loadZ2MBridgeInfo();
  } catch (e) {
    console.warn('[z2m settings]', e);
  }
}

async function saveZ2MSettings() {
  const enabled = !!document.getElementById('z2m-enabled')?.checked;
  const base_topic = (document.getElementById('z2m-base')?.value || '').trim() || 'zigbee2mqtt';
  const host = (document.getElementById('z2m-host')?.value || '').trim() || 'http://localhost:8080';
  try {
    await api('/api/zigbee2mqtt/settings', 'POST', { enabled, base_topic, host });
    alert('Настройки сохранены');
    await loadZ2MSettings();
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

async function loadZ2MDevices() {
  const box = document.getElementById('z2m-list');
  if (!box) return;
  try {
    const list = await api('/api/zigbee2mqtt/devices');
    if (!list.length) {
      box.innerHTML = '<div class="hint" style="margin:0;">Нет привязанных Z2M-устройств. Укажите z2m_name на карточке устройства.</div>';
      return;
    }
    box.innerHTML = list.map(d => `
      <div class="row" style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-bottom:.5rem;">
        <div style="flex:1;min-width:200px;">
          <div style="font-weight:600;">${esc(d.name)}</div>
          <div style="font-size:.8rem;opacity:.7;">
            z2m: <code>${esc(d.z2m_name)}</code> ·
            LQ: ${d.z2m_linkquality ?? '—'} ·
            ${d.z2m_online === true ? '<span class="badge ok">online</span>' :
              d.z2m_online === false ? '<span class="badge off">offline</span>' : ''}
            ${d.z2m_seen ? ' · ' + esc(d.z2m_seen) : ''}
          </div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    box.innerHTML = '<div class="hint" style="margin:0;">Ошибка: ' + esc(e.message) + '</div>';
  }
}

async function refreshZ2MFields(id) {
  await loadZ2MFields(id);
  if (currentView === 'grid') renderCurrentView();
  if (_modalDeviceId === id) refreshDeviceModal();
}

async function loadZ2MFields(id) {
  try {
    const fields = await api('/api/devices/' + id + '/z2m_fields');
    z2mFieldsCache[id] = Array.isArray(fields) ? fields : [];
    return z2mFieldsCache[id];
  } catch (e) {
    console.warn('[z2m fields]', e);
    z2mFieldsCache[id] = [];
    return [];
  }
}

async function loadAllZ2MFields() {
  const ids = devicesCache
    .filter(d => (d.z2m_name || '').trim())
    .map(d => d.id);
  await Promise.all(ids.map(id => loadZ2MFields(id)));
}

async function setDeviceZ2M(id, z2m_name) {
  z2m_name = (z2m_name || '').trim();
  const d = devicesCache.find(x => x.id === id);
  if (d) d.z2m_name = z2m_name;
  try {
    const updated = await api('/api/devices/' + id + '/z2m_name', 'POST', { z2m_name });
    const idx = devicesCache.findIndex(x => x.id === id);
    if (idx >= 0) devicesCache[idx] = updated;
    await loadZ2MFields(id);
    renderCurrentView();
    if (_modalDeviceId === id) refreshDeviceModal();
  } catch (e) {
    console.error('[setDeviceZ2M]', e);
    alert('Ошибка: ' + e.message);
    refresh();
  }
}

async function previewZ2MImportMqtt() {
  try {
    const rep = await api('/api/zigbee2mqtt/import_mqtt/preview', 'POST', {});
    showZ2MReport(rep, 'Предпросмотр импорта (MQTT)');
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

async function applyZ2MImportMqtt() {
  if (!confirm('Импортировать новые устройства из MQTT-кэша Z2M?')) return;
  try {
    const rep = await api('/api/zigbee2mqtt/import_mqtt', 'POST', {});
    showZ2MReport(rep, 'Импорт (MQTT) выполнен');
    await loadZ2MDevices();
    await loadZ2MBridgeInfo();
    refresh();
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

async function loadZ2MBridgeInfo() {
  const el = document.getElementById('z2m-bridge-info');
  if (!el) return;
  try {
    const info = await api('/api/zigbee2mqtt/bridge_info');
    if (!info || !info.count) {
      el.textContent = 'пусто (Z2M ещё не отдал bridge/devices)';
      return;
    }
    const ts = info.updated ? new Date(info.updated * 1000).toLocaleString('ru-RU') : '—';
    el.textContent = `${info.count} устройств · обновлён: ${ts}`;
    if (Array.isArray(info.names) && info.names.length) {
      el.title = info.names.join(', ');
    }
  } catch (e) {
    el.textContent = 'ошибка: ' + e.message;
  }
}

async function previewZ2MImport() {
  try {
    const rep = await api('/api/zigbee2mqtt/import/preview', 'POST', {});
    showZ2MReport(rep, 'Предпросмотр импорта');
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

async function applyZ2MImport() {
  if (!confirm('Импортировать новые устройства из Z2M? Существующие не тронем.')) return;
  try {
    const rep = await api('/api/zigbee2mqtt/import', 'POST', {});
    showZ2MReport(rep, 'Импорт выполнен');
    await loadZ2MDevices();
    refresh();
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

function showZ2MReport(rep, title) {
  const lines = [];
  lines.push(`<b>Источник:</b> ${esc(rep.source || 'http')}`);
  lines.push('');
  if (rep.added && rep.added.length) {
    lines.push(`<b>➕ Добавлено/будет добавлено: ${rep.added.length}</b>`);
    lines.push('<ul>');
    rep.added.forEach(a => {
      lines.push(`<li>${esc(a.name)} — <code>${esc(a.type)}</code> (${esc(a.reason || '')})</li>`);
    });
    lines.push('</ul>');
  } else {
    lines.push('<b>➕ Новых устройств нет.</b>');
  }
  if (rep.skipped && rep.skipped.length) {
    lines.push(`<b>Уже есть: ${rep.skipped.length}</b>`);
    lines.push('<ul>');
    rep.skipped.slice(0, 20).forEach(s => {
      lines.push(`<li>${esc(s.name)} — ${esc(s.reason || '')}</li>`);
    });
    lines.push('</ul>');
  }
  if (rep.errors && rep.errors.length) {
    lines.push(`<b>Ошибки: ${rep.errors.length}</b>`);
    lines.push('<ul>');
    rep.errors.forEach(e => lines.push(`<li>${esc(e)}</li>`));
    lines.push('</ul>');
  }
  if (window.SH && window.SH.openModal) {
    window.SH.openModal('🐝 ' + title, '', lines.join('\n').replace(/<[^>]+>/g, m => m));
  } else {
    alert(title + '\n\n' + lines.join('\n').replace(/<[^>]+>/g, ''));
  }
}

/* ---------- Modbus (общие настройки + поля устройства) ---------- */

async function loadModbusSettings() {
  try {
    const cfg = await api('/api/modbus/settings');
    const el = document.getElementById('modbus-poll');
    if (el) el.value = cfg.poll_ms || 2000;
  } catch (e) {}
}

async function saveModbusSettings() {
  const poll_ms = parseInt(document.getElementById('modbus-poll')?.value || '2000', 10);
  await api('/api/modbus/settings', 'POST', { poll_ms });
  alert('Сохранено');
}

async function saveDeviceModbus(id, patch) {
  const updated = await api('/api/devices/' + id + '/modbus', 'POST', patch);
  const i = devicesCache.findIndex(x => x.id === id);
  if (i >= 0) devicesCache[i].modbus = updated;
  renderCurrentView();
}
async function saveDeviceModbusConn(id, patch) {
  await saveDeviceModbus(id, { conn: patch });
}
async function saveDeviceModbusFields(id, text) {
  let obj = {};
  try { obj = JSON.parse(text || '{}'); } catch (e) { alert('Некорректный JSON: ' + e.message); return; }
  await saveDeviceModbus(id, { fields: obj });
}
async function readDeviceModbus(id) {
  try {
    const vals = await api('/api/devices/' + id + '/modbus/read', 'POST', {});
    alert('Прочитано: ' + JSON.stringify(vals, null, 2));
    refresh();
  } catch (e) { alert('Ошибка: ' + e.message); }
}