const fs = require('fs'), path = require('path');
const MAX_MB = 600;
function dirFor(proj) { return path.join(path.dirname(proj), '.eve', 'checkpoints'); }
function save(proj) {
  const size = fs.statSync(proj).size / 1048576;
  if (size > MAX_MB) return { ok: false, message: 'Project is ' + Math.round(size) + ' MB, checkpoint skipped.' };
  const d = dirFor(proj);
  fs.mkdirSync(d, { recursive: true });
  const id = Date.now().toString(36);
  const file = path.join(d, id + '.aep');
  fs.copyFileSync(proj, file);
  prune(proj, 30);
  return { ok: true, id, file, orig: proj, ts: Date.now() };
}
function prune(proj, keep) {
  const d = dirFor(proj);
  try {
    const files = fs.readdirSync(d).filter(f => f.endsWith('.aep')).map(f => ({ f, t: fs.statSync(path.join(d, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    files.slice(keep).forEach(x => fs.unlinkSync(path.join(d, x.f)));
  } catch (e) {}
}
module.exports = { save };
