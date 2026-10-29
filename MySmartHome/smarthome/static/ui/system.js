/* ============================================================
   Система: сервер, токены, пользователи, кастомные типы,
   экспорт/импорт, уведомления
   ============================================================ */

/* ---------- Сервер ---------- */

async function loadServerInfo() {
  try {
    const info = await api('/api/server/info');
    const hostEl = document.getElementById('srv-host');
    const portEl = document.getElementById('srv-port');
    const pidEl  = document.getElementById('srv-pid');
    const pyEl   = document.getElementById('srv-python');
    if (hostEl) hostEl.value = info.host || '0.0.0.0';
    if (portEl) portEl.value = info.port || 5000;
    if (pidEl)  pidEl.textContent = 'PID ' + (info.pid ?? '—');
    if (pyEl)   pyEl.textContent  = info.python || '';
  } catch (e) {
    console.warn('[server_info]', e);
  }
}

async function saveServerPort() {
  const hostEl = document.getElementById('srv-host');
  const portEl = document.getElementById('srv-port');
  const port = parseInt(portEl?.value || '0', 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    alert('Порт должен быть числом от 1 до 65535');
    return;
  }
  try {
    await api('/api/server/port', 'POST', { port });
    alert('Настройки сохранёны. Перезапустите сервер, чтобы применить.');
    await loadServerInfo();
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

async function restartServer() {
  if (!confirm('Перезапустить сервер? Страница станет недоступна на несколько секунд.')) return;
  try {
    await api('/api/server/restart', 'POST', {});
  } catch (e) { /* 401/сеть — ожидаемо */ }
  showRestartOverlay();
  waitForServerBack();
}

function showRestartOverlay() {
  let el = document.getElementById('restart-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'restart-overlay';
    el.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;
      display:flex;align-items:center;justify-content:center;
      color:#fff;font-size:1.2rem;text-align:center;padding:2rem;
    `;
    el.innerHTML = `
      <div>
        <div style="font-size:3rem;margin-bottom:1rem;">♻️</div>
        <div>Перезапуск сервера…</div>
        <div style="opacity:.7;font-size:.9rem;margin-top:.5rem;">Страница обновится автоматически</div>
      </div>`;
    document.body.appendChild(el);
  }
}

async function waitForServerBack() {
  const started = Date.now();
  const TIMEOUT = 30000;
  while (Date.now() - started < TIMEOUT) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const r = await fetch('/api/server/info', { cache: 'no-store' });
      if (r.ok) { window.location.reload(); return; }
    } catch (e) { /* ещё не поднялся */ }
  }
  alert('Сервер не вернулся за 30 секунд. Проверьте логи.');
}

/* ---------- API-токены ---------- */

async function loadTokens() {
  const box = document.getElementById('tokens-list');
  if (!box) return;
  try {
    const list = await api('/api/tokens');
    if (!Array.isArray(list) || !list.length) {
      box.innerHTML = '<div class="hint" style="margin:0;">Токенов пока нет.</div>';
      return;
    }
    box.innerHTML = list.map(t => `
      <div class="row" style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-bottom:.5rem;">
        <div style="flex:1;min-width:200px;">
          <div style="font-weight:600;">${esc(t.name)}</div>
          <div style="font-size:.8rem;opacity:.7;">
            id: <code>${esc(t.id)}</code> ·
            создан: ${esc(t.created || '—')} ·
            последний раз: ${esc(t.last_used || '—')}
          </div>
        </div>
        <button class="btn small danger" onclick="deleteApiToken('${t.id}')">🗑 Отозвать</button>
      </div>
    `).join('');
  } catch (e) {
    box.innerHTML = '<div class="hint" style="margin:0;">Ошибка загрузки токенов: ' + esc(e.message) + '</div>';
  }
}

async function createApiToken() {
  const nameEl = document.getElementById('tok-name');
  const name = (nameEl?.value || '').trim() || 'API-токен';
  try {
    const rec = await api('/api/tokens', 'POST', { name });
    showTokenOnce(rec);
    if (nameEl) nameEl.value = '';
    await loadTokens();
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

function showTokenOnce(rec) {
  let overlay = document.getElementById('token-once-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'token-once-overlay';
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
    overlay.innerHTML = `
      <div class="modal" style="max-width:640px;">
        <button class="modal-close" onclick="document.getElementById('token-once-overlay').classList.remove('open')">✕</button>
        <div style="padding:1.2rem;">
          <h3 style="margin:0 0 .5rem;">🔑 Токен создан</h3>
          <p style="margin:0 0 .8rem; opacity:.85; font-size:.9rem;">
            Скопируйте токен сейчас — больше он не будет показан.
          </p>
          <textarea id="token-once-value" readonly
            style="width:100%; min-height:90px; font-family:monospace; font-size:.9rem;
                   padding:.6rem; border-radius:10px; resize:vertical;
                   background:rgba(0,0,0,.35); color:#fff;
                   border:1px solid rgba(255,255,255,.25);"></textarea>
          <div style="margin-top:.8rem; display:flex; gap:.5rem; justify-content:flex-end;">
            <button class="btn gray" onclick="document.getElementById('token-once-overlay').classList.remove('open')">Закрыть</button>
            <button class="btn primary" onclick="copyTokenOnce(this)">📋 Скопировать</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }
  document.getElementById('token-once-value').value = rec.token || '';
  overlay.classList.add('open');
}

function copyTokenOnce(btn) {
  const ta = document.getElementById('token-once-value');
  if (!ta) return;
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  const done = () => {
    const old = btn.textContent;
    btn.textContent = '✅ Скопировано';
    setTimeout(() => { btn.textContent = old; }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ta.value).then(done).catch(() => { document.execCommand('copy'); done(); });
  } else {
    document.execCommand('copy'); done();
  }
}

async function deleteApiToken(tid) {
  if (!confirm('Отозвать этот токен? Все интеграции, использующие его, перестанут работать.')) return;
  try {
    await api('/api/tokens/' + tid, 'DELETE');
    await loadTokens();
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

/* ---------- Пользователи ---------- */

async function loadUsers() {
  const box = document.getElementById('users-list');
  if (!box) return;
  try {
    const list = await api('/api/users');
    if (!Array.isArray(list) || !list.length) {
      box.innerHTML = '<div class="hint" style="margin:0;">Нет пользователей.</div>';
      return;
    }
    box.innerHTML = list.map(u => `
      <div class="row" style="display:flex;gap:.6rem;align-items:center;
                              flex-wrap:wrap;margin-bottom:.5rem;">
        <div style="flex:1;min-width:200px;">
          <div style="font-weight:600;">
            ${esc(u.username)}
            ${u.is_admin ? '<span class="badge ok" style="margin-left:.4rem;">admin</span>' : ''}
          </div>
          <div style="font-size:.8rem;opacity:.7;">
            создан: ${esc(u.created || '—')}
          </div>
        </div>
        <button class="btn small gray" onclick="resetUserPassword('${u.username}')">
          🔑 Сменить пароль
        </button>
        <button class="btn small danger" onclick="deleteUser('${u.username}')">
          🗑 Удалить
        </button>
      </div>
    `).join('');
  } catch (e) {
    box.innerHTML = '<div class="hint" style="margin:0;">Ошибка: ' + esc(e.message) + '</div>';
  }
}

async function createUser() {
  const name = (document.getElementById('u-name')?.value || '').trim();
  const pass = document.getElementById('u-pass')?.value || '';
  const isAdmin = !!document.getElementById('u-admin')?.checked;
  if (!name || !pass) { alert('Заполните логин и пароль'); return; }
  try {
    await api('/api/users', 'POST', { username: name, password: pass, is_admin: isAdmin });
    document.getElementById('u-name').value = '';
    document.getElementById('u-pass').value = '';
    document.getElementById('u-admin').checked = false;
    await loadUsers();
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

async function deleteUser(name) {
  if (!confirm(`Удалить пользователя «${name}»? Все его токены будут отозваны.`)) return;
  try {
    await api('/api/users/' + encodeURIComponent(name), 'DELETE');
    await loadUsers();
    await loadTokens();
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

async function resetUserPassword(name) {
  const pwd = prompt(`Новый пароль для «${name}»:`);
  if (!pwd) return;
  if (pwd.length < 4) { alert('Пароль слишком короткий'); return; }
  try {
    await api('/api/users/' + encodeURIComponent(name), 'POST', { password: pwd });
    alert('Пароль изменён');
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

async function changeMyPassword() {
  const oldP = document.getElementById('me-old')?.value || '';
  const newP = document.getElementById('me-new')?.value || '';
  if (!oldP || !newP) { alert('Заполните оба поля'); return; }
  try {
    await api('/api/me/password', 'POST', { old: oldP, new: newP });
    document.getElementById('me-old').value = '';
    document.getElementById('me-new').value = '';
    alert('Пароль изменён');
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

/* ---------- Кастомные типы ---------- */

function fillIconSelect() {
  const sel = document.getElementById('ct-icon');
  if (!sel) return;
  sel.innerHTML = '';
  for (const it of DEVICE_ICONS) {
    const opt = document.createElement('option');
    opt.value = it.id;
    opt.textContent = it.label;
    opt.style.color = '#ffb74d';
    opt.style.fontWeight = '600';
    sel.appendChild(opt);
  }
}

function openCustomTypeModal(typeId) {
  if (currentMode !== 'edit') return;
  fillIconSelect();
  _ct_editing_id = null;

  const nameEl = document.getElementById('ct-name');
  const iconEl = document.getElementById('ct-icon');
  const fieldsEl = document.getElementById('ct-fields');
  const dispEl = document.getElementById('ct-display-field');
  const delBtn = document.getElementById('ct-delete-btn');

  fieldsEl.innerHTML = '';
  _ct_field_idx = 0;

  if (typeId && window.TYPES[typeId] && window.TYPES[typeId].custom) {
    const info = window.TYPES[typeId].raw || {};
    _ct_editing_id = typeId;
    nameEl.value = info.name || '';
    iconEl.value = info.icon || '📦';
    for (const f of (info.fields || [])) {
      addCTypeField(f);
    }
    refreshDisplayFieldOptions(info.fields || [], info.display_field || '');
    delBtn.style.display = '';
  } else {
    nameEl.value = '';
    iconEl.value = '📦';
    addCTypeField({ name: 'state', type: 'bool', default: false, control: 'switch' });
    refreshDisplayFieldOptions([], '');
    delBtn.style.display = 'none';
  }

  document.getElementById('ctype-modal-overlay').classList.add('open');
}

function openCustomTypeModalFromSelect() {
  if (currentMode !== 'edit') return;
  const sel = document.getElementById('type');
  const tid = sel && sel.value;
  if (!tid || !window.TYPES[tid] || !window.TYPES[tid].custom) {
    alert('Выберите кастомный тип в списке типов');
    return;
  }
  openCustomTypeModal(tid);
}

function refreshDisplayFieldOptions(fields, selected) {
  const sel = document.getElementById('ct-display-field');
  if (!sel) return;
  const cur = selected || sel.value || '';
  sel.innerHTML = '<option value="">— не показывать —</option>';
  for (const f of fields) {
    if (!f.name) continue;
    const opt = document.createElement('option');
    opt.value = f.name;
    opt.textContent = f.name;
    if (f.name === cur) opt.selected = true;
    sel.appendChild(opt);
  }
}

function closeCustomTypeModal() {
  _ct_editing_id = null;
  document.getElementById('ctype-modal-overlay').classList.remove('open');
}

function refreshDisplayFieldFromRows() {
  const rows = document.querySelectorAll('#ct-fields .field-row');
  const fields = [];
  rows.forEach(row => {
    const n = row.querySelector('[data-role="fname"]').value.trim();
    if (n) fields.push({ name: n });
  });
  const cur = document.getElementById('ct-display-field')?.value || '';
  refreshDisplayFieldOptions(fields, cur);
}

function addCTypeField(preset) {
  preset = preset || { name: '', label: '', type: 'bool', default: '', control: 'switch', options: [] };
  const wrap = document.getElementById('ct-fields');
  const idx = _ct_field_idx++;

  const row = document.createElement('div');
  row.className = 'field-row';
  row.dataset.idx = idx;
  row.style.cssText = 'display:flex;gap:.4rem;align-items:center;margin-bottom:.3rem;flex-wrap:wrap;';

  row.innerHTML = `
    <input type="text" placeholder="имя поля (латиница)" value="${esc(preset.name)}"
      data-role="fname" oninput="refreshDisplayFieldFromRows()" style="flex:1;min-width:100px;">
    <input type="text" placeholder="отображаемое название" value="${esc(preset.label || '')}"
      data-role="flabel" style="flex:1;min-width:120px;">
    <select data-role="ftype" title="тип значения">
      <option value="bool"   ${preset.type === 'bool'   ? 'selected' : ''}>bool</option>
      <option value="number" ${preset.type === 'number' ? 'selected' : ''}>number</option>
      <option value="string" ${preset.type === 'string' ? 'selected' : ''}>string</option>
    </select>
    <select data-role="fcontrol" title="тип контрола">
      <option value="switch"   ${preset.control === 'switch'   ? 'selected' : ''}>чекбокс</option>
      <option value="onoff"    ${preset.control === 'onoff'    ? 'selected' : ''}>вкл/выкл</option>
      <option value="button"   ${preset.control === 'button'   ? 'selected' : ''}>кнопка</option>
      <option value="slider"   ${preset.control === 'slider'   ? 'selected' : ''}>слайдер 0–100</option>
      <option value="number"   ${preset.control === 'number'   ? 'selected' : ''}>число</option>
      <option value="text"     ${preset.control === 'text'     ? 'selected' : ''}>текст</option>
      <option value="select"   ${preset.control === 'select'   ? 'selected' : ''}>список</option>
    </select>
    <input type="text" placeholder="по умолчанию" value="${esc(String(preset.default ?? ''))}"
      data-role="fdefault" style="flex:1;min-width:90px;">
    <input type="text" placeholder="варианты через запятую (для списка)"
      value="${esc((preset.options || []).join(', '))}" data-role="foptions"
      style="flex:1;min-width:120px;">
    <button class="btn small danger" onclick="this.parentElement.remove()">✕</button>
  `;
  wrap.appendChild(row);

  const rows = document.querySelectorAll('#ct-fields .field-row');
  const fields = [];
  rows.forEach(row => {
    const n = row.querySelector('[data-role="fname"]').value.trim();
    if (n) fields.push({ name: n });
  });
  refreshDisplayFieldOptions(fields, document.getElementById('ct-display-field')?.value);
}

async function saveCustomType() {
  const name = document.getElementById('ct-name').value.trim();
  const icon = document.getElementById('ct-icon').value || '📦';
  const display_field = document.getElementById('ct-display-field').value || '';
  if (!name) { alert('Введите название типа'); return; }

  const fields = [];
  document.querySelectorAll('#ct-fields .field-row').forEach(row => {
    const fname = row.querySelector('[data-role="fname"]').value.trim();
    if (!fname) return;
    const flabel = row.querySelector('[data-role="flabel"]')?.value.trim() || '';
    const ftype = row.querySelector('[data-role="ftype"]').value;
    const fcontrol = row.querySelector('[data-role="fcontrol"]').value;
    const foptionsRaw = row.querySelector('[data-role="foptions"]').value;
    let fdefault = row.querySelector('[data-role="fdefault"]').value;

    if (ftype === 'bool') {
      const s = String(fdefault).trim().toLowerCase();
      fdefault = ['1', 'true', 'yes', 'on', 'вкл', 'да', '+'].includes(s);
    } else if (ftype === 'number') {
      const n = parseFloat(fdefault);
      fdefault = Number.isFinite(n) ? n : 0;
    } else {
      fdefault = String(fdefault ?? '');
    }

    const options = (fcontrol === 'select')
      ? foptionsRaw.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    fields.push({ name: fname, label: flabel, type: ftype, control: fcontrol, default: fdefault, options });
  });

  if (!fields.length) { alert('Добавьте хотя бы одно поле'); return; }

  const payload = { name, icon, label: name, fields, display_field };

  try {
    let created;
    if (_ct_editing_id) {
      created = await api('/api/custom_types/' + _ct_editing_id, 'POST', payload);
    } else {
      created = await api('/api/custom_types', 'POST', payload);
    }
    const tid = created.id;

    if (!window.TYPES) window.TYPES = {};
    window.TYPES[tid] = {
      icon: created.icon || '📦',
      label: created.label || created.name || tid,
      fields: (created.fields || []).map(f => f.name),
      custom: true,
      raw: created,
    };

    const sel = document.getElementById('type');
    if (sel) {
      let opt = sel.querySelector(`option[value="${tid}"]`);
      if (!opt) {
        opt = document.createElement('option');
        opt.value = tid;
        opt.dataset.custom = '1';
        sel.appendChild(opt);
      }
      opt.textContent = `${created.icon} ${created.label || created.name}`;
      opt.style.color = '#ffb74d';
      opt.style.fontWeight = '600';
      sel.value = tid;
    }

    closeCustomTypeModal();
    refresh();
    alert('Тип сохранён.');
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

async function deleteCustomType() {
  if (!_ct_editing_id) return;
  if (!confirm('Удалить тип? Вместе с ним будут удалены все устройства этого типа.')) return;
  try {
    const res = await api('/api/custom_types/' + _ct_editing_id, 'DELETE');
    delete window.TYPES[_ct_editing_id];
    const sel = document.getElementById('type');
    if (sel) {
      const opt = sel.querySelector(`option[value="${_ct_editing_id}"]`);
      if (opt) opt.remove();
    }
    closeCustomTypeModal();
    refresh();
    alert(`Тип удалён. Удалено устройств: ${res.devices_deleted || 0}.`);
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

async function loadCustomTypes() {
  try {
    const types = await api('/api/custom_types');
    const sel = document.getElementById('type');
    if (sel) sel.querySelectorAll('option[data-custom="1"]').forEach(o => o.remove());
    for (const [tid, info] of Object.entries(types || {})) {
      window.TYPES[tid] = {
        icon: info.icon || '📦',
        label: info.label || info.name || tid,
        fields: (info.fields || []).map(f => f.name),
        custom: true,
        raw: info,
      };
      if (sel) {
        const opt = document.createElement('option');
        opt.value = tid;
        opt.dataset.custom = '1';
        opt.textContent = `${info.icon || '📦'} ${info.label || info.name || tid}`;
        sel.appendChild(opt);
      }
    }
    refreshEditTypeButton();
  } catch (e) {
    console.warn('[custom_types] load error:', e);
  }
}

function refreshEditTypeButton() {
  const sel = document.getElementById('type');
  const btn = document.getElementById('edit-type-btn');
  if (!sel || !btn) return;
  const opt = sel.selectedOptions && sel.selectedOptions[0];
  const isCustom = !!(opt && opt.dataset && opt.dataset.custom === '1');
  btn.disabled = !isCustom;
  btn.title = isCustom ? 'Редактировать выбранный тип' : 'Доступно только для кастомного типа';
  sel.style.borderColor = isCustom ? '#ffb74d' : '';
  sel.style.boxShadow   = isCustom ? '0 0 0 1px #ffb74d inset' : '';
}

/* ---------- Экспорт / импорт ---------- */

function exportJson() {
  const a = document.createElement('a');
  a.href = '/api/export'; a.download = 'smarthome.json';
  document.body.appendChild(a); a.click(); a.remove();
}

function importJson(input) {
  const file = input.files[0]; if (!file) return;
  if (!confirm('Импорт заменит все текущие данные. Продолжить?')) { input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      await api('/api/import', 'POST', data);
      input.value = '';
      alert('Импорт выполнен.');
      refresh();
    } catch (e) { alert('Ошибка: ' + e.message); }
  };
  reader.readAsText(file);
}

/* ---------- Уведомления ---------- */

async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.warn('[notify] браузер не поддерживает Notification API');
    return false;
  }
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const res = await Notification.requestPermission();
  return res === 'granted';
}

function showBrowserNotification(data) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const title = data.title || 'Уведомление';
  const opts = {
    body: data.body || '',
    tag: data.tag || undefined,
  };

  try {
    const n = new Notification(title, opts);
    n.onclick = () => { window.focus(); n.close(); };
  } catch (e) {
    console.warn('[notify]', e);
  }
}

async function askNotifyPermission() {
  const ok = await requestNotificationPermission();
  updateNotifyPermStatus();
  if (ok) alert('Уведомления разрешены');
}

function updateNotifyPermStatus() {
  const el = document.getElementById('notify-perm');
  if (!el) return;
  if (!('Notification' in window)) {
    el.textContent = 'не поддерживается';
    return;
  }
  el.textContent = {
    granted: '✅ разрешено',
    denied:  '❌ запрещено',
    default: '⏳ не запрошено',
  }[Notification.permission] || Notification.permission;
}

function testNotify() {
  showBrowserNotification({
    title: 'GS Smart',
    body: 'Это тестовое уведомление',
    level: 'info',
  });
}

/* ---------- Копирование ID ---------- */

function copyDeviceId(id, el) {
  const done = () => {
    const old = el.textContent;
    el.textContent = 'скопировано';
    el.classList.add('copied');
    setTimeout(() => {
      el.textContent = old;
      el.classList.remove('copied');
    }, 1000);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(id).then(done).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = id; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove();
      done();
    });
  } else {
    const ta = document.createElement('textarea');
    ta.value = id; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove();
    done();
  }
}

/* ---------- Переключение раскладки устройств ---------- */

function setDevicesLayout(mode) {
  devicesLayout = (mode === 'list') ? 'list' : 'grid';
  const g = document.getElementById('devview-grid');
  const l = document.getElementById('devview-list');
  if (g) g.classList.toggle('active', devicesLayout === 'grid');
  if (l) l.classList.toggle('active', devicesLayout === 'list');
  try { localStorage.setItem('devicesLayout', devicesLayout); } catch (e) {}
  const grid = document.getElementById('grid');
  if (grid) {
    grid.classList.toggle('grid',      devicesLayout === 'grid');
    grid.classList.toggle('grid-list', devicesLayout === 'list');
  }
  renderCurrentView();
}

function toggleRefreshPause() {
  _refreshPaused = !_refreshPaused;
  const btn = document.getElementById('pause-btn');
  if (btn) btn.textContent = _refreshPaused ? '▶' : '⏸';
}

/* ============================================================
   Telegram
   ============================================================ */

async function loadTelegramSettings() {
  try {
    const r = await api('/api/settings/telegram');
    const en    = document.getElementById('tg-enabled');
    const tok   = document.getElementById('tg-token');
    const chat  = document.getElementById('tg-chat');
    const pm    = document.getElementById('tg-parse');
    const ne    = document.getElementById('tg-notify-errors');
    const proxy = document.getElementById('tg-proxy');
    const hint  = document.getElementById('tg-token-hint');
    if (!en) return;

    en.checked  = !!r.enabled;
    chat.value  = r.default_chat_id || '';
    pm.value    = r.parse_mode || '';
    ne.checked  = !!r.notify_on_errors;
    if (proxy) proxy.value = r.proxy_url || '';
    tok.value   = '';
    tok.placeholder = r.has_token
      ? ('сохранён: ' + (r.bot_token_masked || '•••'))
      : '123456:ABC-DEF…';
    if (hint) {
      hint.textContent = r.has_token
        ? 'Токен сохранён. Введите новый, чтобы заменить.'
        : 'Получите у @BotFather.';
    }
  } catch (e) {
    console.warn('[tg] load error', e);
  }
}

async function saveTelegramSettings() {
  const body = {
    enabled:           document.getElementById('tg-enabled').checked,
    default_chat_id:   document.getElementById('tg-chat').value.trim(),
    parse_mode:        document.getElementById('tg-parse').value,
    notify_on_errors:  document.getElementById('tg-notify-errors').checked,
    proxy_url:         (document.getElementById('tg-proxy')?.value || '').trim(),
  };
  const tok = document.getElementById('tg-token').value.trim();
  if (tok && !tok.includes('…') && !tok.includes('•')) body.bot_token = tok;

  const st = document.getElementById('tg-status');
  try {
    const r = await api('/api/settings/telegram', 'POST', body);
    if (st) st.textContent = r.ok ? '✅ Сохранено' : ('❌ ' + (r.error || 'ошибка'));
    if (r.ok) await loadTelegramSettings();
  } catch (e) {
    if (st) st.textContent = '❌ ' + e.message;
  }
}

async function testTelegram() {
  const st = document.getElementById('tg-status');
  if (st) st.textContent = '⏳ Отправка…';
  try {
    const r = await api('/api/settings/telegram/test', 'POST', {});
    if (r.ok) {
      const u = r.bot?.username ? '@' + r.bot.username : 'бот';
      if (st) st.textContent = `✅ Тест отправлен через ${u}`;
    } else {
      const u = r.bot?.username ? ` (бот @${r.bot.username})` : '';
      if (st) st.textContent = `❌ ${r.error || 'ошибка'}${u}`;
    }
  } catch (e) {
    if (st) st.textContent = '❌ ' + e.message;
  }
}