// Shared popup size — all popup instances read from this single source of truth.
const POPUP_SIZE_KEY = 'claude-relay-popup-size';

let _saved = null;
try { _saved = JSON.parse(localStorage.getItem(POPUP_SIZE_KEY) || '{}'); } catch {}

export let popupSize = $state({
  h: _saved?.h > 200 ? _saved.h : null,
  w: _saved?.w > 280 ? _saved.w : null,
});

export function savePopupSize() {
  try {
    localStorage.setItem(POPUP_SIZE_KEY, JSON.stringify({
      h: popupSize.h ? Math.round(popupSize.h) : null,
      w: popupSize.w ? Math.round(popupSize.w) : null,
    }));
    if (popupSize.h) localStorage.setItem('claude-relay-popup-height', String(Math.round(popupSize.h)));
  } catch {}
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', savePopupSize);
}
