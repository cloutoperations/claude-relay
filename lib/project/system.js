module.exports = {
  async push_subscribe(ctx, ws, msg) {
    if (ctx.pushModule && msg.subscription) ctx.pushModule.addSubscription(msg.subscription, msg.replaceEndpoint);
  },

  async process_stats(ctx, ws, msg) {
    var sessionCount = ctx.sm.sessions.size;
    var processingCount = 0;
    ctx.sm.sessions.forEach(function (s) {
      if (s.isProcessing) processingCount++;
    });
    var mem = process.memoryUsage();
    ctx.sendTo(ws, {
      type: "process_stats",
      pid: process.pid,
      uptime: process.uptime(),
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
      },
      sessions: sessionCount,
      processing: processingCount,
      clients: ctx.clients.size,
      terminals: ctx.tm.list().length,
    });
  },

  async get_usage(ctx, ws, msg) {
    try {
      var data = await ctx.fetchAllUsage(ctx.accounts);
      ctx.sendTo(ws, { type: "usage_data", accounts: data, timestamp: Date.now() });
    } catch (e) {
      ctx.sendTo(ws, { type: "usage_data", error: e.message, accounts: [], timestamp: Date.now() });
    }
  },

  async heal_sessions(ctx, ws, msg) {
    var healed = 0;
    var errors = 0;
    ctx.sm.sessions.forEach(function (session) {
      if (!session.cliSessionId) return;
      try {
        ctx.sm.saveSessionFile(session);
        healed++;
      } catch (e) {
        errors++;
        console.error("[project] heal_sessions error:", e.message);
      }
    });
    ctx.sendTo(ws, { type: "heal_sessions_result", healed: healed, errors: errors, total: ctx.sm.sessions.size });
    console.log("[project] heal_sessions: saved", healed, "sessions, errors:", errors);
  },

  async set_system_prompt(ctx, ws, msg) {
    var targetSessionId = msg.sessionId;
    if (!targetSessionId || !ctx.sm.sessions.has(targetSessionId)) return;
    var targetSession = ctx.sm.sessions.get(targetSessionId);
    targetSession.customPrompt = msg.prompt ? String(msg.prompt).substring(0, 10000) : null;
    console.log("[project] Set customPrompt for session:", targetSessionId, targetSession.customPrompt ? targetSession.customPrompt.length + " chars" : "cleared");
    ctx.sendTo(ws, { type: "system_prompt_set", sessionId: targetSessionId, success: true });
  },
};
