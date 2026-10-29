/* ============================================================
   Node-RED через WebSocket (SSE): live-обновления без MQTT.
   Node-RED подключается к /api/events/stream как EventSource.
   ============================================================ */
(function () {
  'use strict';

  function buildWsFlow(d) {
    const did = d.id;
    const name = d.name || did;
    const tabId = `sh-ws-tab-${did}`;
    const baseUrl = window.location.origin; // http://localhost:5000

    const nodes = [];

    // Вкладка
    nodes.push({
      id: tabId,
      type: 'tab',
      label: `SmartHome WS: ${name}`,
      disabled: false,
      info: 'Live-обновления через SSE /api/events/stream'
    });

    const mkId = (s) => `${did}-ws-${s}`;
    const x = 120, y = 100;

    // SSE — Node-RED не имеет встроенной ноды для SSE,
    // поэтому используем websocket in на /api/events/stream (Chattanooga
    // поддерживает text/event-stream) либо http request с keepalive.
    // Проще: используем node-red-contrib-sse-client, если установлен.
    // Здесь — вариант через http request + polling каждые 2 сек (без SSE),
    // чтобы работало "из коробки".

    nodes.push({
      id: mkId('poll'),
      type: 'inject',
      z: tabId,
      name: 'poll 2s',
      props: [{ p: 'payload' }],
      repeat: '2',
      crontab: '',
      once: true,
      onceDelay: 0.1,
      topic: '',
      payload: '',
      payloadType: 'date',
      x: x,
      y: y,
      wires: [[mkId('req')]]
    });

    nodes.push({
      id: mkId('req'),
      type: 'http request',
      z: tabId,
      name: `GET /api/devices`,
      method: 'GET',
      ret: 'obj',
      paytoqs: 'ignore',
      url: `${baseUrl}/api/devices`,
      tls: '',
      persist: false,
      proxy: '',
      authType: '',
      x: x + 200,
      y: y,
      wires: [[mkId('filter')]]
    });

    // Фильтр по id устройства
    nodes.push({
      id: mkId('filter'),
      type: 'function',
      z: tabId,
      name: `filter id=${did}`,
      func: `var list = msg.payload || [];\nvar d = list.find(x => x.id === "${did}");\nmsg.payload = d ? d.state : null;\nreturn msg;`,
      outputs: 1,
      noerr: 0,
      initialize: '',
      finalize: '',
      libs: [],
      x: x + 400,
      y: y,
      wires: [[mkId('debug')]]
    });

    nodes.push({
      id: mkId('debug'),
      type: 'debug',
      z: tabId,
      name: `${name} (state)`,
      active: true,
      tosidebar: true,
      console: false,
      tostatus: false,
      complete: 'payload',
      targetType: 'msg',
      statusVal: '',
      statusType: 'auto',
      x: x + 600,
      y: y,
      wires: []
    });

    return nodes;
  }

  function openForDevice(id) {
    const d = (window.SH.getDevices() || []).find(x => x.id === id);
    if (!d) return;
    const nodes = buildWsFlow(d);
    const json = JSON.stringify(nodes, null, 2);
    window.SH.openModal(
      `🟥 Node-RED WS — ${d.name || d.id}`,
      'Polling через <code>/api/devices</code> каждые 2 сек. Импортируйте в Node-RED: <b>Меню → Import → Clipboard</b>.',
      json
    );
  }

  window.NodeRedWS = { openForDevice, buildWsFlow };
})();