/* ============================================================
   MQTT-топики: список, публикация, привязка к BACnet
   ============================================================ */

   let mqttTopicsCache = [];
   let _mqttTopicsTimer = null;
   let _mqttTopicsLoading = false;
   
   /* ============================================================
      Загрузка списка
      ============================================================ */
   
   async function loadMqttTopics() {
     if (_mqttTopicsLoading) return;
     _mqttTopicsLoading = true;
   
     const wrap = document.getElementById('mqtt-topics-table-wrap');
     if (wrap && !mqttTopicsCache.length) {
       wrap.innerHTML = '<div class="empty">Загрузка…</div>';
     }
   
     try {
       const data = await api('/api/mqtt/topics');
       mqttTopicsCache = Array.isArray(data) ? data : [];
       renderMqttTopics();
     } catch (e) {
       console.error('[mqtt-topics]', e);
       if (wrap) {
         wrap.innerHTML =
           `<div class="empty" style="color:#ff8a80;">
              Ошибка загрузки: ${esc(e.message || e)}
            </div>`;
       }
     } finally {
       _mqttTopicsLoading = false;
     }
   }
   
   /* ============================================================
      Автоопрос, пока вкладка открыта
      ============================================================ */
   
   function startMqttTopicsPolling() {
     stopMqttTopicsPolling();
     _mqttTopicsTimer = setInterval(() => {
       if (currentView !== 'mqtt-topics') return;
       const view = document.getElementById('mqtt-topics-view');
       if (view && view.style.display === 'none') return;
       loadMqttTopics().catch(() => {});
     }, 5000);
   }
   
   function stopMqttTopicsPolling() {
     if (_mqttTopicsTimer) {
       clearInterval(_mqttTopicsTimer);
       _mqttTopicsTimer = null;
     }
   }
   
   /* ============================================================
      Рендер таблицы
      ============================================================ */
   
      function renderMqttTopics() {
        const wrap = document.getElementById('mqtt-topics-table-wrap');
        if (!wrap) return;
      
        const searchEl = document.getElementById('mqtt-topics-search');
        const q = (searchEl ? searchEl.value : '').trim().toLowerCase();
      
        let list = mqttTopicsCache.slice();
        if (q) {
          list = list.filter(t =>
            (t.topic || '').toLowerCase().includes(q) ||
            (t.device_name || '').toLowerCase().includes(q) ||
            (t.field_name || '').toLowerCase().includes(q)
          );
        }
      
        if (!list.length) {
          wrap.innerHTML = '<div class="empty">Топики не найдены.</div>';
          return;
        }
      
        const rows = list.map(t => {
           const isAuto = t.is_auto;
           const isState = (t.role || '').startsWith('state');
           const roleLabel = isState ? '→ state' : '← sub';
           const roleColor = isState
             ? 'background:rgba(79,195,247,.15);color:#9cdcfe;'
             : 'background:rgba(76,175,80,.15);color:#9ccc65;';
           const role =
             `<span class="badge" style="${roleColor}${isAuto ? 'opacity:.7;' : ''}">
                ${roleLabel}${isAuto ? ' · auto' : ''}
              </span>`;
      
          const valStr = (t.value === null || t.value === undefined)
            ? '<span style="opacity:.4;">—</span>'
            : `<span style="font-family:monospace;color:#9ccc65;">${esc(String(t.value))}</span>`;
      
          // --- Проверяем, есть ли устройство в кеше и делаем строку кликабельной ---
          const hasDevice = t.device_id && devicesCache.some(d => d.id === t.device_id);
          const rowStyle = hasDevice ? 'cursor: pointer; transition: background 0.2s;' : '';
          const rowOnClick = hasDevice 
            ? `onclick="openDeviceFromMqttTopic('${t.device_id}')" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'"` 
            : '';
   
          const devNameHtml = hasDevice
            ? `<span style="text-decoration: underline; text-decoration-style: dotted;">${esc(t.device_name || '—')}</span> <span style="font-size:0.8em; opacity:0.6;" title="Открыть карточку устройства">↗</span>`
            : esc(t.device_name || '—');
   
          const devCell = `
            <div style="font-weight:600;">${devNameHtml}</div>
            <div style="font-size:.75rem;opacity:.65;font-family:monospace;">
              ${esc(t.device_id || '')}${t.field_name ? ' · ' + esc(t.field_name) : ''}
            </div>`;
          // ------------------------------------------------------------------------------
      
          const bacnetCell = t.bacnet_linked
            ? `<div style="display:flex; gap:.25rem; align-items:center;">
                 <span class="badge ok" title="${esc(t.bacnet_object || '')}">
                   🌐 ${esc(t.bacnet_object || 'linked')}
                 </span>
                 <button class="btn small danger"
                         onclick="event.stopPropagation(); unlinkMqttBacnetQuick('${escAttr(t.topic)}')"
                         title="Отвязать от BACnet">✕</button>
               </div>`
            : '<span class="badge off">— не привязан —</span>';
      
          const inputId = 'mqtt-pub-' + encodeURIComponent(t.id).replace(/%/g, '_');
      
          return `
            <tr data-mqtt-id="${esc(t.id)}" style="${rowStyle}" ${rowOnClick}>
              <td style="font-family:monospace; word-break:break-all; max-width:320px;">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                  <span>${esc(t.topic)}</span>
                  <button class="btn small gray" 
                          onclick="event.stopPropagation(); copyToClipboard('${escAttr(t.topic)}', this)" 
                          title="Копировать топик"
                          style="padding: 2px 6px; font-size: 0.75em; opacity: 0.6;">📋</button>
                </div>
                <span style="font-size:.72rem;opacity:.6;">${role}</span>
              </td>
              <td>${devCell}</td>
              <td>${valStr}</td>
              <td>
                <div style="display:flex; gap:.25rem; align-items:center;">
                  <input type="text" id="${inputId}" placeholder="значение"
                         onclick="event.stopPropagation()"
                         style="width:100px; min-width:80px; height:34px; padding:0 .55rem; 
                                background:rgba(255,255,255,.05); color:#eaf2fb; 
                                border:1px solid rgba(255,255,255,.14); border-radius:8px; 
                                font-size:.9rem; box-sizing:border-box; outline:none;">
                  <button class="btn small green"
                          onclick="event.stopPropagation(); publishMqttTopic('${escAttr(t.topic)}', '${inputId}')"
                          title="Опубликовать в топик">➡</button>
                </div>
              </td>
              <td>${bacnetCell}</td>
              <td>
                <button class="btn small gray"
                        onclick="event.stopPropagation(); openMqttBacnetModal('${escAttr(t.topic)}', '${escAttr(t.field_name || '')}')"
                        title="Привязать к BACnet">🌐</button>
              </td>
            </tr>`;
        }).join('');
      
        wrap.innerHTML = `
          <table class="mqtt-topics-table">
            <thead>
              <tr>
                <th>Топик</th>
                <th style="width:180px;">Устройство / поле</th>
                <th style="width:140px;">Значение</th>
                <th style="width:180px;">Публикация</th>
                <th style="width:170px;">BACnet</th>
                <th style="width:90px;">Действия</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div style="opacity:.55;font-size:.8rem;margin-top:.4rem;">
            Всего: ${list.length} из ${mqttTopicsCache.length}
          </div>`;
      }
   
   /* ============================================================
      Утилита: escape для атрибутов onclick
      ============================================================ */
   function escAttr(s) {
     return String(s ?? '')
       .replace(/\\/g, '\\\\')
       .replace(/'/g, "\\'")
       .replace(/"/g, '&quot;')
       .replace(/</g, '&lt;')
       .replace(/>/g, '&gt;');
   }
   
   /* ============================================================
      Публикация значения в MQTT-топик
      ============================================================ */
   
      async function publishMqttTopic(topic, inputId) {
        const input = document.getElementById(inputId);
        if (!input) return;
      
        const val = input.value;
        if (val === '') {
          input.focus();
          return;
        }
      
        // Ищем запись в кеше по отображаемому топику, чтобы взять raw_topic
        const rec = mqttTopicsCache.find(x => x.topic === topic);
        // Если есть raw_topic — используем его (там могут быть +, бэкенд их заменит)
        // Но бэкенд теперь тоже умеет работать с читаемыми топиками,
        // поэтому можно отправлять просто topic. Оставим topic.
        
        const btn = input.nextElementSibling;
        const oldText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
      
        try {
          await api('/api/mqtt/publish', 'POST', {
            topic: topic,
            payload: val,
          });
          input.value = '';
          
          if (rec) {
            const asNum = Number(val);
            rec.value = Number.isFinite(asNum) && String(asNum) === String(val).trim()
              ? asNum
              : val;
          }
          renderMqttTopics();
        } catch (e) {
          alert('Ошибка публикации: ' + e.message);
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = oldText || '➡'; }
        }
      }
   
   /* ============================================================
      Модалка: привязка MQTT-топика к BACnet
      ============================================================ */
   
   let _mqttBacnetTopic = '';
   let _mqttBacnetLinks = {};
   
   async function openMqttBacnetModal(topic, fieldName = '') {
    _mqttBacnetTopic = topic;
    window._currentMqttField = fieldName; 
    _mqttBacnetLinks = {};
  
    try {
      _mqttBacnetLinks = await api('/api/mqtt/bacnet_link') || {};
    } catch (e) {
      console.warn('[mqtt-topics] load links:', e);
    }
  
    const cur = _mqttBacnetLinks[topic] || {};
  
      // Ищем запись в кеше не только по топику, но и по полю (если передано)
      const rec = mqttTopicsCache.find(x => x.topic === topic && (!x.field_name || x.field_name === (window._currentMqttField || ''))) 
      || mqttTopicsCache.find(x => x.topic === topic) 
      || {};
      
const deviceId = cur.device_id || rec.device_id || '';
const field    = cur.field     || rec.field_name || '';
    const type     = cur.type      || (isBoolValue(rec.value) ? 'BV' : 'AV');
    const instance = cur.instance  || 1000;
    const isLinked = !!(cur.object || cur.type || cur.instance);
  
    // Удаляем старую модалку, если она осталась (на всякий случай)
    const old = document.getElementById('mqtt-bacnet-overlay');
    if (old) old.remove();
  
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'mqtt-bacnet-overlay';
    overlay.onclick = (ev) => {
      if (ev.target === overlay) closeMqttBacnetModal();
    };
  
    // Стили для инпутов, чтобы не зависеть от глобального CSS
    const inputStyle = "background:rgba(255,255,255,.05);color:#eaf2fb;border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:0 .55rem;height:34px;font-size:.9rem;width:100%;box-sizing:border-box;outline:none;";
  
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px; width:100%;">
        <button class="modal-close" onclick="closeMqttBacnetModal()" title="Закрыть">✕</button>
        <div style="padding:1.2rem;">
          <h3 style="margin:0 0 .8rem;">🌐 Привязка MQTT → BACnet</h3>
  
          <div class="form-row" style="margin-bottom:.6rem;">
            <label style="min-width:120px;">Топик</label>
            <div style="flex:1;font-family:monospace;font-size:.85rem;word-break:break-all;opacity:.9;">
              ${esc(topic)}
            </div>
          </div>
  
          <div class="form-row" style="margin-bottom:.6rem;">
            <label style="min-width:120px;">Устройство</label>
            <div style="flex:1;font-size:.9rem;">
              ${esc(rec.device_name || '—')}
              ${deviceId ? `<span style="opacity:.6;font-family:monospace;"> (${esc(deviceId)})</span>` : ''}
            </div>
          </div>
  
          <div class="form-row" style="margin-bottom:.6rem;">
            <label style="min-width:120px;">Поле</label>
            <input type="text" id="mb-field" value="${escAttr(field)}" placeholder="например, temp" style="${inputStyle}">
          </div>
  
          <div class="form-row" style="margin-bottom:.6rem;">
            <label style="min-width:120px;">Тип BACnet</label>
            <select id="mb-type" style="${inputStyle}">
              <option value="AV" ${type === 'AV' ? 'selected' : ''}>AV (AnalogValue, числа)</option>
              <option value="BV" ${type === 'BV' ? 'selected' : ''}>BV (BinaryValue, bool)</option>
            </select>
          </div>
  
          <div class="form-row" style="margin-bottom:.6rem;">
            <label style="min-width:120px;">Instance</label>
            <input type="number" id="mb-instance" min="0" max="4194302" value="${instance}" style="${inputStyle}">
          </div>
  
          <div id="mb-error" style="color:#ff8a80;font-size:.85rem;min-height:1.2em;margin-top:.3rem;"></div>
  
          <div style="display:flex;justify-content:space-between;gap:.5rem;margin-top:1rem;">
            <button class="btn danger" onclick="unlinkMqttBacnet()" ${isLinked ? '' : 'style="display:none;"'}>
              🗑 Отвязать
            </button>
            <div style="display:flex;gap:.5rem;">
              <button class="btn gray" onclick="closeMqttBacnetModal()">Отмена</button>
              <button class="btn primary" onclick="applyMqttBacnet()">💾 Привязать</button>
            </div>
          </div>
        </div>
      </div>`;
  
    document.body.appendChild(overlay);
    setTimeout(() => overlay.classList.add('open'), 10);
  }
   
   function isBoolValue(v) {
     return typeof v === 'boolean';
   }
   
   function closeMqttBacnetModal() {
     const overlay = document.getElementById('mqtt-bacnet-overlay');
     if (!overlay) return;
     overlay.classList.remove('open');
     setTimeout(() => overlay.remove(), 150);
   }
   
   async function applyMqttBacnet() {
     const errEl = document.getElementById('mb-error');
     if (errEl) errEl.textContent = '';
   
     const fieldEl = document.getElementById('mb-field');
     const typeEl  = document.getElementById('mb-type');
     const instEl  = document.getElementById('mb-instance');
   
     const field    = (fieldEl?.value || '').trim();
     const type     = typeEl?.value || 'AV';
     const instance = parseInt(instEl?.value || '1000', 10);
   
     if (!Number.isFinite(instance) || instance < 0 || instance > 4194302) {
       if (errEl) errEl.textContent = 'Некорректный instance (0..4194302)';
       return;
     }
   
     const rec = mqttTopicsCache.find(x => x.topic === _mqttBacnetTopic) || {};
   
     try {
       await api('/api/mqtt/bacnet_link', 'POST', {
         topic: _mqttBacnetTopic,
         type: type,
         instance: instance,
         device_id: rec.device_id || '',
         field: field || rec.field_name || '',
       });
   
       // Локально обновим состояние
       const cacheRec = mqttTopicsCache.find(x => x.topic === _mqttBacnetTopic);
       if (cacheRec) {
         cacheRec.bacnet_linked = true;
         cacheRec.bacnet_object = `${type},${instance}`;
       }
   
       closeMqttBacnetModal();
       renderMqttTopics();
     } catch (e) {
       if (errEl) errEl.textContent = 'Ошибка: ' + e.message;
     }
   }
   
   async function unlinkMqttBacnet() {
     if (!confirm('Отвязать этот топик от BACnet?')) return;
     const errEl = document.getElementById('mb-error');
     if (errEl) errEl.textContent = '';
   
     try {
       await api('/api/mqtt/bacnet_link', 'POST', {
         topic: _mqttBacnetTopic,
         unlink: true,
       });
   
       const cacheRec = mqttTopicsCache.find(x => x.topic === _mqttBacnetTopic);
       if (cacheRec) {
         cacheRec.bacnet_linked = false;
         cacheRec.bacnet_object = null;
       }
   
       closeMqttBacnetModal();
       renderMqttTopics();
     } catch (e) {
       if (errEl) errEl.textContent = 'Ошибка: ' + e.message;
     }
   }
   
   /* ============================================================
      Инициализация
      ============================================================ */
   
   document.addEventListener('DOMContentLoaded', () => {
     // Автоопрос запускается всегда; внутри проверка currentView
     startMqttTopicsPolling();
   
     // Esc закрывает модалку
     document.addEventListener('keydown', (e) => {
       if (e.key !== 'Escape') return;
       const overlay = document.getElementById('mqtt-bacnet-overlay');
       if (overlay && overlay.classList.contains('open')) {
         closeMqttBacnetModal();
       }
     });
   });

   async function unlinkMqttBacnetQuick(topic) {
    if (!confirm('Отвязать топик от BACnet?\n\n' + topic)) return;
  
    try {
      await api('/api/mqtt/bacnet_link', 'POST', {
        topic: topic,
        unlink: true,
      });
  
      // локально обновим кэш
      const rec = mqttTopicsCache.find(x => x.topic === topic);
      if (rec) {
        rec.bacnet_linked = false;
        rec.bacnet_object = null;
      }
  
      renderMqttTopics();
    } catch (e) {
      alert('Ошибка отвязки: ' + e.message);
    }
  }

/* ============================================================
   Открытие карточки устройства по клику на строку
   ============================================================ */
   function openDeviceFromMqttTopic(deviceId) {
    // Проверяем, существует ли функция открытия модалки (она в devices.js)
    if (typeof openDeviceModal === 'function') {
      // Закрываем модалку BACnet, если она открыта
      const bacnetOverlay = document.getElementById('bacnet-objects-overlay');
      if (bacnetOverlay) bacnetOverlay.classList.remove('open');
      
      // Открываем карточку
      openDeviceModal(deviceId);
    }
  }

  function copyToClipboard(text, btnEl) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        if (btnEl) {
          const old = btnEl.textContent;
          btnEl.textContent = '✅';
          setTimeout(() => btnEl.textContent = old, 1500);
        }
      }).catch(err => {
        console.error('Ошибка копирования:', err);
      });
    } else {
      // Fallback для старых браузеров
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        if (btnEl) {
          const old = btnEl.textContent;
          btnEl.textContent = '✅';
          setTimeout(() => btnEl.textContent = old, 1500);
        }
      } catch (err) {
        console.error('Ошибка копирования:', err);
      }
      document.body.removeChild(textArea);
    }
  }