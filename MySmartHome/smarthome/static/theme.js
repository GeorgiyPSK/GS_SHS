/* Переключение тем.
   Источник истины — localStorage. Сервер не используется. */
(function () {
  'use strict';

  const STORAGE_KEY = 'gs-smart-theme';
  const DEFAULT_THEME = 'deepblue';

  const THEMES = [
    { id: 'deepblue', label: '🌊 Deep Blue' },
    { id: 'midnight', label: '🌙 Midnight' },
    { id: 'forest',   label: '🌲 Forest' },
    { id: 'sunset',   label: '🌅 Sunset' },
    { id: 'light',    label: '☀️ Light' },
    { id: 'hc',       label: '⚡ High Contrast' },
  ];

  let _current = null;

  function isValid(id) {
    return THEMES.some(t => t.id === id);
  }

  function getLocalTheme() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v && isValid(v)) return v;
    } catch (e) {}
    return null;
  }

  function setLocalTheme(id) {
    try { localStorage.setItem(STORAGE_KEY, id); } catch (e) {}
  }

  function applyTheme(id) {
    if (!isValid(id)) id = DEFAULT_THEME;
    _current = id;

    const body = document.body;
    if (body) {
      THEMES.forEach(t => body.classList.remove('theme-' + t.id));
      body.classList.add('theme-' + id);
    }

    const sel = document.getElementById('themeSelect');
    if (sel && sel.value !== id) sel.value = id;
  }

  function buildThemeSelect() {
    const sel = document.getElementById('themeSelect');
    if (!sel) return;
    sel.innerHTML = '';
    for (const t of THEMES) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.label;
      sel.appendChild(opt);
    }
    sel.value = _current || getLocalTheme() || DEFAULT_THEME;
    sel.onchange = (e) => {
      const id = e.target.value;
      applyTheme(id);
      setLocalTheme(id);
    };
  }

  window.ThemeManager = {
    applyTheme,
    getCurrent: () => _current,
    THEMES,
    refreshFromServer: async () => null, // заглушка, если где-то вызывается
    saveToServer: async () => {},        // заглушка
  };

  applyTheme(getLocalTheme() || DEFAULT_THEME);

  function onReady() {
    if (document.body) {
      const initial = getLocalTheme() || DEFAULT_THEME;
      const hasClass = THEMES.some(t => document.body.classList.contains('theme-' + t.id));
      if (!hasClass) applyTheme(initial);
    }
    buildThemeSelect();
    const sel = document.getElementById('themeSelect');
    if (sel) sel.value = _current;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();