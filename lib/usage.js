var { execFileSync } = require("child_process");
var https = require("https");
var crypto = require("crypto");

var OAUTH_BETA = "oauth-2025-04-20";
var API_BASE = "https://api.anthropic.com";
var CACHE_TTL = 5 * 60 * 1000; // 5 minutes
var RATE_LIMIT_BACKOFF = 15 * 60 * 1000; // 15 minutes after 429

// Cache: { [accountName]: { data, timestamp } }
var usageCache = {};
// Track rate limit hits: { [accountName]: timestamp }
var rateLimitUntil = {};

/**
 * Read OAuth access token from macOS keychain for a given account.
 * configDir: path like ~/.claude or ~/.claude-2
 */
function readOAuthToken(configDir) {
  if (process.platform !== "darwin") return null;
  var suffix = "";
  if (process.env.CLAUDE_CONFIG_DIR === configDir) {
    // Currently active dir — no suffix
  } else {
    // Compute suffix from configDir path
    var home = require("os").homedir();
    var defaultDir = require("path").join(home, ".claude");
    if (configDir !== defaultDir) {
      suffix = "-" + crypto.createHash("sha256").update(configDir).digest("hex").substring(0, 8);
    }
  }
  var serviceName = "Claude Code-credentials" + suffix;
  // Try with macOS username first (newer Claude Code writes with -a <username>),
  // then fall back to bare service name lookup (older entries).
  var user = require("os").userInfo().username;
  var attempts = [
    ["-s", serviceName, "-a", user, "-w"],
    ["-s", serviceName, "-w"],
  ];
  for (var i = 0; i < attempts.length; i++) {
    try {
      var raw = execFileSync("security", ["find-generic-password"].concat(attempts[i]),
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      var parsed = JSON.parse(raw);
      if (parsed.claudeAiOauth && parsed.claudeAiOauth.accessToken) {
        // Skip expired tokens if there's another attempt to try
        if (parsed.claudeAiOauth.expiresAt && parsed.claudeAiOauth.expiresAt < Date.now() && i < attempts.length - 1) continue;
        return parsed.claudeAiOauth;
      }
    } catch (e) { console.warn("[usage] Keychain lookup failed for", serviceName, ":", e.message); }
  }
  return null;
}

/**
 * Make an HTTPS GET request with JSON response.
 */
function httpsGet(url, headers) {
  return new Promise(function (resolve, reject) {
    var done = false;
    var hardTimeout = setTimeout(function () {
      if (!done) { done = true; req.destroy(); reject(new Error("Hard timeout")); }
    }, 5000);
    var parsed = new URL(url);
    var opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: headers,
    };
    var req = https.request(opts, function (res) {
      var body = "";
      res.on("data", function (chunk) { body += chunk; });
      res.on("end", function () {
        if (done) return;
        done = true;
        clearTimeout(hardTimeout);
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (e) { reject(new Error("Invalid JSON: " + body.substring(0, 200))); }
      });
    });
    req.on("error", function (e) {
      if (done) return;
      done = true;
      clearTimeout(hardTimeout);
      reject(e);
    });
    req.setTimeout(4000, function () { req.destroy(new Error("Timeout")); });
    req.end();
  });
}

/**
 * Fetch usage for a single account.
 * Returns { profile, usage } or throws.
 */
async function fetchAccountUsage(account) {
  var oauth = readOAuthToken(account.configDir);
  if (!oauth || !oauth.accessToken) {
    throw new Error("No OAuth token for " + account.email);
  }
  // Check if token is expired
  if (oauth.expiresAt && oauth.expiresAt < Date.now()) {
    throw new Error("Token expired — run `claude` in terminal to refresh");
  }
  var headers = {
    "Authorization": "Bearer " + oauth.accessToken,
    "anthropic-beta": OAUTH_BETA,
    "Content-Type": "application/json",
    "User-Agent": "claude-relay",
  };
  var results = await Promise.all([
    httpsGet(API_BASE + "/api/oauth/usage", headers),
    httpsGet(API_BASE + "/api/oauth/profile", headers),
  ]);
  var usageRes = results[0];
  var profileRes = results[1];
  if (usageRes.status === 429) {
    rateLimitUntil[account.name] = Date.now() + RATE_LIMIT_BACKOFF;
    throw new Error("Rate limited — will retry in 15 minutes");
  }
  if (usageRes.status !== 200) {
    throw new Error("Usage API " + usageRes.status + ": " + JSON.stringify(usageRes.data));
  }
  return {
    usage: usageRes.data,
    profile: profileRes.status === 200 ? profileRes.data : null,
    account: { id: account.name, email: account.email },
  };
}

/**
 * Fetch usage for all accounts with caching.
 */
async function fetchAllUsage(accounts) {
  var now = Date.now();
  var promises = accounts.map(function (acct) {
    var cached = usageCache[acct.name];
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      return Promise.resolve(cached.data);
    }
    // If rate limited, return stale cache or a quiet message
    if (rateLimitUntil[acct.name] && now < rateLimitUntil[acct.name]) {
      if (cached) return Promise.resolve(cached.data);
      var mins = Math.ceil((rateLimitUntil[acct.name] - now) / 60000);
      return Promise.resolve({ account: { id: acct.name, email: acct.email }, error: "Rate limited — retrying in " + mins + "m" });
    }
    return fetchAccountUsage(acct).then(function (data) {
      usageCache[acct.name] = { data: data, timestamp: Date.now() };
      return data;
    }).catch(function (e) {
      // On error, return stale cache if available
      if (cached) return cached.data;
      return { account: { id: acct.name, email: acct.email }, error: e.message };
    });
  });
  return Promise.all(promises);
}

module.exports = { fetchAllUsage, fetchAccountUsage, readOAuthToken };
