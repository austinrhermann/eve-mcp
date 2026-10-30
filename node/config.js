const fs = require('fs'), path = require('path');
const platform = require('./platform.js');
const DIR = platform.dataDir();
const FILE = path.join(DIR, 'config.json');
const DEFAULTS = {
  theme: 'light', model: 'sonnet', mode: 'project', checkpoints: true, useUserMcp: true,
  claudePath: '', customInstructions: '', screenName: 'You', awayMessage: 'brb, rendering. leave a message after the beep',
  confirmRestore: true, eveName: 'Eve', approval: 'auto', inputHeight: 62,
  notify: true, notifyBackground: true, notifySound: true,
  provider: 'claude', codexPath: '', codexModel: ''
};
function ensure() { fs.mkdirSync(DIR, { recursive: true }); }
function load() {
  ensure();
  try { return Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(FILE, 'utf8'))); }
  catch (e) { return Object.assign({}, DEFAULTS); }
}
function save(c) { ensure(); fs.writeFileSync(FILE, JSON.stringify(c, null, 2)); }
module.exports = { DIR, load, save, DEFAULTS };
