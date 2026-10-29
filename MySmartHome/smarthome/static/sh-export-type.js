/* ============================================================
   Экспорт нод/команд для всех устройств выбранного типа.
   ============================================================ */
(function () {
  'use strict';

  function uniqueTypes() {
    const set = new Set();
    (window.SH.getDevices() || []).forEach(d => set.add(d.type));
    return Array.from(set).sort();
  }

  function typeLabel(t) {
    const meta = (window.TYPES && window.TYPES[t]) || {};
    return `${meta.icon || '📦'} ${meta.label || t}`;
  }

  function buildForType(kind, type) {
    const devices = (window.SH.getDevices() || []).filter(d => d.type === type);
    if (!devices.length) return '';

    if (kind === 'mqtt') {
      const all = [];
      const brokerIds = new Set();
      for (const d of devices) {
        for (const n of (window.NodeRed?.buildNodeRedFlow?.(d) || [])) {
          if (n.type === 'mqtt-broker') {
            if (brokerIds.has(n.id)) continue;
            brokerIds.add(n.id);
          }
          all.push(n);
        }
      }
      return JSON.stringify(all, null, 2);
    }

    if (kind === 'http') {
      const all = [];
      for (const d of devices) {
        all.push(...(window.NodeRedHttp?.buildHttpFlow?.(d) || []));
      }
      return JSON.stringify(all, null, 2);
    }

    if (kind === 'ws') {
      const all = [];
      for (const d of devices) {
        all.push(...(window.NodeRedWS?.buildWsFlow?.(d) || []));
      }
      return JSON.stringify(all, null, 2);
    }

    if (kind === 'curl') {
      const parts = [];
      for (const d of devices) {
        parts.push(window.HttpCurl?.buildCurlCommands?.(d) || '');
        parts.push('');
        parts.push('#' + '='.repeat(60));
        parts.push('');
      }
      return parts.join('\n');
    }

    return '';
  }

  function openForType() {
    const types = uniqueTypes();
    if (!types.length) { alert('Нет устройств'); return; }

    // Простейший prompt-выбор
    const options = types.map((t, i) => `${i + 1}) ${typeLabel(t)}`).join('\n');
    const choice = prompt(
      `Выберите тип устройства:\n${options}\n\nВведите номер:`,
      '1'
    );
    if (!choice) return;
    const idx = parseInt(choice, 10) - 1;
    if (!types[idx]) { alert('Неверный номер'); return; }

    const type = types[idx];

    const kindChoice = prompt(
      'Что сгенерировать?\n' +
      '1) Node-RED (MQTT)\n' +
      '2) Node-RED (HTTP)\n' +
      '3) Node-RED (WS/SSE)\n' +
      '4) cURL-команды\n\n' +
      'Введите номер:',
      '1'
    );
    if (!kindChoice) return;

    const kindMap = { '1': 'mqtt', '2': 'http', '3': 'ws', '4': 'curl' };
    const kind = kindMap[kindChoice.trim()];
    if (!kind) { alert('Неверный номер'); return; }

    const text = buildForType(kind, type);
    if (!text) { alert('Нечего генерировать'); return; }

    const titles = {
      mqtt: `🟥 Node-RED MQTT — тип «${typeLabel(type)}»`,
      http: `🟥 Node-RED HTTP — тип «${typeLabel(type)}»`,
      ws:   `🟥 Node-RED WS — тип «${typeLabel(type)}»`,
      curl: `🐚 cURL — тип «${typeLabel(type)}»`
    };

    window.SH.openModal(
      titles[kind],
      `Устройств этого типа: <b>${devices_count(type)}</b>`,
      text
    );
  }

  function devices_count(type) {
    return (window.SH.getDevices() || []).filter(d => d.type === type).length;
  }

  window.ExportByType = { open: openForType, buildForType, uniqueTypes };
})();