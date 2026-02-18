import fs from 'fs';
import path from 'path';
import os from 'os';

const EVENT_FILE = path.join(os.homedir(), '.heyagent', 'last-notification.json');

/**
 * Write a notification event file before sending a notification.
 * External tools can read ~/.heyagent/last-notification.json to
 * identify which project triggered the most recent notification.
 * Written synchronously so it's available before the notification fires.
 */
export function writeNotificationEvent({ project, sessionId, message }) {
  try {
    const dir = path.dirname(EVENT_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      EVENT_FILE,
      JSON.stringify({
        project,
        sessionId: sessionId || null,
        message,
        timestamp: Date.now(),
      }),
    );
  } catch {
    // Best effort - don't block notifications
  }
}
