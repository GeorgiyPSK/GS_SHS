/* ============================================================
   Логи сервера (SSE) и журналы устройств
   ============================================================ */

function addServerLog(logData) {
  if (!logData) return;
  _serverLogs.push(logData);
  if (_serverLogs.length > MAX_LOGS) _serverLogs = _serverLogs.slice(-MAX_LOGS);
  const modal = document.getElementById('logs-modal-overlay');
  if (modal && modal.classList.contains('open')) renderServerLogs();
}

function renderServerLogs() {
  const container = document.getElementById('logs-container');
  if (!container) return;
  const query = (document.getElementById('logs-search')?.value || '').toLowerCase();
  const level = document.getElementById('logs-level-filter')?.value || '';
  let filtered = _serverLogs.filter(l => {
    if (level && l.level !== level) return false;
    if (query) {
      const text = `${l.message} ${l.name}`.toLowerCase();
      if (!text.includes(query)) return false;
    }
    return true;
  });
  if (!filtered.length) {
    container.innerHTML = '<div style="opacity:.5; text-align:center; padding:2rem;">Нет логов, подходящих под фильтр</div>';
    return;
  }
  container.innerHTML = filtered.map(l => {
    const d = new Date(l.ts * 1000);
    const timeStr = d.toLocaleTimeString('ru-RU', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    let color = '#fff';
    let bg = 'transparent';
    if (l.level === 'ERROR') { color = '#ff8a80'; bg = 'rgba(255, 82, 82, 0.1)'; }
    else if (l.level === 'WARNING') { color = '#ffd54f'; bg = 'rgba(255, 213, 79, 0.05)'; }
    else if (l.level === 'DEBUG') { color = '#90a4ae'; }
    else if (l.level === 'INFO') { color = '#81c784'; }
    const msg = esc(l.message);
    return `<div style="padding: 2px 4px; border-bottom: 1px solid rgba(255,255,255,.05); display:flex; gap: 8px; background: ${bg};">
      <span style="color: #78909c; flex-shrink:0;">[${timeStr}]</span>
      <span style="color: ${color}; font-weight: 600; flex-shrink:0; width: 60px;">${esc(l.level)}</span>
      <span style="color: #b0bec5; flex-shrink:0; width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${esc(l.name)}">${esc(l.name)}</span>
      <span style="color: ${color}; word-break: break-all;">${msg}</span>
    </div>`;
  }).join('');
  if (_logsAutoScroll) container.scrollTop = container.scrollHeight;
}

function openLogsModal() {
  document.getElementById('logs-modal-overlay').classList.add('open');
  renderServerLogs();
}

function closeLogsModal() {
  document.getElementById('logs-modal-overlay').classList.remove('open');
}

function clearServerLogs() {
  _serverLogs = [];
  renderServerLogs();
}

function toggleLogScroll() {
  _logsAutoScroll = !_logsAutoScroll;
  const btn = document.getElementById('logs-scroll-btn');
  if (btn) {
    btn.textContent = _logsAutoScroll ? '⏬ Автоскролл: Вкл' : '⏸ Автоскролл: Выкл';
    btn.style.background = _logsAutoScroll ? '' : '#ef6c00';
  }
  if (_logsAutoScroll) {
    const c = document.getElementById('logs-container');
    if (c) c.scrollTop = c.scrollHeight;
  }
}

/* --- Журналы устройств --- */
async function showDeviceLogs(id) {
  try {
    const rows = await api('/api/devices/' + id + '/logs?limit=500');
    if (!rows.length) { alert('Журнал пуст'); return; }
    const byField = {};
    for (const r of rows) {
      const f = r.field || '—';
      (byField[f] = byField[f] || []).push(r);
    }
    const parts = ['<div style="max-height:60vh; overflow:auto; font-family:monospace; font-size:.8rem;">'];
    for (const [f, arr] of Object.entries(byField)) {
      parts.push(`<div style="margin:.6rem 0 .2rem; font-weight:600;">${esc(f)}</div>`);
      parts.push('<table style="width:100%; border-collapse:collapse;">');
      for (const r of arr.slice(-200)) {
        parts.push(
          `<tr>
             <td style="padding:2px 6px; opacity:.7;">${esc(r.ts || '')}</td>
             <td style="padding:2px 6px;">${esc(String(r.value))}</td>
           </tr>`
        );
      }
      parts.push('</table>');
    }
    parts.push('</div>');
    if (window.SH && window.SH.openModal) {
      window.SH.openModal('📈 Журнал: ' + id, '', parts.join(''));
    } else {
      const w = window.open('', '_blank');
      w.document.write(`<pre>${rows.map(r => `${r.ts}\t${r.field}\t${r.value}`).join('\n')}</pre>`);
    }
  } catch (e) { alert('Ошибка: ' + e.message); }
}

async function clearDeviceLogs(id) {
  if (!confirm('Очистить журнал этого устройства?')) return;
  try {
    await api('/api/devices/' + id + '/logs', 'DELETE');
    alert('Журнал очищен');
  } catch (e) { alert('Ошибка: ' + e.message); }
}

async function refreshLogsList() {
  const box = document.getElementById('logs-list');
  if (!box) return;
  try {
    const list = await api('/api/logs/devices');
    if (!list.length) { box.textContent = 'журналов нет'; return; }
    box.innerHTML = list.map(x => `
      <div style="display:flex; gap:.6rem; align-items:center; margin:.2rem 0;">
        <span style="min-width:110px;">${esc(x.device_id)}</span>
        <span style="opacity:.7;">${x.size} Б</span>
        <span style="opacity:.7;">${esc(x.updated || '')}</span>
        <button class="btn small gray"  onclick="showDeviceLogs('${x.device_id}')">📖</button>
        <button class="btn small gray"  onclick="openChartModal('${x.device_id}')">📊</button>
        <button class="btn small danger" onclick="clearDeviceLogs('${x.device_id}')">🗑</button>
      </div>
    `).join('');
  } catch (e) {
    box.textContent = 'ошибка: ' + e.message;
  }
}