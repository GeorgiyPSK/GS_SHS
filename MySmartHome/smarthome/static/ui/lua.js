/* ============================================================
   Lua-редактор, подсветка, логи Lua
   ============================================================ */

function luaHighlight(src) {
  const escHtml = s => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const re = /(--\[\[[\s\S]*?\]\]|--[^\n]*|\[\[[\s\S]*?\]\]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b(?:and|break|do|else|elseif|end|false|for|function|goto|if|in|local|nil|not|or|repeat|return|then|true|until|while)\b|\b(?:print|type|tostring|tonumber|pairs|ipairs|table|string|math|io|os|require|pcall|xpcall|error|assert|select|rawget|rawset|setmetatable|getmetatable|unpack|next|coroutine)\b|[+\-*/%^#=~<>]=?|[{}\[\]();,.:]|[^\s+\-*/%^#=~<>{}()\[\];,.:"']+|\s+)/g;

  let out = '';
  let m;
  let last = 0;

  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out += escHtml(src.slice(last, m.index));
    const t = m[0];
    let cls = 'lua-tok-ident';

    if (t.startsWith('--'))                       cls = 'lua-tok-comment';
    else if (t.startsWith('"') || t.startsWith("'") || t.startsWith('[['))
                                                  cls = 'lua-tok-string';
    else if (/^\d/.test(t))                       cls = 'lua-tok-number';
    else if (/^(and|break|do|else|elseif|end|false|for|function|goto|if|in|local|nil|not|or|repeat|return|then|true|until|while)$/.test(t))
                                                  cls = 'lua-tok-keyword';
    else if (/^(print|type|tostring|tonumber|pairs|ipairs|table|string|math|io|os|require|pcall|xpcall|error|assert|select|rawget|rawset|setmetatable|getmetatable|unpack|next|coroutine)$/.test(t))
                                                  cls = 'lua-tok-builtin';
    else if (/^[+\-*/%^#=~<>{}()\[\];,.:]+$/.test(t))
                                                  cls = 'lua-tok-operator';
    else if (/^\s+$/.test(t)) {
      out += t;
      last = m.index + t.length;
      continue;
    }

    out += `<span class="${cls}">${escHtml(t)}</span>`;
    last = m.index + t.length;
  }
  if (last < src.length) out += escHtml(src.slice(last));
  if (out.endsWith('\n')) out += ' ';
  return out;
}

function renderLuaGutter(ta) {
  const wrap = ta.closest('.lua-editor-wrap');
  if (!wrap) return;
  const gutter = wrap.querySelector('.lua-gutter');
  if (!gutter) return;

  // число строк = число переносов + 1 (учитываем и мягкие переносы — грубо)
  const lines = ta.value.split('\n').length;
  let html = '';
  for (let i = 1; i <= lines; i++) html += `<div>${i}</div>`;
  gutter.innerHTML = html;

  // ширина gutter — по числу цифр в последнем номере
  const digits = String(lines).length;
  gutter.style.minWidth = (digits + 1) + 'ch';
}

function onLuaCodeInput(ta) {
  const wrap = ta.closest('.lua-editor-wrap');
  if (!wrap) return;
  const pre = wrap.querySelector('.lua-highlight');
  if (pre) pre.innerHTML = luaHighlight(ta.value);

  renderLuaGutter(ta);
  syncLuaScroll(ta);
}

function syncLuaScroll(ta) {
  const wrap = ta.closest('.lua-editor-wrap');
  if (!wrap) return;
  const pre    = wrap.querySelector('.lua-highlight');
  const gutter = wrap.querySelector('.lua-gutter');

  if (pre) {
    pre.scrollTop  = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  }
  if (gutter) {
    gutter.scrollTop = ta.scrollTop;
  }
}

/* --- Переключение темы --- */
function toggleLuaEditorTheme() {
  const wrap = document.querySelector('.lua-editor-wrap');
  if (!wrap) return;
  const isLight = wrap.classList.toggle('light');
  localStorage.setItem('luaEditorTheme', isLight ? 'light' : 'dark');
  const ta = wrap.querySelector('textarea.lua-input');
  if (ta) onLuaCodeInput(ta);
  const btn = document.getElementById('lua-theme-btn');
  if (btn) btn.textContent = isLight ? '🌙 Тёмная' : '🌓 Тема';
}

/* --- Сайдбар и редактор --- */
function renderLuaSidebar() {
  const box = document.getElementById('lua-sidebar-list');
  if (!box) return;
  const query = (document.getElementById('lua-search')?.value || '').trim().toLowerCase();
  let list = luaScriptsCache || [];
  if (query) {
    list = list.filter(s =>
      (s.name || '').toLowerCase().includes(query) ||
      (s.code || '').toLowerCase().includes(query)
    );
  }
  if (!list.length) {
    box.innerHTML = '<div style="opacity:.6; font-size:.8rem;">— нет скриптов —</div>';
    return;
  }
  box.innerHTML = list.map(s => `
    <div class="lua-sidebar-item ${s.enabled ? '' : 'disabled'} ${s.id === luaSelectedId ? 'active' : ''}" data-id="${s.id}">
      <span class="ls-dot" title="${s.enabled ? 'включён' : 'отключён'}"></span>
    <span class="ls-name" style="display:flex;flex-direction:column;line-height:1.2;">
  <span onclick="selectLuaScript('${s.id}')"
    title="${esc(s.name)}"
    style="cursor:pointer;">${esc(s.name)}</span>
  <small
    title="Клик — скопировать id"
    onclick="event.stopPropagation(); copyDeviceId('${s.id}', this)"
    style="opacity:.55;font-family:monospace;font-size:.7rem;cursor:pointer;">${esc(s.id)}</small>
</span>
      <button class="ls-run"  title="Запустить"
        onclick="event.stopPropagation(); runLuaScriptById('${s.id}')">▶</button>
      <button class="ls-del"  title="Удалить"
        onclick="event.stopPropagation(); removeLuaScript('${s.id}')">✕</button>
    </div>
  `).join('');
}

function selectLuaScript(id) {
  if (_luaEditorDirty) {
    if (!confirm('Есть несохранённые изменения. Переключиться без сохранения?')) return;
  }
  _luaEditorDirty = false;
  luaSelectedId = id;
  renderLuaEditor();
  renderLuaSidebar();
  renderLuaLogs();
}

async function reloadLuaScripts() {
  try {
    luaScriptsCache = await api('/api/lua_scripts');
    if (!luaSelectedId && luaScriptsCache.length) {
      luaSelectedId = luaScriptsCache[0].id;
    }
    if (luaSelectedId && !luaScriptsCache.some(s => s.id === luaSelectedId)) {
      luaSelectedId = luaScriptsCache[0]?.id || null;
    }
    renderLuaEditor();
    renderLuaSidebar();
  } catch (e) {
    const box = document.getElementById('lua-editor');
    if (box) box.innerHTML = '<div class="empty">Ошибка: ' + esc(e.message) + '</div>';
  }
}

function addTrigger() {
  const s = luaScriptsCache.find(x => x.id === luaSelectedId);
  if (!s) return;
  s.triggers = s.triggers || [];
  s.triggers.push({ type: 'knx', address: '' });
  _luaEditorDirty = true;
  renderLuaEditor();
}

function removeTrigger(idx) {
  const s = luaScriptsCache.find(x => x.id === luaSelectedId);
  if (!s || !s.triggers) return;
  s.triggers.splice(idx, 1);
  _luaEditorDirty = true;
  renderLuaEditor();
}

function onTriggerTypeChange(idx) {
  const s = luaScriptsCache.find(x => x.id === luaSelectedId);
  if (!s) return;
  const sel = document.querySelector(`[data-trigger="${idx}"][data-tkey="type"]`);
  if (!sel) return;
  s.triggers[idx] = { type: sel.value };
  _luaEditorDirty = true;
  renderLuaEditor();
}

function onTriggerEdit(idx, el) {
  const s = luaScriptsCache.find(x => x.id === luaSelectedId);
  if (!s) return;
  const key = el.dataset.tkey;
  s.triggers[idx] = s.triggers[idx] || {};
  s.triggers[idx][key] = el.value;
  _luaEditorDirty = true;
}

function renderTriggerDeviceSelect(idx, selectedId) {
  const opts = devicesCache
    .map(d => `<option value="${esc(d.id)}" ${d.id === selectedId ? 'selected' : ''}>
                 ${esc(d.name)} · ${esc(d.id)}
               </option>`)
    .join('');
  return `
    <select data-trigger="${idx}" data-tkey="device-select"
      onchange="onTriggerDeviceSelect(${idx}, this)"
      style="min-width:180px; max-width:260px;">
      <option value="">— выберите устройство —</option>
      ${opts}
    </select>`;
}

function renderTriggerFieldOptions(deviceId, selectedField) {
  const dev = devicesCache.find(d => d.id === deviceId);
  if (!dev) return '';
  const fields = Object.keys(dev.state || {});
  return fields.map(f =>
    `<option value="${esc(f)}" ${f === selectedField ? 'selected' : ''}>${esc(f)}</option>`
  ).join('');
}

function onTriggerDeviceIdInput(idx, el) {
  const s = luaScriptsCache.find(x => x.id === luaSelectedId);
  if (!s) return;
  s.triggers = s.triggers || [];
  s.triggers[idx] = s.triggers[idx] || { type: 'device_changed' };
  s.triggers[idx].device = el.value.trim();
  _luaEditorDirty = true;
  renderLuaEditor();
  const inp = document.querySelector(
    `#lua-editor [data-trigger="${idx}"][data-tkey="device"]`
  );
  if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}

function onTriggerDeviceSelect(idx, el) {
  const s = luaScriptsCache.find(x => x.id === luaSelectedId);
  if (!s) return;
  s.triggers = s.triggers || [];
  s.triggers[idx] = s.triggers[idx] || { type: 'device_changed' };
  s.triggers[idx].device = el.value;
  s.triggers[idx].field = '';
  _luaEditorDirty = true;
  renderLuaEditor();
}

function pickTriggerDevice(idx) {
  const names = devicesCache.map(d => `${d.name} — ${d.id}`).join('\n');
  const id = prompt('Введите ID устройства:\n\n' + names.slice(0, 4000));
  if (!id) return;
  const d = devicesCache.find(x => x.id === id.trim());
  if (!d) { alert('Устройство не найдено'); return; }
  const s = luaScriptsCache.find(x => x.id === luaSelectedId);
  if (!s) return;
  s.triggers = s.triggers || [];
  s.triggers[idx] = s.triggers[idx] || { type: 'device_changed' };
  s.triggers[idx].device = d.id;
  s.triggers[idx].field = s.triggers[idx].field || '';
  _luaEditorDirty = true;
  renderLuaEditor();
}

function renderLuaEditor() {
  const box = document.getElementById('lua-editor');
  if (!box) return;

  const s = luaScriptsCache.find(x => x.id === luaSelectedId);
  if (!s) {
    box.innerHTML = '<div class="empty">Скрипт не выбран. Выберите из списка справа.</div>';
    updateLuaLogTitle();
    return;
  }

  const triggers = s.triggers || [];
  const savedH = parseInt(localStorage.getItem('luaEditorHeight') || '320', 10);

  // Тема
  const isLightTheme = (localStorage.getItem('luaEditorTheme') || 'dark') === 'light';
  const themeClass = isLightTheme ? ' light' : '';
  const themeBtnText = isLightTheme ? '🌙 Тёмная' : '🌓 Тема';

  const triggerRows = triggers.map((t, i) => `
    <div class="field-row" style="display:flex;gap:.3rem;align-items:center;flex-wrap:wrap;">
      <select data-trigger="${i}" data-tkey="type"
        onchange="onTriggerTypeChange(${i})">
        <option value="knx"            ${t.type==='knx'?'selected':''}>KNX</option>
        <option value="mqtt"           ${t.type==='mqtt'?'selected':''}>MQTT</option>
        <option value="device_changed" ${t.type==='device_changed'?'selected':''}>Устройство</option>
        <option value="timer"          ${t.type==='timer'?'selected':''}>Таймер</option>
        <option value="any"            ${t.type==='any'?'selected':''}>Любое</option>
      </select>
      ${t.type === 'knx' ? `
        <input type="text" placeholder="адрес, напр. 6/0/0"
          value="${esc(t.address||'')}"
          data-trigger="${i}" data-tkey="address"
          oninput="onTriggerEdit(${i}, this)">
      ` : ''}
      ${t.type === 'mqtt' ? `
        <input type="text" placeholder="топик"
          value="${esc(t.topic||'')}"
          data-trigger="${i}" data-tkey="topic"
          oninput="onTriggerEdit(${i}, this)">
        <input type="text" placeholder="payload содержит"
          value="${esc(t.payload_match||'')}"
          data-trigger="${i}" data-tkey="payload_match"
          oninput="onTriggerEdit(${i}, this)">
      ` : ''}
     ${t.type === 'device_changed' ? `
  <input type="text" placeholder="ID устройства"
    value="${esc(t.device||'')}"
    data-trigger="${i}" data-tkey="device"
    oninput="onTriggerDeviceIdInput(${i}, this)"
    style="min-width:140px;"
    title="Введите id — или выберите ниже">
  <button class="btn small gray" type="button"
    onclick="pickTriggerDevice(${i})"
    title="Выбрать из списка">🔍</button>
  ${renderTriggerDeviceSelect(i, t.device)}
  <select data-trigger="${i}" data-tkey="field"
    onchange="onTriggerEdit(${i}, this)"
    ${!t.device ? 'disabled' : ''}>
    <option value="">— поле —</option>
    ${renderTriggerFieldOptions(t.device, t.field)}
  </select>
` : ''}
      ${t.type === 'timer' ? `
        <input type="text" placeholder="id таймера"
          value="${esc(t.timer_id||'')}"
          data-trigger="${i}" data-tkey="timer_id"
          oninput="onTriggerEdit(${i}, this)">
      ` : ''}
      <button class="btn small danger" onclick="removeTrigger(${i})">✕</button>
    </div>
  `).join('');

  box.innerHTML = `
  <div class="row" data-id="${s.id}">
    <div class="row-head">
      <input type="text" value="${esc(s.name)}"
        data-key="name"
        oninput="markRowDirty(this); _luaEditorDirty = true;"
        style="background:transparent;border:none;color:#fff;font-size:1.1rem;font-weight:600;flex:1;">
      <label style="display:flex;align-items:center;gap:.4rem;font-size:.9rem;">
        <input type="checkbox" ${s.enabled ? 'checked' : ''}
          data-key="enabled"
          onchange="markRowDirty(this); _luaEditorDirty = true;"> вкл
      </label>
      <button class="btn small gray" id="lua-theme-btn" onclick="toggleLuaEditorTheme()" title="Сменить тему редактора">${themeBtnText}</button>
      <button class="btn small green ${_luaEditorDirty ? 'dirty' : ''}"
        onclick="saveLuaScript('${s.id}')">💾 Сохранить</button>
      <button class="btn small gray" onclick="runLuaScriptById('${s.id}')">▶ Запустить</button>
      <button class="btn small danger" onclick="removeLuaScript('${s.id}')">🗑 Удалить</button>
    </div>

      <div class="row-body">
        <details open>
          <summary style="cursor:pointer;user-select:none;opacity:.85;">
            ⚡ Триггеры (${triggers.length})
          </summary>
          <div style="margin-top:.4rem;display:flex;flex-direction:column;gap:.3rem;">
            ${triggerRows || '<div style="opacity:.6;font-size:.8rem;">— триггеров нет, запуск только вручную —</div>'}
          </div>
          <div style="margin-top:.4rem;">
            <button class="btn small gray" onclick="addTrigger()">➕ Триггер</button>
          </div>
        </details>

        <div class="lua-editor-wrap${themeClass}" style="position:relative; height:${savedH}px;">
          <div class="lua-gutter" aria-hidden="true"></div>
          <div class="lua-code-area">
            <pre class="lua-highlight" aria-hidden="true"></pre>
            <textarea data-key="code"
              class="lua-input"
              oninput="onLuaCodeInput(this); markRowDirty(this); _luaEditorDirty = true;"
              onscroll="syncLuaScroll(this)"
              spellcheck="false"
              placeholder="-- Lua-скрипт&#10;log('Привет')">${esc(s.code)}</textarea>
          </div>
        </div>
        ${s.updated ? `<div style="font-size:.75rem;opacity:.6;">обновлён: ${esc(s.updated)}</div>` : ''}
      </div>
    </div>
  `;

  const ta = box.querySelector('textarea.lua-input');
  if (ta) {
    onLuaCodeInput(ta);
    ta.addEventListener('mouseup', () => {
      const wrap = ta.closest('.lua-editor-wrap');
      if (wrap) localStorage.setItem('luaEditorHeight', wrap.offsetHeight);
    });
    ta.addEventListener('blur', () => {
      const wrap = ta.closest('.lua-editor-wrap');
      if (wrap) localStorage.setItem('luaEditorHeight', wrap.offsetHeight);
    });
  }

  updateLuaLogTitle();
}

function updateLuaLogTitle() {
  const el = document.getElementById('lua-log-title');
  if (!el) return;
  const s = luaScriptsCache.find(x => x.id === luaSelectedId);
  el.textContent = s ? s.name : '—';
}

async function addLuaScript() {
  const created = await api('/api/lua_scripts', 'POST', {
    name: 'Новый скрипт',
    code: '-- Lua-скрипт\nlog("Привет из Lua")\n',
    enabled: true,
  });
  luaSelectedId = created.id;
  await reloadLuaScripts();
}

async function saveLuaScript(id) {
  const row = document.querySelector(`#lua-editor .row[data-id="${id}"]`);
  if (!row) return;
  const fields = collectRowFields(row);
  const s = luaScriptsCache.find(x => x.id === id) || {};
  await api('/api/lua_scripts/' + id, 'POST', {
    name: fields.name ?? '',
    code: fields.code ?? '',
    enabled: !!fields.enabled,
    triggers: s.triggers || [],
  });
  _luaEditorDirty = false;
  await reloadLuaScripts();
}

async function removeLuaScript(id) {
  if (!confirm('Удалить скрипт?')) return;
  await api('/api/lua_scripts/' + id, 'DELETE');
  if (luaSelectedId === id) luaSelectedId = null;
  await reloadLuaScripts();
}

function addLuaLog(scriptId, level, text) {
  if (!luaLogs[scriptId]) luaLogs[scriptId] = [];
  luaLogs[scriptId].push({
    ts: new Date().toLocaleTimeString('ru-RU', { hour12: false }),
    level, text,
  });
  if (luaLogs[scriptId].length > 500) {
    luaLogs[scriptId] = luaLogs[scriptId].slice(-500);
  }
  if (scriptId === luaSelectedId) renderLuaLogs();
}

function clearLuaLogs() {
  if (luaSelectedId) luaLogs[luaSelectedId] = [];
  renderLuaLogs();
}

function renderLuaLogs() {
  const out = document.getElementById('lua-log-output');
  if (!out) return;
  const arr = (luaSelectedId && luaLogs[luaSelectedId]) || [];
  if (!arr.length) {
    out.innerHTML = '<span style="opacity:.55;">— логов пока нет —</span>';
    return;
  }
  out.innerHTML = arr.map(r => {
    const cls = r.level === 'error' ? 'log-error' : 'log-info';
    return `<span class="log-time">[${esc(r.ts)}]</span> <span class="${cls}">${esc(r.text)}</span>`;
  }).join('\n');
  out.scrollTop = out.scrollHeight;
}

async function runLuaScriptById(id) {
  if (luaSelectedId !== id) {
    luaSelectedId = id;
    renderLuaEditor();
    renderLuaSidebar();
  }
  try {
    const r = await api('/api/lua_scripts/' + id + '/run', 'POST', {});
    if (!r.ok) {
      addLuaLog(id, 'error', '❌ Ошибка: ' + (r.error || 'unknown'));
    }
  } catch (e) {
    addLuaLog(id, 'error', '❌ Ошибка: ' + e.message);
  }
}

async function runLuaScript() {
  const code = document.getElementById('lua-code').value;
  const out = document.getElementById('lua-output');
  out.textContent = '…';
  try {
    const r = await api('/api/lua/run', 'POST', { code });
    if (r.ok) {
      out.textContent = 'OK\n' + (r.result !== null && r.result !== undefined
        ? 'Результат: ' + JSON.stringify(r.result)
        : '(без результата)');
    } else {
      out.textContent = 'ОШИБКА: ' + r.error;
    }
  } catch (e) {
    out.textContent = 'Ошибка запроса: ' + e.message;
  }
}

function clearLuaOutput() {
  document.getElementById('lua-output').textContent = '';
}