/* ============================================================
   app.js — точка входа: refresh loop, SSE, init
   ============================================================ */

function setMode(m) {
  currentMode = m;
  document.getElementById('mode-user').classList.toggle('active', m === 'user');
  document.getElementById('mode-edit').classList.toggle('active', m === 'edit');
  api('/api/settings', 'POST', { mode: m }).catch(() => {});
  const v = document.getElementById('view-ui');
  const e = document.getElementById('edit-ui');
  if (v) v.style.display = (m === 'user') ? 'block' : 'none';
  if (e) e.style.display = (m === 'edit') ? 'block' : 'none';
  updateEditVisibility();
  refresh();
}

async function setState(id, patch) {
  const d = devicesCache.find(x => x.id === id);
  if (d) {
    for (const [k, v] of Object.entries(patch)) {
      const cur = d.state[k];
      if (typeof cur === 'boolean') d.state[k] = (v === true || v === 'true' || v === 1 || v === '1' || v === 'on');
      else if (typeof cur === 'number') d.state[k] = Number(v);
      else d.state[k] = v;
    }
    d.updated = new Date().toISOString().slice(0, 19);
    if (typeof refreshDeviceModal === 'function') refreshDeviceModal();
    if (currentView === 'grid') renderCurrentView();
  }

  try {
    await api('/api/devices/' + id + '/state', 'POST', patch);
  } catch (e) {
    console.error('[setState]', e);
  }

  setTimeout(refresh, 50);
}

function updateEditVisibility() {
  const edit = currentMode === 'edit';
  ['grid-toolbar', 'events-toolbar', 'scenarios-toolbar', 'timers-toolbar']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = edit ? 'flex' : 'none';
    });
  const bulk = document.getElementById('unassigned-toolbar');
  if (bulk) bulk.style.display = edit ? 'flex' : 'none';
}

function renderCurrentView() {
  if (currentMode === 'user') {
    renderViewUI();
    return;
  }
  try {
    if (currentView === 'grid') {
      withDetailsPreserved(() => {
        const grid = document.getElementById('grid');
        grid.classList.toggle('grid',      devicesLayout === 'grid');
        grid.classList.toggle('grid-list', devicesLayout === 'list');
        if (!devicesCache.length) {
          grid.innerHTML = '<div class="empty">Нет устройств.</div>';
          return;
        }
        if (devicesLayout === 'list') {
          snapshotGroupState();
          grid.innerHTML = renderDeviceListGrouped();
          restoreGroupState();
        } else {
          grid.innerHTML = devicesCache.map(renderCard).join('');
        }
      });
    } else if (currentView === 'plan') {
      renderPlanView();
    } else if (currentView === 'unassigned') {
      renderUnassigned();
    } else if (currentView === 'events') {
      if (!hasDirtyRows('events-view')) renderEvents();
    } else if (currentView === 'scenarios') {
      if (!hasDirtyRows('scenarios-view')) renderScenarios();
    } else if (currentView === 'timers') {
      if (!hasDirtyRows('timers-view')) renderTimers();
    } else if (currentView === 'mqtt-triggers') {
      renderMqttTriggers();
    } else if (currentView === 'lua') {
      if (!_luaEditorDirty) reloadLuaScripts().catch(() => {});
      renderLuaSidebar();
    } else if (currentView === 'knx-ga') {
      if (Array.isArray(knxGaCache) && knxGaCache.length) {
        try { renderKnxGaTable(); } catch (e) { console.error('[knx-ga]', e); }
      }
    }
  } catch (e) {
    console.error('[renderCurrentView]', e);
  }
}

function switchView(v) {
  currentView = v;
  ['grid','plan','unassigned','events','scenarios','timers','system',
   'mqtt-triggers','lua','knx-ga']
    .forEach(k => {
      const tab = document.getElementById('tab-' + k);
      if (tab) tab.classList.toggle('active', k === v);
      const el = document.getElementById(k + '-view');
      if (el) el.style.display = (k === v) ? 'block' : 'none';
    });

  _lastVersion = 0;
  _lastSlowFetch = 0;

  const heavy = {
    events: () => api('/api/events').then(r => { eventsCache = r; }),
    scenarios: () => Promise.all([
      api('/api/scenario_groups'),
      api('/api/scenarios'),
    ]).then(([g, s]) => { groupsCache = g; scenariosCache = s; }),
    timers: () => api('/api/timers').then(r => { timersCache = r; }),
    'mqtt-triggers': () => Promise.all([
      api('/api/mqtt_triggers'),
      api('/api/scenarios'),
    ]).then(([t, s]) => { mqttTriggersCache = t; scenariosCache = s; }),
  };

  if (v === 'lua') reloadLuaScripts().catch(() => {});
  if (v === 'knx-ga' && typeof knxGaReload === 'function') {
    try { knxGaReload().catch(e => console.error('[knx-ga] reload:', e)); }
    catch (e) { console.error('[knx-ga] sync error:', e); }
  }
  if (v === 'plan') {
    loadPlanImages().then(() => {
      if (currentMode === 'user') renderViewUI();
      else renderPlanView();
    });
  }
   if (v === 'system') {
    loadServerInfo().catch(() => {});
    loadTokens().catch(() => {});
    loadZ2MSettings().catch(() => {});
    loadModbusSettings().catch(() => {});
    loadKnxSettings().catch(() => {});
  //  loadUsers().catch(() => {});
  //  loadCustomTypes().catch(() => {});
    updateNotifyPermStatus();
    refreshLogsList?.();
    if (typeof loadTelegramSettings === 'function') loadTelegramSettings();
  }

  try { renderCurrentView(); }
  catch (e) { console.error('[switchView] renderCurrentView error:', e); }

  const runHeavy = heavy[v];
  if (runHeavy) {
    runHeavy().catch(() => {}).then(() => {
      try { renderCurrentView(); } catch (e) { console.error(e); }
    });
  }
  refresh();
}

/* --- SSE --- */
function startSSE() {
  if (_sse) return;
  try {
    _sse = new EventSource('/api/events/stream');
    _sse.onmessage = (e) => {
      const raw = e.data;
      if (!raw) return;
      if (raw === 'changed' || raw === 'init') {
        refresh();
        return;
      }
      try {
        const msg = JSON.parse(raw);
        if (!msg) return;
        if (msg.type === 'notify') {
          showBrowserNotification(msg.data || {});
        } else if (msg.type === 'lua_log') {
          const d = msg.data || {};
          if (d.script_id) addLuaLog(d.script_id, d.level || 'info', d.text || '');
        } else if (msg.type === 'server_log') {
          addServerLog(msg.data);
        }
      } catch (err) { /* ignore */ }
    };
  } catch (e) { /* ignore */ }
}

/* --- Refresh loop --- */
async function refresh() {
  if (_refreshPaused) return;
  if (currentView === 'lua' && _luaEditorDirty) return;
  try {
    let version = null;
    try { version = (await api('/api/version')).v; } catch (e) {}
    const versionChanged = (version !== null && version !== _lastVersion);
    if (version !== null) _lastVersion = version;

    const fastTasks = [
      api('/api/devices'),
      api('/api/plan/meta'),
      api('/api/settings'),
      api('/api/rooms'),
    ];

    const needSlow = (currentMode === 'edit'
                   && ['events','scenarios','timers','mqtt-triggers'].includes(currentView));
    const slowTasks = [];
    if (needSlow) {
      if (currentView === 'events') {
        slowTasks.push(api('/api/events'));
        slowTasks.push(api('/api/placeholders'));
      } else if (currentView === 'scenarios') {
        slowTasks.push(api('/api/scenario_groups'));
        slowTasks.push(api('/api/scenarios'));
        slowTasks.push(api('/api/placeholders'));
      } else if (currentView === 'timers') {
        slowTasks.push(api('/api/timers'));
        slowTasks.push(api('/api/placeholders'));
      } else if (currentView === 'mqtt-triggers') {
        slowTasks.push(api('/api/mqtt_triggers'));
        slowTasks.push(api('/api/scenarios'));
      } else if (currentView === 'lua' ||
    ['scenarios','timers','events'].includes(currentView)) {
        slowTasks.push(api('/api/lua_scripts'));
      }
    }

    const results = await Promise.all([...fastTasks, ...slowTasks]);
    const devs = results[0], planMeta = results[1], cfg = results[2], rms = results[3];
    devicesCache = devs;
    window.devicesCache = devicesCache;
    roomsCache   = rms;

    let i = 4;
    if (needSlow) {
      if (currentView === 'events') {
        eventsCache = results[i++];
        placeholdersCache = results[i++];
      } else if (currentView === 'scenarios') {
        groupsCache = results[i++];
        scenariosCache = results[i++];
        placeholdersCache = results[i++];
      } else if (currentView === 'timers') {
        timersCache = results[i++];
        placeholdersCache = results[i++];
      } else if (currentView === 'mqtt-triggers') {
        mqttTriggersCache = results[i++];
        scenariosCache = results[i++];
      } else if (currentView === 'lua' ||
    ['scenarios','timers','events'].includes(currentView)) {
        luaScriptsCache = results[i++] || [];
      }
    }

    const metaChanged = JSON.stringify(planMeta) !== JSON.stringify(_planMeta);
    _planMeta = planMeta;
    if (metaChanged && currentView === 'plan') loadPlanImages();

    if (cfg.mode !== currentMode) {
      currentMode = cfg.mode;
      document.getElementById('mode-user').classList.toggle('active', currentMode === 'user');
      document.getElementById('mode-edit').classList.toggle('active', currentMode === 'edit');
      const v = document.getElementById('view-ui');
      const e = document.getElementById('edit-ui');
      if (v) v.style.display = (currentMode === 'user') ? 'block' : 'none';
      if (e) e.style.display = (currentMode === 'edit') ? 'block' : 'none';
      updateEditVisibility();
    }

    const ae = document.activeElement;
    const isEditingField =
      ae && (ae.tagName === 'SELECT' || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
    const modalOpen = !!document.querySelector('#modal-overlay.open');
    const dragging = !!document.querySelector('.pin.dragging, .room-zone.dragging');
    const inCard = ae && ae.closest && ae.closest('.card[data-id], .view-card[data-id]');
    const detailsEditing = !!document.querySelector(
      '.card[data-id] details[open] input:focus, ' +
      '.card[data-id] details[open] textarea:focus, ' +
      '.card[data-id] details[open] select:focus'
    );
    const recentInteraction = (Date.now() - _lastInteraction) < INTERACTION_PAUSE;

    if (isEditingField || dragging || inCard || detailsEditing || recentInteraction) {
      return;
    }

    if (modalOpen && _modalDeviceId) {
      updateLiveFieldsInModal();
      return;
    }

    renderCurrentView();

    if (currentMode === 'edit' && currentView === 'grid') {
      loadAllZ2MFields().then(() => {
        if (currentView === 'grid') renderCurrentView();
      }).catch(() => {});
    }

    loadMqttSettings().catch(() => {});
    if (currentMode === 'edit' && currentView === 'system') {
      loadKnxSettings().catch(() => {});
    }
    const hasDraft = Object.keys(iconRulesDraft).length > 0;
    if (hasDraft) {
      updateLiveFieldsInModal();
      return;
    }
  } catch (e) { /* ignore */ }
}

if (currentMode === 'edit' && currentView === 'knx-ga' && !_knxGaEditing()) {
  knxGaReload().catch(() => {});
}

function _knxGaEditing() {
  const ae = document.activeElement;
  if (!ae) return false;
  const tbl = document.getElementById('knx-ga-table-wrap');
  if (!tbl) return false;
  return tbl.contains(ae) &&
    (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA');
}

function startRefreshLoop(ms) {
  if (_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(refresh, ms);
}

(async function init() {
  const cfg = await api('/api/settings');
  currentMode = cfg.mode || 'user';
  setMode(currentMode);
  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => requestNotificationPermission().catch(() => {}), 2000);
  }
  await loadServerInfo().catch(() => {});
  await loadPlanImages();
  await loadCustomTypes();
  await loadModbusSettings().catch(() => {});
  loadKnxSettings().catch(() => {});

  try {
    const saved = localStorage.getItem('devicesLayout');
    if (saved === 'list' || saved === 'grid') {
      devicesLayout = saved;
      setDevicesLayout(devicesLayout);
    }
  } catch (e) {}

  switchView('grid');
  refresh();

  const pollMs = cfg.poll_interval || 2000;
  startRefreshLoop(pollMs);
  startSSE();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
    } else {
      refresh();
      startRefreshLoop(pollMs);
    }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) noteInteraction();
  }, true);

  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'SELECT' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
      noteInteraction();
    }
  }, true);

  document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'type') {
      refreshEditTypeButton();
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'SELECT' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
      noteInteraction();
    }
  }, true);
})();