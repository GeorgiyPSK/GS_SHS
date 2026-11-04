/* ============================================================
   BACnet: настройки и статус
   ============================================================ */

async function loadBacnetSettings() {
  try {
    const cfg = await api('/api/bacnet/settings');
    const st  = await api('/api/bacnet/status');

    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.value = v;
    };
    const setChk = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.checked = !!v;
    };

    setChk('bacnet-enabled', cfg.enabled);
    setVal('bacnet-ip', cfg.ip || '0.0.0.0/24');
    setVal('bacnet-port', cfg.port || 47808);
    setVal('bacnet-device-id', cfg.device_id || 1001);
    setVal('bacnet-device-name', cfg.device_name || 'GS-Smart');

    const line = document.getElementById('bacnet-status-line');
    if (line) {
      if (!st.available) {
        line.textContent = '⚠ BAC0 не установлен (pip install BAC0)';
        line.style.color = '#ffb74d';
      } else if (!cfg.enabled) {
        line.textContent = 'BACnet выключен';
        line.style.color = '#bbb';
      } else if (!st.started) {
        line.textContent = '❌ Не запущен' +
          (st.last_error ? ': ' + st.last_error : '');
        line.style.color = '#ef5350';
      } else {
        line.textContent = `✅ Работает · опубликовано: ${(st.published || []).length}`;
        line.style.color = '#4caf50';
      }
    }

    const list = document.getElementById('bacnet-published-list');
    if (list) {
      const items = (st.published || []).map(([addr, info]) =>
        `<div>${esc(addr)} → <b>${esc(info.object)}</b> (${esc(info.name)})</div>`
      ).join('');
      list.innerHTML = items ||
        '<div style="opacity:.6;">Пока ничего не опубликовано. Поставьте чекбокс у GA на вкладке «KNX-адреса».</div>';
    }
  } catch (e) {
    console.warn('[bacnet] load settings error:', e);
    const line = document.getElementById('bacnet-status-line');
    if (line) {
      line.textContent = '⚠ Не удалось загрузить настройки BACnet: ' + e.message;
      line.style.color = '#ef5350';
    }
  }
}

async function saveBacnetSettings() {
  const body = {
    enabled:     !!document.getElementById('bacnet-enabled')?.checked,
    ip:          document.getElementById('bacnet-ip')?.value || '0.0.0.0/24',
    port:        parseInt(document.getElementById('bacnet-port')?.value || '47808', 10),
    device_id:   parseInt(document.getElementById('bacnet-device-id')?.value || '1001', 10),
    device_name: document.getElementById('bacnet-device-name')?.value || 'GS-Smart',
  };

  const line = document.getElementById('bacnet-status-line');
  if (line) {
    line.textContent = '⏳ Запуск BACnet…';
    line.style.color = '#ffb74d';
  }

  try {
    await api('/api/bacnet/settings', 'POST', body);

    // ждём до 10 сек, пока сервер не запустится (или не выключится)
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const st = await api('/api/bacnet/status');
      if (!body.enabled) break;              // выключили — ждать нечего
      if (st.started) break;                 // запустился — выходим
      if (st.last_error) break;              // ошибка — выходим, покажем её
      await new Promise(r => setTimeout(r, 500));
    }

    await loadBacnetSettings();
  } catch (e) {
    alert('BACnet: ' + e.message);
    await loadBacnetSettings();
  }
}

let _bacnetPollTimer = null;

function startBacnetPolling() {
  stopBacnetPolling();
  _bacnetPollTimer = setInterval(() => {
    // опрашиваем только если вкладка BACnet открыта
    const view = document.getElementById('bacnet-view');
    if (view && view.style.display !== 'none') {
      loadBacnetSettings().catch(() => {});
    }
  }, 5000);
}

function stopBacnetPolling() {
  if (_bacnetPollTimer) {
    clearInterval(_bacnetPollTimer);
    _bacnetPollTimer = null;
  }
}

document.addEventListener('DOMContentLoaded', startBacnetPolling);