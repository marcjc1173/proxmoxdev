import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import {
  fetchGuestDetails,
  fetchGuestMetrics,
  triggerGuestAction,
  fetchTaskStatus,
  fetchGuestSnapshots,
  createGuestSnapshot,
  rollbackGuestSnapshot,
  deleteGuestSnapshot,
  getApiBaseUrl,
  getStoredRole,
  fetchAuthConfig,
  GuestType,
  GuestAction,
  MetricRecord,
  GuestSnapshot
} from "../api";


  const { type, node, vmid } = useParams<{ type: string; node: string; vmid: string }>();
  const [guestData, setGuestData] = useState<{
    type: GuestType;
    node: string;
    vmid: number;
    config: Record<string, unknown>;
    status: Record<string, unknown>;
    assignedIp?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string>("-");
  const [proxmoxUiBaseUrl, setProxmoxUiBaseUrl] = useState<string>("");
  const [metrics, setMetrics] = useState<MetricRecord[]>([]);
  const [snapshots, setSnapshots] = useState<GuestSnapshot[]>([]);
  const [newSnapName, setNewSnapName] = useState<string>("");
  const [newSnapDescription, setNewSnapDescription] = useState<string>("");
  const [newSnapVmstate, setNewSnapVmstate] = useState<boolean>(false);
  const [snapshotStatus, setSnapshotStatus] = useState<string>("-");
  const [isRollbackInProgress, setIsRollbackInProgress] = useState<boolean>(false);
  const currentRole = getStoredRole();
  const canOperate = currentRole === "operator" || currentRole === "admin";

  const guestType = type as GuestType;
  const guestNode = node || "";
  const guestVmid = Number(vmid);

  // ISO mount state (must be inside the component)
  const [isoList, setIsoList] = useState<ProvisioningIso[]>([]);
  const [selectedIso, setSelectedIso] = useState<string>("");
  const [isoMountStatus, setIsoMountStatus] = useState<string>("");

  // Fetch ISOs for QEMU guests
  useEffect(() => {
    if (guestType !== "qemu" || !guestNode) return;
    fetchProvisioningIsos(guestNode)
      .then((res) => setIsoList(res.isos))
      .catch(() => setIsoList([]));
  }, [guestType, guestNode]);

  const handleMountIso = async () => {
    if (!selectedIso) {
      setIsoMountStatus("Please select an ISO image.");
      return;
    }
    const [isoStorage, isoFile] = selectedIso.split(":iso/");
    if (!isoStorage || !isoFile) {
      setIsoMountStatus("Invalid ISO selection.");
      return;
    }
    setIsoMountStatus("Mounting ISO...");
    try {
      const { upid } = await mountIsoToQemuVm({ node: guestNode, vmid: guestVmid, isoStorage, isoFile });
      setIsoMountStatus(`Mount requested (task: ${upid})`);
    } catch (err) {
      setIsoMountStatus(`Failed to mount ISO: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  useEffect(() => {
    fetchAuthConfig()
      .then((config) => {
        if (config.proxmoxBaseUrl) {
          setProxmoxUiBaseUrl(config.proxmoxBaseUrl);
        }
      })
      .catch(() => {
        // Ignore error, will fall back to deriving from API base
      });
  }, []);

  useEffect(() => {
    if (!type || !node || !vmid) {
      setError("Invalid guest parameters");
      setLoading(false);
      return;
    }

    let mounted = true;

    const fetchData = async () => {
      try {
        const data = await fetchGuestDetails({
          type: guestType,
          node: guestNode,
          vmid: guestVmid
        });
        if (mounted) {
          setGuestData(data);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to fetch guest details");
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
  }, [type, node, vmid, guestType, guestNode, guestVmid]);

  useEffect(() => {
    if (!type || !node || !vmid) {
      return;
    }

    const fetchMetricsData = async () => {
      try {
        console.log(`Fetching metrics for ${guestType}/${guestNode}/${guestVmid}`);
        const data = await fetchGuestMetrics({
          type: guestType,
          node: guestNode,
          vmid: guestVmid,
          hours: 24
        });
        console.log(`Received ${data.metrics.length} metric records`);
        setMetrics(data.metrics);
      } catch (err) {
        // Ignore metrics errors, they're not critical
        console.error("Failed to fetch metrics:", err);
      }
    };

    fetchMetricsData();
    const interval = setInterval(fetchMetricsData, 60000); // Update metrics every minute

    return () => {
      clearInterval(interval);
    };
  }, [type, node, vmid, guestType, guestNode, guestVmid]);
  useEffect(() => {
    if (!type || !node || !vmid) {
      return;
    }

    const fetchSnapshotsData = async () => {
      try {
        const data = await fetchGuestSnapshots({
          type: guestType,
          node: guestNode,
          vmid: guestVmid
        });
        setSnapshots(data);
      } catch (err) {
        console.error("Failed to fetch snapshots:", err);
        setSnapshots([]);
      }
    };

    fetchSnapshotsData();
    const interval = setInterval(fetchSnapshotsData, 30000); // Update every 30 seconds

    return () => {
      clearInterval(interval);
    };
  }, [type, node, vmid, guestType, guestNode, guestVmid]);
  const handleAction = async (action: GuestAction) => {
    setActionStatus(`executing ${action}...`);
    try {
      await triggerGuestAction({
        type: guestType,
        node: guestNode,
        vmid: guestVmid,
        action,
        reason: `Manual ${action} from web UI`
      });
      setActionStatus(`${action} initiated successfully`);
    } catch (err) {
      setActionStatus(`${action} failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleActionWithConfirm = (action: GuestAction) => {
    const actionMessages: Record<GuestAction, string> = {
      start: `Start ${name} (${guestType.toUpperCase()} ${guestVmid})?`,
      stop: `Force stop ${name}? This will immediately terminate the guest without graceful shutdown.`,
      shutdown: `Shutdown ${name} gracefully?`,
      reboot: `Reboot ${name}?`
    };

    const message = actionMessages[action] || `Execute ${action} on ${name}?`;
    
    if (window.confirm(message)) {
      handleAction(action);
    }
  };

  const handleOpenConsole = () => {
    const apiBase = proxmoxUiBaseUrl || getApiBaseUrl();
    let proxmoxBase = "";

    try {
      const parsed = new URL(apiBase);
      proxmoxBase = `${parsed.protocol}//${parsed.hostname}:8006`;
    } catch {
      // Fall back to simple replacement
      proxmoxBase = apiBase.replace(/\/api$/, "").replace(":4000", ":8006");
    }

    if (!proxmoxBase) {
      return;
    }

    const consoleQuery =
      guestType === "qemu"
        ? `console=kvm&novnc=1&node=${encodeURIComponent(guestNode)}&vmid=${guestVmid}`
        : `console=lxc&xtermjs=1&node=${encodeURIComponent(guestNode)}&vmid=${guestVmid}`;

    const consoleUrl = `${proxmoxBase}/?${consoleQuery}`;
    window.open(consoleUrl, "_blank", "noopener,noreferrer");
  };

  const waitForTaskCompletion = async (upid: string) => {
    for (let attempt = 1; attempt <= 120; attempt += 1) {
      const task = await fetchTaskStatus({ upid, node: guestNode });
      const status = String(task.status || "").toLowerCase();
      const exitstatus = String(task.exitstatus || "");

      if (status === "stopped") {
        return {
          success: !exitstatus || exitstatus.toUpperCase() === "OK",
          exitstatus
        };
      }

      if (attempt % 3 === 0) {
        setSnapshotStatus(`Rollback in progress... (task ${attempt * 2}s elapsed)`);
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    throw new Error("Rollback is still running after 4 minutes. Check Proxmox task history and refresh this page.");
  };

  const handleCreateSnapshot = async () => {
    if (!newSnapName.trim()) {
      setSnapshotStatus("Snapshot name is required");
      return;
    }

    if (!window.confirm(`Create snapshot "${newSnapName}" for ${name}?`)) {
      return;
    }

    setSnapshotStatus(`Creating snapshot "${newSnapName}"...`);
    try {
      await createGuestSnapshot({
        type: guestType,
        node: guestNode,
        vmid: guestVmid,
        snapname: newSnapName,
        description: newSnapDescription || undefined,
        vmstate: newSnapVmstate
      });
      setSnapshotStatus(`Snapshot "${newSnapName}" created successfully`);
      setNewSnapName("");
      setNewSnapDescription("");
      setNewSnapVmstate(false);
      
      // Refresh snapshot list
      setTimeout(async () => {
        const data = await fetchGuestSnapshots({ type: guestType, node: guestNode, vmid: guestVmid });
        setSnapshots(data);
      }, 1000);
    } catch (err) {
      setSnapshotStatus(`Failed to create snapshot: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleRollbackSnapshot = async (snapname: string) => {
    if (isRollbackInProgress) {
      return;
    }

    if (!window.confirm(`Rollback ${name} to snapshot "${snapname}"? This will restore the guest to the state of this snapshot.`)) {
      return;
    }

    setIsRollbackInProgress(true);
    setSnapshotStatus(`Starting rollback to snapshot "${snapname}"...`);
    try {
      const { upid } = await rollbackGuestSnapshot({
        type: guestType,
        node: guestNode,
        vmid: guestVmid,
        snapname,
        reason: `Manual rollback from web UI`
      });

      setSnapshotStatus(`Rollback task queued. Monitoring progress...`);
      const result = await waitForTaskCompletion(upid);

      if (result.success) {
        setSnapshotStatus(`Rollback to snapshot "${snapname}" completed successfully`);

        if (window.confirm("Delete this snapshot now?")) {
          setSnapshotStatus(`Deleting snapshot "${snapname}"...`);
          await deleteGuestSnapshot({
            type: guestType,
            node: guestNode,
            vmid: guestVmid,
            snapname,
            reason: `Post-rollback cleanup from web UI`
          });
          setSnapshotStatus(`Rollback completed and snapshot "${snapname}" deleted`);
        }
      } else {
        setSnapshotStatus(
          `Rollback task finished with status "${result.exitstatus || "unknown"}". Check Proxmox tasks for details.`
        );
      }

      const [guestDetails, snapshotData] = await Promise.all([
        fetchGuestDetails({ type: guestType, node: guestNode, vmid: guestVmid }),
        fetchGuestSnapshots({ type: guestType, node: guestNode, vmid: guestVmid })
      ]);

      setGuestData(guestDetails);
      setSnapshots(snapshotData);
    } catch (err) {
      setSnapshotStatus(`Failed to rollback: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsRollbackInProgress(false);
    }
  };

  const handleDeleteSnapshot = async (snapname: string) => {
    if (isRollbackInProgress) {
      return;
    }

    if (!window.confirm(`Delete snapshot "${snapname}"? This action cannot be undone.`)) {
      return;
    }

    setSnapshotStatus(`Deleting snapshot "${snapname}"...`);
    try {
      await deleteGuestSnapshot({
        type: guestType,
        node: guestNode,
        vmid: guestVmid,
        snapname,
        reason: `Manual deletion from web UI`
      });
      setSnapshotStatus(`Snapshot "${snapname}" deleted successfully`);
      
      // Refresh snapshot list
      setTimeout(async () => {
        const data = await fetchGuestSnapshots({ type: guestType, node: guestNode, vmid: guestVmid });
        setSnapshots(data);
      }, 1000);
    } catch (err) {
      setSnapshotStatus(`Failed to delete snapshot: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  if (loading) {
    return <div className="status">Loading guest details...</div>;
  }

  if (error) {
    return (
      <div>
        <div className="status error">{error}</div>
        <Link to="/" className="button-link">
          ← Back to Overview
        </Link>
      </div>
    );
  }

  if (!guestData) {
    return <div className="status">No guest data available</div>;
  }

  const { config, status } = guestData;
  const name = String(config.name || config.hostname || "-");
  const guestStatus = String(status.status || "-");
  const memory = config.memory ? `${config.memory} MB` : "-";
  const cores = String(config.cores || config.cpus || "-");
  const cpuUsage = status.cpu != null ? `${Math.round(Number(status.cpu) * 100)}%` : "-";
  const memUsage =
    status.mem != null && status.maxmem != null
      ? `${Math.round((Number(status.mem) / Number(status.maxmem)) * 100)}%`
      : "-";
  const diskUsage =
    status.disk != null && status.maxdisk != null
      ? `${Math.round((Number(status.disk) / Number(status.maxdisk)) * 100)}%`
      : "-";
  const uptime = status.uptime != null ? `${Math.floor(Number(status.uptime) / 60)} minutes` : "-";
  const assignedIp = typeof guestData.assignedIp === "string" && guestData.assignedIp.trim()
    ? guestData.assignedIp.trim()
    : "-";

  const configEntries = Object.entries(config)
    .filter(([key]) => !["name", "hostname", "memory", "cores", "cpus"].includes(key))
    .sort(([a], [b]) => a.localeCompare(b));

  // Prepare chart data
  const chartData = metrics.map((m) => ({
    time: new Date(m.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    cpu: Math.round(m.cpu * 100),
    memory: m.maxmem > 0 ? Math.round((m.mem / m.maxmem) * 100) : 0,
    disk: m.maxdisk > 0 ? Math.round((m.disk / m.maxdisk) * 100) : 0
  }));
  const lastMetricTimestamp =
    metrics.length > 0
      ? new Date(metrics[metrics.length - 1].timestamp * 1000).toLocaleString()
      : null;

  return (
    <>
      <div className="guest-detail-header">
        <div>
          <h2>
            {name} ({guestType.toUpperCase()} {guestVmid})
          </h2>
          <p>
            Node: {guestNode} • Status:{" "}
            <span className={`status-badge status-${guestStatus}`}>{guestStatus}</span>
          </p>
        </div>
        <Link to="/" className="button-link">
          ← Back to Overview
        </Link>
      </div>

      <section className="grid two-col">
        <section className="card">
          <h2>Resource Usage</h2>
          <div className="stats-grid-compact">
            <div className="stat-item">
              <div className="label">CPU Usage</div>
              <div className="value">{cpuUsage}</div>
            </div>
            <div className="stat-item">
              <div className="label">Memory Usage</div>
              <div className="value">{memUsage}</div>
            </div>
            <div className="stat-item">
              <div className="label">Disk Usage</div>
              <div className="value">{diskUsage}</div>
            </div>
            <div className="stat-item">
              <div className="label">Uptime</div>
              <div className="value">{uptime}</div>
            </div>
          </div>
        </section>

        <section className="card">
          <h2>Configuration</h2>
          <div className="config-list">
            <div className="config-item">
              <span className="config-key">Cores:</span>
              <span className="config-value">{cores || 'N/A'}</span>
            </div>
            <div className="config-item">
              <span className="config-key">Memory:</span>
              <span className="config-value">{memory || 'N/A'}</span>
            </div>
            <div className="config-item">
              <span className="config-key">Assigned IP:</span>
              <span className="config-value">{assignedIp}</span>
            </div>
          </div>
        </section>
      </section>

      <section className="card">
        <h2>Power Controls</h2>
        <div style={{ marginBottom: "1rem", color: "#d97706", fontSize: "0.95rem" }}>
          ⚠️ To use the console, you must be logged into the Proxmox web GUI in your browser. If the console does not load, open Proxmox in a new tab and log in, then try again.
        </div>
        <div className="actions">
          <button type="button" onClick={handleOpenConsole}>
            open console
          </button>
          <button type="button" onClick={() => handleActionWithConfirm("start")} disabled={!canOperate}>
            start
          </button>
          <button type="button" onClick={() => handleActionWithConfirm("stop")} disabled={!canOperate}>
            stop
          </button>
          <button type="button" onClick={() => handleActionWithConfirm("reboot")} disabled={!canOperate}>
            reboot
          </button>
          <button type="button" onClick={() => handleActionWithConfirm("shutdown")} disabled={!canOperate}>
            shutdown
          </button>
        </div>
        <div className="action-status">{actionStatus}</div>
      </section>

      <section className="card">
        <h2>Resource Usage - Last 24 Hours</h2>
        <p style={{ fontSize: "0.85rem", color: "#666", marginBottom: "1rem" }}>
          Last metrics update: {lastMetricTimestamp ?? "Waiting for first data point..."}
        </p>
        {chartData.length > 0 ? (
          <>
            <div style={{ marginBottom: "2rem" }}>
              <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>CPU Usage (%)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="cpu" stroke="#8884d8" name="CPU %" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ marginBottom: "2rem" }}>
              <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Memory Usage (%)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="memory" stroke="#82ca9d" name="Memory %" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div>
              <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Disk Usage (%)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="disk" stroke="#ffc658" name="Disk %" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : (
          <div style={{ padding: "2rem", textAlign: "center", color: "#888" }}>
            <p>📊 Collecting historical metrics...</p>
            <p style={{ fontSize: "0.9rem", marginTop: "0.5rem" }}>
              Historical data will appear here as it's collected every 5 minutes.
              <br />
              Check back in 10-15 minutes to see trend charts.
            </p>
            <p style={{ fontSize: "0.85rem", marginTop: "1rem", color: "#666" }}>
              Current metrics: {metrics.length} data points collected
            </p>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Snapshot Management</h2>
        
        {canOperate && (
          <div style={{ marginBottom: "2rem" }}>
            <div className="snapshot-form">
              <h3>Create New Snapshot</h3>
              <label>
                <span>
                  Snapshot Name <span style={{ color: "#f87171" }}>*</span>
                </span>
                <input
                  type="text"
                  value={newSnapName}
                  onChange={(e) => setNewSnapName(e.target.value)}
                  placeholder="e.g., before-update"
                />
              </label>
              <label>
                Description
                <input
                  type="text"
                  value={newSnapDescription}
                  onChange={(e) => setNewSnapDescription(e.target.value)}
                  placeholder="Optional description"
                />
              </label>
              {guestType === "qemu" && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={newSnapVmstate}
                    onChange={(e) => setNewSnapVmstate(e.target.checked)}
                  />
                  <span>Include VM state (RAM) - allows restoring running state</span>
                </label>
              )}
              <button type="button" onClick={handleCreateSnapshot} disabled={!canOperate || isRollbackInProgress}>
                Create Snapshot
              </button>
            </div>
          </div>
        )}

        <div style={{ marginBottom: "1rem", fontSize: "0.9rem", color: snapshotStatus.includes("Failed") ? "#fecaca" : "#9ca3af" }}>
          Status: {snapshotStatus}
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Timestamp</th>
                <th>Parent</th>
                {canOperate && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {snapshots.length === 0 ? (
                <tr>
                  <td colSpan={canOperate ? 5 : 4} style={{ textAlign: "center", padding: "2rem", color: "#888" }}>
                    No snapshots found. {canOperate && "Create one using the form above."}
                  </td>
                </tr>
              ) : (
                snapshots.map((snap) => {
                  const snapname = (snap.name || "").trim();
                  const isCurrentMarker = snapname.toLowerCase() === "current";

                  return (
                    <tr key={snap.name}>
                      <td style={{ fontWeight: "500" }}>{snap.name || "-"}</td>
                      <td>{snap.description || "-"}</td>
                      <td>
                        {snap.snaptime
                          ? new Date(snap.snaptime * 1000).toLocaleString()
                          : "-"}
                      </td>
                      <td>{snap.parent || "-"}</td>
                      {canOperate && (
                        <td>
                          {isCurrentMarker ? (
                            <span style={{ color: "#9ca3af", fontSize: "0.85rem" }}>Current state</span>
                          ) : (
                            <div style={{ display: "flex", gap: "0.5rem" }}>
                              <button
                                type="button"
                                onClick={() => handleRollbackSnapshot(snapname)}
                                disabled={!snapname || isRollbackInProgress}
                                style={{ padding: "0.25rem 0.75rem", fontSize: "0.85rem" }}
                              >
                                {isRollbackInProgress ? "Rollback Running..." : "Rollback"}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteSnapshot(snapname)}
                                disabled={!snapname || isRollbackInProgress}
                                style={{ padding: "0.25rem 0.75rem", fontSize: "0.85rem", background: "#d32f2f" }}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Full Configuration</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {configEntries.length === 0 ? (
                <tr>
                  <td colSpan={2}>No additional config</td>
                </tr>
              ) : (
                configEntries.map(([key, value]) => (
                  <tr key={key}>
                    <td>{key}</td>
                    <td>{String(value)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
