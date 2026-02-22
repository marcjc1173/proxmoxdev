import { useEffect, useRef, useState } from "react";
import {
  deployFromTemplate,
  deployFromIso,
  fetchProvisioningTemplates,
  fetchProvisioningIsos,
  uploadProvisioningIso,
  fetchTaskStatus,
  fetchOverview,
  getStoredRole,
  ProvisioningTemplate,
  ProvisioningIso
} from "../api";

interface DeploymentTrackerStep {
  step: string;
  upid: string;
  status: "pending" | "running" | "ok" | "failed" | "timeout";
  exitstatus?: string;
  node?: string;
  lastCheckedAt?: string;
}

interface DeploymentTrackerState {
  title: string;
  steps: DeploymentTrackerStep[];
}

const DEPLOYMENT_TRACKER_STORAGE_KEY = "pc_deployment_tracker_v1";

function loadDeploymentTrackerState(): DeploymentTrackerState {
  const fallback: DeploymentTrackerState = { title: "-", steps: [] };
  try {
    const raw = window.localStorage.getItem(DEPLOYMENT_TRACKER_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<DeploymentTrackerState>;
    return {
      title: typeof parsed.title === "string" ? parsed.title : "-",
      steps: Array.isArray(parsed.steps) ? parsed.steps : []
    };
  } catch {
    return fallback;
  }
}

function saveDeploymentTrackerState(input: DeploymentTrackerState): void {
  try {
    if (input.steps.length === 0 && input.title === "-") {
      window.localStorage.removeItem(DEPLOYMENT_TRACKER_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(DEPLOYMENT_TRACKER_STORAGE_KEY, JSON.stringify(input));
  } catch {
    // best-effort
  }
}

export function ProvisioningPage() {
  const currentRole = getStoredRole();
  const canOperate = currentRole === "operator" || currentRole === "admin";

  const [availableNodes, setAvailableNodes] = useState<string[]>([]);
  const [templates, setTemplates] = useState<ProvisioningTemplate[]>([]);
  const [provisionStatus, setProvisionStatus] = useState<string>("-");
  const [provisionTemplateKey, setProvisionTemplateKey] = useState<string>("");
  const [provisionTargetNode, setProvisionTargetNode] = useState<string>("");
  const [provisionNewId, setProvisionNewId] = useState<string>("");
  const [provisionName, setProvisionName] = useState<string>("");
  const [provisionCores, setProvisionCores] = useState<string>("2");
  const [provisionMemory, setProvisionMemory] = useState<string>("2048");
  const [provisionBridge, setProvisionBridge] = useState<string>("vmbr0");
  const [provisionVlanTag, setProvisionVlanTag] = useState<string>("");
  const [provisionCiUser, setProvisionCiUser] = useState<string>("");
  const [provisionCiPassword, setProvisionCiPassword] = useState<string>("");
  const [provisionIpConfig0, setProvisionIpConfig0] = useState<string>("");
  const [provisionSshKeys, setProvisionSshKeys] = useState<string>("");
  const [provisionStartAfter, setProvisionStartAfter] = useState<boolean>(true);

  const [isoList, setIsoList] = useState<ProvisioningIso[]>([]);
  const [isoStatus, setIsoStatus] = useState<string>("-");
  const [isoNode, setIsoNode] = useState<string>("");
  const [isoUploadStorage, setIsoUploadStorage] = useState<string>("local");
  const [isoUploadFile, setIsoUploadFile] = useState<File | null>(null);
  const [isoUploadStatus, setIsoUploadStatus] = useState<string>("-");
  const [isoUploadProgress, setIsoUploadProgress] = useState<number | null>(null);
  const [isIsoUploading, setIsIsoUploading] = useState<boolean>(false);
  const [isoSelection, setIsoSelection] = useState<string>("");
  const [isoNewId, setIsoNewId] = useState<string>("");
  const [isoName, setIsoName] = useState<string>("");
  const [isoCores, setIsoCores] = useState<string>("2");
  const [isoMemory, setIsoMemory] = useState<string>("2048");
  const [isoDiskGb, setIsoDiskGb] = useState<string>("32");
  const [isoBridge, setIsoBridge] = useState<string>("vmbr0");
  const [isoVlanTag, setIsoVlanTag] = useState<string>("");
  const [isoStartAfter, setIsoStartAfter] = useState<boolean>(false);

  const [deploymentTrackerTitle, setDeploymentTrackerTitle] = useState<string>(
    () => loadDeploymentTrackerState().title
  );
  const [deploymentTrackerSteps, setDeploymentTrackerSteps] = useState<DeploymentTrackerStep[]>(
    () => loadDeploymentTrackerState().steps
  );

  const isoUploadAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    saveDeploymentTrackerState({ title: deploymentTrackerTitle, steps: deploymentTrackerSteps });
  }, [deploymentTrackerTitle, deploymentTrackerSteps]);

  useEffect(() => {
    // Fetch available nodes and auto-populate node fields
    fetchOverview()
      .then((overview) => {
        const nodes = overview.nodes.map((n: any) => String(n.node || "")).filter(Boolean);
        setAvailableNodes(nodes);
        
        // Auto-populate node fields with the first available node
        if (nodes.length > 0) {
          const firstNode = nodes[0];
          if (!provisionTargetNode) {
            setProvisionTargetNode(firstNode);
          }
          if (!isoNode) {
            setIsoNode(firstNode);
          }
        }
      })
      .catch(() => setAvailableNodes([]));
  }, []);

  useEffect(() => {
    fetchProvisioningTemplates().then((res) => setTemplates(res.templates)).catch(() => setTemplates([]));
  }, []);

  useEffect(() => {
    if (!isoNode) return;
    fetchProvisioningIsos(isoNode).then((res) => setIsoList(res.isos)).catch(() => setIsoList([]));
  }, [isoNode]);

  const handleDeployFromTemplate = async () => {
    setProvisionStatus("deploying...");
    try {
      const [node, vmidStr] = provisionTemplateKey.split(":");
      const result = await deployFromTemplate({
        templateNode: node,
        templateVmid: Number(vmidStr),
        targetNode: provisionTargetNode,
        newid: Number(provisionNewId),
        name: provisionName,
        cores: Number(provisionCores),
        memory: Number(provisionMemory),
        bridge: provisionBridge,
        vlanTag: provisionVlanTag ? Number(provisionVlanTag) : undefined,
        ciuser: provisionCiUser || undefined,
        cipassword: provisionCiPassword || undefined,
        ipconfig0: provisionIpConfig0 || undefined,
        sshkeys: provisionSshKeys || undefined,
        startAfterDeploy: provisionStartAfter
      });

      setDeploymentTrackerTitle(`Template deployment: ${provisionName} (${result.vmid})`);
      setDeploymentTrackerSteps(
        result.steps.map((s) => ({ ...s, status: "pending" as const, node: result.node }))
      );
      setProvisionStatus("deployment initiated");
    } catch (err) {
      setProvisionStatus(`deployment failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  };

  const handleUploadIsoFromWorkstation = async () => {
    if (!isoUploadFile) return;
    setIsoUploadStatus("uploading...");
    setIsoUploadProgress(0);
    setIsIsoUploading(true);

    const controller = new AbortController();
    isoUploadAbortControllerRef.current = controller;

    try {
      await uploadProvisioningIso({
        node: isoNode,
        storage: isoUploadStorage,
        file: isoUploadFile,
        onProgress: setIsoUploadProgress,
        signal: controller.signal
      });
      setIsoUploadStatus("upload complete");
      setIsoUploadFile(null);
      fetchProvisioningIsos(isoNode).then((res) => setIsoList(res.isos)).catch(() => setIsoList([]));
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setIsoUploadStatus("upload cancelled");
      } else {
        setIsoUploadStatus(`upload failed: ${err instanceof Error ? err.message : "unknown"}`);
      }
    } finally {
      setIsIsoUploading(false);
      setIsoUploadProgress(null);
      isoUploadAbortControllerRef.current = null;
    }
  };

  const handleCancelIsoUpload = () => {
    isoUploadAbortControllerRef.current?.abort();
  };

  const handleDeployFromIso = async () => {
    setIsoStatus("deploying...");
    try {
      const [storage, file] = isoSelection.split(":");
      const result = await deployFromIso({
        node: isoNode,
        newid: Number(isoNewId),
        name: isoName,
        isoStorage: storage,
        isoFile: file,
        cores: Number(isoCores),
        memory: Number(isoMemory),
        diskGb: Number(isoDiskGb),
        bridge: isoBridge,
        vlanTag: isoVlanTag ? Number(isoVlanTag) : undefined,
        startAfterDeploy: isoStartAfter
      });

      setDeploymentTrackerTitle(`ISO deployment: ${isoName} (${result.vmid})`);
      setDeploymentTrackerSteps(
        result.steps.map((s) => ({ ...s, status: "pending" as const, node: result.node }))
      );
      setIsoStatus("deployment initiated");
    } catch (err) {
      setIsoStatus(`deployment failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  };

  useEffect(() => {
    if (deploymentTrackerSteps.length === 0) return;

    const interval = setInterval(() => {
      deploymentTrackerSteps.forEach(async (step, index) => {
        if (step.status === "ok" || step.status === "failed" || step.status === "timeout") return;

        try {
          const result = await fetchTaskStatus({ upid: step.upid, node: step.node });
          const newStatus = result.status === "stopped" ? "ok" : "running";
          setDeploymentTrackerSteps((prev) =>
            prev.map((s, i) =>
              i === index
                ? {
                    ...s,
                    status: newStatus,
                    exitstatus: String(result.exitstatus || ""),
                    lastCheckedAt: new Date().toISOString()
                  }
                : s
            )
          );
        } catch {
          setDeploymentTrackerSteps((prev) =>
            prev.map((s, i) => (i === index ? { ...s, status: "timeout" as const } : s))
          );
        }
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [deploymentTrackerSteps]);

  return (
    <>
      <section className="grid two-col">
        <section className="card">
          <h2>Provisioning Wizard (Template)</h2>
          <div className="snapshot-form">
            <label>
              Template
              <select
                value={provisionTemplateKey}
                onChange={(event) => setProvisionTemplateKey(event.target.value)}
              >
                {templates.length === 0 ? (
                  <option value="">No templates found</option>
                ) : (
                  templates.map((template) => (
                    <option key={`${template.node}:${template.vmid}`} value={`${template.node}:${template.vmid}`}>
                      {template.node} / {template.vmid} / {template.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label>
              Target Node
              <select
                value={provisionTargetNode}
                onChange={(event) => setProvisionTargetNode(event.target.value)}
              >
                {availableNodes.length === 0 && <option value="">-- Loading nodes --</option>}
                {availableNodes.map((node) => (
                  <option key={node} value={node}>
                    {node}
                  </option>
                ))}
              </select>
            </label>
            <label>
              New VMID
              <input
                value={provisionNewId}
                onChange={(event) => setProvisionNewId(event.target.value)}
                placeholder="300"
              />
            </label>
            <label>
              VM Name
              <input
                value={provisionName}
                onChange={(event) => setProvisionName(event.target.value)}
                placeholder="web-prod-01"
              />
            </label>
            <label>
              Cores
              <input value={provisionCores} onChange={(event) => setProvisionCores(event.target.value)} />
            </label>
            <label>
              Memory (MB)
              <input value={provisionMemory} onChange={(event) => setProvisionMemory(event.target.value)} />
            </label>
            <label>
              Bridge
              <input value={provisionBridge} onChange={(event) => setProvisionBridge(event.target.value)} placeholder="vmbr0" />
            </label>
            <label>
              VLAN Tag (optional)
              <input value={provisionVlanTag} onChange={(event) => setProvisionVlanTag(event.target.value)} placeholder="100" />
            </label>
            <label>
              Cloud-init User (optional)
              <input value={provisionCiUser} onChange={(event) => setProvisionCiUser(event.target.value)} />
            </label>
            <label>
              Cloud-init Password (optional)
              <input type="password" value={provisionCiPassword} onChange={(event) => setProvisionCiPassword(event.target.value)} />
            </label>
            <label>
              Cloud-init ipconfig0 (optional)
              <input value={provisionIpConfig0} onChange={(event) => setProvisionIpConfig0(event.target.value)} placeholder="ip=dhcp" />
            </label>
            <label>
              SSH Keys (optional)
              <input value={provisionSshKeys} onChange={(event) => setProvisionSshKeys(event.target.value)} placeholder="ssh-rsa AAAA..." />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={provisionStartAfter}
                onChange={(event) => setProvisionStartAfter(event.target.checked)}
              />
              Start VM after deploy
            </label>
            <button type="button" onClick={handleDeployFromTemplate} disabled={!canOperate}>
              deploy from template
            </button>
            <div className="action-status">{provisionStatus}</div>
          </div>
        </section>

        <section className="card">
          <h2>Provisioning Wizard (ISO)</h2>
          <div className="snapshot-form">
            <label>
              Node
              <select value={isoNode} onChange={(event) => setIsoNode(event.target.value)}>
                {availableNodes.length === 0 && <option value="">-- Loading nodes --</option>}
                {availableNodes.map((node) => (
                  <option key={node} value={node}>
                    {node}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Upload Storage
              <input value={isoUploadStorage} onChange={(event) => setIsoUploadStorage(event.target.value)} placeholder="local" />
            </label>
            <label>
              Upload ISO from workstation
              <input type="file" accept=".iso" onChange={(event) => setIsoUploadFile(event.target.files?.[0] ?? null)} />
            </label>
            <button type="button" onClick={handleUploadIsoFromWorkstation} disabled={!canOperate || isIsoUploading}>
              upload iso
            </button>
            {isIsoUploading ? (
              <button type="button" onClick={handleCancelIsoUpload}>
                cancel upload
              </button>
            ) : null}
            {isoUploadProgress !== null ? (
              <label>
                Upload Progress
                <progress value={isoUploadProgress} max={100} />
                <div className="action-status">{isoUploadProgress}%</div>
              </label>
            ) : null}
            <div className="action-status">{isoUploadStatus}</div>
            <label>
              ISO
              <select value={isoSelection} onChange={(event) => setIsoSelection(event.target.value)}>
                {isoList.length === 0 ? (
                  <option value="">No ISOs found</option>
                ) : (
                  isoList.map((iso) => (
                    <option key={`${iso.storage}:${iso.file}`} value={`${iso.storage}:${iso.file}`}>
                      {iso.storage} / {iso.file}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label>
              New VMID
              <input value={isoNewId} onChange={(event) => setIsoNewId(event.target.value)} placeholder="400" />
            </label>
            <label>
              VM Name
              <input value={isoName} onChange={(event) => setIsoName(event.target.value)} placeholder="ubuntu-install-01" />
            </label>
            <label>
              Cores
              <input value={isoCores} onChange={(event) => setIsoCores(event.target.value)} />
            </label>
            <label>
              Memory (MB)
              <input value={isoMemory} onChange={(event) => setIsoMemory(event.target.value)} />
            </label>
            <label>
              Disk (GB)
              <input value={isoDiskGb} onChange={(event) => setIsoDiskGb(event.target.value)} />
            </label>
            <label>
              Bridge
              <input value={isoBridge} onChange={(event) => setIsoBridge(event.target.value)} placeholder="vmbr0" />
            </label>
            <label>
              VLAN Tag (optional)
              <input value={isoVlanTag} onChange={(event) => setIsoVlanTag(event.target.value)} placeholder="100" />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={isoStartAfter}
                onChange={(event) => setIsoStartAfter(event.target.checked)}
              />
              Start VM after create
            </label>
            <button type="button" onClick={handleDeployFromIso} disabled={!canOperate}>
              deploy from iso
            </button>
            <div className="action-status">{isoStatus}</div>
          </div>
        </section>
      </section>

      <section className="card">
        <h2>Deployment Task Tracker</h2>
        <div className="action-status">{deploymentTrackerTitle}</div>
        {deploymentTrackerSteps.length === 0 ? (
          <div className="action-status">No tracked deployment yet</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Step</th>
                  <th>UPID</th>
                  <th>Status</th>
                  <th>Exit</th>
                  <th>Last Checked</th>
                </tr>
              </thead>
              <tbody>
                {deploymentTrackerSteps.map((item) => (
                  <tr key={`${item.upid}:${item.step}`}>
                    <td>{item.step}</td>
                    <td>{item.upid}</td>
                    <td>{item.status}</td>
                    <td>{item.exitstatus ?? "-"}</td>
                    <td>
                      {item.lastCheckedAt ? new Date(item.lastCheckedAt).toLocaleTimeString() : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="actions">
          <button
            type="button"
            onClick={() => {
              setDeploymentTrackerTitle("-");
              setDeploymentTrackerSteps([]);
            }}
          >
            clear tracker
          </button>
        </div>
      </section>
    </>
  );
}
