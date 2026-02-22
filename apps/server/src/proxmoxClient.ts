import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import fs from "node:fs";
import FormData from "form-data";
import https from "https";
import { config } from "./config.js";
import {
  ProxmoxClusterStatus,
  ProxmoxEnvelope,
  ProxmoxEvent,
  ProxmoxLxcVm,
  ProxmoxNode,
  ProxmoxQemuVm,
  ProxmoxStorage,
  ProxmoxTask
} from "./types.js";

interface PasswordTicketResponse {
  ticket: string;
  CSRFPreventionToken: string;
}

type GuestType = "qemu" | "lxc";
type GuestAction = "start" | "stop" | "reboot" | "shutdown";

interface SnapshotCreateInput {
  type: GuestType;
  node: string;
  vmid: number;
  snapname: string;
  description?: string;
  vmstate?: boolean;
}

interface GuestCloneInput {
  type: GuestType;
  node: string;
  vmid: number;
  newid: number;
  name?: string;
  target?: string;
  full?: boolean;
  storage?: string;
  snapname?: string;
}

interface QemuConfigInput {
  node: string;
  vmid: number;
  params: Record<string, string | number>;
}

interface QemuCreateInput {
  node: string;
  params: Record<string, string | number>;
}

interface NodeStorageInfo {
  storage: string;
  content?: string;
  enabled?: number;
  active?: number;
}

class ProxmoxClient {
  private readonly http: AxiosInstance;
  private csrfToken?: string;
  private ticket?: string;
  private lastAuthAt = 0;

  constructor() {
    this.http = axios.create({
      baseURL: `${config.proxmox.baseUrl}/api2/json`,
      timeout: 20000,
      httpsAgent: new https.Agent({
        rejectUnauthorized: !config.proxmox.allowSelfSigned
      })
    });
  }

  private get authHeader(): string | undefined {
    if (config.proxmox.authMode !== "token") {
      return undefined;
    }

    return `PVEAPIToken=${config.proxmox.tokenId}=${config.proxmox.tokenSecret}`;
  }

  private buildAxiosErrorMessage(error: unknown): string {
    if (!axios.isAxiosError(error)) {
      return error instanceof Error ? error.message : "Unknown Proxmox request error";
    }

    const data = error.response?.data as
      | { message?: unknown; errors?: Record<string, unknown> }
      | undefined;

    const proxmoxMessage = typeof data?.message === "string" ? data.message.trim() : "";
    if (proxmoxMessage) {
      return proxmoxMessage;
    }

    if (data?.errors && typeof data.errors === "object") {
      const details = Object.entries(data.errors)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(", ");
      if (details) {
        return details;
      }
    }

    const status = error.response?.status;
    return status ? `Proxmox request failed: ${status}` : error.message;
  }

  private async ensurePasswordAuth(): Promise<void> {
    if (config.proxmox.authMode !== "password") {
      return;
    }

    const now = Date.now();
    if (this.ticket && now - this.lastAuthAt < 90_000) {
      return;
    }

    const user = `${config.proxmox.username}@${config.proxmox.realm}`;

    const response = await this.http.post<ProxmoxEnvelope<PasswordTicketResponse>>(
      "/access/ticket",
      {
        username: user,
        password: config.proxmox.password
      }
    );

    this.ticket = response.data.data.ticket;
    this.csrfToken = response.data.data.CSRFPreventionToken;
    this.lastAuthAt = now;
  }

  private async request<T>(
    requestConfig: AxiosRequestConfig,
    writeOperation = false
  ): Promise<T> {
    await this.ensurePasswordAuth();

    const headers: Record<string, string> = {
      ...(requestConfig.headers as Record<string, string> | undefined)
    };

    const authHeader = this.authHeader;
    if (authHeader) {
      headers.Authorization = authHeader;
    }

    if (this.ticket) {
      headers.Cookie = `PVEAuthCookie=${this.ticket}`;
    }

    if (writeOperation && this.csrfToken) {
      headers.CSRFPreventionToken = this.csrfToken;
    }

    try {
      const response = await this.http.request<ProxmoxEnvelope<T>>({
        ...requestConfig,
        headers
      });

      return response.data.data;
    } catch (error) {
      throw new Error(this.buildAxiosErrorMessage(error));
    }
  }

  async uploadIso(input: {
    node: string;
    storage: string;
    localFilePath: string;
    originalFileName: string;
    contentType?: string;
  }) {
    await this.ensurePasswordAuth();

    const headers: Record<string, string> = {};
    const authHeader = this.authHeader;
    if (authHeader) {
      headers.Authorization = authHeader;
    }

    if (this.ticket) {
      headers.Cookie = `PVEAuthCookie=${this.ticket}`;
    }

    if (this.csrfToken) {
      headers.CSRFPreventionToken = this.csrfToken;
    }

    const form = new FormData();
    form.append("content", "iso");
    form.append("filename", fs.createReadStream(input.localFilePath), {
      filename: input.originalFileName,
      contentType: input.contentType ?? "application/octet-stream"
    });

    try {
      const response = await this.http.post<ProxmoxEnvelope<string>>(
        `/nodes/${input.node}/storage/${encodeURIComponent(input.storage)}/upload`,
        form,
        {
          headers: {
            ...headers,
            ...(form.getHeaders() as Record<string, string>)
          },
          timeout: 0,
          maxBodyLength: Number.POSITIVE_INFINITY,
          maxContentLength: Number.POSITIVE_INFINITY
        }
      );

      return response.data.data;
    } catch (error) {
      throw new Error(this.buildAxiosErrorMessage(error));
    }
  }

  getVersion() {
    return this.request<Record<string, unknown>>({ method: "GET", url: "/version" });
  }

  getNodes() {
    return this.request<ProxmoxNode[]>({ method: "GET", url: "/nodes" });
  }

  getClusterStatus() {
    return this.request<ProxmoxClusterStatus[]>({
      method: "GET",
      url: "/cluster/status"
    });
  }

  getQemuVms() {
    return this.request<ProxmoxQemuVm[]>({
      method: "GET",
      url: "/cluster/resources",
      params: { type: "vm" }
    });
  }

  getLxcVms() {
    return this.request<ProxmoxLxcVm[]>({
      method: "GET",
      url: "/cluster/resources",
      params: { type: "vm" }
    });
  }

  getStorage() {
    return this.request<ProxmoxStorage[]>({
      method: "GET",
      url: "/cluster/resources",
      params: { type: "storage" }
    });
  }

  getRecentTasks(limit = 25) {
    return this.request<ProxmoxTask[]>({
      method: "GET",
      url: "/cluster/tasks"
    }).then((tasks) => tasks.slice(0, Math.max(1, limit)));
  }

  getRecentEvents(limit = 25) {
    return this.request<ProxmoxEvent[]>({
      method: "GET",
      url: "/cluster/log"
    }).then((events) => events.slice(0, Math.max(1, limit)));
  }

  async getOverview() {
    const [version, nodes, resources, storage, tasks, clusterStatus, events] =
      await Promise.all([
        this.getVersion(),
        this.getNodes(),
        this.request<Array<Record<string, unknown>>>({
          method: "GET",
          url: "/cluster/resources"
        }),
        this.getStorage(),
        this.getRecentTasks(15),
        this.getClusterStatus().catch(() => []),
        this.getRecentEvents(15)
      ]);

    const qemuVms = resources.filter((item) => item.type === "qemu");
    const lxcVms = resources.filter((item) => item.type === "lxc");

    return {
      version,
      nodes,
      qemuVms,
      lxcVms,
      storage,
      tasks,
      clusterStatus,
      events,
      summary: {
        nodeCount: nodes.length,
        qemuCount: qemuVms.length,
        lxcCount: lxcVms.length,
        runningVms:
          qemuVms.filter((vm) => vm.status === "running").length +
          lxcVms.filter((vm) => vm.status === "running").length
      }
    };
  }

  async getGuestConfig(input: { type: GuestType; node: string; vmid: number }) {
    return this.request<Record<string, unknown>>({
      method: "GET",
      url: `/nodes/${input.node}/${input.type}/${input.vmid}/config`
    });
  }

  async getGuestStatus(input: { type: GuestType; node: string; vmid: number }) {
    return this.request<Record<string, unknown>>({
      method: "GET",
      url: `/nodes/${input.node}/${input.type}/${input.vmid}/status/current`
    });
  }

  async executeGuestAction(input: {
    type: GuestType;
    node: string;
    vmid: number;
    action: GuestAction;
  }) {
    return this.request<string>(
      {
        method: "POST",
        url: `/nodes/${input.node}/${input.type}/${input.vmid}/status/${input.action}`
      },
      true
    );
  }

  async getTaskStatus(input: { upid: string; node?: string }) {
    const node = input.node ?? this.extractNodeFromUpid(input.upid);

    if (!node) {
      throw new Error("Unable to determine node for task status lookup");
    }

    return this.request<Record<string, unknown>>({
      method: "GET",
      url: `/nodes/${node}/tasks/${encodeURIComponent(input.upid)}/status`
    });
  }

  async getGuestSnapshots(input: { type: GuestType; node: string; vmid: number }) {
    return this.request<Array<Record<string, unknown>>>({
      method: "GET",
      url: `/nodes/${input.node}/${input.type}/${input.vmid}/snapshot`
    });
  }

  async createGuestSnapshot(input: SnapshotCreateInput) {
    const params: Record<string, string | number> = {
      snapname: input.snapname
    };

    if (input.description) {
      params.description = input.description;
    }

    if (input.type === "qemu") {
      params.vmstate = input.vmstate ? 1 : 0;
    }

    return this.request<string>(
      {
        method: "POST",
        url: `/nodes/${input.node}/${input.type}/${input.vmid}/snapshot`,
        params
      },
      true
    );
  }

  async rollbackGuestSnapshot(input: {
    type: GuestType;
    node: string;
    vmid: number;
    snapname: string;
  }) {
    return this.request<string>(
      {
        method: "POST",
        url: `/nodes/${input.node}/${input.type}/${input.vmid}/snapshot/${encodeURIComponent(input.snapname)}/rollback`
      },
      true
    );
  }

  async deleteGuestSnapshot(input: {
    type: GuestType;
    node: string;
    vmid: number;
    snapname: string;
  }) {
    return this.request<string>(
      {
        method: "DELETE",
        url: `/nodes/${input.node}/${input.type}/${input.vmid}/snapshot/${encodeURIComponent(input.snapname)}`
      },
      true
    );
  }

  async cloneGuest(input: GuestCloneInput) {
    const params: Record<string, string | number> = {
      newid: input.newid
    };

    if (input.name) {
      params.name = input.name;
    }

    if (input.target) {
      params.target = input.target;
    }

    if (input.storage) {
      params.storage = input.storage;
    }

    if (input.snapname) {
      params.snapname = input.snapname;
    }

    if (input.type === "qemu") {
      params.full = input.full ? 1 : 0;
    }

    return this.request<string>(
      {
        method: "POST",
        url: `/nodes/${input.node}/${input.type}/${input.vmid}/clone`,
        params
      },
      true
    );
  }

  async convertVmToTemplate(input: { node: string; vmid: number }) {
    return this.request<string>(
      {
        method: "POST",
        url: `/nodes/${input.node}/qemu/${input.vmid}/template`
      },
      true
    );
  }

  async getProvisioningTemplates() {
    const resources = await this.request<Array<Record<string, unknown>>>({
      method: "GET",
      url: "/cluster/resources",
      params: { type: "vm" }
    });

    return resources
      .filter((item) => item.type === "qemu" && (item.template === 1 || item.template === true))
      .map((item) => ({
        vmid: Number(item.vmid),
        name: String(item.name ?? `template-${String(item.vmid)}`),
        node: String(item.node ?? "unknown"),
        status: item.status ? String(item.status) : undefined
      }));
  }

  async configureQemuVm(input: QemuConfigInput) {
    return this.request<string>(
      {
        method: "POST",
        url: `/nodes/${input.node}/qemu/${input.vmid}/config`,
        params: input.params
      },
      true
    );
  }

  async startQemuVm(input: { node: string; vmid: number }) {
    return this.request<string>(
      {
        method: "POST",
        url: `/nodes/${input.node}/qemu/${input.vmid}/status/start`
      },
      true
    );
  }

  async createQemuVm(input: QemuCreateInput) {
    return this.request<string>(
      {
        method: "POST",
        url: `/nodes/${input.node}/qemu`,
        params: input.params
      },
      true
    );
  }

  async getNodeStorages(node: string): Promise<NodeStorageInfo[]> {
    const storages = await this.request<Array<Record<string, unknown>>>({
      method: "GET",
      url: `/nodes/${node}/storage`
    });

    return storages
      .map((item) => ({
        storage: String(item.storage ?? "").trim(),
        content: typeof item.content === "string" ? item.content : undefined,
        enabled: typeof item.enabled === "number" ? item.enabled : undefined,
        active: typeof item.active === "number" ? item.active : undefined
      }))
      .filter((item) => item.storage.length > 0);
  }

  async getNodeIsoImages(node: string) {
    const storages = await this.getNodeStorages(node);

    const candidates = storages
      .map((storage) => storage.storage)
      .filter((name) => name.length > 0);

    const contents = await Promise.all(
      candidates.map(async (storage) => {
        try {
          const items = await this.request<Array<Record<string, unknown>>>({
            method: "GET",
            url: `/nodes/${node}/storage/${encodeURIComponent(storage)}/content`,
            params: { content: "iso" }
          });

          return items.map((item) => ({
            node,
            storage,
            volid: String(item.volid ?? ""),
            content: String(item.content ?? ""),
            size: typeof item.size === "number" ? item.size : undefined
          }));
        } catch {
          return [];
        }
      })
    );

    return contents
      .flat()
      .filter((item) => item.content === "iso" && item.volid.includes(":iso/"))
      .map((item) => ({
        ...item,
        file: item.volid.split(":iso/")[1] ?? item.volid
      }));
  }

  private extractNodeFromUpid(upid: string): string | undefined {
    const parts = upid.split(":");
    if (parts.length < 2 || parts[0] !== "UPID") {
      return undefined;
    }

    return parts[1] || undefined;
  }
}

export const proxmoxClient = new ProxmoxClient();
