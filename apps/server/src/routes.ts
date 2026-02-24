

// ...existing code...

// Mount ISO to QEMU VM CD-ROM
apiRouter.post("/proxmox/guests/qemu/:node/:vmid/mount-iso", requireAuth, requireRole("operator"), async (req, res, next) => {
  try {
    const node = req.params.node;
    const vmid = Number(req.params.vmid);
    const isoStorage = typeof req.body.isoStorage === "string" ? req.body.isoStorage.trim() : "";
    const isoFile = typeof req.body.isoFile === "string" ? req.body.isoFile.trim() : "";
    if (!node || !vmid || !isoStorage || !isoFile) {
      return res.status(400).json({ error: "node, vmid, isoStorage, and isoFile are required" });
    }
    const result = await proxmoxClient.mountIsoToQemuVm({ node, vmid, isoStorage, isoFile });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

import { promises as fs } from "node:fs";
import { Router } from "express";
import multer from "multer";
import { issueToken, requireAuth, requireRole } from "./auth.js";
import { acknowledgeAlarm, evaluateAlarms, listAlarms, silenceAlarm } from "./alarms.js";
import { listNotificationAudit } from "./alarmNotifier.js";
import { listActivityAudit, recordActivityAudit } from "./activityAudit.js";
import { config } from "./config.js";
import { evaluatePolicyGuardrails, getPolicyGuardrails, updatePolicyGuardrails } from "./policyGuardrails.js";
import { proxmoxClient } from "./proxmoxClient.js";
import { createUser, deleteUser, findUser, listUsers, updateUser } from "./userStore.js";
import { getMetrics } from "./metricsStore.js";

export const apiRouter = Router();

const validGuestTypes = new Set(["qemu", "lxc"]);
const validActions = new Set(["start", "stop", "reboot", "shutdown"]);
const upload = multer({
  dest: "tmp/proxmox-center-uploads",
  limits: {
    fileSize: 10 * 1024 * 1024 * 1024
  }
});

const redactedKeys = new Set(["password", "cipassword", "token", "secret", "authorization"]);

function sanitizeForAudit(value: unknown): unknown {
  if (value == null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => sanitizeForAudit(item));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      if (redactedKeys.has(key.toLowerCase())) {
        result[key] = "[redacted]";
        continue;
      }

      result[key] = sanitizeForAudit(item);
    }
    return result;
  }

  if (typeof value === "string") {
    return value.length > 160 ? `${value.slice(0, 157)}...` : value;
  }

  return value;
}

function parseReason(req: { body?: Record<string, unknown> }): string | undefined {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  return reason || undefined;
}

function requireReason(req: { body?: Record<string, unknown> }, res: { status: (code: number) => { json: (body: Record<string, unknown>) => unknown } }) {
  const reason = parseReason(req);
  if (!reason || reason.length < 4) {
    res.status(400).json({ error: "A reason (min 4 chars) is required for this action" });
    return null;
  }

  return reason;
}

function parsePolicyOverride(req: { body?: Record<string, unknown> }): boolean {
  return req.body?.policyOverride === true;
}

async function resolveGuestName(input: { type: "qemu" | "lxc"; node: string; vmid: number }): Promise<string | undefined> {
  try {
    const overview = await proxmoxClient.getOverview();
    const list = input.type === "qemu" ? overview.qemuVms : overview.lxcVms;
    const matched = list.find(
      (item) => Number(item.vmid) === input.vmid && String(item.node ?? "") === input.node
    );

    if (!matched) {
      return undefined;
    }

    const name = String(matched.name ?? "").trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}

apiRouter.use((req, res, next) => {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return next();
  }

  let responseBody: unknown;
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    responseBody = body;
    return originalJson(body);
  }) as typeof res.json;

  res.on("finish", () => {
    const request = sanitizeForAudit(req.body ?? {});
    const sanitizedResponse = sanitizeForAudit(responseBody) as Record<string, unknown> | undefined;
    const reason = parseReason(req);
    const action = `${method} ${req.path}`;
    const target =
      (typeof req.params?.username === "string" && req.params.username) ||
      (typeof req.params?.vmid === "string" && req.params.vmid) ||
      (typeof req.params?.id === "string" && req.params.id) ||
      (typeof req.body?.newid === "number" && String(req.body.newid)) ||
      "-";

    recordActivityAudit({
      actor: req.authUser?.username ?? "anonymous",
      role: req.authUser?.role ?? "anonymous",
      method,
      path: req.originalUrl,
      action,
      target,
      reason,
      request: (request as Record<string, unknown>) ?? {},
      result: {
        success: res.statusCode < 400,
        statusCode: res.statusCode,
        message:
          typeof sanitizedResponse?.error === "string"
            ? sanitizedResponse.error
            : typeof sanitizedResponse?.message === "string"
              ? sanitizedResponse.message
              : undefined,
        upid: typeof sanitizedResponse?.upid === "string" ? sanitizedResponse.upid : undefined,
        steps: Array.isArray(sanitizedResponse?.steps) ? sanitizedResponse.steps.length : undefined
      }
    });
  });

  return next();
});

async function waitForTaskCompletion(upid: string, node?: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await proxmoxClient.getTaskStatus({ upid, node });
    if (status.status === "stopped") {
      const exitstatus = String(status.exitstatus ?? "unknown");
      if (exitstatus === "OK") {
        return;
      }
      throw new Error(`Task failed: ${exitstatus}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error("Task timed out");
}

function parseGuestIdentity(req: {
  params: { type?: string; node?: string; vmid?: string };
}) {
  const type = req.params.type;
  const node = req.params.node;
  const vmid = Number(req.params.vmid);

  if (!type || !validGuestTypes.has(type)) {
    return { error: "Invalid guest type" } as const;
  }

  if (!node) {
    return { error: "Invalid node" } as const;
  }

  if (!Number.isInteger(vmid) || vmid <= 0) {
    return { error: "Invalid VMID" } as const;
  }

  return {
    value: {
      type: type as "qemu" | "lxc",
      node,
      vmid
    }
  } as const;
}

apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "proxmox-center-api" });
});

apiRouter.get("/auth/config", (_req, res) => {
  res.json({
    enabled: config.auth.enabled,
    proxmoxBaseUrl: config.proxmox.baseUrl
  });
});

apiRouter.post("/auth/login", (req, res) => {
  if (!config.auth.enabled) {
    return res.status(400).json({ error: "App auth is disabled" });
  }

  const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  const user = findUser(username);

  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = issueToken({
    username: user.username,
    role: user.role
  });

  return res.json({
    token,
    user: {
      username: user.username,
      role: user.role
    }
  });
});

apiRouter.get("/auth/me", requireAuth, (req, res) => {
  return res.json({ user: req.authUser });
});

apiRouter.get("/alarms", requireAuth, requireRole("viewer"), (_req, res) => {
  return res.json({ alarms: listAlarms() });
});

apiRouter.post("/alarms/:id/acknowledge", requireAuth, requireRole("operator"), (req, res, next) => {
  try {
    acknowledgeAlarm(req.params.id, req.authUser?.username ?? "unknown");
    return res.json({ alarms: listAlarms() });
  } catch (error) {
    return next(error);
  }
});

apiRouter.post("/alarms/:id/silence", requireAuth, requireRole("operator"), (req, res, next) => {
  try {
    const minutesRaw = Number(req.body.minutes ?? 30);
    const minutes = Number.isFinite(minutesRaw) ? minutesRaw : 30;
    silenceAlarm(req.params.id, req.authUser?.username ?? "unknown", minutes);
    return res.json({ alarms: listAlarms() });
  } catch (error) {
    return next(error);
  }
});

apiRouter.post("/alarms/evaluate", requireAuth, requireRole("admin"), async (_req, res, next) => {
  try {
    await evaluateAlarms();
    return res.json({ alarms: listAlarms() });
  } catch (error) {
    return next(error);
  }
});

apiRouter.get("/alarms/notifications", requireAuth, requireRole("admin"), (_req, res) => {
  return res.json({ notifications: listNotificationAudit() });
});

apiRouter.get("/audit/activities", requireAuth, requireRole("admin"), (req, res) => {
  const limit = Number(req.query.limit ?? 200);
  return res.json({ activities: listActivityAudit(limit) });
});

apiRouter.get("/policy/guardrails", requireAuth, requireRole("admin"), (_req, res) => {
  return res.json({ policy: getPolicyGuardrails() });
});

apiRouter.patch("/policy/guardrails", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const nextPolicy = await updatePolicyGuardrails({
      enabled: req.body.enabled === true,
      maintenanceWindowEnabled: req.body.maintenanceWindowEnabled === true,
      maintenanceStartHourUtc: Number(req.body.maintenanceStartHourUtc),
      maintenanceEndHourUtc: Number(req.body.maintenanceEndHourUtc),
      protectedVmids: Array.isArray(req.body.protectedVmids)
        ? req.body.protectedVmids.map((value: unknown) => Number(value))
        : undefined,
      protectedNames: Array.isArray(req.body.protectedNames)
        ? req.body.protectedNames.map((value: unknown) => String(value))
        : undefined
    });

    return res.json({ policy: nextPolicy });
  } catch (error) {
    return next(error);
  }
});

apiRouter.post("/policy/guardrails/check", requireAuth, requireRole("admin"), (req, res) => {
  const action = typeof req.body.action === "string" ? req.body.action.trim() : "";
  const vmid = Number(req.body.vmid);
  const name = typeof req.body.name === "string" ? req.body.name.trim() : undefined;
  const policyOverride = req.body.policyOverride === true;

  if (!action) {
    return res.status(400).json({ error: "action is required" });
  }

  if (!Number.isInteger(vmid) || vmid <= 0) {
    return res.status(400).json({ error: "valid vmid is required" });
  }

  const result = evaluatePolicyGuardrails({
    action,
    vmid,
    name,
    actorRole: req.authUser?.role,
    policyOverride
  });

  return res.json({
    allowed: result.allowed,
    reason: result.reason
  });
});

apiRouter.get("/auth/users", requireAuth, requireRole("admin"), (_req, res) => {
  return res.json({ users: listUsers() });
});

apiRouter.post("/auth/users", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const role = req.body.role;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    if (role !== "viewer" && role !== "operator" && role !== "admin") {
      return res.status(400).json({ error: "Invalid role" });
    }

    await createUser({ username, password, role });
    return res.status(201).json({ users: listUsers() });
  } catch (error) {
    return next(error);
  }
});

apiRouter.patch("/auth/users/:username", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const username = typeof req.params.username === "string" ? req.params.username.trim() : "";
    const password = typeof req.body.password === "string" ? req.body.password : undefined;
    const role = req.body.role;

    if (!username) {
      return res.status(400).json({ error: "Invalid username" });
    }

    if (!password && role !== "viewer" && role !== "operator" && role !== "admin") {
      return res.status(400).json({ error: "Provide password and/or valid role" });
    }

    await updateUser(
      username,
      {
        password,
        role: role === "viewer" || role === "operator" || role === "admin" ? role : undefined
      },
      req.authUser?.username
    );

    return res.json({ users: listUsers() });
  } catch (error) {
    return next(error);
  }
});

apiRouter.delete("/auth/users/:username", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    if (!requireReason(req, res)) {
      return;
    }

    const username = typeof req.params.username === "string" ? req.params.username.trim() : "";
    if (!username) {
      return res.status(400).json({ error: "Invalid username" });
    }

    await deleteUser(username, req.authUser?.username);
    return res.json({ users: listUsers() });
  } catch (error) {
    return next(error);
  }
});

apiRouter.get("/proxmox/version", requireAuth, requireRole("viewer"), async (_req, res, next) => {
  try {
    const data = await proxmoxClient.getVersion();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/proxmox/nodes", requireAuth, requireRole("viewer"), async (_req, res, next) => {
  try {
    const data = await proxmoxClient.getNodes();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/proxmox/storage", requireAuth, requireRole("viewer"), async (_req, res, next) => {
  try {
    const data = await proxmoxClient.getStorage();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/proxmox/tasks/recent", requireAuth, requireRole("viewer"), async (req, res, next) => {
  try {
    const limit = Number(req.query.limit ?? 25);
    const data = await proxmoxClient.getRecentTasks(limit);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/proxmox/events/recent", requireAuth, requireRole("viewer"), async (req, res, next) => {
  try {
    const limit = Number(req.query.limit ?? 25);
    const data = await proxmoxClient.getRecentEvents(limit);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/proxmox/cluster/status", requireAuth, requireRole("viewer"), async (_req, res, next) => {
  try {
    const data = await proxmoxClient.getClusterStatus();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/proxmox/overview", requireAuth, requireRole("viewer"), async (_req, res, next) => {
  try {
    const data = await proxmoxClient.getOverview();

    const enrichWithAssignedIp = async (guest: Record<string, unknown>, type: "qemu" | "lxc") => {
      const node = String(guest.node ?? "").trim();
      const vmid = Number(guest.vmid);
      const status = String(guest.status ?? "").toLowerCase();

      if (!node || !Number.isInteger(vmid) || vmid <= 0 || status !== "running") {
        return guest;
      }

      const assignedIp = await proxmoxClient.getGuestAssignedIp({ type, node, vmid });
      return {
        ...guest,
        assignedIp
      };
    };

    const [qemuVms, lxcVms] = await Promise.all([
      Promise.all(
        data.qemuVms.map((guest) => enrichWithAssignedIp(guest as Record<string, unknown>, "qemu"))
      ),
      Promise.all(
        data.lxcVms.map((guest) => enrichWithAssignedIp(guest as Record<string, unknown>, "lxc"))
      )
    ]);

    res.json({
      ...data,
      qemuVms,
      lxcVms
    });
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/proxmox/provisioning/templates", requireAuth, requireRole("viewer"), async (_req, res, next) => {
  try {
    const templates = await proxmoxClient.getProvisioningTemplates();
    return res.json({ templates });
  } catch (error) {
    return next(error);
  }
});

apiRouter.post("/proxmox/provisioning/deploy-template", requireAuth, requireRole("operator"), async (req, res, next) => {
  try {
    const templateNode =
      typeof req.body.templateNode === "string" ? req.body.templateNode.trim() : "";
    const templateVmid = Number(req.body.templateVmid);
    const targetNode = typeof req.body.targetNode === "string" ? req.body.targetNode.trim() : "";
    const newid = Number(req.body.newid);
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";

    if (!templateNode || !targetNode || !name) {
      return res.status(400).json({ error: "templateNode, targetNode, and name are required" });
    }

    if (!Number.isInteger(templateVmid) || templateVmid <= 0) {
      return res.status(400).json({ error: "Invalid templateVmid" });
    }

    if (!Number.isInteger(newid) || newid <= 0) {
      return res.status(400).json({ error: "Invalid newid" });
    }

    const cloneUpid = await proxmoxClient.cloneGuest({
      type: "qemu",
      node: templateNode,
      vmid: templateVmid,
      target: targetNode,
      newid,
      name,
      full: true
    });

    await waitForTaskCompletion(cloneUpid);

    const configParams: Record<string, string | number> = {
      name
    };

    const cores = Number(req.body.cores);
    const memory = Number(req.body.memory);
    const bridge = typeof req.body.bridge === "string" ? req.body.bridge.trim() : "";
    const vlanTag = Number(req.body.vlanTag);
    const ciuser = typeof req.body.ciuser === "string" ? req.body.ciuser.trim() : "";
    const cipassword = typeof req.body.cipassword === "string" ? req.body.cipassword : "";
    const ipconfig0 = typeof req.body.ipconfig0 === "string" ? req.body.ipconfig0.trim() : "";
    const sshkeys = typeof req.body.sshkeys === "string" ? req.body.sshkeys.trim() : "";

    if (Number.isInteger(cores) && cores > 0) {
      configParams.cores = cores;
    }

    if (Number.isInteger(memory) && memory > 0) {
      configParams.memory = memory;
    }

    if (bridge) {
      configParams.net0 = Number.isInteger(vlanTag) && vlanTag > 0
        ? `virtio,bridge=${bridge},tag=${vlanTag}`
        : `virtio,bridge=${bridge}`;
    }

    if (ciuser) {
      configParams.ciuser = ciuser;
    }

    if (cipassword) {
      configParams.cipassword = cipassword;
    }

    if (ipconfig0) {
      configParams.ipconfig0 = ipconfig0;
    }

    if (sshkeys) {
      configParams.sshkeys = sshkeys;
    }

    const steps: Array<{ step: string; upid: string }> = [{ step: "clone", upid: cloneUpid }];

    const configUpid = await proxmoxClient.configureQemuVm({
      node: targetNode,
      vmid: newid,
      params: configParams
    });

    steps.push({ step: "configure", upid: configUpid });

    const startAfterDeploy = req.body.startAfterDeploy === true;
    if (startAfterDeploy) {
      const startUpid = await proxmoxClient.startQemuVm({
        node: targetNode,
        vmid: newid
      });
      steps.push({ step: "start", upid: startUpid });
    }

    return res.status(201).json({
      vmid: newid,
      node: targetNode,
      steps
    });
  } catch (error) {
    return next(error);
  }
});

apiRouter.get("/proxmox/provisioning/isos", requireAuth, requireRole("viewer"), async (req, res, next) => {
  try {
    const node = typeof req.query.node === "string" ? req.query.node.trim() : "";
    if (!node) {
      return res.status(400).json({ error: "node query parameter is required" });
    }

    const isos = await proxmoxClient.getNodeIsoImages(node);
    return res.json({ isos });
  } catch (error) {
    return next(error);
  }
});

apiRouter.post(
  "/proxmox/provisioning/isos/upload",
  requireAuth,
  requireRole("operator"),
  upload.single("file"),
  async (req, res, next) => {
    const file = req.file;
    try {
      const node = typeof req.body.node === "string" ? req.body.node.trim() : "";
      const storage = typeof req.body.storage === "string" ? req.body.storage.trim() : "";

      if (!node || !storage) {
        return res.status(400).json({ error: "node and storage are required" });
      }

      if (!file) {
        return res.status(400).json({ error: "ISO file is required" });
      }

      const originalName = file.originalname?.trim() || "upload.iso";
      if (!originalName.toLowerCase().endsWith(".iso")) {
        return res.status(400).json({ error: "Only .iso files are supported" });
      }

      const upid = await proxmoxClient.uploadIso({
        node,
        storage,
        localFilePath: file.path,
        originalFileName: originalName,
        contentType: file.mimetype || "application/octet-stream"
      });

      let isos: Array<{ node: string; storage: string; volid: string; file: string; size?: number }> = [];
      try {
        isos = await proxmoxClient.getNodeIsoImages(node);
      } catch {
        isos = [];
      }

      return res.status(202).json({
        upid,
        node,
        storage,
        file: originalName,
        isos
      });
    } catch (error) {
      return next(error);
    } finally {
      if (file?.path) {
        await fs.unlink(file.path).catch(() => undefined);
      }
    }
  }
);

apiRouter.post("/proxmox/provisioning/deploy-iso", requireAuth, requireRole("operator"), async (req, res, next) => {
  try {
    const node = typeof req.body.node === "string" ? req.body.node.trim() : "";
    const newid = Number(req.body.newid);
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const isoStorage = typeof req.body.isoStorage === "string" ? req.body.isoStorage.trim() : "";
    const isoFile = typeof req.body.isoFile === "string" ? req.body.isoFile.trim() : "";
    const requestedDiskStorage =
      typeof req.body.diskStorage === "string" ? req.body.diskStorage.trim() : "";

    if (!node || !name || !isoStorage || !isoFile) {
      return res.status(400).json({ error: "node, name, isoStorage, and isoFile are required" });
    }

    if (!Number.isInteger(newid) || newid <= 0) {
      return res.status(400).json({ error: "Invalid newid" });
    }

    const cores = Number(req.body.cores);
    const memory = Number(req.body.memory);
    const diskGb = Number(req.body.diskGb);
    const bridge = typeof req.body.bridge === "string" ? req.body.bridge.trim() : "vmbr0";
    const vlanTag = Number(req.body.vlanTag);

    const nodeStorages = await proxmoxClient.getNodeStorages(node);
    const imageStorages = nodeStorages.filter((item) => {
      if (!item.content || !item.content.split(",").map((value) => value.trim()).includes("images")) {
        return false;
      }

      if (item.enabled === 0 || item.active === 0) {
        return false;
      }

      return true;
    });

    const diskStorage =
      requestedDiskStorage ||
      imageStorages.find((item) => item.storage === isoStorage)?.storage ||
      imageStorages[0]?.storage;

    if (!diskStorage) {
      return res.status(400).json({
        error:
          "No storage with content=images is available on this node. Add an image-capable storage (e.g. local-lvm) or provide diskStorage."
      });
    }

    const params: Record<string, string | number> = {
      vmid: newid,
      name,
      ostype: "l26",
      scsihw: "virtio-scsi-pci",
      cores: Number.isInteger(cores) && cores > 0 ? cores : 2,
      memory: Number.isInteger(memory) && memory > 0 ? memory : 2048,
      scsi0: `${diskStorage}:${Number.isFinite(diskGb) && diskGb > 0 ? Math.round(diskGb) : 32}`,
      ide2: `${isoStorage}:iso/${isoFile},media=cdrom`,
      boot: "order=ide2;scsi0;net0",
      agent: 1
    };

    params.net0 = Number.isInteger(vlanTag) && vlanTag > 0
      ? `virtio,bridge=${bridge},tag=${vlanTag}`
      : `virtio,bridge=${bridge}`;

    const createUpid = await proxmoxClient.createQemuVm({ node, params });

    const steps: Array<{ step: string; upid: string }> = [{ step: "create", upid: createUpid }];

    const startAfterDeploy = req.body.startAfterDeploy === true;
    if (startAfterDeploy) {
      const startUpid = await proxmoxClient.startQemuVm({ node, vmid: newid });
      steps.push({ step: "start", upid: startUpid });
    }

    return res.status(201).json({
      vmid: newid,
      node,
      steps
    });
  } catch (error) {
    return next(error);
  }
});

apiRouter.get("/proxmox/guests/:type/:node/:vmid", requireAuth, requireRole("viewer"), async (req, res, next) => {
  try {
    const parsed = parseGuestIdentity(req);
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const [config, status, assignedIp] = await Promise.all([
      proxmoxClient.getGuestConfig(parsed.value),
      proxmoxClient.getGuestStatus(parsed.value),
      proxmoxClient.getGuestAssignedIp(parsed.value)
    ]);

    return res.json({
      type: parsed.value.type,
      node: parsed.value.node,
      vmid: parsed.value.vmid,
      config,
      status,
      assignedIp
    });
  } catch (error) {
    return next(error);
  }
});

apiRouter.get("/proxmox/guests/:type/:node/:vmid/metrics", requireAuth, requireRole("viewer"), async (req, res, next) => {
  try {
    const parsed = parseGuestIdentity(req);
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const hoursBack = Number(req.query.hours) || 24;
    const startTime = Math.floor(Date.now() / 1000) - (hoursBack * 3600);

    const metrics = getMetrics({
      guestType: parsed.value.type,
      node: parsed.value.node,
      vmid: parsed.value.vmid,
      startTime
    });

    return res.json({ metrics });
  } catch (error) {
    return next(error);
  }
});

apiRouter.post("/proxmox/guests/:type/:node/:vmid/:action(start|stop|reboot|shutdown)", requireAuth, requireRole("operator"), async (req, res, next) => {
  try {
    const { action } = req.params;
    const parsed = parseGuestIdentity(req);

    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    if (!validActions.has(action)) {
      return res.status(400).json({ error: "Invalid guest action" });
    }

    if ((action === "stop" || action === "shutdown" || action === "reboot") && !requireReason(req, res)) {
      return;
    }

    if (action === "stop" || action === "shutdown" || action === "reboot") {
      const guestName = await resolveGuestName(parsed.value);
      const guardrail = evaluatePolicyGuardrails({
        action: `guest.${action}`,
        vmid: parsed.value.vmid,
        name: guestName,
        actorRole: req.authUser?.role,
        policyOverride: parsePolicyOverride(req)
      });

      if (!guardrail.allowed) {
        return res.status(403).json({ error: guardrail.reason });
      }
    }

    const upid = await proxmoxClient.executeGuestAction({
      ...parsed.value,
      action: action as "start" | "stop" | "reboot" | "shutdown"
    });

    return res.json({ upid });
  } catch (error) {
    return next(error);
  }
});

apiRouter.get("/proxmox/tasks/:upid/status", requireAuth, requireRole("viewer"), async (req, res, next) => {
  try {
    const { upid } = req.params;
    const node = typeof req.query.node === "string" ? req.query.node : undefined;
    const data = await proxmoxClient.getTaskStatus({ upid, node });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/proxmox/guests/:type/:node/:vmid/snapshots", requireAuth, requireRole("viewer"), async (req, res, next) => {
  try {
    const parsed = parseGuestIdentity(req);
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const data = await proxmoxClient.getGuestSnapshots(parsed.value);
    return res.json(data);
  } catch (error) {
    return next(error);
  }
});

apiRouter.post("/proxmox/guests/:type/:node/:vmid/snapshots", requireAuth, requireRole("operator"), async (req, res, next) => {
  try {
    const parsed = parseGuestIdentity(req);
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const snapname = typeof req.body.snapname === "string" ? req.body.snapname.trim() : "";
    const description =
      typeof req.body.description === "string" ? req.body.description.trim() : undefined;
    const vmstate = req.body.vmstate === true;

    if (!snapname) {
      return res.status(400).json({ error: "Snapshot name is required" });
    }

    const upid = await proxmoxClient.createGuestSnapshot({
      ...parsed.value,
      snapname,
      description,
      vmstate
    });

    return res.json({ upid });
  } catch (error) {
    return next(error);
  }
});

apiRouter.post(
  "/proxmox/guests/:type/:node/:vmid/snapshots/:snapname/rollback",
  requireAuth,
  requireRole("admin"),
  async (req, res, next) => {
    try {
      if (!requireReason(req, res)) {
        return;
      }

      const parsed = parseGuestIdentity(req);
      if ("error" in parsed) {
        return res.status(400).json({ error: parsed.error });
      }

      const snapname =
        typeof req.params.snapname === "string" ? req.params.snapname.trim() : "";
      if (!snapname) {
        return res.status(400).json({ error: "Invalid snapshot name" });
      }
      if (snapname.toLowerCase() === "current") {
        return res.status(400).json({ error: "Cannot rollback to current snapshot marker" });
      }

      const guestName = await resolveGuestName(parsed.value);
      const guardrail = evaluatePolicyGuardrails({
        action: "snapshot.rollback",
        vmid: parsed.value.vmid,
        name: guestName,
        actorRole: req.authUser?.role,
        policyOverride: parsePolicyOverride(req)
      });

      if (!guardrail.allowed) {
        return res.status(403).json({ error: guardrail.reason });
      }

      const upid = await proxmoxClient.rollbackGuestSnapshot({
        ...parsed.value,
        snapname
      });

      return res.json({ upid });
    } catch (error) {
      return next(error);
    }
  }
);

apiRouter.delete("/proxmox/guests/:type/:node/:vmid/snapshots/:snapname", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    if (!requireReason(req, res)) {
      return;
    }

    const parsed = parseGuestIdentity(req);
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const snapname = typeof req.params.snapname === "string" ? req.params.snapname.trim() : "";
    if (!snapname) {
      return res.status(400).json({ error: "Invalid snapshot name" });
    }
    if (snapname.toLowerCase() === "current") {
      return res.status(400).json({ error: "Cannot delete current snapshot marker" });
    }

    const guestName = await resolveGuestName(parsed.value);
    const guardrail = evaluatePolicyGuardrails({
      action: "snapshot.delete",
      vmid: parsed.value.vmid,
      name: guestName,
      actorRole: req.authUser?.role,
      policyOverride: parsePolicyOverride(req)
    });

    if (!guardrail.allowed) {
      return res.status(403).json({ error: guardrail.reason });
    }

    const upid = await proxmoxClient.deleteGuestSnapshot({
      ...parsed.value,
      snapname
    });

    return res.json({ upid });
  } catch (error) {
    return next(error);
  }
});

apiRouter.post("/proxmox/guests/:type/:node/:vmid/clone", requireAuth, requireRole("operator"), async (req, res, next) => {
  try {
    const parsed = parseGuestIdentity(req);
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const newid = Number(req.body.newid);
    if (!Number.isInteger(newid) || newid <= 0) {
      return res.status(400).json({ error: "Invalid clone VMID (newid)" });
    }

    const name = typeof req.body.name === "string" ? req.body.name.trim() : undefined;
    const target =
      typeof req.body.target === "string" && req.body.target.trim()
        ? req.body.target.trim()
        : undefined;
    const storage =
      typeof req.body.storage === "string" && req.body.storage.trim()
        ? req.body.storage.trim()
        : undefined;
    const snapname =
      typeof req.body.snapname === "string" && req.body.snapname.trim()
        ? req.body.snapname.trim()
        : undefined;
    const full = req.body.full !== false;

    const upid = await proxmoxClient.cloneGuest({
      ...parsed.value,
      newid,
      name,
      target,
      full,
      storage,
      snapname
    });

    return res.json({ upid });
  } catch (error) {
    return next(error);
  }
});

apiRouter.post("/proxmox/guests/:type/:node/:vmid/template", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    if (!requireReason(req, res)) {
      return;
    }

    const parsed = parseGuestIdentity(req);
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    if (parsed.value.type !== "qemu") {
      return res.status(400).json({ error: "Template conversion is only supported for QEMU VMs" });
    }

    const guestName = await resolveGuestName(parsed.value);
    const guardrail = evaluatePolicyGuardrails({
      action: "vm.convert-template",
      vmid: parsed.value.vmid,
      name: guestName,
      actorRole: req.authUser?.role,
      policyOverride: parsePolicyOverride(req)
    });

    if (!guardrail.allowed) {
      return res.status(403).json({ error: guardrail.reason });
    }

    const upid = await proxmoxClient.convertVmToTemplate({
      node: parsed.value.node,
      vmid: parsed.value.vmid
    });

    return res.json({ upid });
  } catch (error) {
    return next(error);
  }
});
