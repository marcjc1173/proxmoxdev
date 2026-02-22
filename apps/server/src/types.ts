export interface ProxmoxEnvelope<T> {
  data: T;
}

export interface ProxmoxNode {
  node: string;
  status: string;
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  uptime?: number;
}

export interface ProxmoxQemuVm {
  vmid: number;
  name?: string;
  node: string;
  status: string;
  cpus?: number;
  maxmem?: number;
  maxdisk?: number;
  uptime?: number;
}

export interface ProxmoxLxcVm {
  vmid: number;
  name?: string;
  node: string;
  status: string;
  cpus?: number;
  maxmem?: number;
  maxdisk?: number;
  uptime?: number;
}

export interface ProxmoxStorage {
  storage: string;
  node: string;
  type: string;
  enabled?: number;
  active?: number;
  avail?: number;
  total?: number;
  used?: number;
}

export interface ProxmoxTask {
  node?: string;
  pid?: string;
  starttime?: number;
  endtime?: number;
  type?: string;
  id?: string;
  user?: string;
  status?: string;
  upid?: string;
}

export interface ProxmoxClusterStatus {
  type: string;
  id: string;
  name?: string;
  ip?: string;
  level?: string;
  local?: number;
  online?: number;
  quorate?: number;
}

export interface ProxmoxEvent {
  node?: string;
  daemon?: string;
  time?: number;
  pri?: string;
  pid?: string;
  msg?: string;
}
