// Toast notification store — Svelte 5 runes
export let toasts = $state([]);
let toastCounter = 0;
const MAX_TOASTS = 5;

export function showToast(message, duration = 3000) {
  // Deduplicate — skip if a toast with the same message is already showing
  if (toasts.some(t => t.message === message)) return;

  const id = ++toastCounter;
  toasts.push({ id, message });

  // Enforce max toast limit — remove oldest if exceeded
  while (toasts.length > MAX_TOASTS) {
    toasts.splice(0, 1);
  }

  setTimeout(() => {
    const idx = toasts.findIndex(t => t.id === id);
    if (idx >= 0) toasts.splice(idx, 1);
  }, duration);
}
