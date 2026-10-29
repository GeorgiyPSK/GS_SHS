/* ============================================================
   Генерация cURL-команд для устройства.
   ============================================================ */
(function () {
  'use strict';

  function buildCurlCommands(d) {
    const did = d.id;
    const baseUrl = window.location.origin;
    const fields = Object.keys(d.state || {});
    const lines = [];

    lines.push(`# Устройство: ${d.name || did} (${did})`);
    lines.push(`# Тип: ${d.type}`);
    lines.push('');
    lines.push(`# 1) Прочитать состояние всех устройств`);
    lines.push(`curl -s ${baseUrl}/api/devices | jq '.[] | select(.id=="${did}")'`);
    lines.push('');
    lines.push(`# 2) Прочитать одно устройство (если есть прямой эндпоинт — сейчас его нет)`);
    lines.push(`# curl -s ${baseUrl}/api/devices | jq '.[] | select(.id=="${did}")'`);
    lines.push('');
    lines.push(`# 3) Установить состояние поля`);
    for (const field of fields) {
      const cur = d.state[field];
      let example;
      if (typeof cur === 'boolean') example = !cur;
      else if (typeof cur === 'number') example = cur + 1;
      else example = 'новое_значение';

      lines.push('');
      lines.push(`# ${field} (сейчас: ${JSON.stringify(cur)})`);
      lines.push(`curl -s -X POST ${baseUrl}/api/devices/${did}/state \\`);
      lines.push(`  -H "Content-Type: application/json" \\`);
      lines.push(`  -H "Cookie: session=<ВАША_СЕССИЯ>" \\`);
      lines.push(`  -d '${JSON.stringify({ [field]: example })}'`);
    }

    lines.push('');
    lines.push(`# 4) Если используешь API-токен вместо cookie:`);
    lines.push(`# curl -s -X POST ${baseUrl}/api/devices/${did}/state \\`);
    lines.push(`#   -H "Authorization: Bearer <ТОКЕН>" \\`);
    lines.push(`#   -H "Content-Type: application/json" \\`);
    lines.push(`#   -d '{"field": "value"}'`);
    lines.push('');
    lines.push(`# 5) Посмотреть логин-сессию в браузере:`);
    lines.push(`#   DevTools → Application → Cookies → session`);

    return lines.join('\n');
  }

  function openForDevice(id) {
    const d = (window.SH.getDevices() || []).find(x => x.id === id);
    if (!d) return;
    const text = buildCurlCommands(d);
    window.SH.openModal(
      `🐚 cURL — ${d.name || d.id}`,
      'Скопируйте команды и вставьте в терминал. Требуется cookie сессии или API-токен.',
      text
    );
  }

  window.HttpCurl = { openForDevice, buildCurlCommands };
})();