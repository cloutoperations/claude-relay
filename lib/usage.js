var { execFileSync } = require("child_process");
var https = require("https");
var crypto = require("crypto");

var OAUTH_BETA = "oauth-2025-04-20";
var API_BASE = "https://api.anthropic.com";
var CACHE_TTL = 60 * 1000; // 1 minute

// Cache: { [accountName]: { data, timestamp } }
var usageCache = {};

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
  try {
    var raw = execFileSync("security", [
      "find-generic-password", "-s", serviceName, "-w"
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    var parsed = JSON.parse(raw);
    if (parsed.claudeAiOauth && parsed.claudeAiOauth.accessToken) {
      return parsed.claudeAiOauth;
    }
  } catch (e) {}
  return null;
}

/**
 * Make an HTTPS GET request with JSON response.
 */
function httpsGet(url, headers) {
  return new Promise(function (resolve, reject) {
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
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (e) { reject(new Error("Invalid JSON: " + body.substring(0, 200))); }
      });
    });
    req.on("error", reject);
    req.setTimeout(8000, function () { req.destroy(new Error("Timeout")); });
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
    return fetchAccountUsage(acct).then(function (data) {
      usageCache[acct.name] = { data: data, timestamp: Date.now() };
      return data;
    }).catch(function (e) {
      return { account: { id: acct.name, email: acct.email }, error: e.message };
    });
  });
  return Promise.all(promises);
}

module.exports = { fetchAllUsage, fetchAccountUsage, readOAuthToken };
