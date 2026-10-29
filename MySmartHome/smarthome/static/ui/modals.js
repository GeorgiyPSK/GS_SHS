/* ============================================================
   Общие модалки: emoji picker, custom field, меню
   ============================================================ */

function openEmojiPicker(currentEmoji, items) {
  return new Promise((resolve) => {
    _emojiPickerResolve = resolve;

    const list = (items && items.length)
      ? items.map(x => typeof x === 'string' ? { id: x, label: x } : x)
      : ROOM_EMOJIS.map(x => ({ id: x, label: x }));

    let overlay = document.getElementById('emoji-picker-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'emoji-picker-overlay';
      overlay.className = 'modal-overlay';
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeEmojiPicker(null);
      });
      overlay.innerHTML = `
        <div class="modal" style="max-width:600px;">
          <button class="modal-close" onclick="closeEmojiPicker(null)">✕</button>
          <div style="padding:1.2rem;">
            <h3 style="margin:0 0 .8rem;">Выбор иконки</h3>
            <div id="emoji-grid" style="
              display:grid;
              grid-template-columns:repeat(8, 1fr);
              gap:.3rem;
              max-height:60vh;
              overflow-y:auto;
            "></div>
            <div style="margin-top:1rem;display:flex;gap:.5rem;align-items:center;justify-content:flex-end;">
              <input type="text" id="emoji-custom" placeholder="свой эмодзи" maxlength="4"
                style="width:100px;text-align:center;font-size:1.2rem;">
              <button class="btn gray" onclick="closeEmojiPicker(null)">Отмена</button>
              <button class="btn primary" onclick="applyCustomEmoji()">OK</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#emoji-custom').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); applyCustomEmoji(); }
      });
    }

    const grid = overlay.querySelector('#emoji-grid');
    grid.innerHTML = '';
    list.forEach(it => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn gray';
      btn.style.cssText = 'padding:.3rem;font-size:1.4rem;line-height:1;cursor:pointer;';
      btn.textContent = it.id;
      btn.title = it.label || it.id;
      if (currentEmoji && it.id === currentEmoji) {
        btn.style.boxShadow = '0 0 0 2px #4caf50';
      }
      btn.onclick = () => closeEmojiPicker(it.id);
      grid.appendChild(btn);
    });

    overlay.querySelector('#emoji-custom').value = '';
    overlay.classList.add('open');
  });
}

function closeEmojiPicker(emoji) {
  const overlay = document.getElementById('emoji-picker-overlay');
  if (overlay) overlay.classList.remove('open');
  if (_emojiPickerResolve) {
    _emojiPickerResolve(emoji);
    _emojiPickerResolve = null;
  }
}

function applyCustomEmoji() {
  const el = document.getElementById('emoji-custom');
  const v = (el && el.value || '').trim();
  closeEmojiPicker(v || null);
}

/* --- Меню устройства (Node-RED / cURL) --- */
function showDeviceMenu(id, btn) {
  const items = [
    ['Node-RED MQTT', () => NodeRed.openForDevice(id)],
    ['Node-RED HTTP', () => NodeRedHttp.openForDevice(id)],
  ];
  const menu = document.createElement('div');
  menu.style.cssText = `
    position:absolute; z-index:300; background:rgba(20,30,60,.98);
    border:1px solid rgba(255,255,255,.2); border-radius:10px;
    padding:.3rem; box-shadow:0 8px 22px rgba(0,0,0,.5); font-size:.85rem;`;
  items.forEach(([text, fn]) => {
    const b = document.createElement('button');
    b.className = 'btn small gray';
    b.style.cssText = 'display:block;width:100%;text-align:left;margin:.15rem 0;';
    b.textContent = text;
    b.onclick = () => { menu.remove(); fn(); };
    menu.appendChild(b);
  });
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect();
  menu.style.left = (r.left + window.scrollX) + 'px';
  menu.style.top  = (r.bottom + window.scrollY + 4) + 'px';
  setTimeout(() => {
    const close = (e) => {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); }
    };
    document.addEventListener('click', close);
  }, 0);
}

/* --- Модалка кастомного поля (кастомные типы) --- */
function openCustomFieldModal(deviceId, fieldName) {
  if (currentMode !== 'edit') return;
  const d = devicesCache.find(x => x.id === deviceId);
  if (!d) return;
  const meta = window.TYPES[d.type] || {};
  if (!meta.custom || !meta.raw) return;
  const f = (meta.raw.fields || []).find(x => x.name === fieldName);
  if (!f) return;

  const v = d.state ? d.state[fieldName] : undefined;
  const control = f.control || (f.type === 'bool' ? 'switch'
                   : f.type === 'number' ? 'number' : 'text');

  const body = document.getElementById('cf-modal-body');
  const titleEl = document.getElementById('cf-modal-title');
  if (!body || !titleEl) return;
  titleEl.textContent = f.label || fieldName;

  const inputStyle = 'width:100%; padding:.55rem .7rem; border-radius:8px; ' +
    'border:1px solid var(--input-border); background:var(--input-bg); color:var(--text); font-family:inherit;';

  let html = '';
  if (control === 'slider') {
    const min = Number.isFinite(f.min) ? f.min : 0;
    const max = Number.isFinite(f.max) ? f.max : 100;
    const step = Number.isFinite(f.step) ? f.step : 1;
    const cur = v ?? min;
    html = `
      <div style="display:flex; flex-direction:column; gap:.5rem;">
        <input type="range" id="cf-input" min="${min}" max="${max}" step="${step}" value="${cur}"
          oninput="document.getElementById('cf-value-label').textContent = this.value">
        <div style="font-size:.9rem; opacity:.8;">Значение: <span id="cf-value-label">${cur}</span></div>
      </div>`;
  } else if (control === 'select') {
    const opts = Array.isArray(f.options) ? f.options : [];
    const optionsHtml = opts.map(o =>
      `<option value="${esc(o)}" ${String(v) === String(o) ? 'selected' : ''}>${esc(o)}</option>`
    ).join('');
    html = `<select id="cf-input" style="${inputStyle}">${optionsHtml || '<option value="">— нет вариантов —</option>'}</select>`;
  } else if (control === 'number' || f.type === 'number') {
    html = `<input type="number" id="cf-input" step="any" value="${v ?? 0}" style="${inputStyle}">`;
  } else if (control === 'switch' || f.type === 'bool') {
    html = `<label style="display:flex; gap:.5rem; align-items:center;">
      <input type="checkbox" id="cf-input" ${v ? 'checked' : ''} style="width:22px;height:22px;">
      <span>Включено</span></label>`;
  } else {
    html = `<input type="text" id="cf-input" value="${esc(v ?? '')}" style="${inputStyle}">`;
  }
  body.innerHTML = html;

  document.getElementById('cf-modal-apply').onclick = () => {
    const inp = document.getElementById('cf-input');
    if (!inp) { closeCustomFieldModal(); return; }
    let value;
    if (control === 'switch' || f.type === 'bool') value = inp.checked;
    else if (control === 'number' || control === 'slider' || f.type === 'number') {
      value = parseFloat(inp.value);
      if (!Number.isFinite(value)) value = 0;
    } else value = inp.value;
    setState(deviceId, { [fieldName]: value });
    closeCustomFieldModal();
  };
  document.getElementById('cf-modal-overlay').classList.add('open');
}

function closeCustomFieldModal() {
  const modal = document.getElementById('cf-modal-overlay');
  if (modal) modal.classList.remove('open');
}

function applyCustomFieldModal(deviceId, fieldName, control, ftype) {
  const inp = document.getElementById('cf-input');
  if (!inp) { closeCustomFieldModal(); return; }

  let value;
  if (control === 'switch' || ftype === 'bool') value = inp.checked;
  else if (control === 'number' || control === 'slider' || ftype === 'number') {
    value = parseFloat(inp.value);
    if (!Number.isFinite(value)) value = 0;
  } else value = inp.value;

  setState(deviceId, { [fieldName]: value });
  closeCustomFieldModal();
}