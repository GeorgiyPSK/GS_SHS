/* ============================================================
   События: HTTP-запросы, MQTT-публикации, плейсхолдеры
   ============================================================ */

/* ---------- HTTP-запрос (бокс) ---------- */

function requestBox(req, idx, actIdx) {
  req = req || {method: 'GET', url: '', body_type: 'none', body: '', headers: [], enabled: true};
  const ai = (actIdx == null) ? idx : actIdx;
  const p = (k) => `a${ai}-${k}`;

  const headersHtml = (req.headers || []).map((h, i) => `
    <div class="req-line">
      <input type="text" placeholder="Header" value="${esc(h.k || '')}"
        data-key="${p('h' + i + '-k')}" oninput="markRowDirty(this)">
      <input type="text" placeholder="Value" value="${esc(h.v || '')}"
        data-key="${p('h' + i + '-v')}" oninput="markRowDirty(this)">
      <button class="btn small gray" title="Вставить плейсхолдер"
        onclick="openPhModal(this.previousElementSibling)">🧩</button>
      <button class="btn small danger edit-only"
        onclick="reqRemoveHeader('action', ${ai}, ${i}, this)">✕</button>
    </div>`).join('');

  const method = (req.method || 'GET').toUpperCase();
  const bodyType = req.body_type || 'none';
  const showBody = method === 'POST' && bodyType !== 'none';

  return `
    <div class="req-box">
      <div class="req-line">
        <input type="checkbox" ${req.enabled !== false ? 'checked' : ''}
          data-key="${p('enabled')}" onchange="markRowDirty(this)">
        <select data-key="${p('method')}" onchange="markRowDirty(this)">
          <option value="GET"  ${method === 'GET' ? 'selected' : ''}>GET</option>
          <option value="POST" ${method === 'POST' ? 'selected' : ''}>POST</option>
        </select>
        <input type="url" value="${esc(req.url || '')}" placeholder="http://..."
          data-key="${p('url')}" oninput="markRowDirty(this)">
        <button class="btn small gray" title="Вставить плейсхолдер"
          onclick="openPhModal(this.previousElementSibling)">🧩</button>
        <button class="btn small danger edit-only"
          onclick="reqRemoveAction('action', ${ai}, this)">✕</button>
      </div>
      ${method === 'POST' ? `
      <div class="req-line">
        <label style="font-size:.85rem;opacity:.75;">Тело</label>
        <select data-key="${p('body_type')}" onchange="markRowDirty(this)">
          <option value="none" ${bodyType === 'none' ? 'selected' : ''}>нет</option>
          <option value="json" ${bodyType === 'json' ? 'selected' : ''}>json</option>
          <option value="form" ${bodyType === 'form' ? 'selected' : ''}>form</option>
          <option value="raw"  ${bodyType === 'raw'  ? 'selected' : ''}>raw</option>
        </select>
      </div>
      ${showBody ? `
        <div class="req-line" style="align-items:flex-start;">
          <textarea placeholder='{"key":"value"} или a=1&b=2'
            data-key="${p('body')}" oninput="markRowDirty(this)"
            style="flex:1;min-height:44px;">${esc(req.body || '')}</textarea>
          <button class="btn small gray" title="Вставить плейсхолдер"
            onclick="openPhModal(this.previousElementSibling)">🧩</button>
        </div>` : ''}
      ` : ''}
      <div style="font-size:.85rem;opacity:.75;margin-top:.2rem;">Заголовки:</div>
      ${headersHtml}
      <div><button class="btn small gray edit-only"
        onclick="reqAddHeader('action', ${ai}, this)">➕ заголовок</button></div>
    </div>`;
}

function reqAddHeader(kind, actIdx, btn) {
  const box = btn.closest('.req-box'); if (!box) return;
  const existing = box.querySelectorAll('input[data-key$="-k"]').length;
  const line = document.createElement('div');
  line.className = 'req-line';
  line.innerHTML = `
    <input type="text" placeholder="Header" data-key="a${actIdx}-h${existing}-k" oninput="markRowDirty(this)">
    <input type="text" placeholder="Value"  data-key="a${actIdx}-h${existing}-v" oninput="markRowDirty(this)" data-ph-target="1">
    <button class="btn small gray" title="Вставить плейсхолдер"
      onclick="openPhModal(this.previousElementSibling)">🧩</button>
    <button class="btn small danger edit-only"
      onclick="this.parentElement.remove(); markRowDirty(this)">✕</button>`;
  const wrap = btn.parentElement;
  wrap.parentElement.insertBefore(line, wrap);
  markRowDirty(btn);
}
function reqRemoveHeader(kind, actIdx, idx, btn) {
  const line = btn.closest('.req-line'); if (line) line.remove();
  markRowDirty(btn);
}
function reqRemoveAction(kind, actIdx, btn) {
  const box = btn.closest('.req-box'); if (box) box.remove();
  markRowDirty(btn);
}

/* ---------- MQTT-публикация в событии ---------- */

function eventMqttBox(pub, idx) {
  pub = pub || {topic: '', payload: '', retain: false, qos: 0, enabled: true};
  const p = (k) => `p${idx}-${k}`;
  return `
    <div class="req-box">
      <div class="req-line">
        <input type="checkbox" ${pub.enabled !== false ? 'checked' : ''}
          data-key="${p('enabled')}" onchange="markRowDirty(this)">
        <label style="font-size:.85rem;opacity:.75;min-width:60px;">Топик</label>
        <input type="text" value="${esc(pub.topic || '')}"
          data-key="${p('topic')}" oninput="markRowDirty(this)"
          placeholder="smarthome/...">
        <button class="btn small gray" title="Вставить плейсхолдер"
          onclick="openPhModal(this.previousElementSibling)">🧩</button>
        <button class="btn small danger edit-only"
          onclick="mqttRemovePub(this)">✕</button>
      </div>
      <div class="req-line" style="align-items:flex-start;">
        <label style="font-size:.85rem;opacity:.75;min-width:60px;">Payload</label>
        <textarea data-key="${p('payload')}" oninput="markRowDirty(this)"
          placeholder='{"event":"triggered"}'
          style="flex:1;min-height:44px;">${esc(pub.payload || '')}</textarea>
        <button class="btn small gray" title="Вставить плейсхолдер"
          onclick="openPhModal(this.previousElementSibling)">🧩</button>
      </div>
      <div class="req-line">
        <label style="font-size:.85rem;opacity:.75;">retain</label>
        <input type="checkbox" ${pub.retain ? 'checked' : ''}
          data-key="${p('retain')}" onchange="markRowDirty(this)">
        <label style="font-size:.85rem;opacity:.75;">QoS</label>
        <input type="number" min="0" max="2" value="${pub.qos || 0}"
          data-key="${p('qos')}" onchange="markRowDirty(this)" style="min-width:60px;">
      </div>
    </div>`;
}

function mqttRemovePub(btn) {
  const box = btn.closest('.req-box');
  if (box) box.remove();
  markRowDirty(btn);
}

function mqttPublishBox(pub, idx) {
  return eventMqttBox(pub, idx);
}

/* ---------- Рендер и CRUD событий ---------- */

function renderEvents() {
  const box = document.getElementById('events-list');
  if (!eventsCache.length) { box.innerHTML = '<div class="empty">Событий нет.</div>'; return; }

  box.innerHTML = eventsCache.map(ev => {
    const reqs = ev.requests || [];
    const reqsHtml = reqs.map((r, i) => requestBox(r, i, i)).join('');
    const pubs = ev.mqtt_publishes || [];
    const pubsHtml = pubs.map((p, i) => eventMqttBox(p, i)).join('');

    return `
      <div class="row" data-id="${ev.id}">
        <div class="row-head">
          <input type="text" value="${esc(ev.name || '')}"
            data-key="name" oninput="markRowDirty(this)"
            style="background:transparent;border:none;color:#fff;font-size:1.1rem;font-weight:600;flex:1;">
          <label style="display:flex;align-items:center;gap:.4rem;font-size:.9rem;">
            <input type="checkbox" ${ev.enabled !== false ? 'checked' : ''}
              data-key="enabled" onchange="markRowDirty(this)"> вкл
          </label>
          <button class="btn small green btn-save" onclick="saveEvent('${ev.id}')">💾 Сохранить</button>
          <button class="btn small danger edit-only" onclick="removeEvent('${ev.id}')">🗑</button>
        </div>
        <div class="row-body">
          <div class="field-row">
            <label>Источник</label>
            <select data-key="source_device"
                    onchange="rebuildFieldOptions(this); markRowDirty(this)">
              <option value="">— устройство —</option>
              ${deviceOptions(ev.source_device)}
            </select>
            <select data-key="source_field" onchange="markRowDirty(this)">
              <option value="">— поле —</option>
              ${fieldOptions(ev.source_device, ev.source_field)}
            </select>
            <label>Когда</label>
            <input type="text" value="${esc(ev.when || 'any')}"
              placeholder="any / true / false / число"
              data-key="when" oninput="markRowDirty(this)" style="min-width:120px;">
          </div>
          <div class="hr"></div>
          <div style="font-size:.9rem;opacity:.85;">HTTP-запросы при срабатывании:</div>
          ${reqsHtml}
          <div><button class="btn small gray edit-only" onclick="addEventReq('${ev.id}')">➕ добавить запрос</button></div>

          <div class="hr"></div>
          <div style="font-size:.9rem;opacity:.85;">MQTT-публикации при срабатывании:</div>
          ${pubsHtml}
          <div><button class="btn small gray edit-only" onclick="addEventPub('${ev.id}')">➕ добавить MQTT-публикацию</button></div>
        </div>
      </div>`;
  }).join('');
}

async function addEvent() {
  await api('/api/events', 'POST', {
    name: 'Новое событие', source_device: '', source_field: '', when: 'any',
    requests: [], enabled: true
  });
  refresh();
}
async function removeEvent(id) {
  if (!confirm('Удалить событие?')) return;
  try {
    await api('/api/events/' + id, 'DELETE');
    eventsCache = eventsCache.filter(e => e.id !== id);
    renderEvents();
    api('/api/events').then(r => { eventsCache = r; renderEvents(); }).catch(() => {});
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}

async function addEventReq(id) {
  const ev = eventsCache.find(e => e.id === id); if (!ev) return;
  const reqs = JSON.parse(JSON.stringify(ev.requests || []));
  reqs.push({method: 'GET', url: '', body_type: 'none', body: '', headers: [], enabled: true});
  await api('/api/events/' + id, 'POST', {requests: reqs});
  eventsCache = await api('/api/events');
  renderEvents();
}

async function addEventPub(id) {
  const ev = eventsCache.find(e => e.id === id); if (!ev) return;
  const pubs = JSON.parse(JSON.stringify(ev.mqtt_publishes || []));
  pubs.push({topic: '', payload: '', retain: false, qos: 0, enabled: true});
  await api('/api/events/' + id, 'POST', {mqtt_publishes: pubs});
  eventsCache = await api('/api/events');
  renderEvents();
}

async function saveEvent(id) {
  const row = document.querySelector(`.row[data-id="${id}"]`); if (!row) return;
  const fields = collectRowFields(row);
  const ev = eventsCache.find(x => x.id === id) || {requests: [], mqtt_publishes: []};

  const requests = buildActionsFromFields(fields, ev.requests || []);

  const pubsByIdx = {};
  for (const key in fields) {
    const m = key.match(/^p(\d+)-(.+)$/);
    if (!m) continue;
    const i = +m[1]; const rest = m[2];
    pubsByIdx[i] = pubsByIdx[i] || {};
    pubsByIdx[i][rest] = fields[key];
  }
  const pubIdx = Object.keys(pubsByIdx).map(n => +n).sort((a, b) => a - b);
  const mqtt_publishes = pubIdx.length
    ? pubIdx.map(i => ({
        topic:   pubsByIdx[i].topic   ?? (ev.mqtt_publishes?.[i]?.topic   ?? ''),
        payload: pubsByIdx[i].payload ?? (ev.mqtt_publishes?.[i]?.payload ?? ''),
        retain:  !!pubsByIdx[i].retain,
        qos:     parseInt(pubsByIdx[i].qos, 10) || 0,
        enabled: pubsByIdx[i].enabled !== false,
      }))
    : (ev.mqtt_publishes || []);

  const patch = {
    name: fields['name'] ?? ev.name ?? '',
    enabled: fields['enabled'] !== undefined ? fields['enabled'] : (ev.enabled !== false),
    source_device: fields['source_device'] ?? ev.source_device ?? '',
    source_field:  fields['source_field']  ?? ev.source_field  ?? '',
    when:          fields['when']          ?? ev.when          ?? 'any',
    requests,
    mqtt_publishes,
  };
  await api('/api/events/' + id, 'POST', patch);
  eventsCache = await api('/api/events');
  renderEvents();
}

/* ---------- Модалка плейсхолдеров ---------- */

function openPhModal(targetEl) {
  _phTargetEl = targetEl;
  const body = document.getElementById('ph-modal-body');
  const devices = Object.entries(placeholdersCache);
  if (!devices.length) {
    body.innerHTML = '<div class="empty">Нет устройств</div>';
  } else {
    body.innerHTML = `
      <div style="font-size:.9rem; opacity:.85; margin-bottom:.6rem;">
        Выберите устройство и поле — они будут вставлены в поле ввода
      </div>
      ${devices.map(([did, info]) => `
        <div style="margin-bottom:.7rem;">
          <div style="font-weight:600; margin-bottom:.25rem;">
            ${esc(info.name)} <small style="opacity:.6; font-family:monospace;">${did}</small>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:.35rem;">
            ${info.fields.map(f => `
              <span class="chip" onclick="insertPlaceholder('${did}', '${f}')">
                {dev:${did}:${f}}
              </span>`).join('')}
          </div>
        </div>`).join('')}
    `;
  }
  document.getElementById('ph-modal-overlay').classList.add('open');
}

function closePhModal() {
  _phTargetEl = null;
  document.getElementById('ph-modal-overlay').classList.remove('open');
  document.getElementById('ph-modal-body').innerHTML = '';
}

function insertPlaceholder(did, field) {
  const el = _phTargetEl;
  if (!el) { closePhModal(); return; }
  const ph = `{dev:${did}:${field}}`;
  const v = el.value || '';
  if (typeof el.selectionStart === 'number') {
    const s = el.selectionStart, e = el.selectionEnd;
    el.value = v.slice(0, s) + ph + v.slice(e);
    el.selectionStart = el.selectionEnd = s + ph.length;
  } else {
    el.value = v + ph;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  closePhModal();
}