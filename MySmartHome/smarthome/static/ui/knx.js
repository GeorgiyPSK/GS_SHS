/* ============================================================
   KNX: поля устройства, GA-таблица, привязки, настройки, импорт .knxproj
   ============================================================ */

/* ---------- Форма полей KNX в карточке устройства ---------- */

function renderKnxFieldsList(d) {
  const knx = d.knx || {};
  const fields = knx.fields || {};
  const keys = Object.keys(fields);
  if (!keys.length) {
    return '<div style="opacity:.6; font-size:.75rem;">— полей пока нет —</div>';
  }
  return keys.map(f => {
    const spec = fields[f] || {};
    let addr = '', dpt = '';
    if (spec.read || spec.write) {
      const r = spec.read || {}, w = spec.write || {};
      const rA = r.address || '', wA = w.address || '';
      const rD = r.dpt || '',     wD = w.dpt || '';
      if (rA && wA && rA !== wA) {
        addr = `R:${rA} W:${wA}`;
        dpt  = rD === wD ? rD : `R:${rD} W:${wD}`;
      } else {
        addr = rA || wA;
        dpt  = rD || wD;
      }
    } else {
      addr = spec.address || '';
      dpt  = spec.dpt || '';
    }
    return `<div class="knx-field">
      <span class="knx-field-name">${esc(f)}</span>
      <span class="knx-field-meta">${esc(addr)} · ${esc(dpt)}</span>
      <button class="btn small gray" title="Загрузить в форму"
        onclick="knxLoadFieldIntoForm('${d.id}', '${esc(f)}')">✎</button>
      <button class="btn small danger" title="Удалить"
        onclick="knxRemoveField('${d.id}', '${esc(f)}')">✕</button>
    </div>`;
  }).join('');
}

function knxGuessDpt(value) {
  if (typeof value === 'boolean') return 'DPT-1.001';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      if (value >= 0 && value <= 255) return 'DPT-5.001';
      return 'DPT-7.001';
    }
    return 'DPT-9.001';
  }
  return 'DPT-1.001';
}

async function knxApplyField(devId) {
  const d = devicesCache.find(x => x.id === devId);
  if (!d) return;

  const field   = document.getElementById('knx-field-sel-' + devId)?.value;
  const mode    = document.getElementById('knx-mode-sel-'  + devId)?.value || 'single';
  const addr    = (document.getElementById('knx-addr-'  + devId)?.value || '').trim();
  const dpt     = (document.getElementById('knx-dpt-'   + devId)?.value || '').trim();
  const waddr   = (document.getElementById('knx-waddr-' + devId)?.value || '').trim();
  const wdpt    = (document.getElementById('knx-wdpt-'  + devId)?.value || '').trim();

  if (!field) { alert('Выберите поле'); return; }
  if (!addr)  { alert('Укажите групповой адрес'); return; }
  if (!dpt)   { alert('Укажите DPT'); return; }

  const knx = d.knx || {};
  const fields = JSON.parse(JSON.stringify(knx.fields || {}));

  let spec;
  if (mode === 'rw') {
    if (!waddr) { alert('Укажите адрес write'); return; }
    spec = {
      read:  { address: addr,  dpt: dpt },
      write: { address: waddr, dpt: wdpt || dpt },
    };
  } else {
    spec = { address: addr, dpt: dpt };
  }

  fields[field] = spec;

  await saveDeviceKnx(devId, { fields });

  const ta = document.getElementById('knx-json-' + devId);
  if (ta) ta.value = JSON.stringify(fields, null, 2);

  const list = document.getElementById('knx-fields-list-' + devId);
  const updated = devicesCache.find(x => x.id === devId);
  if (list && updated) list.innerHTML = renderKnxFieldsList(updated);
}

function knxRemoveField(devId, field) {
  const d = devicesCache.find(x => x.id === devId);
  if (!d) return;

  if (field === undefined) {
    field = document.getElementById('knx-field-sel-' + devId)?.value;
  }
  if (!field) return;
  if (!confirm(`Удалить поле «${field}» из KNX?`)) return;

  const fields = JSON.parse(JSON.stringify((d.knx && d.knx.fields) || {}));
  delete fields[field];

  saveDeviceKnx(devId, { fields }).then(() => {
    const ta = document.getElementById('knx-json-' + devId);
    if (ta) ta.value = JSON.stringify(fields, null, 2);

    const list = document.getElementById('knx-fields-list-' + devId);
    if (list) {
      const updated = devicesCache.find(x => x.id === devId);
      if (updated) list.innerHTML = renderKnxFieldsList(updated);
    }
  });
}

function knxLoadFieldIntoForm(devId, field) {
  const d = devicesCache.find(x => x.id === devId);
  if (!d) return;
  const spec = (d.knx && d.knx.fields && d.knx.fields[field]) || {};

  const fieldSel = document.getElementById('knx-field-sel-' + devId);
  const modeSel  = document.getElementById('knx-mode-sel-'  + devId);
  const addrI    = document.getElementById('knx-addr-'      + devId);
  const dptI     = document.getElementById('knx-dpt-'       + devId);
  const waddrI   = document.getElementById('knx-waddr-'     + devId);
  const wdptI    = document.getElementById('knx-wdpt-'      + devId);

  if (fieldSel) fieldSel.value = field;

  const r = spec.read  || {};
  const w = spec.write || {};

  if ((r.address || w.address) && (r.address !== w.address || r.dpt !== w.dpt)) {
    if (modeSel) modeSel.value = 'rw';
    if (addrI)  addrI.value  = r.address || w.address || '';
    if (dptI)   dptI.value   = r.dpt     || w.dpt     || '';
    if (waddrI) waddrI.value = w.address || '';
    if (wdptI)  wdptI.value  = w.dpt     || '';
  } else {
    if (modeSel) modeSel.value = 'single';
    if (addrI)  addrI.value = spec.address || r.address || w.address || '';
    if (dptI)   dptI.value  = spec.dpt     || r.dpt     || w.dpt     || '';
    if (waddrI) waddrI.value = '';
    if (wdptI)  wdptI.value  = '';
  }
}

function knxOnFieldChange(devId) {
  const d = devicesCache.find(x => x.id === devId);
  if (!d) return;
  const field = document.getElementById('knx-field-sel-' + devId)?.value;
  if (!field) return;

  const val = d.state ? d.state[field] : undefined;
  const dptI = document.getElementById('knx-dpt-' + devId);
  if (dptI && (!dptI.value || dptI.value === 'DPT-1.001')) {
    dptI.value = knxGuessDpt(val);
  }

  const addrI = document.getElementById('knx-addr-' + devId);
  if (addrI) {
    const knx = d.knx || {};
    const fields = knx.fields || {};
    if (!fields[field]) {
      const n = Object.keys(fields).length + 1;
      addrI.value = `1/2/${n}`;
    } else {
      knxLoadFieldIntoForm(devId, field);
    }
  }
}

/* ---------- JSON-редактор KNX ---------- */

function knxReadJson(devId) {
  const ta = document.getElementById('knx-json-' + devId);
  if (!ta) return {};
  try {
    return JSON.parse(ta.value || '{}') || {};
  } catch (e) {
    alert('Некорректный JSON: ' + e.message);
    return null;
  }
}

function knxWriteJson(devId, obj) {
  const ta = document.getElementById('knx-json-' + devId);
  if (!ta) return;
  const txt = JSON.stringify(obj, null, 2);
  ta.value = txt;
  saveDeviceKnxFields(devId, txt);
}

function knxAddField(devId) {
  const d = devicesCache.find(x => x.id === devId);
  if (!d) return;

  const fieldSel = document.getElementById('knx-field-sel-' + devId);
  const modeSel  = document.getElementById('knx-mode-sel-'  + devId);
  if (!fieldSel || !modeSel) return;

  const field = fieldSel.value;
  const mode  = modeSel.value;
  if (!field) { alert('Выберите поле'); return; }

  const cur = d.state ? d.state[field] : undefined;
  const dpt = knxGuessDpt(cur);

  const fields = knxReadJson(devId);
  if (fields === null) return;
  if (fields[field]) {
    if (!confirm(`Поле «${field}» уже есть в KNX. Заменить?`)) return;
  }
  const order = Object.keys(fields).length + 1;
  const addr  = `1/2/${order}`;

  let spec;
  if (mode === 'rw') {
    spec = { read: { address: addr, dpt }, write: { address: addr, dpt } };
  } else if (mode === 'read') {
    spec = { read:  { address: addr, dpt } };
  } else if (mode === 'write') {
    spec = { write: { address: addr, dpt } };
  } else {
    spec = { address: addr, dpt };
  }

  fields[field] = spec;
  knxWriteJson(devId, fields);
}

function knxFormatJson(devId) {
  const obj = knxReadJson(devId);
  if (obj === null) return;
  const ta = document.getElementById('knx-json-' + devId);
  if (ta) ta.value = JSON.stringify(obj, null, 2);
}

/* ---------- Сохранение KNX-конфигурации устройства ---------- */

async function saveDeviceKnx(id, patch) {
  const updated = await api('/api/devices/' + id + '/knx', 'POST', patch);
  const i = devicesCache.findIndex(x => x.id === id);
  if (i >= 0) devicesCache[i].knx = updated;
  renderCurrentView();
}

async function saveDeviceKnxFields(id, text) {
  let obj = {};
  try { obj = JSON.parse(text || '{}'); }
  catch (e) { alert('Некорректный JSON: ' + e.message); return; }
  await saveDeviceKnx(id, { fields: obj });
}

async function readDeviceKnx(id) {
  const ae = document.activeElement;
  if (ae && ae.blur) ae.blur();
  try {
    const r = await api('/api/devices/' + id + '/knx/read', 'POST', {});
    if (!r.ok) alert('Не удалось отправить запрос чтения');
  } catch (e) { alert('Ошибка: ' + e.message); }
}

/* ---------- Настройки KNX ---------- */

async function loadKnxSettings() {
  try {
    const cfg = await api('/api/knx/settings');
    const st  = await api('/api/knx/status');
    const el = id => document.getElementById(id);

    if (el('knx-enabled')) el('knx-enabled').checked = !!cfg.enabled;
    if (el('knx-conn'))    el('knx-conn').value = cfg.connection || 'automatic';
    if (el('knx-gw'))      el('knx-gw').value = cfg.gateway_ip || '';
    if (el('knx-port'))    el('knx-port').value = cfg.gateway_port || 3671;
    if (el('knx-own'))     el('knx-own').value = cfg.own_address || '15.15.250';

    const line = el('knx-status-line');
    if (line) {
      if (!st.available) {
        line.textContent = '⚠ xknx не установлен (pip install xknx)';
        line.style.color = '#ffb74d';
      } else if (!cfg.enabled) {
        line.textContent = 'KNX выключен';
        line.style.color = '#bbb';
      } else if (!st.connected) {
        const err = st.last_error ? ` (${st.last_error})` : '';
        line.textContent = `❌ Нет соединения с KNX/IP${err}`;
        line.style.color = '#ef5350';
      } else {
        line.textContent = '✅ Подключено к KNX/IP';
        line.style.color = '#4caf50';
      }
    }
  } catch (e) {
    console.warn('[knx settings]', e);
  }
}

async function saveKnxSettings() {
  const body = {
    enabled: !!document.getElementById('knx-enabled')?.checked,
    connection: document.getElementById('knx-conn')?.value || 'automatic',
    gateway_ip: document.getElementById('knx-gw')?.value || '',
    gateway_port: parseInt(document.getElementById('knx-port')?.value || '3671', 10),
    own_address: document.getElementById('knx-own')?.value || '15.15.250',
  };
  try {
    await api('/api/knx/settings', 'POST', body);
    alert('Сохранено');
    await loadKnxSettings();
  } catch (e) { alert('Ошибка: ' + e.message); }
}

/* ---------- GA-таблица (вкладка «KNX-адреса») ---------- */

async function knxGaReload() {
  try {
    const wrap = document.getElementById('knx-ga-table-wrap');
    if (!wrap) return;
    wrap.innerHTML = '<div class="empty">Загрузка…</div>';
    const data = await api('/api/knx/group_addresses');
    knxGaCache = Array.isArray(data) ? data : [];
    try { renderKnxGaTable(); }
    catch (e) {
      console.error('[knx-ga] renderKnxGaTable error:', e);
      wrap.innerHTML = '<div class="empty">Ошибка рендера: ' + esc(e.message || e) + '</div>';
    }
  } catch (e) {
    console.error('[knx-ga] knxGaReload error:', e);
    const wrap = document.getElementById('knx-ga-table-wrap');
    if (wrap) wrap.innerHTML = '<div class="empty">Ошибка загрузки: ' + esc(e.message || e) + '</div>';
  }
}

function renderKnxGaTable() {
  try {
    const wrap = document.getElementById('knx-ga-table-wrap');
    if (!wrap) return;

    const q = (document.getElementById('knx-ga-search')?.value || '').trim().toLowerCase();
    const onlyLinked = !!document.getElementById('knx-ga-only-linked')?.checked;
    const onlyValue  = !!document.getElementById('knx-ga-only-with-value')?.checked;
    const sortBy     = document.getElementById('knx-ga-sort')?.value || 'addr';

    let list = Array.isArray(knxGaCache) ? knxGaCache.slice() : [];
    if (q) {
      list = list.filter(x =>
        (x.address || '').toLowerCase().includes(q) ||
        (x.name || '').toLowerCase().includes(q)
      );
    }
    if (onlyLinked) list = list.filter(x => x.device_id);
    if (onlyValue)  list = list.filter(x =>
      x.value !== null && x.value !== undefined && x.value !== ''
    );

    const cmpFns = {
      addr:    (a, b) => (a.address || '').localeCompare(b.address || '', 'ru'),
      name:    (a, b) => (a.name || '').localeCompare(b.name || '', 'ru'),
      dpt:     (a, b) => (a.dpt || '').localeCompare(b.dpt || ''),
      value:   (a, b) => {
        const va = a.value, vb = b.value;
        if (va === vb) return 0;
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
        if (typeof va === 'number' && typeof vb === 'number') return va - vb;
        return String(va).localeCompare(String(vb));
      },
      updated: (a, b) => (b.updated || '').localeCompare(a.updated || ''),
    };
    list.sort(cmpFns[sortBy] || cmpFns.addr);

    const counter = document.getElementById('knx-ga-counter');
    if (counter) counter.textContent = `Найдено: ${list.length} из ${knxGaCache.length}`;

    if (!list.length) {
      wrap.innerHTML = '<div class="empty">Ничего не найдено</div>';
      return;
    }

    const rows = list.map(ga => {
      const addr = ga.address;
      const linked = ga.device_id
        ? `<span class="badge ok" title="${esc(ga.device_id)} / ${esc(ga.field || '')}">
             🔗 ${esc(ga.field || '—')}
           </span>`
        : '<span class="badge off">— не привязан —</span>';

      const val = formatGaValue(ga);
      const isBool = (ga.dpt || '').startsWith('DPT-1.');

      let inputHtml;
      if (isBool) {
        inputHtml = `
          <select data-ga-input="${esc(addr)}" style="min-width:90px;">
            <option value="">—</option>
            <option value="true"  ${ga.value === true  ? 'selected' : ''}>true</option>
            <option value="false" ${ga.value === false ? 'selected' : ''}>false</option>
          </select>`;
      } else {
        inputHtml = `
          <input type="text" data-ga-input="${esc(addr)}"
                 value="${esc(ga.value === null || ga.value === undefined ? '' : ga.value)}"
                 placeholder="значение"
                 style="min-width:90px; width:120px;">`;
      }

      return `
        <tr data-ga="${esc(addr)}">
          <td style="font-family:monospace;">${esc(addr)}</td>
          <td>
            <input type="text" data-ga-name="${esc(addr)}"
                   value="${esc(ga.name || '')}"
                   style="width:100%; min-width:180px;">
          </td>
          <td>
            <input type="text" data-ga-dpt="${esc(addr)}"
                   value="${esc(ga.dpt || '')}"
                   style="width:90px; font-family:monospace;">
          </td>
          <td style="font-family:monospace; text-align:right; white-space:nowrap;">
            ${val}
            ${ga.updated ? `<div style="font-size:.7rem;opacity:.55;">${esc(ga.updated)}</div>` : ''}
          </td>
          <td>
            <div style="display:flex; gap:.25rem; align-items:center; white-space:nowrap;">
              ${inputHtml}
              <button class="btn small green" onclick="knxGaWrite('${esc(addr)}')" title="Записать в шину">➡</button>
              <button class="btn small gray"  onclick="knxGaRead('${esc(addr)}')"  title="Прочитать с шины">⬅</button>
            </div>
          </td>
          <td>${linked}</td>
          <td>
            <div style="display:flex; gap:.25rem; flex-wrap:nowrap; white-space:nowrap;">
              <button class="btn small gray"   onclick="knxGaSave('${esc(addr)}')"   title="Сохранить имя и DPT">💾</button>
              <button class="btn small gray"   onclick="openKnxLinkModal('${esc(addr)}', {dpt: '${esc(ga.dpt || '')}'})" title="Привязать к устройству">🔗</button>
              <button class="btn small danger" onclick="knxGaUnlink('${esc(addr)}')" title="Отвязать">✕</button>
            </div>
          </td>
        </tr>`;
    }).join('');

    wrap.innerHTML = `
      <table class="knx-ga-table">
        <thead>
          <tr>
            <th style="width:100px;">Адрес</th>
            <th>Имя (ETS)</th>
            <th style="width:110px;">DPT</th>
            <th style="width:140px;">Текущее</th>
            <th style="width:230px;">Записать</th>
            <th style="width:160px;">Привязка</th>
            <th style="width:150px;">Действия</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) {
    console.error('[knx-ga] renderKnxGaTable error:', e);
    const wrap = document.getElementById('knx-ga-table-wrap');
    if (wrap) wrap.innerHTML = '<div class="empty">Ошибка рендера: ' + esc(e.message || e) + '</div>';
  }
}

function formatGaValue(ga) {
  if (ga.value === null || ga.value === undefined) return '<span style="opacity:.5;">—</span>';
  if (typeof ga.value === 'boolean') return ga.value ? '✅ true' : '⛔ false';
  if (typeof ga.value === 'number')   return ga.value.toFixed(2);
  return esc(String(ga.value));
}

async function knxGaSave(addr) {
  const nameEl = document.querySelector(`[data-ga-name="${addr}"]`);
  const dptEl  = document.querySelector(`[data-ga-dpt="${addr}"]`);
  const body = {
    name: nameEl ? nameEl.value : '',
    dpt:  dptEl  ? dptEl.value  : '',
  };
  try {
    const updated = await api('/api/knx/group_addresses/' + encodeURIComponent(addr), 'POST', body);
    const i = knxGaCache.findIndex(x => x.address === addr);
    if (i >= 0) knxGaCache[i] = updated;
    renderKnxGaTable();
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

async function knxGaWrite(addr) {
  const inp = document.querySelector(`[data-ga-input="${addr}"]`);
  if (!inp) return;
  let val = inp.value;
  const ga = knxGaCache.find(x => x.address === addr);
  const dpt = ga?.dpt || 'DPT-1.001';
  if (dpt.startsWith('DPT-1.')) {
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    else return alert('Выберите значение');
  } else if (dpt.match(/^DPT-(5|7|8|12|13|20)\./)) {
    val = parseInt(val, 10);
    if (!Number.isFinite(val)) return alert('Ожидается целое число');
  } else if (dpt.match(/^DPT-(9|14)\./)) {
    val = parseFloat(val.replace(',', '.'));
    if (!Number.isFinite(val)) return alert('Ожидается число');
  }
  try {
    await api('/api/knx/group_addresses/' + encodeURIComponent(addr) + '/write',
              'POST', { value: val, dpt });
    if (ga) { ga.value = val; ga.updated = new Date().toISOString().slice(0, 19); }
    renderKnxGaTable();
  } catch (e) {
    alert('Ошибка записи: ' + e.message);
  }
}

async function knxGaRead(addr) {
  try {
    await api('/api/knx/group_addresses/' + encodeURIComponent(addr) + '/read', 'POST', {});
  } catch (e) {
    alert('Ошибка чтения: ' + e.message);
  }
}

/* ---------- Модалка «Новый GA» ---------- */

function openKnxGaAddModal(prefill = {}) {
  document.getElementById('kga-address').value = prefill.address || '';
  document.getElementById('kga-name').value    = prefill.name    || '';
  document.getElementById('kga-dpt').value     = prefill.dpt     || 'DPT-1.001';
  document.getElementById('kga-readable').checked = prefill.readable !== false;
  document.getElementById('kga-writable').checked = prefill.writable !== false;
  document.getElementById('kga-error').textContent = '';
  document.getElementById('knx-ga-add-overlay').classList.add('open');
  setTimeout(() => {
    const el = document.getElementById('kga-address');
    if (el) el.focus();
  }, 50);
}

function closeKnxGaAddModal() {
  document.getElementById('knx-ga-add-overlay').classList.remove('open');
}

async function applyKnxGaAddModal() {
  const errEl = document.getElementById('kga-error');
  errEl.textContent = '';

  const address  = (document.getElementById('kga-address').value || '').trim();
  const name     = (document.getElementById('kga-name').value || '').trim();
  const dpt      = document.getElementById('kga-dpt').value || 'DPT-1.001';
  const readable = !!document.getElementById('kga-readable').checked;
  const writable = !!document.getElementById('kga-writable').checked;

  if (!address) { errEl.textContent = 'Укажите адрес'; return; }
  if (!/^\d+\/\d+\/\d+$/.test(address)) {
    errEl.textContent = 'Формат адреса: X/Y/Z (например 1/2/3)';
    return;
  }
  if (!readable && !writable) {
    errEl.textContent = 'Нужно включить хотя бы read или write';
    return;
  }

  try {
    const rec = await api('/api/knx/group_addresses', 'POST', {
      address, name, dpt, readable, writable,
    });
    knxGaCache.push(rec);
    closeKnxGaAddModal();
    knxGaReload().catch(() => {});
  } catch (e) {
    errEl.textContent = 'Ошибка: ' + e.message;
  }
}

document.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'kga-address') {
    const v = e.target.value.trim();
    const ok = /^\d+\/\d+\/\d+$/.test(v);
    e.target.style.borderColor = v && !ok ? '#e57373' : '';
  }
}, true);

/* ---------- Модалка «Привязка GA к полю» ---------- */

let _klPrefillAddress = '';

function openKnxLinkModal(address, opts = {}) {
  _klPrefillAddress = address || '';

  const devSel = document.getElementById('kl-device');
  devSel.innerHTML = '<option value="">— выберите —</option>';
  devicesCache
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'))
    .forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = `${d.name}  ·  ${d.id}`;
      devSel.appendChild(opt);
    });

  document.getElementById('kl-address').value = address || '';
  document.getElementById('kl-dpt').value = opts.dpt || 'DPT-1.001';
  document.getElementById('kl-field').innerHTML =
    '<option value="">— выберите поле —</option>';
  document.getElementById('kl-formula').value = '';
  document.getElementById('kl-readable').checked = true;
  document.getElementById('kl-writable').checked = true;
  document.getElementById('kl-error').textContent = '';

  const idEl = document.getElementById('kl-device-id');
  if (idEl) idEl.value = opts.device_id || '';

  if (opts.device_id) devSel.value = opts.device_id;
  onKnxLinkDeviceChange(opts.field || '');
  updateKnxLinkGaInfo(address);

  document.getElementById('knx-link-modal-overlay').classList.add('open');
}

function onKnxLinkDeviceIdInput(el) {
  const id = (el.value || '').trim();
  const devSel = document.getElementById('kl-device');

  if (!id) {
    devSel.value = '';
    onKnxLinkDeviceChange('');
    return;
  }

  const d = devicesCache.find(x => x.id === id);
  if (!d) {
    el.style.borderColor = '#e57373';
    devSel.value = '';
    onKnxLinkDeviceChange('');
    return;
  }

  el.style.borderColor = '';
  devSel.value = d.id;
  onKnxLinkDeviceChange('');
}

function closeKnxLinkModal() {
  document.getElementById('knx-link-modal-overlay').classList.remove('open');
}

function onKnxLinkDeviceChange(prefillField) {
  const devSel  = document.getElementById('kl-device');
  const fieldSel = document.getElementById('kl-field');
  const idEl    = document.getElementById('kl-device-id');
  const devId   = devSel.value;

  if (idEl) idEl.value = devId || '';

  fieldSel.innerHTML = '<option value="">— выберите поле —</option>';
  if (!devId) return;

  const d = devicesCache.find(x => x.id === devId);
  if (!d) return;

  const fields = Object.keys(d.state || {});
  for (const f of fields) {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f;
    if (prefillField && f === prefillField) opt.selected = true;
    fieldSel.appendChild(opt);
  }

  if (!fieldSel.value && fields.length) fieldSel.value = fields[0];
}

function pickKnxLinkDevice() {
  const devs = devicesCache.slice().sort(
    (a, b) => (a.name || '').localeCompare(b.name || '', 'ru')
  );
  if (!devs.length) return alert('Нет устройств');
  const lines = devs.map((d, i) => `${i + 1}. ${d.name} — ${d.id}`).join('\n');
  const n = prompt('Выберите устройство (номер):\n\n' + lines.slice(0, 4000));
  if (!n) return;
  const idx = parseInt(n, 10) - 1;
  const dev = devs[idx];
  if (!dev) return alert('Неверный номер');

  document.getElementById('kl-device-id').value = dev.id;
  document.getElementById('kl-device').value = dev.id;
  onKnxLinkDeviceChange('');
}

function updateKnxLinkGaInfo(address) {
  const el = document.getElementById('kl-ga-name');
  if (!el) return;
  if (!address) { el.textContent = '—'; return; }

  const ga = knxGaCache.find(x => x.address === address);
  if (ga) {
    el.innerHTML = `<b>${esc(ga.name || '')}</b>`;
    if (ga.dpt && !document.getElementById('kl-dpt').value) {
      document.getElementById('kl-dpt').value = ga.dpt;
    }
  } else {
    el.innerHTML = '<span style="opacity:.6;">— нет в реестре GA —</span>';
  }
}

async function applyKnxLinkModal() {
  const errEl = document.getElementById('kl-error');
  errEl.textContent = '';

  const addr    = (document.getElementById('kl-address').value || '').trim();
  const dpt     = (document.getElementById('kl-dpt').value || '').trim();
  const idVal   = (document.getElementById('kl-device-id')?.value || '').trim();
  const devId   = document.getElementById('kl-device').value || idVal;
  const field   = document.getElementById('kl-field').value;
  const formula = (document.getElementById('kl-formula').value || '').trim();
  const readable = !!document.getElementById('kl-readable').checked;
  const writable = !!document.getElementById('kl-writable').checked;

  if (!addr)  { errEl.textContent = 'Укажите групповой адрес'; return; }
  if (!dpt)   { errEl.textContent = 'Укажите DPT'; return; }
  if (!devId) { errEl.textContent = 'Укажите устройство (id или из списка)'; return; }
  if (!field) { errEl.textContent = 'Выберите поле'; return; }

  const devExists = devicesCache.find(x => x.id === devId);
  if (!devExists) {
    errEl.textContent = `Устройство с id ${devId} не найдено`;
    return;
  }

  if (!/^\d+\/\d+\/\d+$/.test(addr)) {
    errEl.textContent = 'Адрес должен быть в формате X/Y/Z (например 1/2/3)';
    return;
  }

  const spec = { address: addr, dpt: dpt };
  if (formula) spec.formula = formula;
  if (readable && !writable) {
    delete spec.address;
    spec.read = { address: addr, dpt };
  } else if (writable && !readable) {
    delete spec.address;
    spec.write = { address: addr, dpt };
  } else {
    spec.address = addr;
  }

  try {
    const d = devicesCache.find(x => x.id === devId);
    const knx = JSON.parse(JSON.stringify(d?.knx || {}));
    knx.enabled = true;
    knx.fields = knx.fields || {};
    knx.fields[field] = spec;

    const updated = await api('/api/devices/' + devId + '/knx', 'POST', {
      enabled: true,
      fields: knx.fields,
    });

    const i = devicesCache.findIndex(x => x.id === devId);
    if (i >= 0) devicesCache[i].knx = updated;

    try {
      await api('/api/knx/group_addresses/' + encodeURIComponent(addr),
                'POST', { device_id: devId, field: field, dpt: dpt });
    } catch (e) {
      console.warn('[knx-link] ga_store link error:', e);
    }

    closeKnxLinkModal();
    try { await api('/api/knx/refresh', 'POST', {}); } catch (e) {}
    if (currentView === 'knx-ga') knxGaReload().catch(() => {});
    refresh();
  } catch (e) {
    errEl.textContent = 'Ошибка: ' + e.message;
  }
}

async function knxGaUnlink(addr) {
  if (!confirm('Отвязать GA от устройства?')) return;
  try {
    await api('/api/knx/group_addresses/' + encodeURIComponent(addr),
              'POST', { device_id: '', field: '' });
    await knxGaReload();
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

/* ---------- Импорт .knxproj ---------- */

async function knxGaImportFile(input) {
  const f = input.files[0];
  if (!f) return;
  const fd = new FormData();
  fd.append('file', f);
  const pwd = prompt('Пароль проекта (если есть):') || '';
  if (pwd) fd.append('password', pwd);

  const status = document.getElementById('knx-ga-import-status');
  if (status) status.textContent = '⏳ Импорт…';

  try {
    const r = await fetch('/api/knx/group_addresses/import', {
      method: 'POST', body: fd,
    });
    const rep = await r.json();
    if (!r.ok) throw new Error(rep.error || 'HTTP ' + r.status);
    if (status) status.textContent = `✅ Импортировано: ${rep.imported}`;
    await knxGaReload();
  } catch (e) {
    if (status) status.textContent = '❌ ' + e.message;
  } finally {
    input.value = '';
  }
}

function knxImportProj(input) {
  const f = input.files[0];
  if (!f) return;
  _knxprojFile = f;
  input.value = '';
  knxImportProjApply();
}

function knxImportProjPreview() {
  if (!_knxprojFile) { alert('Сначала выберите файл'); return; }
  _sendKnxproj('/api/knx/import_knxproj/preview', 'Предпросмотр импорта');
}

function knxImportProjApply() {
  if (!_knxprojFile) { alert('Сначала выберите файл'); return; }
  if (!confirm('Импортировать устройства из .knxproj? Существующие не тронем.')) return;
  _sendKnxproj('/api/knx/import_knxproj', 'Импорт выполнен');
}

async function _sendKnxproj(url, title) {
  const fd = new FormData();
  fd.append('file', _knxprojFile);
  const pwd = document.getElementById('knxproj-pass')?.value || '';
  if (pwd) fd.append('password', pwd);

  try {
    const r = await fetch(url, { method: 'POST', body: fd });
    const rep = await r.json();
    if (!r.ok) throw new Error(rep.error || 'HTTP ' + r.status);
    showKnxprojReport(rep, title);
    if (url.endsWith('/import_knxproj')) refresh();
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

function showKnxprojReport(rep, title) {
  const lines = [];
  lines.push(`<b>Всего устройств в проекте:</b> ${rep.total_devices || 0}`);
  if (rep.added?.length) {
    lines.push(`<b>➕ Будет добавлено / добавлено: ${rep.added.length}</b><ul>`);
    rep.added.forEach(a => {
      lines.push(`<li>${esc(a.name)} — <code>${esc(a.ia)}</code> · ${esc(a.type)} · поля: ${(a.fields || []).join(', ')}</li>`);
    });
    lines.push('</ul>');
  } else {
    lines.push('<b>Новых устройств нет.</b>');
  }
  if (rep.skipped?.length) {
    lines.push(`<b>Пропущено: ${rep.skipped.length}</b><ul>`);
    rep.skipped.slice(0, 30).forEach(s => {
      lines.push(`<li>${esc(s.name)} — ${esc(s.reason)}</li>`);
    });
    lines.push('</ul>');
  }
  if (rep.errors?.length) {
    lines.push(`<b>Ошибки: ${rep.errors.length}</b><ul>`);
    rep.errors.forEach(e => lines.push(`<li>${esc(e.ia)}: ${esc(e.error)}</li>`));
    lines.push('</ul>');
  }
  if (window.SH?.openModal) {
    window.SH.openModal('📥 ' + title, '', lines.join(''));
  } else {
    alert(title + '\n\n' + lines.join('\n').replace(/<[^>]+>/g, ''));
  }
}

async function knxGaImportLinksOnly(input) {
  const f = input.files[0];
  if (!f) return;
  const fd = new FormData();
  fd.append('file', f);
  const pwd = prompt('Пароль проекта (если есть):') || '';
  if (pwd) fd.append('password', pwd);

  const status = document.getElementById('knx-ga-import-status');
  if (status) status.textContent = '⏳ Обновление привязок…';

  try {
    const r = await fetch('/api/knx/group_addresses/import_links', {
      method: 'POST', body: fd,
    });
    const rep = await r.json();
    if (!r.ok) throw new Error(rep.error || 'HTTP ' + r.status);
    if (status) status.textContent = `✅ Обновлено привязок: ${rep.linked || 0}`;
    await knxGaReload();
  } catch (e) {
    if (status) status.textContent = '❌ ' + e.message;
  } finally {
    input.value = '';
  }
}