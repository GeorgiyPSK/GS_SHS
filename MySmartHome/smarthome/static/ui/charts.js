/* ============================================================
   Графики: Chart.js (модалка + виджеты на плане)
   ============================================================ */

function openChartForDevice(id) {
  const d = devicesCache.find(x => x.id === id);
  if (!d) return;
  const seen = new Set();
  const uniq = [];
  for (const s of deviceLogSeries(d)) {
    const k = s.device_id + '::' + s.field;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(s);
  }
  if (uniq.length) openChartModal(null, null, { series: uniq });
  else openChartModal(id, devFieldsFirst(d) || null, null);
}

async function openChartModal(deviceId, field, chart) {
  const overlay = document.getElementById('chart-modal-overlay');
  if (!overlay) return;

  _chartModalSeries = [];

  if (chart) {
    const src = Array.isArray(chart.series) && chart.series.length
      ? chart.series
      : (chart.device_id && chart.field
          ? [{ device_id: chart.device_id, field: chart.field }]
          : []);
    for (const s of src) {
      if (s && s.device_id && s.field) {
        _chartModalSeries.push({ device_id: s.device_id, field: s.field });
      }
    }
  } else if (deviceId && field) {
    _chartModalSeries.push({ device_id: deviceId, field });
  }

  const devSel = document.getElementById('chart-modal-device');
  devSel.innerHTML = '<option value="">— устройство —</option>';
  devicesCache
    .filter(deviceHasLogs)
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'))
    .forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = `${d.name || d.id} · ${d.id}`;
      devSel.appendChild(opt);
    });

  const last = _chartModalSeries[_chartModalSeries.length - 1];
  if (last) devSel.value = last.device_id;
  chartModalRefreshFields();
  if (last) document.getElementById('chart-modal-field').value = last.field;

  const now = new Date();
  const fmt = d => {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const from = new Date(now.getTime() - 24 * 3600 * 1000);

  if (chart && (chart.period || chart.from || chart.to)) {
    const period = chart.period || '24h';
    let tsFrom, tsTo;
    if (period === 'custom' && chart.from && chart.to) {
      tsFrom = String(chart.from).slice(0, 16);
      tsTo   = String(chart.to).slice(0, 16);
    } else {
      const hours = period === '1h' ? 1
                  : period === '7d' ? 24*7
                  : period === '30d' ? 24*30
                  : 24;
      tsFrom = fmt(new Date(now.getTime() - hours * 3600 * 1000));
      tsTo   = fmt(now);
    }
    document.getElementById('chart-from').value = tsFrom;
    document.getElementById('chart-to').value   = tsTo;
    document.getElementById('chart-max-points').value = chart.max_points || 1000;
  } else {
    document.getElementById('chart-from').value = fmt(from);
    document.getElementById('chart-to').value   = fmt(now);
    document.getElementById('chart-max-points').value = 1000;
  }

  document.getElementById('chart-modal-title').textContent =
    chart && chart.title ? `📊 ${chart.title}` : '📊 График';

  renderChartModalSeries();
  overlay.classList.add('open');
  await reloadChartSeries();
}

function closeChartModal() {
  const overlay = document.getElementById('chart-modal-overlay');
  if (overlay) overlay.classList.remove('open');
  if (_chart) { try { _chart.destroy(); } catch (e) {} _chart = null; }
  _chartModalSeries = [];
}

function chartQuickRange(hours) {
  const now = new Date();
  const from = new Date(now.getTime() - hours * 3600 * 1000);
  const fmt = d => {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  document.getElementById('chart-from').value = fmt(from);
  document.getElementById('chart-to').value   = fmt(now);
  reloadChartSeries();
}

function chartModalRefreshFields() {
  const devId = document.getElementById('chart-modal-device').value;
  const fieldSel = document.getElementById('chart-modal-field');
  fieldSel.innerHTML = '';
  const dev = devicesCache.find(d => d.id === devId);
  if (!dev) return;
  const fields = deviceLogFields(dev);
  if (!fields.length) {
    fieldSel.innerHTML = '<option value="">— нет полей —</option>';
    return;
  }
  for (const f of fields) {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f;
    fieldSel.appendChild(opt);
  }
}

function renderChartModalSeries() {
  const ul = document.getElementById('chart-modal-series');
  if (!ul) return;
  if (!_chartModalSeries.length) {
    ul.innerHTML = '<li style="opacity:.7; font-size:.85rem;">— серий пока нет —</li>';
    return;
  }
  ul.innerHTML = _chartModalSeries.map((s, i) => {
    const dev = devicesCache.find(d => d.id === s.device_id);
    const devName = dev ? (dev.name || dev.id) : s.device_id;
    return `<li style="display:flex; gap:.4rem; align-items:center;
                        background:rgba(255,255,255,.06); padding:.25rem .5rem;
                        border-radius:8px; font-size:.85rem;">
      <span style="flex:1;">${esc(devName)} · <b>${esc(s.field)}</b></span>
      <button class="btn small danger" onclick="chartModalSeriesRemove(${i})">✕</button>
    </li>`;
  }).join('');
}

function chartModalSeriesAdd() {
  const devId = document.getElementById('chart-modal-device').value;
  const field = document.getElementById('chart-modal-field').value;
  if (!devId || !field) { alert('Выберите устройство и поле'); return; }
  if (_chartModalSeries.some(s => s.device_id === devId && s.field === field)) {
    alert('Такая серия уже добавлена');
    return;
  }
  _chartModalSeries.push({ device_id: devId, field });
  renderChartModalSeries();
  reloadChartSeries();
}

function chartModalSeriesRemove(i) {
  _chartModalSeries.splice(i, 1);
  renderChartModalSeries();
  reloadChartSeries();
}

async function reloadChartSeries() {
  const canvas = document.getElementById('chart-canvas');
  if (!canvas) return;
  if (!_chartModalSeries.length) {
    setChartStatus('добавьте хотя бы одну серию');
    if (_chart) { try { _chart.destroy(); } catch (e) {} _chart = null; }
    return;
  }

  const fromLocal = document.getElementById('chart-from').value;
  const toLocal   = document.getElementById('chart-to').value;
  const maxPoints = parseInt(document.getElementById('chart-max-points').value || '1000', 10);
  const tsFrom = fromLocal ? fromLocal + ':00' : '';
  const tsTo   = toLocal   ? toLocal   + ':59' : '';

  setChartStatus('загрузка…');

  const palette = ['#4fc3f7', '#ffb74d', '#81c784', '#e57373', '#ba68c8',
                   '#4db6ac', '#ffd54f', '#90a4ae'];

  const results = await Promise.all(_chartModalSeries.map(async (s) => {
    const url = `/api/devices/${s.device_id}/logs/series`
      + `?field=${encodeURIComponent(s.field)}`
      + (tsFrom ? `&from=${encodeURIComponent(tsFrom)}` : '')
      + (tsTo   ? `&to=${encodeURIComponent(tsTo)}`     : '')
      + `&max_points=${maxPoints}`;
    try {
      const r = await api(url);
      return { device_id: s.device_id, field: s.field, points: r.points || [] };
    } catch (e) {
      return { device_id: s.device_id, field: s.field, points: [] };
    }
  }));

  const tsSet = new Set();
  for (const s of results) for (const p of s.points) tsSet.add(p.ts);
  const labels = [...tsSet].sort();

  const datasets = results.map((s, i) => {
    const byTs = new Map();
    for (const p of s.points) byTs.set(p.ts, p.v);
    const dev = devicesCache.find(d => d.id === s.device_id);
    const devName = dev ? (dev.name || dev.id) : s.device_id;
    return {
      label: devName + '.' + s.field,
      data: labels.map(ts => byTs.has(ts) ? byTs.get(ts) : null),
      borderColor: palette[i % palette.length],
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.15,
      spanGaps: true,
    };
  });

  if (_chart) { try { _chart.destroy(); } catch (e) {} _chart = null; }

  const ctx = canvas.getContext('2d');
  _chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#fff' } },
        tooltip: {
          callbacks: {
            title: (items) => items[0]?.label || '',
            label: (c) => `${c.dataset.label}: ${c.parsed.y}`,
          },
        },
      },
      scales: {
        x: {
          type: 'category',
          ticks: { color: '#bbb', maxRotation: 45, autoSkip: true, maxTicksLimit: 8 },
          grid:  { color: 'rgba(255,255,255,.08)' },
        },
        y: {
          ticks: { color: '#bbb' },
          grid:  { color: 'rgba(255,255,255,.08)' },
        },
      },
    },
  });

  const totalPts = results.reduce((n, s) => n + s.points.length, 0);
  setChartStatus(`серий: ${_chartModalSeries.length}, точек: ${totalPts}`);
}

function setChartStatus(text) {
  const el = document.getElementById('chart-status');
  if (el) el.textContent = text || '';
}

/* --- Виджеты-графики на плане --- */
async function loadPlanCharts() {
  try {
    const all = await api('/api/plan/charts');
    _planChartsList = Array.isArray(all) ? all : [];
  } catch (e) {
    _planChartsList = [];
  }
}

function chartsForCurrentPlan() {
  let key;
  if (currentMode === 'user') {
    key = (viewRoomId === null || viewRoomId === undefined) ? 'main' : (viewRoomId || 'main');
  } else {
    key = currentRoomId || 'main';
  }
  return _planChartsList.filter(c => (c.plan || 'main') === key);
}

function renderPlanCharts(wrap) {
  if (!wrap) return;
  const ids = new Set(chartsForCurrentPlan().map(c => c.id));
  wrap.querySelectorAll('.plan-chart').forEach(el => {
    if (!ids.has(el.dataset.id)) {
      const id = el.dataset.id;
      if (_planCharts[id]) {
        try { _planCharts[id].destroy(); } catch (e) {}
        delete _planCharts[id];
      }
      el.remove();
    }
  });

  chartsForCurrentPlan().forEach(c => {
    let el = wrap.querySelector(`.plan-chart[data-id="${c.id}"]`);
    const needRebuild = !el || el.dataset.mode !== currentMode;
    if (needRebuild) {
      if (el) {
        if (_planCharts[c.id]) {
          try { _planCharts[c.id].destroy(); } catch (e) {}
          delete _planCharts[c.id];
        }
        el.remove();
        el = null;
      }
      el = document.createElement('div');
      el.className = 'plan-chart';
      el.dataset.id = c.id;
      el.dataset.mode = currentMode;
      el.style.left   = c.x + '%';
      el.style.top    = c.y + '%';
      el.style.width  = c.w + '%';
      el.style.height = c.h + '%';
      const st = c.style || {};
      el.style.background  = st.bg || 'rgba(20,30,60,.72)';
      el.style.borderColor = st.border || '#4fc3f7';
      el.style.color       = st.color || '#fff';

      el.innerHTML = `
        <div class="pc-head" style="cursor: move;">
          <span class="pc-title">${esc(c.title || (c.device_id + '.' + c.field))}</span>
          <button class="pc-refresh" title="Обновить">⟳</button>
          ${currentMode === 'edit' ? `<button class="pc-remove" title="Удалить">✕</button>` : ''}
        </div>
        <div class="pc-canvas-wrap"><canvas></canvas></div>
        ${currentMode === 'edit' ? '<div class="pc-resize"></div>' : ''}
      `;
      wrap.appendChild(el);

      const refreshBtn = el.querySelector('.pc-refresh');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          delete el.dataset.signature;
          drawPlanChart(c, el);
        });
      }

      const removeBtn = el.querySelector('.pc-remove');
      if (removeBtn) {
        removeBtn.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          if (!confirm('Удалить график с плана?')) return;
          try {
            await api('/api/plan/charts/' + c.id, 'DELETE');
            destroyPlanChart(c.id);
            el.remove();
            _planChartsList = _planChartsList.filter(x => x.id !== c.id);
          } catch (e) {
            alert('Ошибка удаления: ' + e.message);
          }
        });
      }

      if (currentMode === 'edit') {
        makeChartDraggable(el, c, wrap);
      }

      el.addEventListener('click', (ev) => {
        if (el.dataset.justDragged === '1') {
          ev.stopPropagation();
          delete el.dataset.justDragged;
          return;
        }
        if (ev.target.closest('.pc-refresh')) return;
        if (ev.target.closest('.pc-remove')) return;
        if (ev.target.closest('.pc-resize')) return;
        ev.stopPropagation();
        openChartModal(null, null, c);
      });
    } else {
      el.style.left   = c.x + '%';
      el.style.top    = c.y + '%';
      el.style.width  = c.w + '%';
      el.style.height = c.h + '%';
      const st = c.style || {};
      el.style.background  = st.bg || 'rgba(20,30,60,.72)';
      el.style.borderColor = st.border || '#4fc3f7';
      el.style.color       = st.color || '#ffffff';
      const t = el.querySelector('.pc-title');
      if (t) t.textContent = c.title || (c.device_id + '.' + c.field);
    }
    drawPlanChart(c, el);
  });
}

function destroyPlanChart(chartId) {
  const inst = _planCharts[chartId];
  if (inst) {
    try { inst.destroy(); } catch (e) {}
    delete _planCharts[chartId];
  }
}

function destroyAllPlanCharts() {
  Object.keys(_planCharts).forEach(destroyPlanChart);
}

async function drawPlanChart(c, el) {
  const canvas = el.querySelector('canvas');
  if (!canvas) return;
  const sig = `${c.id}|${JSON.stringify(c.series || [])}|${c.period}|${c.from}|${c.to}|${c.max_points}|${(c.style && c.style.type) || 'line'}`;
  if (el.dataset.signature === sig && _planCharts[c.id]) return;
  el.dataset.signature = sig;

  let r;
  try {
    r = await api('/api/plan/charts/' + c.id + '/data');
  } catch (e) {
    console.warn('[plan chart] fetch error', e);
    return;
  }
  if (!el.isConnected) return;

  const series = (r && r.series) || [];
  const palette = ['#4fc3f7', '#ffb74d', '#81c784', '#e57373', '#ba68c8',
                   '#4db6ac', '#ffd54f', '#90a4ae'];

  let labels = [];
  for (const s of series) {
    const pts = s.points || [];
    if (pts.length > labels.length) {
      labels = pts.map(p => p.ts);
    }
  }

  const datasets = series.map((s, i) => {
    const pts = s.points || [];
    const byTs = new Map();
    for (const p of pts) byTs.set(p.ts, p.v);
    const data = labels.map(ts => byTs.has(ts) ? byTs.get(ts) : null);
    return {
      label: s.device_id + '.' + s.field,
      data,
      borderColor: palette[i % palette.length],
      backgroundColor: 'transparent',
      borderWidth: 1.4,
      pointRadius: 0,
      tension: 0.15,
      spanGaps: true,
    };
  });

  if (_planCharts[c.id]) {
    try { _planCharts[c.id].destroy(); } catch (e) {}
    _planCharts[c.id] = null;
  }

  const ctx = canvas.getContext('2d');
  _planCharts[c.id] = new Chart(ctx, {
    type: (c.style && c.style.type) || 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          display: datasets.length > 1,
          labels: { color: 'rgba(255,255,255,.8)', boxWidth: 10, font: { size: 9 } },
        },
        tooltip: {
          callbacks: {
            title: (items) => items[0]?.label || '',
            label: (item) => `${item.dataset.label}: ${item.parsed.y}`,
          },
        },
      },
      scales: {
        x: {
          type: 'category',
          ticks: { color: 'rgba(255,255,255,.6)', maxRotation: 45, font: { size: 9 }, autoSkip: true, maxTicksLimit: 8 },
          grid:  { color: 'rgba(255,255,255,.06)' },
        },
        y: {
          ticks: { color: 'rgba(255,255,255,.6)', font: { size: 9 } },
          grid:  { color: 'rgba(255,255,255,.06)' },
        },
      },
    },
  });
}

function makeChartDraggable(el, c, wrap) {
  const handle = el.querySelector('.pc-head');
  if (!handle) return;
  handle.style.cursor = 'move';

  let dragging = false, moved = false;
  let sx = 0, sy = 0, ox = 0, oy = 0;

  handle.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    if (e.target.classList.contains('pc-resize')) return;
    noteInteraction();
    dragging = true; moved = false;
    sx = e.clientX; sy = e.clientY;
    ox = parseFloat(c.x) || 0;
    oy = parseFloat(c.y) || 0;
    el.classList.add('dragging');
    el.dataset.justDragged = '0';
    e.preventDefault();

    const move = (ev) => {
      if (!dragging) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      el.dataset.justDragged = '1';
      const rect = wrap.getBoundingClientRect();
      c.x = Math.max(0, Math.min(100 - c.w, ox + (dx / rect.width)  * 100));
      c.y = Math.max(0, Math.min(100 - c.h, oy + (dy / rect.height) * 100));
      el.style.left = c.x + '%';
      el.style.top  = c.y + '%';
    };

    const up = async () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      if (moved) {
        await api('/api/plan/charts/' + c.id, 'POST', { x: c.x, y: c.y });
        setTimeout(() => { delete el.dataset.justDragged; }, 0);
      }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  const resize = el.querySelector('.pc-resize');
  if (resize) {
    let rz = false, moved = false;
    let rsx = 0, rsy = 0, rw = 0, rh = 0;

    resize.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      noteInteraction();
      rz = true; moved = false;
      rsx = e.clientX; rsy = e.clientY;
      rw = parseFloat(c.w) || 30;
      rh = parseFloat(c.h) || 25;
      el.classList.add('dragging');
      el.dataset.justDragged = '0';

      const move = (ev) => {
        if (!rz) return;
        const dx = ev.clientX - rsx, dy = ev.clientY - rsy;
        if (!moved && Math.hypot(dx, dy) < 2) return;
        moved = true;
        el.dataset.justDragged = '1';
        const rect = wrap.getBoundingClientRect();
        c.w = Math.max(10, Math.min(100 - c.x, rw + (dx / rect.width)  * 100));
        c.h = Math.max(8,  Math.min(100 - c.y, rh + (dy / rect.height) * 100));
        el.style.width  = c.w + '%';
        el.style.height = c.h + '%';
      };

      const up = async () => {
        if (!rz) return;
        rz = false;
        el.classList.remove('dragging');
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        if (moved) {
          await api('/api/plan/charts/' + c.id, 'POST', { w: c.w, h: c.h });
          setTimeout(() => { delete el.dataset.justDragged; }, 0);
        }
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }
}

/* --- Добавление графика на план --- */
function openAddChartModal() {
  if (currentMode !== 'edit') return;
  const overlay = document.getElementById('chart-add-overlay');
  if (!overlay) return;

  const devSel = document.getElementById('chart-add-device');
  devSel.innerHTML = '<option value="">— выберите устройство —</option>';
  devicesCache
    .filter(deviceHasLogs)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'))
    .forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = `${d.name}  ·  ${d.id}`;
      devSel.appendChild(opt);
    });

  if (devSel.options.length === 1) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.disabled = true;
    opt.textContent = '— нет устройств с логами —';
    devSel.appendChild(opt);
  }

  _chartAddSeries = [];
  renderChartAddSeries();
  document.getElementById('chart-add-field').innerHTML = '';
  document.getElementById('chart-add-title').value = '';
  document.getElementById('chart-add-period').value = '24h';
  document.getElementById('chart-add-type').value = 'line';
  document.getElementById('chart-add-from').value = '';
  document.getElementById('chart-add-to').value = '';
  document.getElementById('chart-add-custom').style.display = 'none';

  chartAddRefreshFields();
  overlay.classList.add('open');
}

function closeAddChartModal() {
  const overlay = document.getElementById('chart-add-overlay');
  if (overlay) overlay.classList.remove('open');
}

function chartAddRefreshFields() {
  const devId = document.getElementById('chart-add-device').value;
  const fieldSel = document.getElementById('chart-add-field');
  fieldSel.innerHTML = '';
  const dev = devicesCache.find(d => d.id === devId);
  if (!dev) return;
  const fields = deviceLogFields(dev);
  if (!fields.length) {
    fieldSel.innerHTML = '<option value="" disabled>— нет полей с логами —</option>';
    return;
  }
  fields.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f;
    fieldSel.appendChild(opt);
  });
}

function renderChartAddSeries() {
  const ul = document.getElementById('chart-add-series');
  if (!ul) return;
  if (!_chartAddSeries.length) {
    ul.innerHTML = '<li style="opacity:.7; font-size:.85rem;">— серий пока нет —</li>';
    return;
  }
  ul.innerHTML = _chartAddSeries.map((s, i) => {
    const dev = devicesCache.find(d => d.id === s.device_id);
    const devName = dev ? dev.name : s.device_id;
    return `<li style="display:flex; gap:.4rem; align-items:center;
                        background:rgba(255,255,255,.06); padding:.25rem .5rem;
                        border-radius:8px; font-size:.85rem;">
      <span style="flex:1;">${esc(devName)} · <b>${esc(s.field)}</b></span>
      <button class="btn small danger"
        onclick="chartAddSeriesRemove(${i})">✕</button>
    </li>`;
  }).join('');
}

function chartAddSeriesAdd() {
  const devId = document.getElementById('chart-add-device').value;
  const field = document.getElementById('chart-add-field').value;
  if (!devId || !field) { alert('Выберите устройство и поле'); return; }
  if (_chartAddSeries.some(s => s.device_id === devId && s.field === field)) {
    alert('Такая серия уже добавлена');
    return;
  }
  _chartAddSeries.push({ device_id: devId, field });
  renderChartAddSeries();
}

function chartAddSeriesRemove(i) {
  _chartAddSeries.splice(i, 1);
  renderChartAddSeries();
}

async function chartAddApply() {
  if (!_chartAddSeries.length) {
    alert('Добавьте хотя бы одну серию');
    return;
  }
  const period = document.getElementById('chart-add-period').value || '24h';
  const type = document.getElementById('chart-add-type').value || 'line';

  const seriesTitle = _chartAddSeries.map(s => {
    const dev = devicesCache.find(d => d.id === s.device_id);
    return `${dev ? dev.name : s.device_id}.${s.field}`;
  }).join(', ');

  const payload = {
    plan: currentRoomId || 'main',
    device_id: _chartAddSeries[0].device_id,
    field: _chartAddSeries[0].field,
    series: _chartAddSeries.map(s => ({ device_id: s.device_id, field: s.field })),
    period,
    title: (document.getElementById('chart-add-title').value || '').trim()
           || seriesTitle,
    x: 35, y: 35, w: 30, h: 25,
    style: { type },
  };

  if (period === 'custom') {
    const from = document.getElementById('chart-add-from').value;
    const to   = document.getElementById('chart-add-to').value;
    if (!from || !to) { alert('Укажите период'); return; }
    payload.from = from + ':00';
    payload.to   = to   + ':59';
  }

  try {
    const c = await api('/api/plan/charts', 'POST', payload);
    _planChartsList.push(c);
    closeAddChartModal();
    renderPlanView();
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}