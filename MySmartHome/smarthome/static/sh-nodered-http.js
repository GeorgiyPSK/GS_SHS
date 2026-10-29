/* ============================================================
   Node-RED через HTTP: чтение и управление устройством.
   Управление — POST /api/devices/<id>/state.
   Авторизация — Authorization: Bearer <токен>.
   ============================================================ */
(function () {
  'use strict';

  function buildHttpFlow(d, token) {
    const did = d.id;
    const name = d.name || did;
    const tabId = `sh-http-tab-${did}`;
    const baseUrl = window.location.origin;
    const fields = Object.keys(d.state || {});
    const bearer = token || '<ВСТАВЬТЕ_ТОКЕН>';

    const nodes = [];
    const mkId = (s) => `${did}-http-${s}`;
    let x = 120;
    let y = 100;

    // Вкладка
    nodes.push({
      id: tabId,
      type: 'tab',
      label: 'SmartHome HTTP: ' + name,
      disabled: false,
      info: 'HTTP через /api/devices. Заголовок Authorization: Bearer ...'
    });

    // --- read state ---
    nodes.push({
      id: mkId('inject-get'),
      type: 'inject',
      z: tabId,
      name: 'read state',
      props: [{ p: 'payload' }],
      repeat: '',
      crontab: '',
      once: true,
      onceDelay: 0.1,
      topic: '',
      payload: '',
      payloadType: 'date',
      x: x,
      y: y,
      wires: [[mkId('fn-auth-get')]]
    });

    nodes.push({
      id: mkId('fn-auth-get'),
      type: 'function',
      z: tabId,
      name: 'auth header',
      func:
        'msg.headers = msg.headers || {};\n' +
        'msg.headers["Authorization"] = "Bearer ' + bearer + '";\n' +
        'return msg;',
      outputs: 1,
      noerr: 0,
      initialize: '',
      finalize: '',
      libs: [],
      x: x + 180,
      y: y,
      wires: [[mkId('req-get')]]
    });

    nodes.push({
      id: mkId('req-get'),
      type: 'http request',
      z: tabId,
      name: 'GET /api/devices',
      method: 'GET',
      ret: 'obj',
      paytoqs: 'ignore',
      url: baseUrl + '/api/devices',
      tls: '',
      persist: false,
      proxy: '',
      authType: '',
      x: x + 380,
      y: y,
      wires: [[mkId('fn-find')]]
    });

    nodes.push({
      id: mkId('fn-find'),
      type: 'function',
      z: tabId,
      name: 'find ' + did,
      func:
        'var list = msg.payload;\n' +
        'if (!Array.isArray(list)) {\n' +
        '  node.warn("payload is not array");\n' +
        '  msg.payload = null;\n' +
        '  return msg;\n' +
        '}\n' +
        'var d = list.find(function (x) { return x && x.id === "' + did + '"; });\n' +
        'msg.payload = d ? d.state : null;\n' +
        'return msg;',
      outputs: 1,
      noerr: 0,
      initialize: '',
      finalize: '',
      libs: [],
      x: x + 580,
      y: y,
      wires: [[mkId('debug')]]
    });

    nodes.push({
      id: mkId('debug'),
      type: 'debug',
      z: tabId,
      name: name + ' (state)',
      active: true,
      tosidebar: true,
      console: false,
      tostatus: false,
      complete: 'payload',
      targetType: 'msg',
      statusVal: '',
      statusType: 'auto',
      x: x + 780,
      y: y,
      wires: []
    });

    y += 100;

    // --- set field для каждого поля ---
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];

      nodes.push({
        id: mkId('inj-' + field),
        type: 'inject',
        z: tabId,
        name: 'set ' + field,
        props: [{ p: 'payload', v: '{"' + field + '": ""}', vt: 'json' }],
        repeat: '',
        crontab: '',
        once: false,
        onceDelay: 0.1,
        topic: '',
        payload: '',
        payloadType: 'date',
        x: x,
        y: y,
        wires: [[mkId('fn-auth-' + field)]]
      });

      nodes.push({
        id: mkId('fn-auth-' + field),
        type: 'function',
        z: tabId,
        name: 'auth header',
        func:
          'msg.headers = msg.headers || {};\n' +
          'msg.headers["Authorization"] = "Bearer ' + bearer + '";\n' +
          'return msg;',
        outputs: 1,
        noerr: 0,
        initialize: '',
        finalize: '',
        libs: [],
        x: x + 180,
        y: y,
        wires: [[mkId('req-' + field)]]
      });

      nodes.push({
        id: mkId('req-' + field),
        type: 'http request',
        z: tabId,
        name: 'POST ' + field,
        method: 'POST',
        ret: 'obj',
        paytoqs: 'ignore',
        url: baseUrl + '/api/devices/' + did + '/state',
        tls: '',
        persist: false,
        proxy: '',
        authType: '',
        x: x + 380,
        y: y,
        wires: [[mkId('debug-post-' + field)]]
      });

      nodes.push({
        id: mkId('debug-post-' + field),
        type: 'debug',
        z: tabId,
        name: field + ' response',
        active: true,
        tosidebar: true,
        console: false,
        tostatus: false,
        complete: 'payload',
        targetType: 'msg',
        statusVal: '',
        statusType: 'auto',
        x: x + 580,
        y: y,
        wires: []
      });

      y += 90;
    }

    return nodes;
  }

  function openForDevice(id) {
    const devices = (window.SH && window.SH.getDevices && window.SH.getDevices()) || [];
    const d = devices.find(function (x) { return x.id === id; });
    if (!d) return;

    const token = prompt(
      'Вставьте API-токен (создаётся в «Настройка → Система → API-токены»):',
      ''
    );
    if (!token) return;

    const nodes = buildHttpFlow(d, token.trim());
    const json = JSON.stringify(nodes, null, 2);

    window.SH.openModal(
      '🟥 Node-RED HTTP — ' + (d.name || d.id),
      'Токен встроен в ноды. Импортируйте в Node-RED: <b>Меню → Import → Clipboard</b>.',
      json
    );
  }

  window.NodeRedHttp = {
    openForDevice: openForDevice,
    buildHttpFlow: buildHttpFlow,
  };
})();