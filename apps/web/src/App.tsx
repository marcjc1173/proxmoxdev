import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import {
  fetchAuthConfig,
  login,
  setAuthSession,
  clearAuthSession,
  hasAuthToken,
  getStoredRole,
  getStoredUsername
} from "./api";
import { Layout } from "./components/Layout";
import { OverviewPage } from "./pages/OverviewPage";
import { GuestDetailPage } from "./pages/GuestDetailPage";
import { ProvisioningPage } from "./pages/ProvisioningPage";
import { SnapshotsPage } from "./pages/SnapshotsPage";
import { AlarmsPage } from "./pages/AlarmsPage";
import { AdminPage } from "./pages/AdminPage";

export function App() {
  const [authEnabled, setAuthEnabled] = useState<boolean>(false);
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [loginUsername, setLoginUsername] = useState<string>("");
  const [loginPassword, setLoginPassword] = useState<string>("");
  const [loginError, setLoginError] = useState<string>("");
  const [authVersion, setAuthVersion] = useState<number>(0);

  useEffect(() => {
    fetchAuthConfig()
      .then((config) => {
        setAuthEnabled(config.enabled);
        setAuthChecked(true);
      })
      .catch(() => {
        setAuthEnabled(false);
        setAuthChecked(true);
      });
  }, [authVersion]);

  const handleLogin = async () => {
    setLoginError("");
    try {
      const result = await login({ username: loginUsername, password: loginPassword });
      setAuthSession({ token: result.token, role: result.user.role, username: result.user.username });
      setLoginUsername("");
      setLoginPassword("");
      setAuthVersion((prev) => prev + 1);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Login failed");
    }
  };

  const handleLogout = () => {
    clearAuthSession();
    setAuthVersion((prev) => prev + 1);
  };

  if (!authChecked) {
    return <div className="layout">Loading authentication config...</div>;
  }

  if (authEnabled && !hasAuthToken()) {
    return (
      <div className="layout">
        <section className="card login-card">
          <h2>Sign In</h2>
          <form
            className="snapshot-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleLogin();
            }}
          >
            <label>
              Username
              <input
                value={loginUsername}
                onChange={(event) => setLoginUsername(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && handleLogin()}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && handleLogin()}
              />
            </label>
            <button type="submit">
              sign in
            </button>
            {loginError ? <div className="status error">{loginError}</div> : null}
          </form>
        </section>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Layout authEnabled={authEnabled} onLogout={handleLogout}>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/guest/:type/:node/:vmid" element={<GuestDetailPage />} />
          <Route path="/provisioning" element={<ProvisioningPage />} />
          <Route path="/snapshots" element={<SnapshotsPage />} />
          <Route path="/alarms" element={<AlarmsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
