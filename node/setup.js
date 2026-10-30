const { execFile } = require('child_process');
const P = require('./platform.js');
function run(spec, args, env, timeout) {
  return new Promise(resolve => {
    execFile(spec.cmd, spec.pre.concat(args), { env, timeout: timeout || 60000, encoding: 'utf8', shell: !!spec.shell, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || '') + String(stderr || '') });
    });
  });
}
async function listMcp(spec, env, provider) {
  const r = await run(spec, ['mcp', 'list'], env, 60000);
  const servers = [];
  if (provider === 'codex') {
    r.out.split(/\r?\n/).forEach(line => {
      const t = line.trim(); if (!t || /^name\b/i.test(t) || /^no mcp/i.test(t)) return;
      const name = t.split(/\s+/)[0];
      const raw = /not logged in|unauth/i.test(t) ? 'needs sign-in' : (/disabled/i.test(t) ? 'disabled' : 'configured');
      servers.push({ name, target: '', status: raw === 'configured' ? 'online' : (raw === 'needs sign-in' ? 'auth' : 'offline'), raw });
    });
    return servers;
  }
  r.out.split(/\r?\n/).forEach(line => {
    const m = line.match(/^([^:\s][^:]*):\s+(.*?)\s+-\s+(.*)$/);
    if (!m) return;
    const status = m[3];
    servers.push({ name: m[1].trim(), target: m[2].trim(), status: /connected/i.test(status) && !/not|fail/i.test(status) ? 'online' : (/auth/i.test(status) ? 'auth' : 'offline'), raw: status });
  });
  return servers;
}
function addFigma(spec, env, provider) {
  if (provider === 'codex') return run(spec, ['mcp', 'add', 'figma', '--url', 'https://mcp.figma.com/mcp'], env, 120000);
  return run(spec, ['mcp', 'add', '--transport', 'http', 'figma', 'https://mcp.figma.com/mcp', '--scope', 'user'], env, 30000);
}
function openTerminal(provider) { P.openTerminalRunning(provider === 'codex' ? 'codex mcp login figma' : 'claude'); }
module.exports = { listMcp, addFigma, openTerminal };
