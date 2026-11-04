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

/* ============================================================
   Модалка: объекты BACnet
   ============================================================ */

   let _bacnetObjectsTimer = null;
   let _bacnetObjectsData = [];
   let _bacnetObjectsLastFetch = 0;
   
   async function openBacnetObjectsModal() {
     const overlay = document.getElementById('bacnet-objects-overlay');
     if (!overlay) return;
     overlay.classList.add('open');
   
     const searchEl = document.getElementById('bacnet-objects-search');
     if (searchEl) searchEl.value = '';
   
     await refreshBacnetObjects();
     // автоопрос раз в 2 секунды, пока модалка открыта
     stopBacnetObjectsPolling();
     _bacnetObjectsTimer = setInterval(() => {
       if (!overlay.classList.contains('open')) {
         stopBacnetObjectsPolling();
         return;
       }
       refreshBacnetObjects().catch(() => {});
     }, 2000);
   }
   
   function closeBacnetObjectsModal() {
     const overlay = document.getElementById('bacnet-objects-overlay');
     if (overlay) overlay.classList.remove('open');
     stopBacnetObjectsPolling();
   }
   
   function stopBacnetObjectsPolling() {
     if (_bacnetObjectsTimer) {
       clearInterval(_bacnetObjectsTimer);
       _bacnetObjectsTimer = null;
     }
   }
   
   async function refreshBacnetObjects() {
    const now = Date.now();
    if (now - _bacnetObjectsLastFetch < 1000) return;
    _bacnetObjectsLastFetch = now;
  
    let st;
    try {
      st = await api('/api/bacnet/status');
    } catch (e) {
      const body = document.getElementById('bacnet-objects-body');
      if (body) {
        body.innerHTML = `<div class="bacnet-empty">
          ⚠ Не удалось загрузить статус: ${esc(e.message)}
        </div>`;
      }
      return;
    }
  
    // Гарантированно подгружаем GA-реестр, чтобы получить name/value/dpt.
    // Не полагаемся на window.knxGaCache — он может быть пустым,
    // если пользователь не открывал вкладку «KNX-адреса».
    let gasList = [];
    try {
      // Если knxGaCache уже загружен и не пуст — используем его,
      // но только если он "свежий" (последний раз грузили < 30 сек назад)
      if (Array.isArray(window.knxGaCache) && window.knxGaCache.length) {
        gasList = window.knxGaCache;
      } else {
        gasList = await api('/api/knx/group_addresses');
        window.knxGaCache = gasList;   // кэш пригодится и на вкладке KNX
      }
    } catch (e) {
      // fallback: без GA-данных — покажем хотя бы Object ID
      gasList = [];
    }
  
    const gasByAddr = {};
    for (const g of gasList) gasByAddr[g.address] = g;
  
    _bacnetObjectsData = (st.published || []).map(([addr, info]) => {
      const ga = gasByAddr[addr] || {};
      return {
        address: addr,
        name: ga.name || info.name || '',
        // Если есть в KNX-реестре — берем оттуда, иначе из info.value
        value: ga.value !== undefined ? ga.value : info.value, 
        dpt: ga.dpt || '',
        object: info.object || '',
        instance: info.instance || '',
        type: info.type || '',
        objName: info.name || '',
      };
    });
  
    renderBacnetObjectsTable();
  }
   
  function renderBacnetObjectsTable() {
    const body = document.getElementById('bacnet-objects-body');
    const countEl = document.getElementById('bacnet-objects-count');
    if (!body) return;
  
    const q = (document.getElementById('bacnet-objects-search')?.value || '')
      .trim().toLowerCase();
  
    let list = _bacnetObjectsData.slice();
    if (q) {
      list = list.filter(r =>
        (r.address || '').toLowerCase().includes(q) ||
        (r.name || '').toLowerCase().includes(q) ||
        (r.object || '').toLowerCase().includes(q) ||
        (r.objName || '').toLowerCase().includes(q)
      );
    }
  
    if (countEl) {
      countEl.textContent = q
        ? `Найдено: ${list.length} из ${_bacnetObjectsData.length}`
        : `${_bacnetObjectsData.length} объектов`;
    }
  
    if (!list.length) {
      body.innerHTML = `
        <div class="bacnet-empty">
          ${q
            ? 'Ничего не найдено'
            : 'Пока ничего не опубликовано.<br>Отметьте чекбоксы у GA на вкладке «KNX-адреса» или в карточках устройств.'}
        </div>`;
      return;
    }
  
    const fmtValue = (v, dpt) => {
      if (v === null || v === undefined) return '<span style="opacity:.4;">—</span>';
      if (typeof v === 'boolean') {
        return `<span class="bacnet-value bacnet-value-bool">${v ? 'true' : 'false'}</span>`;
      }
      if (typeof v === 'number') {
        const s = Number.isInteger(v) ? String(v) : v.toFixed(2);
        return `<span class="bacnet-value bacnet-value-num">${s}</span>`;
      }
      return `<span class="bacnet-value">${esc(String(v))}</span>`;
    };
  
    const fmtObj = (r) => {
      const cls = 'bacnet-objid bacnet-objid-' + (r.type || '');
      return `<span class="${cls}" title="${esc(r.objName)}">${esc(r.object)}</span>`;
    };
  
    body.innerHTML = `
      <table>
        <thead>
          <tr>
            <th style="width:110px;">Адрес</th>
            <th>Имя</th>
            <th style="width:140px;">Значение</th>
            <th style="width:100px;">DPT</th>
            <th style="width:160px;">Object ID</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(r => {
            // Пытаемся найти device_id для этой строки
            let deviceId = null;

            // 1. Если это поле устройства (формат did:field)
            if (r.address.includes(':')) {
              deviceId = r.address.split(':')[0];
            } 
            // 2. Если это MQTT-топик, ищем в mqtt_bacnet_links
            else {
              const mqttLinks = window.mqttBacnetLinksCache || {};
              if (mqttLinks[r.address] && mqttLinks[r.address].device_id) {
                deviceId = mqttLinks[r.address].device_id;
              }
            }

            // Проверяем, существует ли такое устройство в кеше
            const hasDevice = deviceId && devicesCache.some(d => d.id === deviceId);
            
            // Добавляем стиль и обработчик клика, если устройство найдено
            const rowStyle = hasDevice ? 'cursor: pointer; transition: background 0.2s;' : '';
            const rowOnClick = hasDevice ? `onclick="openDeviceFromBacnet('${deviceId}')" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'"` : '';
            
            // Добавляем иконку, если есть привязка к устройству
            const nameHtml = hasDevice 
              ? `<span style="text-decoration: underline; text-decoration-style: dotted;">${esc(r.name || '—')}</span> <span style="font-size:0.8em; opacity:0.6;" title="Открыть карточку устройства">↗</span>`
              : esc(r.name || '—');

            return `
              <tr style="${rowStyle}" ${rowOnClick}>
                <td class="bacnet-addr">${esc(r.address)}</td>
                <td>${nameHtml}</td>
                <td>${fmtValue(r.value, r.dpt)}</td>
                <td style="font-family:monospace; opacity:.7;">${esc(r.dpt || '')}</td>
                <td>${fmtObj(r)}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

// Функция для открытия карточки устройства из таблицы BACnet
function openDeviceFromBacnet(deviceId) {
  // Закрываем модалку BACnet, чтобы не было двух модалок поверх друг друга
  const overlay = document.getElementById('bacnet-objects-overlay');
  if (overlay) overlay.classList.remove('open');
  
  // Открываем карточку устройства
  if (typeof openDeviceModal === 'function') {
    openDeviceModal(deviceId);
  }
}

// Расширяем refreshBacnetObjects, чтобы подгружать MQTT-привязки
async function refreshBacnetObjects() {
  const now = Date.now();
  if (now - _bacnetObjectsLastFetch < 1000) return;
  _bacnetObjectsLastFetch = now;

  let st;
  try {
    st = await api('/api/bacnet/status');
  } catch (e) {
    const body = document.getElementById('bacnet-objects-body');
    if (body) {
      body.innerHTML = `<div class="bacnet-empty">
        ⚠ Не удалось загрузить статус: ${esc(e.message)}
      </div>`;
    }
    return;
  }

  // Загружаем GA-реестр
  let gasList = [];
  try {
    if (Array.isArray(window.knxGaCache) && window.knxGaCache.length) {
      gasList = window.knxGaCache;
    } else {
      gasList = await api('/api/knx/group_addresses');
      window.knxGaCache = gasList;
    }
  } catch (e) {
    gasList = [];
  }

  const gasByAddr = {};
  for (const g of gasList) gasByAddr[g.address] = g;

  // Загружаем привязки MQTT к BACnet (чтобы знать, к какому устройству относится топик)
  try {
    const mqttLinks = await api('/api/mqtt/bacnet_link'); // GET
    window.mqttBacnetLinksCache = mqttLinks || {};
  } catch (e) {
    window.mqttBacnetLinksCache = {};
  }

  _bacnetObjectsData = (st.published || []).map(([addr, info]) => {
    const ga = gasByAddr[addr] || {};
    return {
      address: addr,
      name: ga.name || info.name || '',
      value: (ga.value !== undefined && ga.value !== null) ? ga.value : info.value,
      dpt: ga.dpt || '',
      object: info.object || '',
      instance: info.instance || '',
      type: info.type || '',
      objName: info.name || '',
    };
  });

  renderBacnetObjectsTable();
}

   document.addEventListener('keydown', (e) => {
     if (e.key !== 'Escape') return;
     const overlay = document.getElementById('bacnet-objects-overlay');
     if (overlay && overlay.classList.contains('open')) {
       closeBacnetObjectsModal();
     }
   });

