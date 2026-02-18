import process from 'process';
import path from 'path';
import Logger from '../logger.js';
import { NOTIFY_TITLE_CLAUDE, NOTIFY_MSG_CLAUDE_DONE } from '../constants.js';

import Config from '../config.js';
import NotificationService from '../notification.js';
import { writeNotificationEvent } from '../notification-event.js';

class HookHandler {
  constructor() {
    this.logger = new Logger('hook');
  }

  getNotificationService() {
    const config = new Config();
    return new NotificationService(config);
  }

  async readInput() {
    let input = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      input += chunk;
    }
    return input;
  }

  async handleHook() {
    const input = await this.readInput();
    this.logger.info(`Claude hook input received: ${input}`);

    const hookData = JSON.parse(input.trim());

    const eventType = hookData.hook_event_name;
    const message = hookData.message;
    const cwd = hookData.cwd || '';
    const project = cwd ? path.basename(cwd) : 'unknown';
    const sessionId = hookData.session_id || 'unknown';
    const shortSession = sessionId.slice(0, 8);

    const notificationService = this.getNotificationService();

    let body;
    if (eventType === 'Stop') {
      body = NOTIFY_MSG_CLAUDE_DONE;
    } else if (eventType === 'Notification') {
      body = message;
    } else {
      this.logger.info(`Unknown event type: ${eventType}`);
      return;
    }

    writeNotificationEvent({ project, sessionId: shortSession, message: body });
    await notificationService.send(NOTIFY_TITLE_CLAUDE, body, project);
  }
}

export default HookHandler;
