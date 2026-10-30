(function () {
  'use strict';
  const fs = require('fs'), path = require('path'), os = require('os');
  const cs = new CSInterface();
  const EXT = decodeURI(cs.getSystemPath(SystemPath.EXTENSION)).replace(/^file:\/\//, '');
  const mod = n => require(path.join(EXT, 'node', n));
  const config = mod('config.js'), shell = mod('shell.js'), mcpMod = mod('mcp.js'), checkpoints = mod('checkpoints.js'),
    attachments = mod('attachments.js'), setup = mod('setup.js'), platform = mod('platform.js'), notify = mod('notify.js'), { CodexAgent } = mod('codex.js'), makeTools = mod('tools.js'), { Agent } = mod('agent.js');

  let VERSION = '';
  try { VERSION = fs.readFileSync(path.join(EXT, 'VERSION'), 'utf8').trim(); } catch (e) {}
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lit = v => JSON.stringify(v === undefined ? null : v).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const clock = ts => new Date(ts || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const NAME = () => ((S.cfg.eveName || 'Eve').trim() || 'Eve');
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function md(s) {
    let t = esc(s);
    t = t.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (m, c) => '<pre>' + c + '</pre>');
    t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
    return t.replace(/<pre>([\s\S]*?)<\/pre>/g, (m, c) => '<pre>' + c.replace(/<br>/g, '\n') + '</pre>');
  }

  const ae = {
    run: s => new Promise(r => cs.evalScript(s, r)),
    async json(s) { const r = await ae.run(s); try { return JSON.parse(r); } catch (e) { return { ok: false, message: 'Host error: ' + r }; } }
  };

  const S = {
    cfg: config.load(), view: 'chat', id: uid(), title: 'New chat', entries: [], running: false, agent: null,
    sessionId: null, sessionCwd: null, sessionProvider: null, clis: {}, mcpUrl: '', mcpToken: '', codexNoted: false, spec: null, lastEve: '', forkPending: false, project: null, atts: [], toolEls: {}, pendingNote: '',
    claudePath: '', pathEnv: '', mcpFile: '', mcpPort: 0, aeOk: false, prefOk: true, prefWarned: false,
    mcpServers: [], skills: [], scriptFails: 0, lastScript: ''
  };
  const state = { fails: 0 };

  // ---------- provider ----------
  function PROV() { return S.cfg.provider === 'codex' ? 'codex' : 'claude'; }
  function PNAME() { return PROV() === 'codex' ? 'Codex' : 'Claude Code'; }
  function curModel() { return PROV() === 'codex' ? (S.cfg.codexModel || '') : S.cfg.model; }
  function selectProvider() { const c = S.clis[PROV()] || {}; S.claudePath = c.path || ''; S.spec = c.spec || null; }
  function applyProviderUI() { $('c-model').hidden = PROV() === 'codex'; }

  // ---------- theme / persistence ----------
  function applyTheme() { document.documentElement.setAttribute('data-theme', S.cfg.theme === 'dark' ? 'dark' : 'light'); }
  function saveCfg() { config.save(S.cfg); }
  const SESS = path.join(config.DIR, 'sessions.json');
  function loadSessions() { try { return JSON.parse(fs.readFileSync(SESS, 'utf8')).sessions || []; } catch (e) { return []; } }
  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const all = loadSessions().filter(s => s.id !== S.id);
        if (S.entries.some(e => e.kind === 'user')) {
          all.unshift({ id: S.id, title: S.title, project: S.project && S.project.name, ts: Date.now(), claudeSessionId: S.sessionId, provider: S.sessionProvider, cwd: S.sessionCwd, entries: S.entries.slice(-500) });
        }
        fs.mkdirSync(config.DIR, { recursive: true });
        fs.writeFileSync(SESS, JSON.stringify({ sessions: all.slice(0, 50) }));
      } catch (e) {}
    }, 500);
  }

  // ---------- dialogs ----------
  function dialog(title, bodyHtml, buttons) {
    return new Promise(resolve => {
      const ov = $('overlay');
      bodyHtml = bodyHtml.replace(/\bEve\b/g, NAME());
      ov.innerHTML = '<div class="dlg" role="dialog" aria-modal="true"><div class="tb">' + esc(title.replace(/\bEve\b/g, NAME())) + '</div><div class="bd">' + bodyHtml + '</div><div class="ft"></div></div>';
      const ft = ov.querySelector('.ft');
      buttons.forEach((b, i) => {
        const btn = document.createElement('button');
        btn.textContent = b; if (i === buttons.length - 1) btn.className = 'primary';
        btn.onclick = () => { const chk = ov.querySelector('input[type=checkbox]'); const vals = {}; ov.querySelectorAll('input[data-key]').forEach(x => { vals[x.dataset.key] = x.value; }); const v = { index: i, checked: chk ? chk.checked : false, values: vals }; ov.hidden = true; ov.innerHTML = ''; resolve(v); };
        ft.appendChild(btn);
      });
      ov.hidden = false;
      const first = ov.querySelector('input[data-key]'); (first || ft.lastChild).focus();
    });
  }

  // ---------- views ----------
  function show(view) {
    S.view = view;
    ['chat', 'buddies', 'history', 'settings'].forEach(v => { $('view-' + v).hidden = v !== view; });
    if (view === 'buddies') renderBuddies();
    if (view === 'history') renderHistory();
    if (view === 'settings') renderSettings();
    if (view === 'chat') { renderStrip(); $('input').focus(); }
  }

  // ---------- log ----------
  function scrollLog() { const l = $('log'); l.scrollTop = l.scrollHeight; }
  function renderEntry(e) {
    const log = $('log'); let node;
    if (e.kind === 'sys' || e.kind === 'err') {
      node = document.createElement('p'); node.className = e.kind;
      node.append('*** ' + e.text + ' ');
      if (e.link) { const a = document.createElement('a'); a.textContent = e.link.label; a.tabIndex = 0; a.onclick = () => restore(e.link.cp); node.appendChild(a); }
    } else if (e.kind === 'user') {
      node = document.createElement('p');
      node.innerHTML = '<span class="ts">[' + clock(e.ts) + ']</span> <span class="me">' + esc(e.name) + ':</span> <span class="body">' + md(e.text) + '</span>';
      (e.files || []).forEach(f => {
        const t = document.createElement('span'); t.className = 'thumb';
        if (f.image) { const im = document.createElement('img'); im.src = platform.fileUrl(f.path); im.alt = f.name; t.appendChild(im); }
        t.appendChild(document.createTextNode(f.name));
        node.appendChild(document.createElement('br')); node.appendChild(t);
      });
    } else if (e.kind === 'eve') {
      node = document.createElement('p');
      node.innerHTML = '<span class="ts">[' + clock(e.ts) + ']</span> <span class="bot">' + esc(NAME()) + ':</span> <span class="body">' + md(e.text) + '</span>';
    } else if (e.kind === 'tool') {
      node = document.createElement('div'); node.className = 'tool' + (e.bad ? ' bad' : '');
      node.innerHTML = '<details><summary><b>' + esc(e.label) + '</b> <span class="st">' + esc(e.status || 'running…') + '</span></summary>' + (e.code ? '<pre>' + esc(e.code) + '</pre>' : '') + '</details>';
      S.toolEls[e.id] = { node, e };
    }
    log.appendChild(node); scrollLog(); return node;
  }
  function add(e) { e.ts = e.ts || Date.now(); if (e.text && (e.kind === 'sys' || e.kind === 'err')) e.text = e.text.replace(/\bEve\b/g, NAME()); S.entries.push(e); renderEntry(e); persist(); return e; }
  function updateTool(id, status, bad) {
    const t = S.toolEls[id]; if (!t) return;
    t.e.status = status; t.e.bad = !!bad;
    t.node.className = 'tool' + (bad ? ' bad' : '');
    t.node.querySelector('.st').textContent = status; persist();
  }
  function renderAll() { $('log').innerHTML = ''; S.toolEls = {}; S.entries.forEach(renderEntry); }

  function setRunning(on, label) {
    S.running = on;
    $('b-send').textContent = on ? 'Stop' : 'Send';
    $('status-text').textContent = on ? NAME() + ' is thinking' + (label ? ' · ' + label : '…') : '';
  }

  // ---------- strip / skills ----------
  function dot(c) { return '<span class="dot ' + c + '"></span>'; }
  function renderStrip() {
    const claudeOk = !!S.claudePath;
    const eveOk = !!S.mcpPort;
    const others = S.mcpServers.filter(s => s.name !== 'eve');
    const figma = others.find(s => /figma/i.test(s.name));
    const parts = [
      '<b>Buddies</b>',
      '<span class="pill">' + dot(claudeOk ? 'on' : 'off') + PNAME() + '</span>',
      '<span class="pill">' + dot(S.aeOk && eveOk ? 'on' : 'off') + 'After Effects</span>',
      '<span class="pill">' + dot(figma ? (figma.status === 'online' ? 'on' : 'warn') : 'off') + 'Figma</span>'
    ];
    $('strip').innerHTML = parts.join('');
    if (!S.prefOk) $('strip').innerHTML += '<span class="pill err">Enable “Allow Scripts to Write Files and Access Network”</span>';
  }
  function scanSkills() {
    const out = []; const seen = {};
    const codex = PROV() === 'codex';
    const roots = codex ? [{ dir: path.join(os.homedir(), '.agents', 'skills'), scope: 'GLOBAL' }, { dir: path.join(os.homedir(), '.codex', 'skills'), scope: 'GLOBAL' }]
                        : [{ dir: path.join(os.homedir(), '.claude', 'skills'), scope: 'GLOBAL' }];
    if (S.project && S.project.path) roots.push({ dir: path.join(path.dirname(S.project.path), codex ? '.agents' : '.claude', 'skills'), scope: 'PROJECT' });
    roots.forEach(r => {
      let names = []; try { names = fs.readdirSync(r.dir); } catch (e) {}
      names.forEach(n => {
        const f = path.join(r.dir, n, 'SKILL.md'); let txt;
        try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { return; }
        const fm = (txt.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
        const name = ((fm.match(/^name:\s*(.+)$/m) || [])[1] || n).replace(/^["']|["']$/g, '').trim();
        const description = ((fm.match(/^description:\s*(.+)$/m) || [])[1] || '').replace(/^["']|["']$/g, '').trim();
        if (seen[r.scope + name]) return; seen[r.scope + name] = 1;
        out.push({ name, description, scope: r.scope, file: f });
      });
    });
    S.skills = out;
    const sel = $('f-skill'); sel.innerHTML = '<option value="">/ Skills</option>';
    out.forEach(s => { const o = document.createElement('option'); o.value = s.name; o.textContent = s.name; sel.appendChild(o); });
  }

  // ---------- attachments ----------
  async function addFile(file) {
    try {
      const isImg = /^image\//.test(file.type);
      let buf, mime = file.type, name = file.name || ('pasted-' + Date.now() + '.png');
      if (isImg) {
        const bmp = await createImageBitmap(file);
        const max = 1600, sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        let blob = await new Promise(r => c.toBlob(r, 'image/png'));
        mime = 'image/png';
        if (blob.size > 3 * 1048576) { blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85)); mime = 'image/jpeg'; name = name.replace(/\.\w+$/, '') + '.jpg'; }
        buf = Buffer.from(await blob.arrayBuffer());
      } else { buf = Buffer.from(await file.arrayBuffer()); }
      const p = attachments.store(S.id, name, buf);
      S.atts.push({ path: p, name, mime, image: isImg, b64: isImg ? buf.toString('base64') : null });
      renderChips();
    } catch (e) { add({ kind: 'err', text: 'Could not attach ' + (file.name || 'file') + ': ' + e.message }); }
  }
  function renderChips() {
    const c = $('chips'); c.innerHTML = '';
    S.atts.forEach((a, i) => {
      const d = document.createElement('div'); d.className = 'chip';
      if (a.image) { const im = document.createElement('img'); im.src = 'data:' + a.mime + ';base64,' + a.b64; im.alt = ''; d.appendChild(im); }
      d.appendChild(document.createTextNode(a.name));
      const x = document.createElement('button'); x.textContent = 'x'; x.setAttribute('aria-label', 'Remove ' + a.name);
      x.onclick = () => { S.atts.splice(i, 1); renderChips(); }; d.appendChild(x); c.appendChild(d);
    });
  }

  // ---------- agent ----------
  function buildSystemPrompt() {
    let p = ''; try { p = fs.readFileSync(path.join(EXT, 'prompts', 'system.md'), 'utf8').replace(/\bEve\b/g, NAME()); } catch (e) {}
    if (S.project && S.project.path) p += '\nProject file: ' + S.project.path + '\n';
    if (S.cfg.customInstructions.trim()) p += '\nUser instructions:\n' + S.cfg.customInstructions.trim() + '\n';
    return p;
  }
  function sameAgent() {
    const a = S.agent, cwd = path.dirname(S.project.path);
    return a && a.alive && a.cwd === cwd && (a.provider || 'claude') === PROV() && a.mode === S.cfg.mode && a.model === curModel() && a.approval === S.cfg.approval;
  }
  function ping(body) { notify.send(S.cfg, NAME(), body); }
  function startAgent() {
    const cwd = path.dirname(S.project.path);
    if (S.agent) S.agent.stop();
    let resume = S.sessionId;
    if (resume && S.sessionProvider && S.sessionProvider !== PROV()) { resume = null; S.sessionId = null; add({ kind: 'sys', text: 'Switched to ' + PNAME() + ', starting a fresh conversation.' }); }
    if (resume && S.sessionCwd && S.sessionCwd !== cwd) { resume = null; S.sessionId = null; add({ kind: 'sys', text: 'Project folder changed, starting a fresh conversation with Claude.' }); }
    const fork = S.forkPending && !!resume;
    S.forkPending = false; S.sessionCwd = cwd; S.sessionProvider = PROV();
    S.agent = new (PROV() === 'codex' ? CodexAgent : Agent)({
      claudePath: S.claudePath, spec: S.spec, pathEnv: S.pathEnv, cwd, mode: S.cfg.mode, model: curModel(), codexPath: S.claudePath, mcpUrl: S.mcpUrl, mcpToken: S.mcpToken, approval: S.cfg.approval, useUserMcp: S.cfg.useUserMcp,
      mcpConfig: S.mcpFile, systemPrompt: buildSystemPrompt(), resume, fork,
      onEvent, onExit
    });
    S.agent.start();
    if (PROV() === 'codex' && S.cfg.approval === 'manual' && !S.codexNoted) { S.codexNoted = true; add({ kind: 'sys', text: 'Codex cannot ask before shell or file actions in headless mode, so M only asks before scripts. The security mode still limits what it can touch.' }); }
  }
  function onEvent(ev) {
    if (ev.session_id) S.sessionId = ev.session_id;
    if (ev.type === 'system' && ev.subtype === 'init') {
      const servers = ev.mcp_servers || [];
      const eve = servers.find(s => s.name === 'eve');
      if (eve && eve.status !== 'connected') add({ kind: 'err', text: 'Eve could not reach her own tools (' + eve.status + ').' });
      persist();
    } else if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
      ev.message.content.forEach(b => {
        if (b.type === 'text' && b.text && b.text.trim()) { S.lastEve = b.text.trim().replace(/\s+/g, ' '); add({ kind: 'eve', text: b.text }); }
        else if (b.type === 'tool_use') {
          const inp = b.input || {};
          const isScript = /execute_script$/.test(b.name);
          const parts = b.name.split('__');
          const toolName = parts.length >= 3 ? parts.slice(2).join('__') : b.name;
          const server = parts.length >= 3 ? parts[1].replace(/^claude_ai_/, '') : '';
          const label = isScript ? (inp.label || 'script') : (server && server !== 'eve' ? server + ' · ' + toolName : toolName);
          const e = add({ kind: 'tool', id: b.id, label, code: isScript ? inp.code : (b.name.indexOf('mcp__eve__') === 0 ? '' : JSON.stringify(inp, null, 2)), status: 'running…' });
          setRunning(true, label);
        }
      });
    } else if (ev.type === 'user' && ev.message && Array.isArray(ev.message.content)) {
      ev.message.content.forEach(b => { if (b.type === 'tool_result') updateTool(b.tool_use_id, b.is_error ? 'failed' : 'done', b.is_error); });
    } else if (ev.type === 'result') {
      setRunning(false);
      ping(ev.is_error ? 'Hit a snag. Open the panel to see what happened.' : (S.lastEve ? S.lastEve.slice(0, 120) : 'Done. Ready for your next message.'));
      if (ev.is_error) add({ kind: 'err', text: 'Message could not be delivered: ' + (ev.result || ev.subtype || 'unknown error') });
      persist();
    }
  }
  function onExit(code, err) {
    const wasRunning = S.running;
    setRunning(false);
    if (S.agent && S.agent.alive === false && (wasRunning || code)) {
      const tail = String(err || '').trim().split('\n').slice(-3).join(' ');
      if (code && code !== 143) add({ kind: 'err', text: PNAME() + ' stopped (' + code + '). ' + (tail || ('Is it installed and signed in? Run “' + (PROV() === 'codex' ? 'codex login' : 'claude') + '” in a terminal once.')) });
    }
  }

  async function send() {
    if (S.running) { if (S.agent) S.agent.stop(); setRunning(false); add({ kind: 'sys', text: 'Stopped.' }); return; }
    const input = $('input'); const text = input.value.trim();
    if (!text && !S.atts.length) return;
    if (!S.claudePath) { add({ kind: 'err', text: PNAME() + ' was not found. Install it, or set its path in Settings.' }); return; }
    const info = await ae.json('eveProjectInfo()');
    S.aeOk = !!info.ok;
    if (!info.ok) { add({ kind: 'err', text: 'Could not read After Effects: ' + (info.message || 'no response') }); return; }
    if (!info.saved) { add({ kind: 'sys', text: 'Save your project first (File > Save). Eve needs a project folder for checkpoints and skills.' }); return; }
    S.project = info; $('title').textContent = NAME() + ' – ' + info.name;
    S.prefOk = (await ae.run('evePrefOk()')) === '1'; renderStrip();
    if (!S.prefOk && !S.prefWarned) { S.prefWarned = true; add({ kind: 'err', text: 'Turn on Settings > Scripting & Expressions > “Allow Scripts to Write Files and Access Network”, or Eve cannot see frames.' }); }

    const files = S.atts.slice(); S.atts = []; renderChips(); input.value = '';
    add({ kind: 'user', name: S.cfg.screenName || 'You', text, files: files.map(f => ({ path: f.path, name: f.name, image: f.image })) });
    if (S.title === 'New chat') { S.title = (text || files[0].name).slice(0, 48); }

    if (S.cfg.checkpoints) {
      const sv = await ae.json('eveSave()');
      if (sv.ok) {
        try { const cp = checkpoints.save(info.path); if (cp.ok) add({ kind: 'sys', text: 'Checkpoint saved.', link: { label: 'Restore checkpoint', cp } }); else add({ kind: 'sys', text: cp.message }); }
        catch (e) { add({ kind: 'sys', text: 'Checkpoint failed: ' + e.message }); }
      }
    }

    if (!sameAgent()) startAgent();
    state.fails = 0; S.lastEve = '';
    const blocks = [];
    files.filter(f => f.image).forEach(f => blocks.push({ type: 'image', source: { type: 'base64', media_type: f.mime, data: f.b64 } }));
    let msg = text || 'See the attached file(s).';
    if (S.pendingNote) { msg = S.pendingNote + '\n\n' + msg; S.pendingNote = ''; }
    if (files.length) msg += '\n\nAttached files:\n' + files.map(f => '- ' + f.path).join('\n');
    blocks.push({ type: 'text', text: msg });
    setRunning(true);
    if (!S.agent.send(blocks, { imagePaths: files.filter(f => f.image).map(f => f.path) })) { setRunning(false); add({ kind: 'err', text: 'Could not reach ' + PNAME() + '.' }); }
  }

  async function restore(cp) {
    if (S.cfg.confirmRestore) {
      const r = await dialog('Revert to checkpoint?', 'All changes made after this point will be undone. Eve will reopen the saved copy of the project.<br><br><label><input type="checkbox"> Don\'t ask again</label>', ['Cancel', 'Revert']);
      if (r.index !== 1) return;
      if (r.checked) { S.cfg.confirmRestore = false; saveCfg(); }
    }
    const res = await ae.json('eveRestore(' + lit(platform.fwd(cp.orig)) + ',' + lit(platform.fwd(cp.file)) + ')');
    if (res.ok) { add({ kind: 'sys', text: 'Project restored to checkpoint from ' + clock(cp.ts) + '.' }); S.pendingNote = '[Eve note: the project was reverted to an earlier checkpoint. Any edits you made after that point no longer exist. Re-inspect before continuing.]'; }
    else add({ kind: 'err', text: 'Restore failed: ' + (res.message || 'unknown') });
  }

  // ---------- chat management ----------
  function newChat(opts) {
    if (S.agent) S.agent.stop();
    S.agent = null; S.id = uid(); S.title = 'New chat'; S.entries = []; S.atts = []; S.toolEls = {}; renderChips(); setRunning(false);
    if (!opts || !opts.fork) { S.sessionId = null; S.sessionProvider = null; S.forkPending = false; }
    $('log').innerHTML = '';
    add({ kind: 'sys', text: NAME() + ' has entered the room.' });
    if (opts && opts.fork) { S.forkPending = true; add({ kind: 'sys', text: 'Branched from the previous conversation. Eve remembers it, your original stays untouched.' }); }
    show('chat');
  }
  function loadSession(s) {
    if (S.agent) S.agent.stop(); S.agent = null;
    S.id = s.id; S.title = s.title; S.entries = s.entries || []; S.sessionId = s.claudeSessionId; S.sessionProvider = s.provider || 'claude'; S.sessionCwd = s.cwd; S.forkPending = false;
    renderAll(); setRunning(false); show('chat'); scrollLog();
  }

  // ---------- buddies ----------
  async function renderBuddies() {
    const v = $('view-buddies'); scanSkills();
    const row = (d, name, sub, extra) => '<div class="row">' + dot(d) + '<div class="grow"><b>' + esc(name) + '</b><br><span class="sub">' + esc(sub) + '</span></div>' + (extra || '') + '</div>';
    const others = S.mcpServers.filter(s => s.name !== 'eve');
    const figma = others.find(s => /figma/i.test(s.name));
    let html = '<div class="pane"><div class="grp">' + esc(NAME()) + '</div>' + row('on', NAME(), S.running ? 'Busy…' : S.cfg.awayMessage) +
      '<div class="grp">Connections</div>' +
      row(S.claudePath ? 'on' : 'off', PNAME(), S.claudePath ? 'using your own login' : 'not found') +
      row(S.aeOk && S.mcpPort ? 'on' : 'off', 'After Effects', S.mcpPort ? NAME() + ' tools on port ' + S.mcpPort : 'tools offline') +
      (figma ? row(figma.status === 'online' ? 'on' : 'warn', 'Figma', figma.status === 'auth' ? 'needs sign-in' : figma.raw) + (figma.status !== 'online' ? '<button id="bd-term">Sign in</button>' : '')
             : row('off', 'Figma', 'not set up', '<button id="bd-figma">Connect</button>'));
    others.filter(s => s !== figma).forEach(s => { html += row(s.status === 'online' ? 'on' : (s.status === 'auth' ? 'warn' : 'off'), s.name, s.raw); });
    html += '<div style="margin-top:6px"><button id="bd-refresh">Refresh connections</button></div><div class="grp">Skills (' + S.skills.length + ')</div>';
    S.skills.forEach((s, i) => { html += '<div class="row"><div class="grow"><b>' + esc(s.name) + '</b> <span class="tag ' + (s.scope === 'PROJECT' ? 'proj' : '') + '">' + s.scope + '</span><br><span class="sub">' + esc(s.description) + '</span></div><button data-skill="' + i + '">Edit</button></div>'; });
    html += '<div style="margin-top:6px"><button id="bd-newskill">+ New skill</button></div>';
    html += '<div class="grp">Security mode</div>' + ['adobe|Adobe Only|no shell or file tools', 'project|Project Folder|default', 'full|Full Access|use with care'].map(x => { const p = x.split('|'); return '<label class="check"><input type="radio" name="mode" value="' + p[0] + '"' + (S.cfg.mode === p[0] ? ' checked' : '') + '> ' + p[1] + ' <span class="sub">' + p[2] + '</span></label>'; }).join('');
    html += '<div class="grp">My away message</div><div class="field"><input type="text" id="bd-away" value="' + esc(S.cfg.awayMessage) + '"></div></div>';
    v.innerHTML = html;
    v.querySelectorAll('input[name=mode]').forEach(r => r.onchange = () => { S.cfg.mode = r.value; saveCfg(); $('c-mode').value = r.value; });
    $('bd-away').onchange = e => { S.cfg.awayMessage = e.target.value; saveCfg(); };
    $('bd-refresh').onclick = refreshMcp;
    if ($('bd-figma')) $('bd-figma').onclick = connectFigma;
    if ($('bd-term')) $('bd-term').onclick = () => setup.openTerminal();
    $('bd-newskill').onclick = newSkill;
    v.querySelectorAll('button[data-skill]').forEach(b => b.onclick = () => platform.openPath(S.skills[+b.dataset.skill].file));
    renderStrip();
  }
  async function refreshMcp() {
    $('status-text').textContent = 'Checking connections…';
    S.mcpServers = await setup.listMcp(S.spec, Object.assign({}, process.env, { PATH: S.pathEnv }), PROV());
    $('status-text').textContent = ''; renderStrip(); if (S.view === 'buddies') renderBuddies();
  }
  async function connectFigma() {
    const r = await dialog('Connect Figma', 'Eve will register Figma’s remote MCP server with ' + PNAME() + '. ' + (PROV() === 'codex' ? 'Codex may open a browser to sign in. If it does not, Eve can open a terminal that runs <b>codex mcp login figma</b>.' : 'The first time you use it, sign in once from Terminal: open <b>claude</b>, type <b>/mcp</b>, choose figma and authenticate.'), ['Cancel', 'Connect']);
    if (r.index !== 1) return;
    const res = await setup.addFigma(S.spec, Object.assign({}, process.env, { PATH: S.pathEnv }), PROV());
    add({ kind: res.ok ? 'sys' : 'err', text: res.ok ? 'Figma added. Open Terminal to finish signing in.' : 'Figma setup failed: ' + res.out.slice(0, 200) });
    await refreshMcp();
    const t = await dialog('Sign in to Figma', 'Open Terminal now to finish signing in?', ['Later', 'Open Terminal']);
    if (t.index === 1) setup.openTerminal(PROV());
  }
  async function newSkill() {
    const r = await dialog('New skill', '<div class="field"><label for="ns-name">Name (letters, numbers, dashes)</label><input type="text" id="ns-name" data-key="name"></div><div class="field"><label for="ns-desc">When should Eve use it?</label><input type="text" id="ns-desc" data-key="desc"></div>', ['Cancel', 'Create']);
    if (r.index !== 1) return;
    const name = String(r.values.name || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!name) return;
    const desc = String(r.values.desc || '');
    const dir = path.join(os.homedir(), PROV() === 'codex' ? '.agents' : '.claude', 'skills', name);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, 'SKILL.md');
      if (!fs.existsSync(f)) fs.writeFileSync(f, '---\nname: ' + name + '\ndescription: ' + desc.replace(/\n/g, ' ') + '\n---\n\nDescribe the steps, rules and ExtendScript patterns here.\n');
      platform.openPath(f); renderBuddies();
    } catch (e) { add({ kind: 'err', text: 'Could not create skill: ' + e.message }); }
  }

  // ---------- history ----------
  function renderHistory() {
    const v = $('view-history'); const list = loadSessions();
    let html = '<div class="pane"><div class="grp">Past chats</div>';
    if (!list.length) html += '<div class="sub">Nothing here yet.</div>';
    list.forEach((s, i) => { html += '<div class="row"><div class="grow"><b>' + esc(s.title) + '</b><br><span class="sub">' + esc(s.project || '') + ' · ' + new Date(s.ts).toLocaleString() + '</span></div><button data-open="' + i + '">Open</button><button data-del="' + i + '" aria-label="Delete chat">x</button></div>'; });
    v.innerHTML = html + '</div>';
    v.querySelectorAll('[data-open]').forEach(b => b.onclick = () => loadSession(list[+b.dataset.open]));
    v.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { list.splice(+b.dataset.del, 1); fs.writeFileSync(SESS, JSON.stringify({ sessions: list })); renderHistory(); });
  }

  // ---------- settings ----------
  function renderSettings() {
    const c = S.cfg, v = $('view-settings');
    v.innerHTML = '<div class="pane">' +
      '<div class="grp">Look</div><div class="field"><label for="s-theme">Theme</label><select id="s-theme"><option value="light">Light</option><option value="dark">Dark</option></select></div>' +
      '<div class="field"><label for="s-ename">Assistant name</label><input type="text" id="s-ename" value="' + esc(c.eveName) + '"></div>' +
      '<div class="field"><label for="s-name">Your screen name</label><input type="text" id="s-name" value="' + esc(c.screenName) + '"></div>' +
      '<div class="grp">Behaviour</div>' +
      '<label class="check"><input type="checkbox" id="s-cp"' + (c.checkpoints ? ' checked' : '') + '> Save a checkpoint before every message</label>' +
      '<label class="check"><input type="checkbox" id="s-cr"' + (c.confirmRestore ? ' checked' : '') + '> Confirm before restoring a checkpoint</label>' +
      '<label class="check"><input type="checkbox" id="s-mcp"' + (c.useUserMcp ? ' checked' : '') + '> Also load my other MCP servers (Figma, etc.)</label>' +
      '<div class="field"><label for="s-inst">Custom instructions</label><textarea id="s-inst">' + esc(c.customInstructions) + '</textarea></div>' +
      '<div class="grp">Notifications</div>' +
      '<label class="check"><input type="checkbox" id="s-nt"' + (c.notify ? ' checked' : '') + '> Notify me when ' + esc(NAME()) + ' finishes or needs me</label>' +
      '<label class="check"><input type="checkbox" id="s-nb"' + (c.notifyBackground ? ' checked' : '') + '> Only when After Effects is in the background</label>' +
      '<label class="check"><input type="checkbox" id="s-ns"' + (c.notifySound ? ' checked' : '') + '> Play a sound</label>' +
      '<div style="margin:0 0 10px"><button id="s-ntest">Send test notification</button></div>' +
      '<div class="grp">Agent</div><div class="field"><label for="s-prov">Provider</label><select id="s-prov"><option value="claude">Claude Code</option><option value="codex">Codex</option></select><span class="sub">Runs the CLI you already have installed and signed in.</span></div>' +
      (PROV() === 'codex'
        ? '<div class="field"><label for="s-cpath">Path to codex</label><input type="text" id="s-cpath" placeholder="' + esc(S.claudePath || 'not found') + '" value="' + esc(c.codexPath) + '"><span class="sub">Detected: ' + esc(S.claudePath || 'nothing') + '</span></div><div class="field"><label for="s-cmodel">Codex model (optional)</label><input type="text" id="s-cmodel" placeholder="Codex default" value="' + esc(c.codexModel) + '"></div>'
        : '<div class="field"><label for="s-path">Path to claude</label><input type="text" id="s-path" placeholder="' + esc(S.claudePath || 'not found') + '" value="' + esc(c.claudePath) + '"><span class="sub">Detected: ' + esc(S.claudePath || 'nothing') + '</span></div>') +
      '<div><button id="s-data">Open data folder</button> <button id="s-reload">Reload panel</button></div><p class="sub">' + esc(NAME()) + ' v' + esc(VERSION || '?') + '</p></div>';
    $('s-theme').value = c.theme;
    $('s-theme').onchange = e => { c.theme = e.target.value; saveCfg(); applyTheme(); };
    $('s-ename').onchange = e => { c.eveName = e.target.value.trim() || 'Eve'; saveCfg(); renderAll(); $('title').textContent = S.project ? NAME() + ' – ' + S.project.name : NAME(); };
    $('s-name').onchange = e => { c.screenName = e.target.value || 'You'; saveCfg(); };
    $('s-cp').onchange = e => { c.checkpoints = e.target.checked; saveCfg(); };
    $('s-cr').onchange = e => { c.confirmRestore = e.target.checked; saveCfg(); };
    $('s-nt').onchange = e => { c.notify = e.target.checked; saveCfg(); };
    $('s-nb').onchange = e => { c.notifyBackground = e.target.checked; saveCfg(); };
    $('s-ns').onchange = e => { c.notifySound = e.target.checked; saveCfg(); };
    $('s-ntest').onclick = () => notify.send(c, NAME(), 'Test notification. This is how I will ping you.', true);
    $('s-mcp').onchange = e => { c.useUserMcp = e.target.checked; saveCfg(); if (S.agent) S.agent.stop(); };
    $('s-inst').onchange = e => { c.customInstructions = e.target.value; saveCfg(); if (S.agent) S.agent.stop(); };
    $('s-prov').value = PROV();
    $('s-prov').onchange = e => { c.provider = e.target.value; saveCfg(); selectProvider(); if (S.agent) S.agent.stop(); applyProviderUI(); scanSkills(); renderSettings(); renderStrip(); if (S.claudePath) refreshMcp(); };
    if ($('s-path')) $('s-path').onchange = async e => { c.claudePath = e.target.value.trim(); saveCfg(); const p = await shell.findClaude(c.claudePath); S.clis.claude = { path: p, spec: await shell.spawnSpec(p, 'claude') }; selectProvider(); renderSettings(); renderStrip(); };
    if ($('s-cpath')) $('s-cpath').onchange = async e => { c.codexPath = e.target.value.trim(); saveCfg(); const p = await shell.findCodex(c.codexPath); S.clis.codex = { path: p, spec: await shell.spawnSpec(p, 'codex') }; selectProvider(); renderSettings(); renderStrip(); };
    if ($('s-cmodel')) $('s-cmodel').onchange = e => { c.codexModel = e.target.value.trim(); saveCfg(); if (S.agent) S.agent.stop(); };
    $('s-reload').onclick = () => location.reload();
    $('s-data').onclick = () => platform.openPath(config.DIR);
  }

  // ---------- wiring ----------
  function wrap(a, b) {
    const t = $('input'), s = t.selectionStart, e = t.selectionEnd;
    t.value = t.value.slice(0, s) + a + t.value.slice(s, e) + b + t.value.slice(e);
    t.focus(); t.selectionStart = s + a.length; t.selectionEnd = e + a.length;
  }
  function syncApproval() {
    const m = S.cfg.approval === 'manual';
    $('c-auto').setAttribute('aria-pressed', String(!m)); $('c-man').setAttribute('aria-pressed', String(m));
  }
  function wireResize() {
    const inp = $('input'), split = $('split');
    inp.style.height = (S.cfg.inputHeight || 62) + 'px';
    const setH = h => { const max = Math.max(80, $('view-chat').offsetHeight - 260); const v = Math.max(40, Math.min(max, h)); inp.style.height = v + 'px'; S.cfg.inputHeight = v; };
    split.onmousedown = e => {
      e.preventDefault(); const y0 = e.clientY, h0 = inp.offsetHeight;
      const move = ev => setH(h0 + (y0 - ev.clientY));
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); saveCfg(); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    };
    split.ondblclick = () => { setH(62); saveCfg(); };
    split.onkeydown = e => { if (e.key === 'ArrowUp') { e.preventDefault(); setH(inp.offsetHeight + 16); saveCfg(); } if (e.key === 'ArrowDown') { e.preventDefault(); setH(inp.offsetHeight - 16); saveCfg(); } };
  }
  function wire() {
    wireResize();
    $('c-auto').onclick = () => { S.cfg.approval = 'auto'; saveCfg(); syncApproval(); };
    $('c-man').onclick = () => { S.cfg.approval = 'manual'; saveCfg(); syncApproval(); };
    syncApproval();
    $('b-new').onclick = () => newChat();
    $('b-history').onclick = () => show(S.view === 'history' ? 'chat' : 'history');
    $('b-buddies').onclick = () => show(S.view === 'buddies' ? 'chat' : 'buddies');
    $('b-settings').onclick = () => show(S.view === 'settings' ? 'chat' : 'settings');
    $('b-branch').onclick = () => { if (PROV() === 'codex') { add({ kind: 'sys', text: 'Branching is not available with Codex yet.' }); return; } if (!S.sessionId) { add({ kind: 'sys', text: 'Nothing to branch yet. Send a message first.' }); return; } newChat({ fork: true }); };
    $('b-send').onclick = send;
    $('f-b').onclick = () => wrap('**', '**'); $('f-i').onclick = () => wrap('*', '*'); $('f-u').onclick = () => wrap('__', '__');
    $('f-attach').onclick = () => $('filepick').click();
    $('filepick').onchange = e => { Array.from(e.target.files).forEach(addFile); e.target.value = ''; };
    $('f-skill').onchange = e => { if (e.target.value) { const t = $('input'); t.value = 'Use the "' + e.target.value + '" skill. ' + t.value; t.focus(); } e.target.value = ''; };
    $('c-model').value = S.cfg.model; applyProviderUI(); $('c-model').onchange = e => { S.cfg.model = e.target.value; saveCfg(); };
    $('c-mode').value = S.cfg.mode; $('c-mode').onchange = e => { S.cfg.mode = e.target.value; saveCfg(); };
    $('input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    $('input').addEventListener('paste', e => {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const it of items) { if (it.kind === 'file') { const f = it.getAsFile(); if (f) { e.preventDefault(); addFile(f); } } }
    });
    const comp = $('compose');
    ['dragenter', 'dragover'].forEach(n => comp.addEventListener(n, e => { e.preventDefault(); comp.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(n => comp.addEventListener(n, e => { e.preventDefault(); comp.classList.remove('drag'); }));
    comp.addEventListener('drop', e => { Array.from((e.dataTransfer && e.dataTransfer.files) || []).forEach(addFile); });
    try { cs.registerKeyEventsInterest(JSON.stringify([{ keyCode: 86, metaKey: true }, { keyCode: 67, metaKey: true }, { keyCode: 88, metaKey: true }, { keyCode: 65, metaKey: true }, { keyCode: 90, metaKey: true }])); } catch (e) {}
    window.addEventListener('beforeunload', () => { if (S.agent) S.agent.stop(); if (S.mcp) S.mcp.stop(); });
  }

  async function init() {
    applyTheme(); wire(); $('title').textContent = NAME();
    ae.run('$.evalFile(' + lit(path.join(EXT, 'host', 'eve.jsx')) + ')');
    add({ kind: 'sys', text: NAME() + ' has entered the room. (v' + (VERSION || '?') + ')' });
    S.pathEnv = await shell.loginPath();
    const cp = await shell.findClaude(S.cfg.claudePath), xp = await shell.findCodex(S.cfg.codexPath);
    S.clis.claude = { path: cp, spec: await shell.spawnSpec(cp, 'claude') };
    S.clis.codex = { path: xp, spec: await shell.spawnSpec(xp, 'codex') };
    selectProvider();
    if (!S.claudePath) add({ kind: 'err', text: PNAME() + ' was not found. Install it and ' + (PROV() === 'codex' ? 'run “codex login”' : 'run “claude” once to sign in') + ', or set the path in Settings.' });
    const tools = makeTools({
      ae, lit, state,
      ui: {
        manual: () => S.cfg.approval === 'manual',
        confirmScript: async i => {
          ping('Waiting for your OK to run a script.');
          const r = await dialog('Run this script?', '<b>' + esc(i.label) + '</b><pre>' + esc(String(i.code || '').slice(0, 2500)) + '</pre><label><input type="checkbox"> Switch to auto-accept (A)</label>', ['Decline', 'Run']);
          if (r.index === 1 && r.checked) { S.cfg.approval = 'auto'; saveCfg(); syncApproval(); }
          return r.index === 1;
        },
        onScript: i => { if (!i.ok) add({ kind: 'err', text: 'Message could not be delivered: ' + i.message + (i.line ? ' (line ' + i.line + ')' : '') + '. Eve is retrying (' + Math.min(i.attempt, 3) + '/3)…' }); },
        approve: async a => {
          if (S.cfg.approval !== 'manual') return true;
          ping('Waiting for your approval.');
          const body = '<b>Eve</b> would like to use <b>' + esc(a.tool_name) + '</b>:<pre>' + esc(JSON.stringify(a.input || {}, null, 2).slice(0, 1500)) + '</pre><span class="sub">ExtendScript can touch any file in every mode.</span>';
          const r = await dialog('Approve action', body, ['Decline', 'Accept']);
          return r.index === 1;
        }
      }
    });
    S.mcp = mcpMod.create(tools, config.DIR);
    try { const m = await S.mcp.start(); S.mcpPort = m.port; S.mcpFile = m.file; S.mcpUrl = m.url; S.mcpToken = m.token; }
    catch (e) { add({ kind: 'err', text: 'Eve’s tool server failed to start: ' + e.message }); }
    const info = await ae.json('eveProjectInfo()');
    S.aeOk = !!info.ok; if (info.ok && info.saved) { S.project = info; $('title').textContent = NAME() + ' – ' + info.name; }
    S.prefOk = (await ae.run('evePrefOk()')) === '1';
    scanSkills(); renderStrip();
    if (S.claudePath) refreshMcp();
  }
  init();
})();
