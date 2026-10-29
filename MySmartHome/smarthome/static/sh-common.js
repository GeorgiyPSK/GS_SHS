/* ============================================================
   SH — общие утилиты для Node-RED / HTTP / cURL модулей
   ============================================================ */
(function () {
  'use strict';

  function getDevices() {
    return (window.devicesCache || window.SH?.devicesCache || []);
  }

  function getMqttBase() {
    return (window.mqttSettingsCache && window.mqttSettingsCache.base_topic) || 'smarthome';
  }
  function getMqttHost() {
    return (window.mqttSettingsCache && window.mqttSettingsCache.host) || 'localhost';
  }
  function getMqttPort() {
    return (window.mqttSettingsCache && window.mqttSettingsCache.port) || 1883;
  }

  function ensureModal() {
    let overlay = document.getElementById('sh-modal-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'sh-modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    overlay.innerHTML = `
      <div class="modal" style="max-width:760px;">
        <button class="modal-close" onclick="SH.closeModal()">✕</button>
        <div style="padding:1.2rem;">
          <h3 id="sh-modal-title" style="margin:0 0 .5rem;">—</h3>
          <p id="sh-modal-hint" style="margin:0 0 .8rem; opacity:.8; font-size:.9rem;"></p>
          <textarea id="sh-modal-json" readonly
            style="width:100%; min-height:380px; font-family:monospace; font-size:.85rem;
                   padding:.6rem; border-radius:10px; resize:vertical;
                   background:rgba(0,0,0,.35); color:#fff;
                   border:1px solid rgba(255,255,255,.25);"></textarea>
          <div style="margin-top:.8rem; display:flex; gap:.5rem; justify-content:flex-end;">
            <button class="btn gray" onclick="SH.closeModal()">Закрыть</button>
            <button class="btn primary" onclick="SH.copyText(this)">📋 Скопировать</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function openModal(title, hint, text) {
    const overlay = ensureModal();
    document.getElementById('sh-modal-title').textContent = title;
    document.getElementById('sh-modal-hint').innerHTML = hint || '';
    document.getElementById('sh-modal-json').value = text;
    overlay.classList.add('open');
  }

  function closeModal() {
    const overlay = document.getElementById('sh-modal-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  function copyText(btn) {
    const ta = document.getElementById('sh-modal-json');
    if (!ta) return;
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const done = () => {
      const old = btn.textContent;
      btn.textContent = '✅ Скопировано';
      setTimeout(() => { btn.textContent = old; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(done).catch(() => {
        document.execCommand('copy'); done();
      });
    } else {
      document.execCommand('copy'); done();
    }
  }

  window.SH = {
    getDevices,
    getMqttBase, getMqttHost, getMqttPort,
    openModal, closeModal, copyText,
  };
})();