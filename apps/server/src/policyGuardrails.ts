import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppRole } from "./auth.js";

export interface PolicyGuardrails {
  enabled: boolean;
  maintenanceWindowEnabled: boolean;
  maintenanceStartHourUtc: number;
  maintenanceEndHourUtc: number;
  protectedVmids: number[];
  protectedNames: string[];
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const policyFilePath = path.resolve(currentDir, "../data/policy-guardrails.json");

const defaultPolicy: PolicyGuardrails = {
  enabled: false,
  maintenanceWindowEnabled: false,
  maintenanceStartHourUtc: 0,
  maintenanceEndHourUtc: 6,
  protectedVmids: [],
  protectedNames: []
};

let policyState: PolicyGuardrails = { ...defaultPolicy };

function normalizePolicy(input: Partial<PolicyGuardrails>): PolicyGuardrails {
  const startRaw = Number(input.maintenanceStartHourUtc);
  const endRaw = Number(input.maintenanceEndHourUtc);

  const start = Number.isFinite(startRaw) ? Math.max(0, Math.min(23, Math.floor(startRaw))) : 0;
  const end = Number.isFinite(endRaw) ? Math.max(0, Math.min(23, Math.floor(endRaw))) : 6;

  const protectedVmids = Array.isArray(input.protectedVmids)
    ? [...new Set(input.protectedVmids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))]
    : [];

  const protectedNames = Array.isArray(input.protectedNames)
    ? [...new Set(input.protectedNames.map((value) => String(value).trim()).filter((value) => value.length > 0))]
    : [];

  return {
    enabled: input.enabled === true,
    maintenanceWindowEnabled: input.maintenanceWindowEnabled === true,
    maintenanceStartHourUtc: start,
    maintenanceEndHourUtc: end,
    protectedVmids,
    protectedNames
  };
}

async function persistPolicy(): Promise<void> {
  const directory = path.dirname(policyFilePath);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(policyFilePath, JSON.stringify(policyState, null, 2), "utf-8");
}

function isWithinMaintenanceWindow(date: Date, startHourUtc: number, endHourUtc: number): boolean {
  const hour = date.getUTCHours();
  if (startHourUtc === endHourUtc) {
    return true;
  }

  if (startHourUtc < endHourUtc) {
    return hour >= startHourUtc && hour < endHourUtc;
  }

  return hour >= startHourUtc || hour < endHourUtc;
}

export async function initPolicyGuardrailsStore(): Promise<void> {
  try {
    const existing = await fs.readFile(policyFilePath, "utf-8");
    const parsed = JSON.parse(existing) as Partial<PolicyGuardrails>;
    policyState = normalizePolicy(parsed);
  } catch {
    policyState = { ...defaultPolicy };
    await persistPolicy();
  }
}

export function getPolicyGuardrails(): PolicyGuardrails {
  return {
    ...policyState,
    protectedVmids: [...policyState.protectedVmids],
    protectedNames: [...policyState.protectedNames]
  };
}

export async function updatePolicyGuardrails(input: Partial<PolicyGuardrails>): Promise<PolicyGuardrails> {
  policyState = normalizePolicy({
    ...policyState,
    ...input,
    protectedVmids: input.protectedVmids ?? policyState.protectedVmids,
    protectedNames: input.protectedNames ?? policyState.protectedNames
  });

  await persistPolicy();
  return getPolicyGuardrails();
}

export function evaluatePolicyGuardrails(input: {
  action: string;
  vmid: number;
  name?: string;
  actorRole?: AppRole;
  policyOverride?: boolean;
  now?: Date;
}): { allowed: boolean; reason?: string } {
  const state = policyState;
  if (!state.enabled) {
    return { allowed: true };
  }

  const overrideAllowed = input.policyOverride === true && input.actorRole === "admin";

  if (state.protectedVmids.includes(input.vmid)) {
    if (!overrideAllowed) {
      return {
        allowed: false,
        reason: `Blocked by policy: VMID ${input.vmid} is protected`
      };
    }
  }

  if (input.name) {
    const loweredName = input.name.toLowerCase();
    const matchedName = state.protectedNames.find((value) => value.toLowerCase() === loweredName);
    if (matchedName && !overrideAllowed) {
      return {
        allowed: false,
        reason: `Blocked by policy: guest name '${input.name}' is protected`
      };
    }
  }

  if (state.maintenanceWindowEnabled) {
    const now = input.now ?? new Date();
    const inWindow = isWithinMaintenanceWindow(
      now,
      state.maintenanceStartHourUtc,
      state.maintenanceEndHourUtc
    );

    if (!inWindow && !overrideAllowed) {
      return {
        allowed: false,
        reason: `Blocked by policy: action '${input.action}' is outside maintenance window ${state.maintenanceStartHourUtc}:00-${state.maintenanceEndHourUtc}:00 UTC`
      };
    }
  }

  return { allowed: true };
}
