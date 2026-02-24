const defaultApiBaseUrl = `${window.location.protocol}//${window.location.hostname}:4000/api`;
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || defaultApiBaseUrl;
const TOKEN_KEY = "pc_token";
const ROLE_KEY = "pc_role";
const USERNAME_KEY = "pc_username";

function buildHeaders(contentTypeJson = false): HeadersInit {
  const headers: Record<string, string> = {};

  if (contentTypeJson) {
    headers["Content-Type"] = "application/json";
  }

  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

export function getAuthToken(): string | null {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function hasAuthToken(): boolean {
  return Boolean(getAuthToken());
}

export function setAuthSession(input: { token: string; role: "viewer" | "operator" | "admin"; username: string }) {
  window.localStorage.setItem(TOKEN_KEY, input.token);
  window.localStorage.setItem(ROLE_KEY, input.role);
  window.localStorage.setItem(USERNAME_KEY, input.username);
}

export function clearAuthSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(ROLE_KEY);
  window.localStorage.removeItem(USERNAME_KEY);
}

export function getStoredRole(): "viewer" | "operator" | "admin" | null {
  const role = window.localStorage.getItem(ROLE_KEY);
  if (role === "viewer" || role === "operator" || role === "admin") {
    return role;
  }
  return null;
}

export function getStoredUsername(): string | null {
  return window.localStorage.getItem(USERNAME_KEY);
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

export async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: buildHeaders()
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function postJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: buildHeaders()
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function postJsonWithBody<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: buildHeaders(true),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || errorBody.error || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function deleteJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "DELETE",
    headers: buildHeaders()
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function deleteJsonWithBody<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "DELETE",
    headers: buildHeaders(true),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || errorBody.error || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export interface OverviewData {
  version: Record<string, unknown>;
  nodes: Array<Record<string, unknown>>;
  qemuVms: Array<Record<string, unknown>>;
  lxcVms: Array<Record<string, unknown>>;
  storage: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  clusterStatus: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  summary: {
    nodeCount: number;
    qemuCount: number;
    lxcCount: number;
    runningVms: number;
  };
}

export interface ProvisioningTemplate {
  vmid: number;
  name: string;
  node: string;
  status?: string;
}

export interface ProvisioningIso {
  node: string;
  storage: string;
  volid: string;
  file: string;
  size?: number;
}

export interface ProvisioningTemplatesResponse {
  templates: ProvisioningTemplate[];
}

export interface ProvisioningIsosResponse {
  isos: ProvisioningIso[];
}

export interface ProvisioningIsoUploadResponse {
  upid: string;
  node: string;
  storage: string;
  file: string;
  isos: ProvisioningIso[];
}

export interface ProvisionDeploymentResponse {
  vmid: number;
  node: string;
  steps: Array<{ step: string; upid: string }>;
}

export type GuestType = "qemu" | "lxc";
export type GuestAction = "start" | "stop" | "reboot" | "shutdown";
export type AppRole = "viewer" | "operator" | "admin";

export interface TaskActionResponse {
  upid: string;
}

export interface TaskStatusResponse {
  status?: string;
  exitstatus?: string;
  [key: string]: unknown;
}

export interface GuestSnapshot {
  name?: string;
  description?: string;
  snaptime?: number;
  vmstate?: number;
  parent?: string;
}

export interface AuthConfigResponse {
  enabled: boolean;
  proxmoxBaseUrl?: string;
}

export interface LoginResponse {
  token: string;
  user: {
    username: string;
    role: AppRole;
  };
}

export interface AdminUser {
  username: string;
  role: AppRole;
}

export interface AdminUsersResponse {
  users: AdminUser[];
}

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
}

export interface AlarmsResponse {
  alarms: AlarmRecord[];
}

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

export interface NotificationAuditResponse {
  notifications: NotificationAuditRecord[];
}

export interface ActivityAuditRecord {
  id: string;
  createdAt: string;
  actor: string;
  role: AppRole | "anonymous";
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

export interface ActivityAuditResponse {
  activities: ActivityAuditRecord[];
}

export interface PolicyGuardrails {
  enabled: boolean;
  maintenanceWindowEnabled: boolean;
  maintenanceStartHourUtc: number;
  maintenanceEndHourUtc: number;
  protectedVmids: number[];
  protectedNames: string[];
}

export interface PolicyGuardrailsResponse {
  policy: PolicyGuardrails;
}

export interface PolicyGuardrailsCheckResponse {
  allowed: boolean;
  reason?: string;
}

export function fetchOverview(): Promise<OverviewData> {
  return fetchJson<OverviewData>("/proxmox/overview");
}

export function fetchAuthConfig(): Promise<AuthConfigResponse> {
  return fetchJson<AuthConfigResponse>("/auth/config");
}

export function login(input: { username: string; password: string }): Promise<LoginResponse> {
  return postJsonWithBody<LoginResponse>("/auth/login", input);
}

export function fetchUsers(): Promise<AdminUsersResponse> {
  return fetchJson<AdminUsersResponse>("/auth/users");
}

export function createAppUser(input: {
  username: string;
  password: string;
  role: AppRole;
}): Promise<AdminUsersResponse> {
  return postJsonWithBody<AdminUsersResponse>("/auth/users", input);
}

export async function patchJsonWithBody<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "PATCH",
    headers: buildHeaders(true),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || errorBody.error || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function updateAppUser(
  username: string,
  body: { password?: string; role?: AppRole }
): Promise<AdminUsersResponse> {
  return patchJsonWithBody<AdminUsersResponse>(`/auth/users/${encodeURIComponent(username)}`, body);
}

export function deleteAppUser(username: string, reason: string): Promise<AdminUsersResponse> {
  return deleteJsonWithBody<AdminUsersResponse>(`/auth/users/${encodeURIComponent(username)}`, { reason });
}

export function fetchAlarms(): Promise<AlarmsResponse> {
  return fetchJson<AlarmsResponse>("/alarms");
}

export function acknowledgeAlarm(id: string): Promise<AlarmsResponse> {
  return postJson<AlarmsResponse>(`/alarms/${encodeURIComponent(id)}/acknowledge`);
}

export function silenceAlarm(id: string, minutes: number): Promise<AlarmsResponse> {
  return postJsonWithBody<AlarmsResponse>(`/alarms/${encodeURIComponent(id)}/silence`, { minutes });
}

export function evaluateAlarmsNow(): Promise<AlarmsResponse> {
  return postJson<AlarmsResponse>("/alarms/evaluate");
}

export function fetchAlarmNotifications(): Promise<NotificationAuditResponse> {
  return fetchJson<NotificationAuditResponse>("/alarms/notifications");
}

export function fetchActivityAudit(limit = 200): Promise<ActivityAuditResponse> {
  return fetchJson<ActivityAuditResponse>(`/audit/activities?limit=${encodeURIComponent(String(limit))}`);
}

export function fetchPolicyGuardrails(): Promise<PolicyGuardrailsResponse> {
  return fetchJson<PolicyGuardrailsResponse>("/policy/guardrails");
}

export function updatePolicyGuardrails(input: PolicyGuardrails): Promise<PolicyGuardrailsResponse> {
  return patchJsonWithBody<PolicyGuardrailsResponse>("/policy/guardrails", input as unknown as Record<string, unknown>);
}

export function checkPolicyGuardrails(input: {
  action: string;
  vmid: number;
  name?: string;
  policyOverride?: boolean;
}): Promise<PolicyGuardrailsCheckResponse> {
  return postJsonWithBody<PolicyGuardrailsCheckResponse>("/policy/guardrails/check", {
    action: input.action,
    vmid: input.vmid,
    name: input.name,
    policyOverride: input.policyOverride === true
  });
}

export function triggerGuestAction(input: {
  type: GuestType;
  node: string;
  vmid: number;
  action: GuestAction;
  reason?: string;
  policyOverride?: boolean;
}): Promise<TaskActionResponse> {
  return postJsonWithBody<TaskActionResponse>(
    `/proxmox/guests/${input.type}/${encodeURIComponent(input.node)}/${input.vmid}/${input.action}`,
    {
      reason: input.reason,
      policyOverride: input.policyOverride === true
    }
  );
}

export function fetchTaskStatus(input: { upid: string; node?: string }): Promise<TaskStatusResponse> {
  const query = input.node ? `?node=${encodeURIComponent(input.node)}` : "";
  return fetchJson<TaskStatusResponse>(
    `/proxmox/tasks/${encodeURIComponent(input.upid)}/status${query}`
  );
}

export function fetchGuestDetails(input: {
  type: GuestType;
  node: string;
  vmid: number;
}): Promise<{ type: GuestType; node: string; vmid: number; config: Record<string, unknown>; status: Record<string, unknown>; assignedIp?: string }> {
  return fetchJson<{ type: GuestType; node: string; vmid: number; config: Record<string, unknown>; status: Record<string, unknown>; assignedIp?: string }>(
    `/proxmox/guests/${input.type}/${encodeURIComponent(input.node)}/${input.vmid}`
  );
}

export interface MetricRecord {
  id: number;
  timestamp: number;
  guestType: GuestType;
  node: string;
  vmid: number;
  cpu: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  netin?: number;
  netout?: number;
}

export interface MetricsResponse {
  metrics: MetricRecord[];
}

export function fetchGuestMetrics(input: {
  type: GuestType;
  node: string;
  vmid: number;
  hours?: number;
}): Promise<MetricsResponse> {
  const hours = input.hours ?? 24;
  return fetchJson<MetricsResponse>(
    `/proxmox/guests/${input.type}/${encodeURIComponent(input.node)}/${input.vmid}/metrics?hours=${hours}`
  );
}

export function fetchGuestSnapshots(input: {
  type: GuestType;
  node: string;
  vmid: number;
}): Promise<GuestSnapshot[]> {
  return fetchJson<GuestSnapshot[]>(
    `/proxmox/guests/${input.type}/${encodeURIComponent(input.node)}/${input.vmid}/snapshots`
  );
}

export function createGuestSnapshot(input: {
  type: GuestType;
  node: string;
  vmid: number;
  snapname: string;
  description?: string;
  vmstate?: boolean;
}): Promise<TaskActionResponse> {
  return postJsonWithBody<TaskActionResponse>(
    `/proxmox/guests/${input.type}/${encodeURIComponent(input.node)}/${input.vmid}/snapshots`,
    {
      snapname: input.snapname,
      description: input.description,
      vmstate: input.vmstate === true
    }
  );
}

export function rollbackGuestSnapshot(input: {
  type: GuestType;
  node: string;
  vmid: number;
  snapname: string;
  reason?: string;
  policyOverride?: boolean;
}): Promise<TaskActionResponse> {
  return postJsonWithBody<TaskActionResponse>(
    `/proxmox/guests/${input.type}/${encodeURIComponent(input.node)}/${input.vmid}/snapshots/${encodeURIComponent(input.snapname)}/rollback`,
    {
      reason: input.reason,
      policyOverride: input.policyOverride === true
    }
  );
}

export function deleteGuestSnapshot(input: {
  type: GuestType;
  node: string;
  vmid: number;
  snapname: string;
  reason?: string;
  policyOverride?: boolean;
}): Promise<TaskActionResponse> {
  return deleteJsonWithBody<TaskActionResponse>(
    `/proxmox/guests/${input.type}/${encodeURIComponent(input.node)}/${input.vmid}/snapshots/${encodeURIComponent(input.snapname)}`,
    {
      reason: input.reason,
      policyOverride: input.policyOverride === true
    }
  );
}

export function cloneGuest(input: {
  type: GuestType;
  node: string;
  vmid: number;
  newid: number;
  name?: string;
  target?: string;
  full?: boolean;
  storage?: string;
  snapname?: string;
}): Promise<TaskActionResponse> {
  return postJsonWithBody<TaskActionResponse>(
    `/proxmox/guests/${input.type}/${encodeURIComponent(input.node)}/${input.vmid}/clone`,
    {
      newid: input.newid,
      name: input.name,
      target: input.target,
      full: input.full !== false,
      storage: input.storage,
      snapname: input.snapname
    }
  );
}

export function convertVmToTemplate(input: {
  type: GuestType;
  node: string;
  vmid: number;
  reason?: string;
  policyOverride?: boolean;
}): Promise<TaskActionResponse> {
  return postJsonWithBody<TaskActionResponse>(
    `/proxmox/guests/${input.type}/${encodeURIComponent(input.node)}/${input.vmid}/template`,
    {
      reason: input.reason,
      policyOverride: input.policyOverride === true
    }
  );
}

export function fetchProvisioningTemplates(): Promise<ProvisioningTemplatesResponse> {
  return fetchJson<ProvisioningTemplatesResponse>("/proxmox/provisioning/templates");
}

export function deployFromTemplate(input: {
  templateNode: string;
  templateVmid: number;
  targetNode: string;
  newid: number;
  name: string;
  cores?: number;
  memory?: number;
  bridge?: string;
  vlanTag?: number;
  ciuser?: string;
  cipassword?: string;
  ipconfig0?: string;
  sshkeys?: string;
  startAfterDeploy?: boolean;
}): Promise<ProvisionDeploymentResponse> {
  return postJsonWithBody<ProvisionDeploymentResponse>("/proxmox/provisioning/deploy-template", input);
}

export function fetchProvisioningIsos(node: string): Promise<ProvisioningIsosResponse> {
  return fetchJson<ProvisioningIsosResponse>(`/proxmox/provisioning/isos?node=${encodeURIComponent(node)}`);
}

export async function uploadProvisioningIso(input: {
  node: string;
  storage: string;
  file: File;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<ProvisioningIsoUploadResponse> {
  return new Promise<ProvisioningIsoUploadResponse>((resolve, reject) => {
    const form = new FormData();
    form.append("node", input.node);
    form.append("storage", input.storage);
    form.append("file", input.file, input.file.name);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}/proxmox/provisioning/isos/upload`);

    const token = getAuthToken();
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (!input.onProgress || !event.lengthComputable || event.total <= 0) {
        return;
      }

      const percent = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      input.onProgress(percent);
    };

    xhr.onerror = () => {
      reject(new Error("Upload failed"));
    };

    xhr.onabort = () => {
      const abortError = new Error("Upload cancelled");
      abortError.name = "AbortError";
      reject(abortError);
    };

    if (input.signal) {
      if (input.signal.aborted) {
        xhr.abort();
        return;
      }

      input.signal.addEventListener("abort", () => {
        xhr.abort();
      }, { once: true });
    }

    xhr.onload = () => {
      const text = xhr.responseText || "{}";
      const body = JSON.parse(text) as Record<string, unknown>;

      if (xhr.status < 200 || xhr.status >= 300) {
        const message =
          (typeof body.message === "string" && body.message) ||
          (typeof body.error === "string" && body.error) ||
          `Request failed: ${xhr.status}`;
        reject(new Error(message));
        return;
      }

      resolve(body as unknown as ProvisioningIsoUploadResponse);
    };

    xhr.send(form);
  });
}

export function deployFromIso(input: {
  node: string;
  newid: number;
  name: string;
  isoStorage: string;
  isoFile: string;
  cores?: number;
  memory?: number;
  diskGb?: number;
  bridge?: string;
  vlanTag?: number;
  startAfterDeploy?: boolean;
}): Promise<ProvisionDeploymentResponse> {
  return postJsonWithBody<ProvisionDeploymentResponse>("/proxmox/provisioning/deploy-iso", input);
}
