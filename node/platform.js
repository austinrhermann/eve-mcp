// OS helpers so the rest of Eve does not care whether it runs on macOS or Windows.
const os = require('os'), path = require('path');
const { execFile } = require('child_process');
const isWin = process.platform === 'win32', isMac = process.platform === 'darwin';

function dataDir() {
  if (isWin) return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'eve');
  if (isMac) return path.join(os.homedir(), 'Library', 'Application Support', 'eve');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'eve');
}
function openPath(p) {
  if (isMac) execFile('open', [p]);
  else if (isWin) execFile('explorer.exe', [p], { windowsHide: true });
  else execFile('xdg-open', [p]);
}
function fwd(p) { return String(p).replace(/\\/g, '/'); }
function fileUrl(p) { const f = fwd(p); return 'file://' + (f.charAt(0) === '/' ? '' : '/') + encodeURI(f); }
function openTerminalRunning(cmd) {
  if (isMac) execFile('osascript', ['-e', 'tell application "Terminal" to activate', '-e', 'tell application "Terminal" to do script "' + cmd + '"']);
  else if (isWin) execFile('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', cmd], { windowsHide: false });
}
module.exports = { isWin, isMac, dataDir, openPath, fwd, fileUrl, openTerminalRunning };
