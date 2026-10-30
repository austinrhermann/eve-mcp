// Tiny MCP server (streamable HTTP, JSON responses) bound to 127.0.0.1 with a bearer token.
const http = require('http'), crypto = require('crypto'), fs = require('fs'), path = require('path');

function create(tools, configDir, log) {
  const token = crypto.randomBytes(24).toString('hex');
  const byName = {};
  tools.forEach(t => { byName[t.name] = t; });
  let server = null;

  async function rpc(msg) {
    switch (msg.method) {
      case 'initialize':
        return { protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'eve', version: '0.1.0' } };
      case 'ping': return {};
      case 'tools/list':
        return { tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) };
      case 'tools/call': {
        const t = byName[msg.params && msg.params.name];
        if (!t) return { content: [{ type: 'text', text: 'Unknown tool' }], isError: true };
        try { return await t.handler((msg.params && msg.params.arguments) || {}); }
        catch (e) { return { content: [{ type: 'text', text: 'Tool error: ' + (e && e.message || e) }], isError: true }; }
      }
      default: { const err = new Error('Method not found'); err.code = -32601; throw err; }
    }
  }

  function handle(req, res) {
    if (req.headers.authorization !== 'Bearer ' + token) { res.writeHead(401); return res.end(); }
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      let msg;
      try { msg = JSON.parse(body); } catch (e) { res.writeHead(400); return res.end(); }
      const one = async m => {
        if (m.id === undefined || m.id === null) { return null; }
        try { return { jsonrpc: '2.0', id: m.id, result: await rpc(m) }; }
        catch (e) { return { jsonrpc: '2.0', id: m.id, error: { code: e.code || -32603, message: e.message || 'Internal error' } }; }
      };
      if (Array.isArray(msg)) {
        const out = (await Promise.all(msg.map(one))).filter(Boolean);
        if (!out.length) { res.writeHead(202); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(out));
      }
      const out = await one(msg);
      if (!out) { res.writeHead(202); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  }

  function start() {
    return new Promise((resolve, reject) => {
      server = http.createServer(handle);
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const cfg = { mcpServers: { eve: { type: 'http', url: 'http://127.0.0.1:' + port + '/mcp', headers: { Authorization: 'Bearer ' + token } } } };
        fs.mkdirSync(configDir, { recursive: true });
        const file = path.join(configDir, 'mcp.json');
        fs.writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
        if (log) log('MCP listening on ' + port);
        resolve({ port, file, token, url: 'http://127.0.0.1:' + port + '/mcp' });
      });
    });
  }
  function stop() { if (server) { server.close(); server = null; } }
  return { start, stop };
}
module.exports = { create };
