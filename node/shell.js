// Finds the user's PATH and the claude binary on macOS and Windows.
const { execFile } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const P = require('./platform.js');

function zsh(cmd) {
  return new Promise(resolve => {
    execFile('/bin/zsh', ['-lic', cmd], { timeout: 10000, encoding: 'utf8' }, (err, out) => {
      if (err) return resolve('');
      resolve(String(out).trim().split('\n').pop().trim());
    });
  });
}
function whereAll(name) {
  return new Promise(resolve => {
    execFile('where', [name], { timeout: 8000, encoding: 'utf8', windowsHide: true }, (err, out) => {
      resolve(err ? [] : String(out).split(/\r?\n/).map(s => s.trim()).filter(Boolean));
    });
  });
}
async function which(name) {
  if (P.isWin) {
    const all = (await whereAll(name)).filter(f => fs.existsSync(f));
    return all.find(f => /\.exe$/i.test(f)) || all[0] || '';
  }
  const f = await zsh('command -v ' + name);
  return f && fs.existsSync(f) ? f : '';
}
async function loginPath() {
  if (P.isWin) return process.env.PATH || process.env.Path || '';
  return (await zsh('echo -n $PATH')) || process.env.PATH || '';
}
async function findCli(name, configured) {
  if (configured && fs.existsSync(configured)) return configured;
  const found = await which(name);
  if (found) return found;
  const home = os.homedir();
  const spots = P.isWin
    ? [path.join(home, '.local', 'bin', name + '.exe'), path.join(home, '.' + name, 'local', name + '.exe'), path.join(process.env.APPDATA || '', 'npm', name + '.cmd')]
    : [path.join(home, '.' + name, 'local', name), path.join(home, '.local', 'bin', name), '/opt/homebrew/bin/' + name, '/usr/local/bin/' + name];
  for (const s of spots) if (s && fs.existsSync(s)) return s;
  return '';
}
const findClaude = c => findCli('claude', c);
const findCodex = c => findCli('codex', c);
// How to launch it. Windows npm installs are .cmd shims, which cannot take our long arguments safely,
// so run the real cli.js with node when we can find it.
const SHIMS = { claude: ['@anthropic-ai', 'claude-code', 'cli.js'], codex: ['@openai', 'codex', 'bin', 'codex.js'] };
async function spawnSpec(claudePath, which_) {
  if (!P.isWin || !/\.(cmd|bat)$/i.test(claudePath || '')) return { cmd: claudePath, pre: [], shell: false };
  const cli = path.join.apply(path, [path.dirname(claudePath), 'node_modules'].concat(SHIMS[which_ || 'claude']));
  if (fs.existsSync(cli)) { const node = await which('node'); if (node) return { cmd: node, pre: [cli], shell: false }; }
  return { cmd: claudePath, pre: [], shell: true };
}
module.exports = { loginPath, findClaude, findCodex, spawnSpec, which };
