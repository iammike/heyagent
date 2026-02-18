import process from 'process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Logger from '../logger.js';
import { NOTIFY_TITLE_CLAUDE, NOTIFY_MSG_CLAUDE_DONE } from '../constants.js';

import Config from '../config.js';
import NotificationService from '../notification.js';
import { writeNotificationEvent } from '../notification-event.js';

// Cooldown state file for cross-process throttling
const COOLDOWN_FILE = path.join(os.homedir(), '.heyagent', 'cooldown.json');

class HookHandler {
  constructor() {
    this.logger = new Logger('hook');
  }

  getNotificationService() {
    const config = new Config();
    return new NotificationService(config);
  }

  getConfig() {
    return new Config();
  }

  async readInput() {
    let input = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      input += chunk;
    }
    return input;
  }

  /**
   * Extract a short project name from the cwd for logging.
   * e.g. "/Users/me/Git/iosui-argo" -> "iosui-argo"
   */
  getProjectName(cwd) {
    if (!cwd) return 'unknown';
    return path.basename(cwd);
  }

  /**
   * Load cooldown state from disk.
   * Format: { [sessionId]: { lastNotifyTime: number, lastEventType: string } }
   */
  loadCooldownState() {
    try {
      if (fs.existsSync(COOLDOWN_FILE)) {
        return JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf8'));
      }
    } catch {
      // Corrupted file, start fresh
    }
    return {};
  }

  /**
   * Save cooldown state to disk.
   */
  saveCooldownState(state) {
    try {
      const dir = path.dirname(COOLDOWN_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(state, null, 2));
    } catch {
      // Best effort
    }
  }

  /**
   * Check if a notification should be throttled for this session.
   * Returns { throttled: boolean, reason: string }
   */
  checkThrottle(sessionId, eventType, cooldownMs) {
    if (!cooldownMs || cooldownMs <= 0) {
      return { throttled: false, reason: 'throttling disabled' };
    }

    const state = this.loadCooldownState();
    const now = Date.now();

    // Clean up entries older than 10 minutes
    for (const [key, entry] of Object.entries(state)) {
      if (now - entry.lastNotifyTime > 600000) {
        delete state[key];
      }
    }

    const sessionState = state[sessionId];
    if (sessionState) {
      const elapsed = now - sessionState.lastNotifyTime;
      if (elapsed < cooldownMs) {
        this.saveCooldownState(state);
        return {
          throttled: true,
          reason: `throttled (${Math.round(elapsed / 1000)}s since last, cooldown=${Math.round(cooldownMs / 1000)}s)`,
        };
      }
    }

    // Record this notification
    state[sessionId] = { lastNotifyTime: now, lastEventType: eventType };
    this.saveCooldownState(state);
    return { throttled: false, reason: 'not throttled' };
  }

  async handleHook() {
    const input = await this.readInput();

    const hookData = JSON.parse(input.trim());

    const eventType = hookData.hook_event_name;
    const message = hookData.message;
    const sessionId = hookData.session_id || 'unknown';
    const notificationType = hookData.notification_type || null;
    const stopHookActive = hookData.stop_hook_active;
    const cwd = hookData.cwd || '';
    const project = this.getProjectName(cwd);
    const shortSession = sessionId.slice(0, 8);

    // Structured debug log
    this.logger.info(
      `[${project}] [${shortSession}] event=${eventType}` +
        (notificationType ? ` type=${notificationType}` : '') +
        (stopHookActive !== undefined ? ` stop_active=${stopHookActive}` : '') +
        (message ? ` msg="${message}"` : ''),
    );

    const config = this.getConfig();
    const notificationService = new NotificationService(config);

    // Read notification preferences
    const suppressStop = config.get('suppressStopNotifications') || false;
    const cooldownMs = config.get('notificationCooldownMs') || 0;

    let title = NOTIFY_TITLE_CLAUDE;
    let body = message;
    let shouldNotify = true;
    let suppressReason = null;

    if (eventType === 'Stop') {
      body = NOTIFY_MSG_CLAUDE_DONE;

      if (suppressStop) {
        shouldNotify = false;
        suppressReason = 'suppressStopNotifications=true';
      }
    } else if (eventType === 'Notification') {
      // permission_prompt and idle_prompt both come through here
      body = message;
    } else {
      this.logger.info(`[${project}] [${shortSession}] unknown event type: ${eventType}`);
      return;
    }

    // Apply throttling
    if (shouldNotify && cooldownMs > 0) {
      const throttle = this.checkThrottle(sessionId, eventType, cooldownMs);
      if (throttle.throttled) {
        shouldNotify = false;
        suppressReason = throttle.reason;
      }
    }

    // Log the decision
    if (shouldNotify) {
      this.logger.info(`[${project}] [${shortSession}] NOTIFY: "${body}"`);
      writeNotificationEvent({ project, sessionId: shortSession, message: body });
      await notificationService.send(title, body, project);
    } else {
      this.logger.info(`[${project}] [${shortSession}] SUPPRESSED: "${body}" reason=${suppressReason}`);
    }
  }
}

export default HookHandler;
