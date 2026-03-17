/* Push notification subscription store (Svelte 5 runes) */

export let pushState = $state({
  supported: 'serviceWorker' in globalThis.navigator && 'PushManager' in globalThis,
  subscribed: false,
  denied: globalThis.Notification?.permission === 'denied',
  loading: false,
});

// Check existing subscription on load
if (pushState.supported) {
  navigator.serviceWorker.ready.then(reg => {
    reg.pushManager.getSubscription().then(sub => {
      if (sub) pushState.subscribed = true;
    });
  }).catch(() => {});
}

/** Subscribe to push notifications */
export function subscribeToPush() {
  if (!pushState.supported || pushState.subscribed || pushState.loading) return;
  pushState.loading = true;

  navigator.serviceWorker.ready
    .then(reg =>
      fetch('/api/vapid-public-key', { cache: 'no-store' })
        .then(r => r.json())
        .then(data => {
          if (!data.publicKey) throw new Error('No VAPID key');
          const raw = atob(data.publicKey.replace(/-/g, '+').replace(/_/g, '/'));
          const key = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        })
    )
    .then(sub => {
      const prevEndpoint = localStorage.getItem('push-endpoint');
      localStorage.setItem('push-endpoint', sub.endpoint);
      const payload = { subscription: sub.toJSON() };
      if (prevEndpoint && prevEndpoint !== sub.endpoint) {
        payload.replaceEndpoint = prevEndpoint;
      }
      return fetch('/api/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    })
    .then(() => {
      pushState.subscribed = true;
      pushState.loading = false;
    })
    .catch(err => {
      pushState.loading = false;
      if (Notification.permission === 'denied') {
        pushState.denied = true;
      }
      console.warn('[push] subscription failed:', err.message || err);
    });
}
