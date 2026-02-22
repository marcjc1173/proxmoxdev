import { insertMetric } from "./metricsStore.js";

export class MetricsCollector {
  private client: any;
  private intervalId: NodeJS.Timeout | null = null;
  private collectIntervalMs: number;

  constructor(client: any, collectIntervalMinutes = 5) {
    this.client = client;
    this.collectIntervalMs = collectIntervalMinutes * 60 * 1000;
  }

  start(): void {
    if (this.intervalId) {
      console.log("[metrics-collector] Already running");
      return;
    }

    console.log(`[metrics-collector] Starting collection every ${this.collectIntervalMs / 60000} minutes`);
    
    // Collect immediately on start
    this.collect().catch((err) => {
      console.error("[metrics-collector] Initial collection failed:", err.message);
    });

    // Then collect on interval
    this.intervalId = setInterval(() => {
      this.collect().catch((err) => {
        console.error("[metrics-collector] Collection failed:", err.message);
      });
    }, this.collectIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[metrics-collector] Stopped");
    }
  }

  async collect(): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000);
    
    try {
      const nodes = await this.client.getNodes();
      const vmResources = await this.client.getQemuVms();
      
      for (const node of nodes) {
        const nodeName = String(node.node);
        
        // Collect QEMU VM metrics
        try {
          const qemuVms = vmResources.filter(
            (vm: any) => String(vm.type) === "qemu" && String(vm.node) === nodeName
          );
          for (const vm of qemuVms) {
            const vmid = Number(vm.vmid);
            if (!vmid) continue;

            insertMetric({
              timestamp,
              guestType: "qemu",
              node: nodeName,
              vmid,
              cpu: Number(vm.cpu) || 0,
              mem: Number(vm.mem) || 0,
              maxmem: Number(vm.maxmem) || 0,
              disk: Number(vm.disk) || 0,
              maxdisk: Number(vm.maxdisk) || 0,
              netin: Number(vm.netin) || 0,
              netout: Number(vm.netout) || 0
            });
          }
        } catch (err) {
          console.error(`[metrics-collector] Failed to collect QEMU metrics for node ${nodeName}`);
        }

        // Collect LXC container metrics
        try {
          const lxcCts = vmResources.filter(
            (vm: any) => String(vm.type) === "lxc" && String(vm.node) === nodeName
          );
          for (const ct of lxcCts) {
            const vmid = Number(ct.vmid);
            if (!vmid) continue;

            insertMetric({
              timestamp,
              guestType: "lxc",
              node: nodeName,
              vmid,
              cpu: Number(ct.cpu) || 0,
              mem: Number(ct.mem) || 0,
              maxmem: Number(ct.maxmem) || 0,
              disk: Number(ct.disk) || 0,
              maxdisk: Number(ct.maxdisk) || 0,
              netin: Number(ct.netin) || 0,
              netout: Number(ct.netout) || 0
            });
          }
        } catch (err) {
          console.error(`[metrics-collector] Failed to collect LXC metrics for node ${nodeName}`);
        }
      }
    } catch (err) {
      throw new Error(`Metrics collection failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }
}
