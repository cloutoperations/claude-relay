// Chat store — global broadcast state (project info, context, model, etc.)
// No message handling — session-router updates us directly.

// --- State ---
// Note: primitives (sessionCost, clientCount) are wrapped in objects because
// $state exports are read-only bindings — the router mutates .total / .count.
// Components: use contextData.used, sessionCost.total, clientCount.count, etc.

export let contextData = $state({ used: 0, max: 200000, model: '', percent: 0 });
export let sessionCost = $state({ total: 0 });
export let projectInfo = $state({ name: '', cwd: '', version: '', slug: '', accounts: [], debug: false, accountLabel: '', dangerouslySkipPermissions: false });
export let clientCount = $state({ count: 1 });
export let slashCommands = $state([]);
export let modelInfo = $state({ model: '', models: [] });

// Rate limit indicator — set by session-router when any session hits a rate limit
export let rateLimitState = $state({ active: false, text: '', clearTimer: null });

// Legacy exports — kept for StatusBar compatibility
export let processing = $state(false);
export let activity = $state(null);
export let tasks = $state([]);
