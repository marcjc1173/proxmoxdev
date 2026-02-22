import { useEffect, useState } from "react";
import {
  fetchAlarms,
  fetchOverview,
  evaluateAlarmsNow,
  acknowledgeAlarm,
  silenceAlarm,
  AlarmRecord,
  OverviewData,
  getStoredRole
} from "../api";

export function AlarmsPage() {
  const [alarms, setAlarms] = useState<AlarmRecord[]>([]);
  const [alarmStatus, setAlarmStatus] = useState<string>("-");
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [taskFilterText, setTaskFilterText] = useState<string>("");
  const [taskFilterStatus, setTaskFilterStatus] = useState<string>("all");

  const currentRole = getStoredRole();
  const canOperate = currentRole === "operator" || currentRole === "admin";
  const canAdmin = currentRole === "admin";

  useEffect(() => {
    const refresh = () => {
      fetchAlarms().then((res) => setAlarms(res.alarms)).catch(() => setAlarms([]));
      fetchOverview().then(setOverview).catch(() => setOverview(null));
    };
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleEvaluateAlarmsNow = async () => {
    setAlarmStatus("evaluating...");
    try {
      await evaluateAlarmsNow();
      setAlarmStatus("evaluation complete");
      fetchAlarms().then((res) => setAlarms(res.alarms));
    } catch (err) {
      setAlarmStatus(`evaluation failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  };

  const handleAcknowledgeAlarm = async (id: string) => {
    try {
      await acknowledgeAlarm(id);
      fetchAlarms().then((res) => setAlarms(res.alarms));
    } catch (err) {
      setAlarmStatus(`acknowledge failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  };

  const handleSilenceAlarm = async (id: string) => {
    try {
      await silenceAlarm(id, 60); // Silence for 60 minutes by default
      fetchAlarms().then((res) => setAlarms(res.alarms));
    } catch (err) {
      setAlarmStatus(`silence failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  };

  const tasks = overview?.tasks || [];
  const filteredTasks = tasks.filter((task) => {
    if (taskFilterStatus !== "all" && task.status !== taskFilterStatus) return false;
    if (taskFilterText) {
      const lower = taskFilterText.toLowerCase();
      return (
        String(task.node).toLowerCase().includes(lower) ||
        String(task.type).toLowerCase().includes(lower) ||
        String(task.user).toLowerCase().includes(lower) ||
        String(task.id).toLowerCase().includes(lower)
      );
    }
    return true;
  });

  return (
    <>
      <section className="card">
        <h2>Alarms</h2>
        <div className="actions">
          <button type="button" onClick={handleEvaluateAlarmsNow} disabled={!canAdmin}>
            evaluate now
          </button>
        </div>
        <div className="action-status">{alarmStatus}</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Severity</th>
                <th>State</th>
                <th>Source</th>
                <th>Message</th>
                <th>Last Seen</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {alarms.length === 0 ? (
                <tr>
                  <td colSpan={6}>No alarms</td>
                </tr>
              ) : (
                alarms.slice(0, 40).map((alarm) => (
                  <tr key={alarm.id}>
                    <td>{alarm.severity}</td>
                    <td>{alarm.state}</td>
                    <td>{alarm.source}</td>
                    <td>{alarm.message}</td>
                    <td>{new Date(alarm.lastSeenAt).toLocaleString()}</td>
                    <td>
                      <div className="actions">
                        <button
                          type="button"
                          onClick={() => handleAcknowledgeAlarm(alarm.id)}
                          disabled={!canOperate || alarm.state === "resolved"}
                        >
                          acknowledge
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSilenceAlarm(alarm.id)}
                          disabled={!canOperate || alarm.state === "resolved"}
                        >
                          silence
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Task History Filters</h2>
        <div className="task-filters">
          <label>
            Status
            <select value={taskFilterStatus} onChange={(event) => setTaskFilterStatus(event.target.value)}>
              <option value="all">all</option>
              <option value="OK">OK</option>
              <option value="running">running</option>
              <option value="ERROR">ERROR</option>
            </select>
          </label>
          <label>
            Search (node/type/user/id)
            <input
              value={taskFilterText}
              onChange={(event) => setTaskFilterText(event.target.value)}
              placeholder="node1 backup root@pam"
            />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Recent Tasks</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Node</th>
                <th>Type</th>
                <th>User</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.length === 0 ? (
                <tr>
                  <td colSpan={5}>No tasks</td>
                </tr>
              ) : (
                filteredTasks.slice(0, 20).map((task, idx) => (
                  <tr key={idx}>
                    <td>
                      {task.starttime ? new Date(Number(task.starttime) * 1000).toLocaleString() : "-"}
                    </td>
                    <td>{String(task.node ?? "-")}</td>
                    <td>{String(task.type ?? "-")}</td>
                    <td>{String(task.user ?? "-")}</td>
                    <td>{String(task.status ?? "-")}</td>
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
