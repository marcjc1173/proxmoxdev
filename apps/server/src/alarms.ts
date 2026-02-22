import { config } from "./config.js";
import { proxmoxClient } from "./proxmoxClient.js";
import { sendAlarmNotification } from "./alarmNotifier.js";

export type AlarmSeverity = "warning" | "critical";
export type AlarmState = "active" | "acknowledged" | "silenced" | "resolved";

export interface AlarmRecord {
  id: string;
  key: string;
  category: "node" | "storage" | "task";
  severity: AlarmSeverity;
  state: AlarmState;
  source: string;
  message: string;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt?: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  silencedUntil?: string;
  lastValue?: number;
  notifiedCriticalAt?: string;
}

const alarmMap = new Map<string, AlarmRecord>();

function nowIso() {
  return new Date().toISOString();
}

function toPercent(part: unknown, total: unknown): number | undefined {
  const numerator = Number(part);
  const denominator = Number(total);

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return undefined;
  }

  return (numerator / denominator) * 100;
}

async function upsertTriggered(input: {
  key: string;
  category: AlarmRecord["category"];
  severity: AlarmSeverity;
  source: string;
  message: string;
  lastValue?: number;
}) {
  const existing = alarmMap.get(input.key);
  const currentTime = nowIso();
  let shouldNotifyCritical = false;

  if (!existing) {
    const created: AlarmRecord = {
      id: input.key,
      key: input.key,
      category: input.category,
      severity: input.severity,
      state: "active",
      source: input.source,
      message: input.message,
      firstSeenAt: currentTime,
      lastSeenAt: currentTime,
      lastValue: input.lastValue
    };

    alarmMap.set(input.key, created);
    shouldNotifyCritical = input.severity === "critical";

    if (shouldNotifyCritical) {
      try {
        await sendAlarmNotification(created);
        created.notifiedCriticalAt = nowIso();
      } catch (error) {
        console.error("Failed to send critical alarm notification", error);
      }
    }

    return;
  }

  const previousSeverity = existing.severity;

  const isSilenced =
    existing.state === "silenced" &&
    existing.silencedUntil != null &&
    new Date(existing.silencedUntil).getTime() > Date.now();

  existing.severity = input.severity;
  existing.source = input.source;
  existing.message = input.message;
  existing.lastSeenAt = currentTime;
  existing.lastValue = input.lastValue;
  existing.resolvedAt = undefined;

  if (isSilenced) {
    existing.state = "silenced";
  } else if (existing.state !== "acknowledged") {
    existing.state = "active";
  }

  shouldNotifyCritical = input.severity === "critical" && previousSeverity !== "critical";

  if (shouldNotifyCritical) {
    try {
      await sendAlarmNotification(existing);
      existing.notifiedCriticalAt = nowIso();
    } catch (error) {
      console.error("Failed to send critical alarm notification", error);
    }
  }
}

function resolveMissing(triggeredKeys: Set<string>) {
  const currentTime = nowIso();

  for (const [key, alarm] of alarmMap.entries()) {
    if (triggeredKeys.has(key)) {
      continue;
    }

    if (alarm.state === "resolved") {
      continue;
    }

    alarm.state = "resolved";
    alarm.resolvedAt = currentTime;
    alarm.lastSeenAt = currentTime;
    alarm.silencedUntil = undefined;
  }
}

async function evaluateOverview(overview: Awaited<ReturnType<typeof proxmoxClient.getOverview>>) {
  const triggeredKeys = new Set<string>();

  for (const node of overview.nodes) {
    const nodeName = String(node.node ?? "unknown");
    const status = String(node.status ?? "unknown");

    if (status !== "online") {
      const key = `node:${nodeName}:status`;
      triggeredKeys.add(key);
      await upsertTriggered({
        key,
        category: "node",
        severity: "critical",
        source: `Node ${nodeName}`,
        message: `Node status is ${status}`
      });
    }

    const cpu = Number(node.cpu ?? 0) * 100;
    if (Number.isFinite(cpu) && cpu >= config.alarms.cpuWarnPercent) {
      const key = `node:${nodeName}:cpu`;
      triggeredKeys.add(key);
      await upsertTriggered({
        key,
        category: "node",
        severity: cpu >= 95 ? "critical" : "warning",
        source: `Node ${nodeName}`,
        message: `CPU usage ${cpu.toFixed(1)}% exceeds threshold ${config.alarms.cpuWarnPercent}%`,
        lastValue: Number(cpu.toFixed(1))
      });
    }

    const memPercent = toPercent(node.mem, node.maxmem);

    if (memPercent != null && memPercent >= config.alarms.memWarnPercent) {
      const key = `node:${nodeName}:mem`;
      triggeredKeys.add(key);
      await upsertTriggered({
        key,
        category: "node",
        severity: memPercent >= 97 ? "critical" : "warning",
        source: `Node ${nodeName}`,
        message: `Memory usage ${memPercent.toFixed(1)}% exceeds threshold ${config.alarms.memWarnPercent}%`,
        lastValue: Number(memPercent.toFixed(1))
      });
    }

    const diskPercent = toPercent(node.disk, node.maxdisk);

    if (diskPercent != null && diskPercent >= config.alarms.diskWarnPercent) {
      const key = `node:${nodeName}:disk`;
      triggeredKeys.add(key);
      await upsertTriggered({
        key,
        category: "node",
        severity: diskPercent >= 97 ? "critical" : "warning",
        source: `Node ${nodeName}`,
        message: `Disk usage ${diskPercent.toFixed(1)}% exceeds threshold ${config.alarms.diskWarnPercent}%`,
        lastValue: Number(diskPercent.toFixed(1))
      });
    }
  }

  for (const storage of overview.storage) {
    const storageName = String(storage.storage ?? "unknown");
    const nodeName = String(storage.node ?? "unknown");
    const usedPercent = toPercent(storage.used, storage.total);

    if (usedPercent != null && usedPercent >= config.alarms.storageWarnPercent) {
      const key = `storage:${nodeName}:${storageName}:usage`;
      triggeredKeys.add(key);
      await upsertTriggered({
        key,
        category: "storage",
        severity: usedPercent >= 97 ? "critical" : "warning",
        source: `Storage ${storageName}@${nodeName}`,
        message: `Storage usage ${usedPercent.toFixed(1)}% exceeds threshold ${config.alarms.storageWarnPercent}%`,
        lastValue: Number(usedPercent.toFixed(1))
      });
    }
  }

  for (const task of overview.tasks) {
    const taskStatus = String(task.status ?? "");
    if (!taskStatus || taskStatus === "OK" || taskStatus === "running") {
      continue;
    }

    const upid = String(task.upid ?? task.id ?? "unknown");
    const key = `task:${upid}`;
    triggeredKeys.add(key);
    await upsertTriggered({
      key,
      category: "task",
      severity: "warning",
      source: `Task ${String(task.type ?? "unknown")}`,
      message: `Task status is ${taskStatus}`
    });
  }

  resolveMissing(triggeredKeys);
}

export async function evaluateAlarms() {
  try {
    const overview = await proxmoxClient.getOverview();
    await evaluateOverview(overview);
  } catch (error) {
    await upsertTriggered({
      key: "system:evaluator",
      category: "node",
      severity: "critical",
      source: "Alarm Evaluator",
      message: error instanceof Error ? error.message : "Failed to evaluate alarms"
    });
  }
}

export function listAlarms() {
  return [...alarmMap.values()].sort((a, b) =>
    new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
  );
}

export function acknowledgeAlarm(id: string, username: string) {
  const alarm = alarmMap.get(id);
  if (!alarm) {
    throw new Error("Alarm not found");
  }

  alarm.state = "acknowledged";
  alarm.acknowledgedBy = username;
  alarm.acknowledgedAt = nowIso();
  alarm.silencedUntil = undefined;
}

export function silenceAlarm(id: string, username: string, minutes: number) {
  const alarm = alarmMap.get(id);
  if (!alarm) {
    throw new Error("Alarm not found");
  }

  const clampedMinutes = Math.max(1, Math.min(minutes, 1440));
  const until = new Date(Date.now() + clampedMinutes * 60_000).toISOString();

  alarm.state = "silenced";
  alarm.acknowledgedBy = username;
  alarm.acknowledgedAt = nowIso();
  alarm.silencedUntil = until;
}
