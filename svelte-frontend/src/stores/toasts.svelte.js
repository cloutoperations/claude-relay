// Toast notification store — Svelte 5 runes
export let toasts = $state([]);
let toastCounter = 0;

export function showToast(message, duration = 3000) {
  const id = ++toastCounter;
  toasts.push({ id, message });
  setTimeout(() => {
    const idx = toasts.findIndex(t => t.id === id);
    if (idx >= 0) toasts.splice(idx, 1);
  }, duration);
}
