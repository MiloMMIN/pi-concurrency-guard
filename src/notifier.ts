import { exec } from 'node:child_process';
import os from 'node:os';

/**
 * 跨平台系统级通知与蜂鸣提醒
 */
export function sendAlertNotification(title: string, message: string): void {
  const platform = os.platform();

  if (platform === 'win32') {
    // Windows: 原生 WinRT XML Toast 通知 + 系统蜂鸣音
    const safeTitle = title.replace(/["'`$\\]/g, '');
    const safeMsg = message.replace(/["'`$\\]/g, '');
    const psScript = `
      [System.Console]::Beep(1000, 350)
      try {
        $xml = @"
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>${safeTitle}</text>
      <text>${safeMsg}</text>
    </binding>
  </visual>
</toast>
"@
        $doc = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlCommands, ContentType = WindowsRuntime]::new()
        $doc.LoadXml($xml)
        $toast = [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]::new($doc)
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]::CreateToastNotifier("Pi Concurrency Guard").Show($toast)
      } catch {}
    `.trim();

    exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/\r?\n/g, ' ')}"`, () => {});
  } else if (platform === 'darwin') {
    // macOS: osascript 通知
    const safeTitle = title.replace(/"/g, '\\"');
    const safeMsg = message.replace(/"/g, '\\"');
    exec(`osascript -e 'display notification "${safeMsg}" with title "${safeTitle}" sound name "Glass"'`, () => {});
  } else {
    // Linux
    exec(`notify-send "${title}" "${message}"`, () => {});
    process.stdout.write('\x07');
  }
}
