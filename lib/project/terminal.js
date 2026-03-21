module.exports = {
  async term_create(ctx, ws, msg) {
    var t = ctx.tm.create(msg.cols || 80, msg.rows || 24);
    if (!t) {
      ctx.sendTo(ws, { type: "term_error", error: "Cannot create terminal (node-pty not available or limit reached)" });
      return;
    }
    ctx.tm.attach(t.id, ws);
    ctx.send({ type: "term_list", terminals: ctx.tm.list() });
    ctx.sendTo(ws, { type: "term_created", id: t.id });
  },

  async term_attach(ctx, ws, msg) {
    if (msg.id) ctx.tm.attach(msg.id, ws);
  },

  async term_detach(ctx, ws, msg) {
    if (msg.id) ctx.tm.detach(msg.id, ws);
  },

  async term_input(ctx, ws, msg) {
    if (msg.id) ctx.tm.write(msg.id, msg.data);
  },

  async term_resize(ctx, ws, msg) {
    if (msg.id && msg.cols > 0 && msg.rows > 0) {
      ctx.tm.resize(msg.id, msg.cols, msg.rows);
    }
  },

  async term_close(ctx, ws, msg) {
    if (msg.id) {
      ctx.tm.close(msg.id);
      ctx.send({ type: "term_list", terminals: ctx.tm.list() });
    }
  },

  async term_rename(ctx, ws, msg) {
    if (msg.id && msg.title) {
      ctx.tm.rename(msg.id, msg.title);
      ctx.send({ type: "term_list", terminals: ctx.tm.list() });
    }
  },
};
