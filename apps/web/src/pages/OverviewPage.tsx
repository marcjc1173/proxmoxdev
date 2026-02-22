import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchOverview, getStoredRole, OverviewData } from "../api";
import { StatCard } from "../components/StatCard";
import { Table } from "../components/Table";

export function OverviewPage() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentRole = getStoredRole();

  useEffect(() => {
    let mounted = true;

    const fetchData = async () => {
      try {
        const data = await fetchOverview();
        if (mounted) {
          setOverview(data);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to fetch overview");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (loading && !overview) {
    return <div className="status">Loading cluster data...</div>;
  }

  if (error) {
    return <div className="status error">{error}</div>;
  }

  if (!overview) {
    return <div className="status">No data available</div>;
  }

  const versionText = String(overview.version?.version ?? "unknown");

  const guests = [
    ...overview.qemuVms.map((vm: any) => ({
      key: `qemu:${vm.node}:${vm.vmid}`,
      type: "qemu" as const,
      node: String(vm.node ?? "-"),
      vmid: Number(vm.vmid ?? 0),
      name: String(vm.name ?? "-"),
      status: String(vm.status ?? "-")
    })),
    ...overview.lxcVms.map((ct: any) => ({
      key: `lxc:${ct.node}:${ct.vmid}`,
      type: "lxc" as const,
      node: String(ct.node ?? "-"),
      vmid: Number(ct.vmid ?? 0),
      name: String(ct.name ?? "-"),
      status: String(ct.status ?? "-")
    }))
  ].sort((a, b) => a.vmid - b.vmid);

  return (
    <>
      <section className="stats-grid">
        <StatCard label="Proxmox Version" value={versionText || 'Unknown'} />
        <StatCard label="Nodes" value={overview.summary.nodeCount} />
        <StatCard label="QEMU VMs" value={overview.summary.qemuCount} />
        <StatCard label="LXC CTs" value={overview.summary.lxcCount} />
        <StatCard label="Running Guests" value={overview.summary.runningVms} />
      </section>

      <section className="grid two-col">
        <Table
          title="Nodes"
          columns={["Node", "Status", "CPU", "Memory", "Disk"]}
          rows={overview.nodes.map((node) => [
            String(node.node ?? "-"),
            String(node.status ?? "-"),
            node.cpu != null ? `${Math.round(Number(node.cpu) * 100)}%` : "-",
            node.mem != null && node.maxmem != null
              ? `${Math.round((Number(node.mem) / Number(node.maxmem)) * 100)}%`
              : "-",
            node.disk != null && node.maxdisk != null
              ? `${Math.round((Number(node.disk) / Number(node.maxdisk)) * 100)}%`
              : "-"
          ])}
        />

        <Table
          title="Storage"
          columns={["Storage", "Node", "Type", "Used", "Total"]}
          rows={overview.storage.map((storage) => [
            String(storage.storage ?? "-"),
            String(storage.node ?? "-"),
            String(storage.type ?? "-"),
            storage.used != null ? Math.round(Number(storage.used) / 1024 ** 3) + " GB" : "-",
            storage.total != null ? Math.round(Number(storage.total) / 1024 ** 3) + " GB" : "-"
          ])}
        />
      </section>

      <section className="card">
        <h2>Virtual Machines & Containers</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Node</th>
                <th>VMID</th>
                <th>Name</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {guests.length === 0 ? (
                <tr>
                  <td colSpan={6}>No guests</td>
                </tr>
              ) : (
                guests.map((guest) => (
                  <tr key={guest.key}>
                    <td>{guest.type.toUpperCase()}</td>
                    <td>{guest.node}</td>
                    <td>{guest.vmid}</td>
                    <td>{guest.name}</td>
                    <td>
                      <span className={`status-badge status-${guest.status}`}>{guest.status}</span>
                    </td>
                    <td>
                      <Link
                        to={`/guest/${guest.type}/${guest.node}/${guest.vmid}`}
                        className="button-link"
                      >
                        view details
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid two-col">
        <Table
          title="Recent Events"
          columns={["Time", "Node", "Daemon", "Message"]}
          rows={overview.events.slice(0, 12).map((event) => [
            event.time ? new Date(Number(event.time) * 1000).toLocaleString() : "-",
            String(event.node ?? "-"),
            String(event.daemon ?? "-"),
            String(event.msg ?? "-")
          ])}
        />
      </section>
    </>
  );
}
