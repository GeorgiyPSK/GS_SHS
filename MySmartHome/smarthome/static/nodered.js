/* ============================================================
   Node-RED: генерация flow для устройств
   ============================================================ */

(function () {
  'use strict';

  // ---------- Утилиты ----------
  function getMqttBase() {
    return (window.mqttSettingsCache && window.mqttSettingsCache.base_topic)
      ? window.mqttSettingsCache.base_topic
      : 'smarthome';
  }

  function getMqttHost() {
    return (window.mqttSettingsCache && window.mqttSettingsCache.host) || 'localhost';
  }

  function getMqttPort() {
    return (window.mqttSettingsCache && window.mqttSettingsCache.port) || 1883;
  }

  // ---------- Генерация flow для одного устройства ----------
  function buildNodeRedFlow(d) {
    const base = getMqttBase();
    const did  = d.id;
    const name = d.name || did;
    const fields = Object.keys(d.state || {});

    const tabId = `smarthome-tab-${did}`;
    const brokerId = 'mqtt-broker-smarthome';
    const nodes = [];

    // Вкладка (flow) в Node-RED
    nodes.push({
      id: tabId,
      type: 'tab',
      label: `SmartHome: ${name}`,
      disabled: false,
      info: ''
    });

    let x = 100, y = 100;
    const stepY = 80;
    const mkId = (suffix) => `${did}-${suffix}`;

    // Подписка на state
    nodes.push({
      id: mkId('state-in'),
      type: 'mqtt in',
      z: tabId,
      name: `${name} state`,
      topic: `${base}/${did}/state`,
      qos: '2',
      datatype: 'json',
      broker: brokerId,
      nl: false,
      rap: true,
      rh: 0,
      inputs: 0,
      x: x,
      y: y,
      wires: [[mkId('debug')]]
    });

    // Debug
    nodes.push({
      id: mkId('debug'),
      type: 'debug',
      z: tabId,
      name: `${name} (debug)`,
      active: true,
      tosidebar: true,
      console: false,
      tostatus: false,
      complete: 'payload',
      targetType: 'msg',
      statusVal: '',
      statusType: 'auto',
      x: x + 220,
      y: y,
      wires: []
    });

    y += stepY;

    // inject → mqtt out для каждого поля
    for (const field of fields) {
      const injId = mkId(`inj-${field}`);
      const outId = mkId(`out-${field}`);

      nodes.push({
        id: injId,
        type: 'inject',
        z: tabId,
        name: `${name}: ${field}`,
        props: [{ p: 'payload' }],
        repeat: '',
        crontab: '',
        once: false,
        onceDelay: 0.1,
        topic: '',
        payload: '',
        payloadType: 'date',
        x: x,
        y: y,
        wires: [[outId]]
      });

      nodes.push({
        id: outId,
        type: 'mqtt out',
        z: tabId,
        name: `${name}: ${field}`,
        topic: `${base}/${did}/${field}/set`,
        qos: '',
        retain: 'false',
        respTopic: '',
        contentType: '',
        userProps: '',
        correl: '',
        expiry: '',
        broker: brokerId,
        x: x + 220,
        y: y,
        wires: []
      });

      y += stepY;
    }

    // Config-нода broker (без z)
    nodes.push({
      id: brokerId,
      type: 'mqtt-broker',
      name: 'SmartHome Broker',
      broker: getMqttHost(),
      port: getMqttPort(),
      clientid: 'node-red-client',
      autoConnect: true,
      usetls: false,
      protocolVersion: '4',
      keepalive: '60',
      cleansession: true,
      birthTopic: '',
      birthQos: '0',
      birthPayload: '',
      closeTopic: '',
      closeQos: '0',
      closePayload: '',
      willTopic: '',
      willQos: '0',
      willPayload: ''
    });

    return nodes;
  }

  // ---------- Модалка ----------
  function ensureModal() {
    let overlay = document.getElementById('nodered-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'nodered-overlay';
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    overlay.innerHTML = `
      <div class="modal" style="max-width:720px;">
        <button class="modal-close" onclick="NodeRed.closeModal()">✕</button>
        <div style="padding:1.2rem;">
          <h3 id="nodered-title" style="margin:0 0 .5rem;">🟥 Node-RED</h3>
          <p style="margin:0 0 .8rem; opacity:.8; font-size:.9rem;">
            Скопируйте JSON и вставьте в Node-RED:
            <b>Меню → Import → Clipboard</b>.
          </p>
          <textarea id="nodered-json" readonly
            style="width:100%; min-height:360px; font-family:monospace; font-size:.85rem;
                   padding:.6rem; border-radius:10px; resize:vertical;
                   background:rgba(0,0,0,.35); color:#fff;
                   border:1px solid rgba(255,255,255,.25);"></textarea>
          <div style="margin-top:.8rem; display:flex; gap:.5rem; justify-content:flex-end;">
            <button class="btn gray" onclick="NodeRed.closeModal()">Закрыть</button>
            <button class="btn primary" onclick="NodeRed.copyJson(this)">📋 Скопировать</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function openModal(title, json) {
    const overlay = ensureModal();
    document.getElementById('nodered-title').textContent = title;
    document.getElementById('nodered-json').value = json;
    overlay.classList.add('open');
  }

  function closeModal() {
    const overlay = document.getElementById('nodered-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  function copyJson(btn) {
    const ta = document.getElementById('nodered-json');
    if (!ta) return;
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const done = () => {
      const old = btn.textContent;
      btn.textContent = '✅ Скопировано';
      setTimeout(() => { btn.textContent = old; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(done).catch(() => {
        document.execCommand('copy');
        done();
      });
    } else {
      document.execCommand('copy');
      done();
    }
  }

  // ---------- Публичные функции ----------
  function openForDevice(id) {
    const d = (window.devicesCache || []).find(x => x.id === id);
    if (!d) return;
    const nodes = buildNodeRedFlow(d);
    const json = JSON.stringify(nodes, null, 2);
    openModal(`🟥 Node-RED — ${d.name || d.id}`, json);
  }

  function exportAll() {
    const devices = window.devicesCache || [];
    if (!devices.length) { alert('Нет устройств'); return; }
    const all = [];
    const brokerIds = new Set();
    for (const d of devices) {
      for (const n of buildNodeRedFlow(d)) {
        if (n.type === 'mqtt-broker') {
          if (brokerIds.has(n.id)) continue;
          brokerIds.add(n.id);
        }
        all.push(n);
      }
    }
    const json = JSON.stringify(all, null, 2);
    openModal('🟥 Node-RED — все устройства', json);
  }

  // Экспорт
  window.NodeRed = {
    openForDevice,
    exportAll,
    closeModal,
    copyJson,
    buildNodeRedFlow,   // на всякий случай, вдруг пригодится
  };
})();