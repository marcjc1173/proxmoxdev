import { useEffect, useState } from "react";
import {
  fetchUsers,
  fetchActivityAudit,
  fetchAlarmNotifications,
  fetchPolicyGuardrails,
  createAppUser,
  updateAppUser,
  deleteAppUser,
  updatePolicyGuardrails,
  checkPolicyGuardrails,
  AdminUser,
  AppRole,
  ActivityAuditRecord,
  NotificationAuditRecord,
  PolicyGuardrails
} from "../api";

export function AdminPage() {
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminStatus, setAdminStatus] = useState<string>("-");
  const [newUserUsername, setNewUserUsername] = useState<string>("");
  const [newUserPassword, setNewUserPassword] = useState<string>("");
  const [newUserRole, setNewUserRole] = useState<AppRole>("viewer");
  const [resetPasswordByUser, setResetPasswordByUser] = useState<Record<string, string>>({});

  const [notificationAudit, setNotificationAudit] = useState<NotificationAuditRecord[]>([]);
  const [notificationAuditStatus, setNotificationAuditStatus] = useState<string>("-");

  const [activityAudit, setActivityAudit] = useState<ActivityAuditRecord[]>([]);
  const [activityAuditStatus, setActivityAuditStatus] = useState<string>("-");
  const [activityFilterUser, setActivityFilterUser] = useState<string>("");
  const [activityFilterAction, setActivityFilterAction] = useState<string>("");
  const [activityFilterResult, setActivityFilterResult] = useState<"all" | "success" | "failed">("all");

  const [policyGuardrails, setPolicyGuardrails] = useState<PolicyGuardrails>({
    enabled: false,
    maintenanceWindowEnabled: false,
    maintenanceStartHourUtc: 0,
    maintenanceEndHourUtc: 6,
    protectedVmids: [],
    protectedNames: []
  });
  const [policyProtectedVmidsText, setPolicyProtectedVmidsText] = useState<string>("");
  const [policyProtectedNamesText, setPolicyProtectedNamesText] = useState<string>("");
  const [policyStatus, setPolicyStatus] = useState<string>("-");

  useEffect(() => {
    refreshAdminUsers();
    refreshNotificationAudit();
    refreshActivityAudit();
    refreshPolicyGuardrails();
  }, []);

  const refreshAdminUsers = () => {
    fetchUsers().then((res) => setAdminUsers(res.users)).catch(() => setAdminUsers([]));
  };

  const refreshNotificationAudit = () => {
    setNotificationAuditStatus("loading...");
    fetchAlarmNotifications()
      .then((res) => {
        setNotificationAudit(res.notifications);
        setNotificationAuditStatus("loaded");
      })
      .catch((err) => setNotificationAuditStatus(`failed: ${err instanceof Error ? err.message : "unknown"}`));
  };

  const refreshActivityAudit = () => {
    setActivityAuditStatus("loading...");
    fetchActivityAudit()
      .then((res) => {
        setActivityAudit(res.activities);
        setActivityAuditStatus("loaded");
      })
      .catch((err) => setActivityAuditStatus(`failed: ${err instanceof Error ? err.message : "unknown"}`));
  };

  const refreshPolicyGuardrails = () => {
    fetchPolicyGuardrails()
      .then((res) => {
        setPolicyGuardrails(res.policy);
        setPolicyProtectedVmidsText(res.policy.protectedVmids.join(", "));
        setPolicyProtectedNamesText(res.policy.protectedNames.join("\n"));
        setPolicyStatus("loaded");
      })
      .catch((err) => setPolicyStatus(`failed: ${err instanceof Error ? err.message : "unknown"}`));
  };

  const handleCreateUser = async () => {
    setAdminStatus("creating...");
    try {
      await createAppUser({ username: newUserUsername, password: newUserPassword, role: newUserRole });
      setAdminStatus("user created");
      setNewUserUsername("");
      setNewUserPassword("");
      refreshAdminUsers();
    } catch (err) {
      setAdminStatus(`create failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  };

  const handleRoleChange = async (username: string, role: AppRole) => {
    try {
      await updateAppUser(username, { role });
      refreshAdminUsers();
    } catch (err) {
      setAdminStatus(`role update failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  };

  const handleResetPassword = async (username: string) => {
    const newPassword = resetPasswordByUser[username];
    if (!newPassword) return;
    try {
      await updateAppUser(username, { password: newPassword });
      setResetPasswordByUser((prev) => ({ ...prev, [username]: "" }));
      setAdminStatus(`password reset for ${username}`);
    } catch (err) {
      setAdminStatus(`reset failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  };

  const handleDeleteUser = async (username: string) => {
    try {
      await deleteAppUser(username, "Deleted via admin interface");
      setAdminStatus(`deleted ${username}`);
      refreshAdminUsers();
    } catch (err) {
      setAdminStatus(`delete failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  };

  const handleSavePolicyGuardrails = async () => {
    setPolicyStatus("saving...");
    try {
      const vmids = policyProtectedVmidsText
        .split(",")
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isInteger(v) && v > 0);
      const names = policyProtectedNamesText.split("\n").map((line) => line.trim()).filter(Boolean);

      await updatePolicyGuardrails({
        ...policyGuardrails,
        protectedVmids: vmids,
        protectedNames: names
      });
      setPolicyStatus("policy saved");
      refreshPolicyGuardrails();
    } catch (err) {
      setPolicyStatus(`save failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  };

  const filteredActivityAudit = activityAudit.filter((item) => {
    if (activityFilterResult !== "all" && (activityFilterResult === "success" ? !item.result.success : item.result.success))
      return false;
    if (activityFilterUser && !item.actor.toLowerCase().includes(activityFilterUser.toLowerCase())) return false;
    if (
      activityFilterAction &&
      !item.action.toLowerCase().includes(activityFilterAction.toLowerCase()) &&
      !item.target.toLowerCase().includes(activityFilterAction.toLowerCase())
    )
      return false;
    return true;
  });

  return (
    <>
      <section className="card">
        <h2>Admin Users</h2>
        <div className="snapshot-form">
          <label>
            New Username
            <input value={newUserUsername} onChange={(event) => setNewUserUsername(event.target.value)} placeholder="new-user" />
          </label>
          <label>
            New Password
            <input type="password" value={newUserPassword} onChange={(event) => setNewUserPassword(event.target.value)} placeholder="temporary password" />
          </label>
          <label>
            Role
            <select value={newUserRole} onChange={(event) => setNewUserRole(event.target.value as AppRole)}>
              <option value="viewer">viewer</option>
              <option value="operator">operator</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button type="button" onClick={handleCreateUser}>
            create user
          </button>
          <div className="action-status">{adminStatus}</div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Reset Password</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {adminUsers.map((user) => (
                <tr key={user.username}>
                  <td>{user.username}</td>
                  <td>
                    <select value={user.role} onChange={(event) => handleRoleChange(user.username, event.target.value as AppRole)}>
                      <option value="viewer">viewer</option>
                      <option value="operator">operator</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="password"
                      value={resetPasswordByUser[user.username] ?? ""}
                      onChange={(event) =>
                        setResetPasswordByUser((prev) => ({ ...prev, [user.username]: event.target.value }))
                      }
                      placeholder="new password"
                    />
                  </td>
                  <td>
                    <div className="actions">
                      <button type="button" onClick={() => handleResetPassword(user.username)}>
                        reset password
                      </button>
                      <button type="button" onClick={() => handleDeleteUser(user.username)}>
                        delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Notifications Audit</h2>
        <div className="actions">
          <button type="button" onClick={refreshNotificationAudit}>
            refresh notifications
          </button>
        </div>
        <div className="action-status">{notificationAuditStatus}</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Alarm</th>
                <th>Severity</th>
                <th>Provider</th>
                <th>Attempt</th>
                <th>Status</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {notificationAudit.length === 0 ? (
                <tr>
                  <td colSpan={7}>No notification audit records</td>
                </tr>
              ) : (
                notificationAudit.slice(0, 50).map((item) => (
                  <tr key={item.id}>
                    <td>{new Date(item.createdAt).toLocaleString()}</td>
                    <td>{item.alarmId}</td>
                    <td>{item.severity}</td>
                    <td>{item.provider}</td>
                    <td>
                      {item.attempt}/{item.maxAttempts}
                    </td>
                    <td>{item.success ? "success" : "failed"}</td>
                    <td>{item.error ?? "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Policy Guardrails</h2>
        <div className="snapshot-form">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={policyGuardrails.enabled}
              onChange={(event) => setPolicyGuardrails((prev) => ({ ...prev, enabled: event.target.checked }))}
            />
            Enable guardrails
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={policyGuardrails.maintenanceWindowEnabled}
              onChange={(event) =>
                setPolicyGuardrails((prev) => ({ ...prev, maintenanceWindowEnabled: event.target.checked }))
              }
            />
            Enforce maintenance window (UTC)
          </label>
          <label>
            Start Hour UTC (0-23)
            <input
              value={String(policyGuardrails.maintenanceStartHourUtc)}
              onChange={(event) => {
                const next = Number(event.target.value);
                setPolicyGuardrails((prev) => ({
                  ...prev,
                  maintenanceStartHourUtc: Number.isFinite(next) ? next : prev.maintenanceStartHourUtc
                }));
              }}
            />
          </label>
          <label>
            End Hour UTC (0-23)
            <input
              value={String(policyGuardrails.maintenanceEndHourUtc)}
              onChange={(event) => {
                const next = Number(event.target.value);
                setPolicyGuardrails((prev) => ({
                  ...prev,
                  maintenanceEndHourUtc: Number.isFinite(next) ? next : prev.maintenanceEndHourUtc
                }));
              }}
            />
          </label>
          <label>
            Protected VMIDs (comma-separated)
            <input
              value={policyProtectedVmidsText}
              onChange={(event) => setPolicyProtectedVmidsText(event.target.value)}
              placeholder="100,101,200"
            />
          </label>
          <label>
            Protected Names (one per line)
            <textarea
              value={policyProtectedNamesText}
              onChange={(event) => setPolicyProtectedNamesText(event.target.value)}
              rows={4}
              placeholder="prod-db-01"
            />
          </label>
          <div className="actions">
            <button type="button" onClick={handleSavePolicyGuardrails}>
              save policy
            </button>
            <button type="button" onClick={refreshPolicyGuardrails}>
              reload policy
            </button>
          </div>
          <div className="action-status">{policyStatus}</div>
        </div>
      </section>

      <section className="card">
        <h2>Activity Log</h2>
        <div className="actions">
          <button type="button" onClick={refreshActivityAudit}>
            refresh activity log
          </button>
          <button
            type="button"
            onClick={() => {
              setActivityFilterResult("all");
              setActivityFilterUser("");
              setActivityFilterAction("");
            }}
          >
            clear filters
          </button>
        </div>
        <div className="task-filters">
          <label>
            Result
            <select value={activityFilterResult} onChange={(event) => setActivityFilterResult(event.target.value as "all" | "success" | "failed")}>
              <option value="all">all</option>
              <option value="success">success</option>
              <option value="failed">failed</option>
            </select>
          </label>
          <label>
            User
            <input value={activityFilterUser} onChange={(event) => setActivityFilterUser(event.target.value)} placeholder="admin operator" />
          </label>
          <label>
            Action / Target
            <input value={activityFilterAction} onChange={(event) => setActivityFilterAction(event.target.value)} placeholder="DELETE snapshot / vmid" />
          </label>
        </div>
        <div className="action-status">{activityAuditStatus}</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Target</th>
                <th>Reason</th>
                <th>Status</th>
                <th>UPID</th>
              </tr>
            </thead>
            <tbody>
              {filteredActivityAudit.length === 0 ? (
                <tr>
                  <td colSpan={7}>No activity records</td>
                </tr>
              ) : (
                filteredActivityAudit.slice(0, 80).map((item) => (
                  <tr key={item.id}>
                    <td>{new Date(item.createdAt).toLocaleString()}</td>
                    <td>
                      {item.actor} ({item.role})
                    </td>
                    <td>{item.action}</td>
                    <td>{item.target}</td>
                    <td>{item.reason ?? "-"}</td>
                    <td>{item.result.success ? "success" : `failed (${item.result.statusCode})`}</td>
                    <td>{item.result.upid ?? "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
