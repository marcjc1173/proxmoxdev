import { config } from "./config.js";
import type { AlarmRecord } from "./alarms.js";

export interface NotificationAuditRecord {
  id: string;
  alarmId: string;
  severity: AlarmRecord["severity"];
  source: string;
  attempt: number;
  maxAttempts: number;
  success: boolean;
  provider: "generic" | "slack" | "teams";
  responseStatus?: number;
  error?: string;
  createdAt: string;
}

const notificationAudit: NotificationAuditRecord[] = [];

function pushAudit(record: NotificationAuditRecord) {
  notificationAudit.unshift(record);
  const limit = Math.max(10, config.alarms.webhookAuditLimit || 200);
  if (notificationAudit.length > limit) {
    notificationAudit.length = limit;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextDelay(baseMs: number, attempt: number) {
  return Math.max(100, baseMs) * 2 ** Math.max(0, attempt - 1);
}

function buildPayload(alarm: AlarmRecord) {
  const title = `Proxmox Alarm: ${alarm.severity.toUpperCase()} - ${alarm.source}`;
  const body = `${alarm.message}\nState: ${alarm.state}\nCategory: ${alarm.category}\nSeen: ${alarm.lastSeenAt}`;

  if (config.alarms.webhookProvider === "slack") {
    return {
      text: `*${title}*\n${body}`
    };
  }

  if (config.alarms.webhookProvider === "teams") {
    return {
      "@type": "MessageCard",
      "@context": "https://schema.org/extensions",
      summary: title,
      themeColor: alarm.severity === "critical" ? "FF0000" : "FFA500",
      title,
      text: body.replace(/\n/g, "<br/>")
    };
  }

  return {
    event: "alarm.critical",
    alarm
  };
}

export async function sendAlarmNotification(alarm: AlarmRecord) {
  if (!config.alarms.webhookEnabled || !config.alarms.webhookUrl) {
    return;
  }

  const payload = buildPayload(alarm);

  const maxAttempts = Math.max(1, config.alarms.webhookRetryMax || 3);
  const backoffMs = Math.max(100, config.alarms.webhookRetryBackoffMs || 1000);
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(config.alarms.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const error = new Error(`Webhook notification failed (${response.status}): ${text}`);

        pushAudit({
          id: `${Date.now()}-${alarm.id}-${attempt}`,
          alarmId: alarm.id,
          severity: alarm.severity,
          source: alarm.source,
          attempt,
          maxAttempts,
          success: false,
          provider: config.alarms.webhookProvider,
          responseStatus: response.status,
          error: error.message,
          createdAt: new Date().toISOString()
        });

        lastError = error;
      } else {
        pushAudit({
          id: `${Date.now()}-${alarm.id}-${attempt}`,
          alarmId: alarm.id,
          severity: alarm.severity,
          source: alarm.source,
          attempt,
          maxAttempts,
          success: true,
          provider: config.alarms.webhookProvider,
          responseStatus: response.status,
          createdAt: new Date().toISOString()
        });

        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown webhook error";
      lastError = error instanceof Error ? error : new Error(message);

      pushAudit({
        id: `${Date.now()}-${alarm.id}-${attempt}`,
        alarmId: alarm.id,
        severity: alarm.severity,
        source: alarm.source,
        attempt,
        maxAttempts,
        success: false,
        provider: config.alarms.webhookProvider,
        error: message,
        createdAt: new Date().toISOString()
      });
    }

    if (attempt < maxAttempts) {
      await sleep(nextDelay(backoffMs, attempt));
    }
  }

  if (lastError) {
    throw lastError;
  }
}

export function listNotificationAudit() {
  return [...notificationAudit];
}
