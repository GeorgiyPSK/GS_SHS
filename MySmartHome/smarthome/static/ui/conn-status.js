/* ============================================================
   conn-status.js - индикаторы состояния соединений в шапке
   ============================================================ */

   const CONN_POLL_INTERVAL_MS = 5000;
   const CONN_STALE_MS = 15000;
   
   const CONN_LAST_OK = {};
   const CONN_DISABLED_ENDPOINTS = new Set(); // 404 -> больше не дергаем
   const _connCache = new Map();               // path -> { at, value }
   
   /* ---------- fetch с кэшем 404 и минутным TTL ---------- */
   
   async function connFetch(path) {
    if (CONN_DISABLED_ENDPOINTS.has(path)) return { __missing: true };
  
    const hit = _connCache.get(path);
    if (hit && Date.now() - hit.at < 1000) return hit.value;
  
    try {
      const r = await fetch(path, { cache: 'no-store' });
      let value;
      if (r.status === 404) {
        CONN_DISABLED_ENDPOINTS.add(path);
        value = { __missing: true };
      } else if (!r.ok) {
        value = { __error: 'HTTP ' + r.status };
      } else {
        value = await r.json();
      }
      _connCache.set(path, { at: Date.now(), value });
      return value;
    } catch (e) {
      // Сетевой сбой (ERR_NETWORK_CHANGED, ERR_INTERNET_DISCONNECTED,
      // ERR_CONNECTION_REFUSED и т.п.) — это НЕ повод считать
      // эндпоинт «мёртвым». Возвращаем "нет данных", но НЕ кэшируем
      // надолго — на следующем тике попробуем снова.
      return { __error: 'network' };
    }
  }
   
   /* ---------- установка состояния пилюли ---------- */
   
   function connSetState(key, state, tooltip) {
     const el = document.getElementById('conn-' + key);
     if (!el) return;
     el.dataset.state = state || 'unknown';
     if (tooltip) el.title = tooltip;
     if (state === 'ok') CONN_LAST_OK[key] = Date.now();
   }
   
   /* ============================================================
      MQTT
      ============================================================ */
   
      async function connFetchMqtt() {
        const j = await connFetch('/api/mqtt/status');
      
        // сеть/404/ошибка сервера — статус неизвестен, не считаем «выключено»
        if (j.__missing) {
          connSetState('mqtt', 'off', 'MQTT: эндпоинт недоступен');
          return;
        }
        if (j.__error) {
          connSetState('mqtt', 'unknown', 'MQTT: нет ответа (сеть?)');
          return;
        }
      
        // 1) включён ли MQTT в настройках?
        //    сначала смотрим enabled, если нет — по available
        const enabled = (j.enabled !== undefined)
          ? !!j.enabled
          : (j.available !== undefined ? !!j.available : true);
      
        if (!enabled) {
          connSetState('mqtt', 'off', 'MQTT выключен в настройках');
          return;
        }
      
        // 2) библиотека установлена?
        if (j.available === false) {
          connSetState('mqtt', 'off',
            'MQTT: библиотека paho-mqtt не установлена');
          return;
        }
      
        // 3) есть ли соединение?
        const where = (j.host ? j.host + ':' + (j.port || 1883) : '');
        if (j.connected) {
          connSetState('mqtt', 'ok',
            'MQTT подключён' + (where ? ': ' + where : ''));
        } else {
          connSetState('mqtt', 'err',
            'MQTT не подключён' + (where ? ' (' + where + ')' : '') +
            (j.error ? ': ' + j.error : ''));
        }
      }
   
   /* ============================================================
      KNX
      ============================================================ */
   
   async function connFetchKnx() {
     const j = await connFetch('/api/knx/status');
   
     if (j.__missing || j.__error) {
       connSetState('knx', 'off', 'KNX: нет API статуса');
       return;
     }
   
     // enabled отсутствует → используем available/running (для совместимости)
     const supported = j.enabled !== undefined
       ? !!j.enabled
       : !!(j.available || j.running);
   
     if (!supported) {
       connSetState('knx', 'off', 'KNX выключен');
       return;
     }
   
     if (j.connected) {
       const ct = j.connection_type ? ' (' + j.connection_type + ')' : '';
       connSetState('knx', 'ok', 'KNX подключён' + ct);
     } else {
       const err = j.last_error || j.error || '';
       connSetState('knx', 'err', 'KNX не подключён' + (err ? ': ' + err : ''));
     }
   }
   
   /* ============================================================
      Modbus
      ============================================================ */
   
   async function connFetchModbus() {
     const j = await connFetch('/api/modbus/status');
   
     if (j.__missing || j.__error) {
       connSetState('modbus', 'off', 'Modbus: статус недоступен');
       return;
     }
   
     if (j.enabled === false) {
       connSetState('modbus', 'off', 'Modbus выключен');
       return;
     }
   
     const total  = j.devices_total  || 0;
     const failed = j.devices_failed || 0;
   
     if (total === 0) {
       connSetState('modbus', 'off', 'Нет Modbus-устройств');
     } else if (failed === 0) {
       connSetState('modbus', 'ok',
         'Modbus: ' + total + ' устройств опрашиваются без ошибок');
     } else if (failed < total) {
       connSetState('modbus', 'warn',
         'Modbus: ошибки у ' + failed + ' из ' + total);
     } else {
       connSetState('modbus', 'err',
         'Modbus: все ' + total + ' устройств недоступны');
     }
   }
   
   /* ============================================================
      Zigbee2MQTT
      ============================================================ */
   
   async function connFetchZ2M() {
     const j = await connFetch('/api/z2m/status');
   
     if (j.__missing || j.__error) {
       const cfg = await connFetch('/api/config');
       const z2m = (cfg && (cfg.zigbee2mqtt || cfg.z2m)) || {};
       if (!z2m.enabled) {
         connSetState('z2m', 'off', 'Zigbee2MQTT выключен');
       } else {
         connSetState('z2m', 'warn', 'Z2M включён (нет API статуса)');
       }
       return;
     }
   
     if (!j.enabled) {
       connSetState('z2m', 'off', 'Zigbee2MQTT выключен');
       return;
     }
     if (j.mqtt_bridge_online) {
       connSetState('z2m', 'ok',
         'Z2M bridge online, устройств: ' + (j.devices_count || '?'));
     } else if (j.mqtt_connected) {
       connSetState('z2m', 'warn',
         'Z2M: MQTT есть, но bridge/state не online');
     } else {
       connSetState('z2m', 'err', 'Z2M: MQTT не подключён');
     }
   }
   
   /* ============================================================
      Telegram
      ============================================================ */
   
   async function connFetchTelegram() {
     const j = await connFetch('/api/telegram/status');
   
     if (j.__missing || j.__error) {
       const cfg = await connFetch('/api/config');
       const tg = (cfg && cfg.telegram) || {};
       if (!tg.enabled) {
         connSetState('telegram', 'off', 'Telegram выключен');
       } else if (tg.token) {
         connSetState('telegram', 'warn',
           'Telegram включён (нет API статуса)');
       } else {
         connSetState('telegram', 'warn',
           'Telegram включён, но token не задан');
       }
       return;
     }
   
     if (!j.enabled) {
       connSetState('telegram', 'off', 'Telegram выключен');
       return;
     }
     if (j.ok) {
       connSetState('telegram', 'ok',
         'Telegram OK' + (j.username ? ' @' + j.username : ''));
     } else {
       connSetState('telegram', 'err',
         'Telegram ошибка' + (j.error ? ': ' + j.error : ''));
     }
   }
   
   /* ============================================================
      Оркестрация
      ============================================================ */
   
   let _connTimer = null;
   
   async function refreshConnStatus() {
     await Promise.allSettled([
       connFetchMqtt(),
       connFetchKnx(),
       connFetchModbus(),
       connFetchZ2M(),
       connFetchTelegram(),
     ]);
   
     const now = Date.now();
     const keys = ['mqtt', 'knx', 'modbus', 'z2m', 'telegram'];
     for (let i = 0; i < keys.length; i++) {
       const key = keys[i];
       const el = document.getElementById('conn-' + key);
       if (!el) continue;
       if (el.dataset.state === 'ok' &&
           now - (CONN_LAST_OK[key] || 0) > CONN_STALE_MS) {
         el.dataset.state = 'unknown';
       }
     }
   }
   
   function startConnStatusPolling() {
     if (_connTimer) return;
     refreshConnStatus();
     _connTimer = setInterval(refreshConnStatus, CONN_POLL_INTERVAL_MS);
   }
   
   function stopConnStatusPolling() {
     if (_connTimer) {
       clearInterval(_connTimer);
       _connTimer = null;
     }
   }
   
   document.addEventListener('DOMContentLoaded', startConnStatusPolling);
   
   document.addEventListener('visibilitychange', function () {
     if (document.hidden) stopConnStatusPolling();
     else startConnStatusPolling();
   });
   
   window.refreshConnStatus = refreshConnStatus;