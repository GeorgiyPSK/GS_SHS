/* ============================================================
   Утилиты и HTTP
   ============================================================ */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toBool(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on' || s === 'вкл';
}

function hexToRgba(hex, alpha) {
  const h = (hex || '#4caf50').replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) || 76;
  const g = parseInt(h.substring(2, 4), 16) || 175;
  const b = parseInt(h.substring(4, 6), 16) || 80;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function collectRowFields(rowEl) {
  const out = {};
  rowEl.querySelectorAll('[data-key]').forEach(el => {
    const k = el.dataset.key;
    if (el.type === 'checkbox') out[k] = el.checked;
    else out[k] = el.value;
  });
  return out;
}

function markRowDirty(elOrBtn) {
  const row = elOrBtn.closest('.row');
  if (!row) return;
  const btn = row.querySelector('.btn-save');
  if (btn) btn.classList.add('dirty');
}

function hasDirtyRows(viewId) {
  const view = document.getElementById(viewId); if (!view) return false;
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')
      && view.contains(ae)) return true;
  return !!view.querySelector('.btn-save.dirty');
}

function isDraggingRange(viewId) {
  const view = document.getElementById(viewId); if (!view) return false;
  const ae = document.activeElement;
  return !!(ae && ae.tagName === 'INPUT' && ae.type === 'range' && view.contains(ae));
}

function compareRule(left, op, right) {
  if (op === 'contains') {
    return String(right).toLowerCase() in String(left).toLowerCase();
  }
  if (op === 'between' && Array.isArray(right) && right.length === 2) {
    const n = Number(left);
    const [a, b] = right.map(Number);
    if (Number.isFinite(n) && Number.isFinite(a) && Number.isFinite(b)) {
      return n >= Math.min(a, b) && n <= Math.max(a, b);
    }
    return false;
  }
  let l = left, r = right;
  if (typeof right === 'boolean') {
    const lb = (left === true || left === 1 ||
                String(left).toLowerCase() === 'true' ||
                String(left).toLowerCase() === 'on' ||
                String(left).toLowerCase() === 'вкл');
    if (op === '==') return lb === right;
    if (op === '!=') return lb !== right;
    return false;
  }
  const ln = Number(left), rn = Number(right);
  if (Number.isFinite(ln) && Number.isFinite(rn) && left !== '' && right !== '') {
    l = ln; r = rn;
  } else {
    l = String(left ?? '');
    r = String(right ?? '');
  }
  if (op === '==') return l === r;
  if (op === '!=') return l !== r;
  if (op === '>')  return l > r;
  if (op === '<')  return l < r;
  if (op === '>=') return l >= r;
  if (op === '<=') return l <= r;
  return false;
}

function pickDeviceIcon(d) {
  const s = d.state || {};
  let rules = Array.isArray(d.icon_rules) ? d.icon_rules : null;
  if (!rules) {
    const meta = window.TYPES[d.type] || {};
    if (meta.raw && Array.isArray(meta.raw.icon_rules)) {
      rules = meta.raw.icon_rules;
    }
  }
  if (rules && rules.length) {
    for (const r of rules) {
      if (!r || !r.field || !r.icon) continue;
      const v = s[r.field];
      if (v === undefined) continue;
      if (compareRule(v, r.op || '==', r.value)) {
        return r.icon;
      }
    }
  }
  const meta = window.TYPES[d.type] || {};
  return meta.icon || '📦';
}

async function api(url, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  if (r.status === 401) {
    window.location.href = '/login';
    throw new Error('unauthorized');
  }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function noteInteraction() { _lastInteraction = Date.now(); }