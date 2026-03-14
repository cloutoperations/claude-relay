// IndexedDB message cache — stores processed messages per session.
// On tab restore, checks cache before requesting full history from server.
// Cache is invalidated when session has new activity (lastActivity changes).

const DB_NAME = 'claude-relay-cache';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';

let db = null;

function openDB() {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_NAME)) {
        d.createObjectStore(STORE_NAME, { keyPath: 'sessionId' });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

// Save processed messages for a session
export async function cacheSession(sessionId, data) {
  try {
    const d = await openDB();
    const tx = d.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({
      sessionId,
      messages: data.messages,
      tasks: data.tasks || [],
      historyFrom: data.historyFrom || 0,
      historyTotal: data.historyTotal || 0,
      cachedAt: Date.now(),
    });
  } catch {}
}

// Load cached messages for a session
export async function getCachedSession(sessionId) {
  try {
    const d = await openDB();
    return new Promise((resolve) => {
      const tx = d.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(sessionId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

// Remove cached session
export async function removeCachedSession(sessionId) {
  try {
    const d = await openDB();
    const tx = d.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(sessionId);
  } catch {}
}

// Clear all cached sessions
export async function clearCache() {
  try {
    const d = await openDB();
    const tx = d.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
  } catch {}
}
