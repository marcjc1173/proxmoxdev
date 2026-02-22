import { randomUUID } from "node:crypto";

export interface ActivityAuditRecord {
  id: string;
  createdAt: string;
  actor: string;
  role: "viewer" | "operator" | "admin" | "anonymous";
  method: string;
  path: string;
  action: string;
  target: string;
  reason?: string;
  request: Record<string, unknown>;
  result: {
    success: boolean;
    statusCode: number;
    message?: string;
    upid?: string;
    steps?: number;
  };
}

const MAX_ACTIVITY_AUDIT = 500;
const activityAuditStore: ActivityAuditRecord[] = [];

export function recordActivityAudit(
  input: Omit<ActivityAuditRecord, "id" | "createdAt">
): ActivityAuditRecord {
  const record: ActivityAuditRecord = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...input
  };

  activityAuditStore.unshift(record);
  if (activityAuditStore.length > MAX_ACTIVITY_AUDIT) {
    activityAuditStore.length = MAX_ACTIVITY_AUDIT;
  }

  return record;
}

export function listActivityAudit(limit = 200): ActivityAuditRecord[] {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 200;
  return activityAuditStore.slice(0, safeLimit);
}
