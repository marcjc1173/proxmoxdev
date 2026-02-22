import { useState, useEffect } from "react";
import {
  fetchOverview,
  cloneGuest,
  convertVmToTemplate,
  GuestType,
  OverviewData,
  getStoredRole
} from "../api";

export function SnapshotsPage() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [selectedGuestKey, setSelectedGuestKey] = useState<string>("");
  const [cloneNewId, setCloneNewId] = useState<string>("");
  const [cloneName, setCloneName] = useState<string>("");
  const [cloneTargetNode, setCloneTargetNode] = useState<string>("");
  const [cloneStorage, setCloneStorage] = useState<string>("");
  const [cloneSnapname, setCloneSnapname] = useState<string>("");
  const [cloneFull, setCloneFull] = useState<boolean>(true);
  const [cloneStatus, setCloneStatus] = useState<string>("-");

  const currentRole = getStoredRole();
  const canOperate = currentRole === "operator" || currentRole === "admin";
  const canAdmin = currentRole === "admin";

  useEffect(() => {
    fetchOverview().then(setOverview).catch(() => setOverview(null));
  }, []);

  const guests = !overview
    ? []
    : [
        ...overview.qemuVms.map((vm: any) => ({
          key: `qemu:${vm.node}:${vm.vmid}`,
          type: "qemu" as const,
          node: String(vm.node ?? "-"),
          vmid: Number(vm.vmid ?? 0),
          name: String(vm.name ?? "-")
        })),
        ...overview.lxcVms.map((ct: any) => ({
          key: `lxc:${ct.node}:${ct.vmid}`,
          type: "lxc" as const,
          node: String(ct.node ?? "-"),
          vmid: Number(ct.vmid ?? 0),
          name: String(ct.name ?? "-")
        }))
      ].sort((a, b) => a.vmid - b.vmid);

  const selectedGuest = guests.find((g) => g.key === selectedGuestKey);

  const handleCloneGuest = async () => {
    if (!selectedGuest) return;
    setCloneStatus("cloning...");
    try {
      await cloneGuest({
        type: selectedGuest.type,
        node: selectedGuest.node,
        vmid: selectedGuest.vmid,
        newid: Number(cloneNewId),
        name: cloneName || undefined,
        target: cloneTargetNode || undefined,
        full: cloneFull,
        storage: cloneStorage || undefined,
        snapname: cloneSnapname || undefined
      });
      setCloneStatus("clone initiated");
    } catch (err) {
      setCloneStatus(`clone failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  };

  const handleConvertToTemplate = async () => {
    if (!selectedGuest) return;
    setCloneStatus("converting...");
    try {
      await convertVmToTemplate({
        type: selectedGuest.type,
        node: selectedGuest.node,
        vmid: selectedGuest.vmid,
        reason: "Manual conversion from web UI"
      });
      setCloneStatus("conversion initiated");
    } catch (err) {
      setCloneStatus(`conversion failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  };

  return (
    <>
      <section className="card">
        <h2>Clone / Template</h2>
        <div className="snapshot-form">
          <label>
            Source Guest
            <select value={selectedGuestKey} onChange={(event) => setSelectedGuestKey(event.target.value)}>
              <option value="">-- Select Guest --</option>
              {guests.map((guest) => (
                <option key={guest.key} value={guest.key}>
                  {guest.node} / {guest.type.toUpperCase()} / {guest.vmid} / {guest.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Clone VMID (newid)
            <input value={cloneNewId} onChange={(event) => setCloneNewId(event.target.value)} placeholder="200" />
          </label>
          <label>
            Clone Name (optional)
            <input value={cloneName} onChange={(event) => setCloneName(event.target.value)} placeholder="web-01-clone" />
          </label>
          <label>
            Target Node (optional)
            <input value={cloneTargetNode} onChange={(event) => setCloneTargetNode(event.target.value)} placeholder="node2" />
          </label>
          <label>
            Storage (optional)
            <input value={cloneStorage} onChange={(event) => setCloneStorage(event.target.value)} placeholder="local-lvm" />
          </label>
          <label>
            Snapshot Name (optional)
            <input value={cloneSnapname} onChange={(event) => setCloneSnapname(event.target.value)} placeholder="base-snap" />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={cloneFull}
              onChange={(event) => setCloneFull(event.target.checked)}
              disabled={selectedGuest?.type !== "qemu"}
            />
            Full clone (QEMU only)
          </label>
          <div className="actions">
            <button type="button" onClick={handleCloneGuest} disabled={!canOperate || !selectedGuest}>
              clone guest
            </button>
            <button type="button" onClick={handleConvertToTemplate} disabled={!canAdmin || !selectedGuest}>
              convert to template
            </button>
          </div>
          <div className="action-status">{cloneStatus}</div>
        </div>
      </section>
    </>
  );
}
