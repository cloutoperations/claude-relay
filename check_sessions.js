const WebSocket = require('ws');
const slugs = ['clout-operations', 'code', 'backstage', 'claude-relay'];
let done = 0;
for (const slug of slugs) {
  const url = 'wss://localhost:2633/p/' + slug + '/ws';
  const ws = new WebSocket(url, { rejectUnauthorized: false });
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'session_list') {
        const titles = msg.sessions.map(s => s.title);
        const counts = {};
        titles.forEach(t => { counts[t] = (counts[t]||0)+1; });
        const dupes = Object.entries(counts).filter(([t,c]) => c > 1).sort((a,b) => b[1]-a[1]);
        console.log(slug + ': ' + msg.sessions.length + ' sessions, ' + dupes.length + ' dupe groups');
        dupes.forEach(([t,c]) => console.log('  x' + c + ' "' + t + '"'));
        ws.close();
        done++;
        if (done >= slugs.length) process.exit(0);
      }
    } catch(e) {}
  });
  ws.on('error', (e) => { 
    console.log(slug + ' error: ' + e.message);
    done++;
    if (done >= slugs.length) process.exit(0);
  });
}
setTimeout(() => { console.log('Timeout after 10s'); process.exit(1); }, 10000);
