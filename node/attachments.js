const fs = require('fs'), path = require('path'), crypto = require('crypto');
const config = require('./config.js');
function dir(session) { const d = path.join(config.DIR, 'attachments', session || 'misc'); fs.mkdirSync(d, { recursive: true }); return d; }
function store(session, name, buffer) {
  const safe = String(name || 'file').replace(/[^\w.\-]+/g, '_');
  const file = path.join(dir(session), crypto.randomBytes(4).toString('hex') + '-' + safe);
  fs.writeFileSync(file, buffer);
  return file;
}
module.exports = { store };
