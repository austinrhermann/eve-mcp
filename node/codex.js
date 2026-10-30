// Codex provider. `codex exec` runs one turn per process, so this spawns a process per message and
// translates Codex's JSONL events into the same event shapes the Claude agent produces.
const { spawn } = require('child_process');

class CodexAgent {
  constructor(o) {
    this.o = o; this.cwd = o.cwd; this.mode = o.mode; this.model = o.model; this.approval = o.approval; this.provider = 'codex';
    this.alive = true; this.busy = false; this.proc = null; this.threadId = o.resume || null;
    this.buf = ''; this.stderr = ''; this.seen = {}; this.gotResult = false; this.stopped = false; this.lastError = '';
  }
  start() {}

  send(blocks, meta) {
    if (!this.alive || this.busy) return false;
    const o = this.o;
    const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n\n');
    const prompt = (!this.threadId && o.systemPrompt) ? o.systemPrompt + '\n\n---\nUser request:\n' + text : text;
    const images = (meta && meta.imagePaths) || [];
    const sandbox = o.mode === 'adobe' ? 'read-only' : (o.mode === 'full' ? 'danger-full-access' : 'workspace-write');
    const args = ['exec', '--json', '--skip-git-repo-check', '--sandbox', sandbox, '-C', o.cwd];
    if (o.model && o.model !== 'default') args.push('-m', o.model);
    if (!o.useUserMcp) args.push('--ignore-user-config');
    [['mcp_servers.eve.url', JSON.stringify(o.mcpUrl)],
     ['mcp_servers.eve.bearer_token_env_var', JSON.stringify('EVE_MCP_TOKEN')],
     ['mcp_servers.eve.default_tools_approval_mode', JSON.stringify('approve')],
     ['mcp_servers.eve.tool_timeout_sec', '300'],
     ['mcp_servers.eve.startup_timeout_sec', '30']].forEach(kv => args.push('-c', kv[0] + '=' + kv[1]));
    images.forEach(p => args.push('--image=' + p));
    if (this.threadId) args.push('resume', this.threadId);
    args.push('-');

    const spec = o.spec || { cmd: o.codexPath, pre: [], shell: false };
    this.busy = true; this.gotResult = false; this.stopped = false; this.buf = ''; this.stderr = ''; this.lastError = '';
    let p;
    try {
      p = spawn(spec.cmd, spec.pre.concat(args), { cwd: o.cwd, env: Object.assign({}, process.env, { PATH: o.pathEnv, EVE_MCP_TOKEN: o.mcpToken }),
        stdio: ['pipe', 'pipe', 'pipe'], shell: !!spec.shell, windowsHide: true });
    } catch (e) { this.busy = false; this.fail(String(e.message || e)); return true; }
    this.proc = p;
    p.stdin.on('error', () => {});
    p.stdin.end(prompt);
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', d => {
      this.buf += d; let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        try { this.handle(JSON.parse(line)); } catch (e) { /* ignore non-JSON noise */ }
      }
    });
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', d => { this.stderr = (this.stderr + d).slice(-4000); });
    p.on('error', e => { this.busy = false; this.fail(String(e.message || e)); });
    p.on('close', code => {
      this.busy = false;
      if (this.stopped || this.gotResult) return;
      const tail = this.stderr.trim().split(/\r?\n/).slice(-3).join(' ');
      this.fail(tail || ('Codex exited with code ' + code + '. Is it installed and signed in? Run “codex login” in a terminal.'));
    });
    return true;
  }

  fail(msg) { this.gotResult = true; this.o.onEvent({ type: 'result', is_error: true, result: msg, session_id: this.threadId }); }
  emitAssistant(block) { this.o.onEvent({ type: 'assistant', message: { content: [block] } }); }
  emitResult(id, isErr) { this.o.onEvent({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: !!isErr }] } }); }

  handle(ev) {
    const o = this.o;
    if (ev.type === 'thread.started') { this.threadId = ev.thread_id; o.onEvent({ type: 'system', subtype: 'init', session_id: ev.thread_id, mcp_servers: [] }); }
    else if (ev.type === 'item.started' || ev.type === 'item.completed') this.item(ev);
    else if (ev.type === 'turn.completed') { this.gotResult = true; o.onEvent({ type: 'result', is_error: false, session_id: this.threadId }); }
    else if (ev.type === 'turn.failed') { this.gotResult = true; o.onEvent({ type: 'result', is_error: true, result: (ev.error && ev.error.message) || this.lastError || 'Codex could not finish.', session_id: this.threadId }); }
    else if (ev.type === 'error') this.lastError = ev.message || '';
  }

  item(ev) {
    const it = ev.item || {}, done = ev.type === 'item.completed', id = it.id || ('item_' + Math.random());
    if (it.type === 'agent_message') { if (done && it.text) this.emitAssistant({ type: 'text', text: it.text }); return; }
    let name, input, failed = false;
    if (it.type === 'command_execution') { name = 'shell'; input = { command: it.command }; failed = it.status === 'failed' || (typeof it.exit_code === 'number' && it.exit_code !== 0); }
    else if (it.type === 'mcp_tool_call') {
      name = 'mcp__' + (it.server || 'mcp') + '__' + (it.tool || 'tool');
      input = it.arguments || it.input || {};
      if (typeof input === 'string') { try { input = JSON.parse(input); } catch (e) { input = { value: input }; } }
      failed = it.status === 'failed' || !!it.error;
    }
    else if (it.type === 'file_change') { name = 'edit_files'; input = { changes: it.changes }; failed = it.status === 'failed'; }
    else if (it.type === 'web_search') { name = 'web_search'; input = { query: it.query }; }
    else return;
    if (!this.seen[id]) { this.seen[id] = true; this.emitAssistant({ type: 'tool_use', id, name, input }); }
    if (done) this.emitResult(id, failed);
  }

  stop() {
    this.stopped = true; this.alive = false;
    if (this.proc) { try { this.proc.kill('SIGTERM'); } catch (e) {} }
  }
}
module.exports = { CodexAgent };
