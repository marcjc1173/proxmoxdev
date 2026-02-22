import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { clearAuthSession, getStoredRole, getStoredUsername } from "../api";

interface LayoutProps {
  children: ReactNode;
  authEnabled: boolean;
  onLogout: () => void;
}

export function Layout({ children, authEnabled, onLogout }: LayoutProps) {
  const location = useLocation();
  const currentRole = getStoredRole();
  const currentUsername = getStoredUsername();
  const canAdmin = currentRole === "admin";

  const navigation = [
    { path: "/", label: "Overview" },
    { path: "/provisioning", label: "Provisioning" },
    { path: "/snapshots", label: "Cloning & Templates" },
    { path: "/alarms", label: "Alarms & Tasks" },
    ...(authEnabled && canAdmin ? [{ path: "/admin", label: "Administration" }] : [])
  ];

  const handleLogout = () => {
    clearAuthSession();
    onLogout();
  };

  return (
    <div className="layout">
      <header className="header">
        <div className="header-title">
          <h1>Proxmox Center</h1>
          <p>vCenter-style operations dashboard for Proxmox VE</p>
        </div>
        <nav className="nav">
          {navigation.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={location.pathname === item.path ? "nav-link active" : "nav-link"}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="header-user">
          <p>
            Role: {currentRole ?? "unknown"} • User: {currentUsername ?? "unknown"}
            {authEnabled ? (
              <button type="button" className="logout-button" onClick={handleLogout}>
                sign out
              </button>
            ) : null}
          </p>
        </div>
      </header>
      <main className="main-content">{children}</main>
    </div>
  );
}
