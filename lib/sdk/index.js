var { AGENT_SKILLS, BASE_SYSTEM_APPEND, loadAgentSkills, buildSystemPrompt } = require("./prompts");
var { createToolHandler, permissionPushTitle, permissionPushBody } = require("./tools");
var { createEventProcessor } = require("./events");
var { createQueryManager, createMessageQueue } = require("./query");

function createSDKBridge(opts) {
  var cwd = opts.cwd;
  var skills = loadAgentSkills(cwd) || AGENT_SKILLS;
  var slug = opts.slug || "";
  var sm = opts.sessionManager;
  var send = opts.send;
  var sendToViewers = opts.sendToViewers || send;
  var pushModule = opts.pushModule;
  var getSDK = opts.getSDK;
  var dangerouslySkipPermissions = opts.dangerouslySkipPermissions || false;
  var onFileChange = opts.onFileChange || null;
  var onSessionRekey = opts.onSessionRekey || null;

  function sendAndRecord(session, obj) {
    sm.sendAndRecord(session, obj);
  }

  // Shared context for all sub-modules
  var ctx = {
    cwd: cwd,
    slug: slug,
    skills: skills,
    sessionManager: sm,
    send: send,
    sendToViewers: sendToViewers,
    sendAndRecord: sendAndRecord,
    pushModule: pushModule,
    getSDK: getSDK,
    dangerouslySkipPermissions: dangerouslySkipPermissions,
    onFileChange: onFileChange,
    onSessionRekey: onSessionRekey,
  };

  // Create tool handler
  var handleCanUseTool = createToolHandler(ctx);
  ctx.handleCanUseTool = handleCanUseTool;

  // Create event processor
  var events = createEventProcessor(ctx);
  ctx.processSDKMessage = events.processSDKMessage;
  ctx.broadcastConfigState = events.broadcastConfigState;

  // Create query manager (needs handleCanUseTool and processSDKMessage)
  var query = createQueryManager(ctx);
  // Wire startQuery into ctx so events.js can call it for expired session retry
  ctx.startQuery = query.startQuery;

  return {
    createMessageQueue: createMessageQueue,
    processSDKMessage: events.processSDKMessage,
    handleCanUseTool: handleCanUseTool,
    getOrCreateRewindQuery: query.getOrCreateRewindQuery,
    startQuery: query.startQuery,
    pushMessage: query.pushMessage,
    setModel: query.setModel,
    setPermissionMode: query.setPermissionMode,
    setEffort: query.setEffort,
    stopTask: query.stopTask,
    broadcastConfigState: events.broadcastConfigState,
    permissionPushTitle: permissionPushTitle,
    permissionPushBody: permissionPushBody,
    warmup: query.warmup,
  };
}

module.exports = { createSDKBridge, createMessageQueue, AGENT_SKILLS, BASE_SYSTEM_APPEND, buildSystemPrompt };
