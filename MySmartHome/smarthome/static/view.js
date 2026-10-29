/* ============================================================
   view.js — точка входа страницы /view (только просмотр)
   Зависит от: constants.js, core.js,
               ui/modals.js, ui/devices.js, ui/charts.js, ui/plan.js
   ============================================================ */

/* Тема не переключается — user-режим по умолчанию */
currentMode = 'user';

/* ---------- Загрузка данных ---------- */
async function viewLoadDevices() {
  devicesCache = await api('/api/devices');
  window.devicesCache = devicesCache;
}

async function viewLoadRooms() {
  roomsCache = await api('/api/rooms');
}

async function viewLoadPlanImages() {
  try {
    const plan = await api('/api/plan');
    planMainImage  = (plan.main && plan.main.image) || null;
    planRoomImages = {};
    for (const [rid, entry] of Object.entries(plan.rooms || {})) {
      if (entry && entry.image) planRoomImages[rid] = entry.image;
    }
  } catch (e) {
    planMainImage  = null;
    planRoomImages = {};
  }
}

/* ---------- Стартовое состояние ---------- */
function viewInitState() {
  const initial = window.__VIEW_INITIAL_ROOM__;
  viewRoomId = (initial === null || initial === undefined || initial === '') ? null : initial;
  currentViewView = 'rooms';
}

/* ---------- Под-вкладки ---------- */
function viewSwitchViewView(v) {
  currentViewView = v;
  ['rooms','plan','all'].forEach(k => {
    const t = document.getElementById('vtab-' + k);
    if (t) t.classList.toggle('active', k === v);
    const el = document.getElementById('view-' + k + '-view');
    if (el) el.style.display = (k === v) ? 'block' : 'none';
  });

  if (v === 'plan') {
    renderViewUI();
    viewLoadPlanImages().then(() => renderViewUI());
  } else {
    renderViewUI();
  }
}

/* Переопределяем глобальную для view (не путать с app.js-версией) */
function switchViewView(v) { viewSwitchViewView(v); }

/* ---------- SSE (живые обновления) ---------- */
let _viewSSE = null;
function startViewSSE() {
  if (_viewSSE) return;
  try {
    _viewSSE = new EventSource('/api/events/stream');
    _viewSSE.onmessage = () => { viewRefresh(); };
    _viewSSE.onerror = () => {
      try { _viewSSE.close(); } catch (e) {}
      _viewSSE = null;
      setTimeout(startViewSSE, 3000);
    };
  } catch (e) {
    _viewSSE = null;
    setTimeout(startViewSSE, 3000);
  }
}

/* ---------- Основной refresh ---------- */
async function viewRefresh() {
  try {
    const [devs, rms, planMeta] = await Promise.all([
      api('/api/devices'),
      api('/api/rooms'),
      api('/api/plan/meta').catch(() => null),
    ]);
    devicesCache = devs;
    window.devicesCache = devicesCache;
    roomsCache = rms;

    if (planMeta) {
      const metaChanged = JSON.stringify(planMeta) !== JSON.stringify(_planMeta);
      _planMeta = planMeta;
      if (metaChanged && currentViewView === 'plan') {
        await viewLoadPlanImages();
      }
    }

    /* Не трогаем DOM, если пользователь что-то редактирует (в user-режиме почти не бывает) */
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) {
      return;
    }

    renderViewUI();
  } catch (e) {
    /* сеть моргнула — переживём */
  }
}

/* ---------- Инициализация ---------- */
(async function viewInit() {
  viewInitState();

  /* clock */
  function updateClock() {
    const now = new Date();
    const d = document.getElementById('date');
    const t = document.getElementById('time');
    if (d) d.textContent = now.toLocaleDateString('ru-RU', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
    }).replace(' г.', '');
    if (t) t.textContent = now.toLocaleTimeString('ru-RU', { hour12: false });
  }
  updateClock(); setInterval(updateClock, 1000);

  /* загрузка */
  await Promise.all([
    viewLoadDevices(),
    viewLoadRooms(),
    viewLoadPlanImages(),
    loadPlanCharts().catch(() => {}),
  ]);

  /* отрисовка */
  renderViewUI();

  /* SSE + fallback-опрос */
  startViewSSE();
  setInterval(() => {
    if (document.hidden) return;
    if (_viewSSE && _viewSSE.readyState === EventSource.OPEN) return;
    viewRefresh();
  }, 10000);

  /* восстановление после скрытия вкладки */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) viewRefresh();
  });

  /* закрытие модалки по Escape */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const chartModal = document.getElementById('chart-modal-overlay');
    if (chartModal && chartModal.classList.contains('open')) {
      closeChartModal();
      return;
    }
    closeDeviceModal();
  });
})();