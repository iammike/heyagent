import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const EVENT_FILE = path.join(os.homedir(), '.heyagent', 'last-notification.json');

/**
 * Get the TTY of the current process by walking up the process tree.
 * Hook subprocesses have piped stdio, so we check ancestors until we
 * find one with a real TTY (the shell session in the iTerm tab).
 * Returns a path like "/dev/ttys003" or null.
 */
function getTty() {
  // Walk up the process tree collecting TTYs. Claude Code creates its
  // own PTY, so the first TTY we hit is Claude's, not the iTerm tab's.
  // We want the outermost (last) TTY, which belongs to the tab's shell.
  let pid = process.pid;
  let lastTty = null;
  for (let i = 0; i < 10; i++) {
    try {
      const result = execSync(`ps -o tty= -p ${pid}`, { encoding: 'utf8' }).trim();
      if (result && result !== '??' && result !== '') {
        lastTty = `/dev/${result}`;
      }
      const ppid = execSync(`ps -o ppid= -p ${pid}`, { encoding: 'utf8' }).trim();
      if (!ppid || ppid === '0' || ppid === '1' || ppid === pid.toString()) break;
      pid = parseInt(ppid, 10);
      if (isNaN(pid)) break;
    } catch {
      break;
    }
  }
  return lastTty;
}

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
        tty: getTty(),
        message,
        timestamp: Date.now(),
      }),
    );
  } catch {
    // Best effort - don't block notifications
  }
}
