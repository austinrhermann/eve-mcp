// Desktop notification + sound when Eve needs the user, only if After Effects is in the background (optional).
const { execFile } = require('child_process');
const P = require('./platform.js');

function frontIsAE() {
  return new Promise(resolve => {
    if (P.isMac) {
      execFile('/bin/sh', ['-c', 'lsappinfo info -only name "$(lsappinfo front)"'], { timeout: 3000, encoding: 'utf8' },
        (e, out) => resolve(!e && /after\s?effects/i.test(String(out))));
    } else if (P.isWin) {
      const ps = 'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public class EveW{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern int GetWindowThreadProcessId(IntPtr h,out int p);}\';' +
        '$h=[EveW]::GetForegroundWindow();$p=0;[void][EveW]::GetWindowThreadProcessId($h,[ref]$p);(Get-Process -Id $p).ProcessName';
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 6000, encoding: 'utf8', windowsHide: true },
        (e, out) => resolve(!e && /afterfx|after\s?effects/i.test(String(out))));
    } else resolve(false);
  });
}

function toast(title, body) {
  if (P.isMac) {
    execFile('osascript', ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', title, body]);
  } else if (P.isWin) {
    const ps = "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;" +
      "$x=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);" +
      "$n=$x.GetElementsByTagName('text');[void]$n.Item(0).AppendChild($x.CreateTextNode($env:EVE_T));[void]$n.Item(1).AppendChild($x.CreateTextNode($env:EVE_B));" +
      "$t=[Windows.UI.Notifications.ToastNotification]::new($x);" +
      "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($t)";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { env: Object.assign({}, process.env, { EVE_T: title, EVE_B: body }), windowsHide: true });
  }
}
function sound() {
  if (P.isMac) execFile('afplay', ['/System/Library/Sounds/Glass.aiff']);
  else if (P.isWin) execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Media.SystemSounds]::Asterisk.Play();Start-Sleep -Milliseconds 900'], { windowsHide: true });
}
async function send(cfg, title, body, force) {
  try {
    if (!force) {
      if (!cfg.notify) return;
      if (cfg.notifyBackground && await frontIsAE()) return;
    }
    toast(title, String(body).slice(0, 180));
    if (cfg.notifySound) sound();
  } catch (e) {}
}
module.exports = { send };
