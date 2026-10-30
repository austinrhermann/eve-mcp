// Runs one long-lived `claude -p` process per conversation and speaks stream-json over stdio.
const { spawn } = require('child_process');

class Agent {
  constructor(o) { this.o = o; this.proc = null; this.buf = ''; this.alive = false; this.cwd = o.cwd; this.mode = o.mode; this.model = o.model; this.approval = o.approval; this.stderr = ''; }

  start() {
    const o = this.o;
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--mcp-config', o.mcpConfig, '--append-system-prompt', o.systemPrompt];
    if (o.model && o.model !== 'default') args.push('--model', o.model);
    if (o.mode === 'adobe') {
      args.push('--tools', '', '--strict-mcp-config', '--allowedTools', 'mcp__eve');
    } else if (o.mode === 'full') {
      args.push('--permission-mode', 'bypassPermissions');
      if (!o.useUserMcp) args.push('--strict-mcp-config');
    } else {
      args.push('--permission-mode', o.approval === 'manual' ? 'default' : 'acceptEdits', '--allowedTools', 'mcp__eve', '--permission-prompt-tool', 'mcp__eve__approve');
      if (!o.useUserMcp) args.push('--strict-mcp-config');
    }
    if (o.resume) { args.push('--resume', o.resume); if (o.fork) args.push('--fork-session'); }

    let p;
    try {
      const spec = o.spec || { cmd: o.claudePath, pre: [], shell: false };
      p = spawn(spec.cmd, spec.pre.concat(args), { cwd: o.cwd, env: Object.assign({}, process.env, { PATH: o.pathEnv }), stdio: ['pipe', 'pipe', 'pipe'], shell: !!spec.shell, windowsHide: true });
    } catch (e) { o.onExit(-1, String(e)); return; }
    this.proc = p; this.alive = true;
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', d => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        try { o.onEvent(JSON.parse(line)); } catch (e) { /* ignore non-JSON noise */ }
      }
    });
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', d => { this.stderr = (this.stderr + d).slice(-4000); });
    p.on('error', e => { this.alive = false; o.onExit(-1, String(e.message || e)); });
    p.on('close', code => { this.alive = false; o.onExit(code, this.stderr); });
  }

  send(blocks) {
    if (!this.alive) return false;
    this.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: blocks } }) + '\n');
    return true;
  }

  stop() { this.alive = false; if (this.proc) { try { this.proc.kill('SIGTERM'); } catch (e) {} } }
}
module.exports = { Agent };
