# Proxmox Center

A plug-and-play, vCenter-like starter app for Proxmox VE.

## What this includes

- Proxmox API integration with token auth **or** user/password auth
- Dashboard overview (nodes, VMs, containers, storage, cluster health)
- Recent tasks and recent cluster events
- Environment-driven setup (`.env` only)
- Full-stack TypeScript workspace (Express + React)

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Generate local env files:

```bash
npm run setup
```

3. Fill required Proxmox values in `apps/server/.env`:

- `PROXMOX_BASE_URL`
- `PROXMOX_AUTH_MODE`
- token values (`PROXMOX_API_TOKEN_ID` / `PROXMOX_API_TOKEN_SECRET`) or password values

4. Start:

```bash
npm run dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:4000/api`

## Auth modes

Choose one mode in `apps/server/.env`:

### A) API token (recommended)
- `PROXMOX_API_TOKEN_ID`
- `PROXMOX_API_TOKEN_SECRET`

### B) Username/password
- `PROXMOX_USERNAME`
- `PROXMOX_PASSWORD`
- `PROXMOX_REALM`

## App RBAC (optional)

Enable app-level login and roles in `apps/server/.env`:

- `APP_AUTH_ENABLED=true`
- `APP_JWT_SECRET=<long-random-secret>`
- `APP_USERS_FILE=<optional path>`
- `APP_BOOTSTRAP_ADMIN_USERNAME=<default: admin>`
- `APP_BOOTSTRAP_ADMIN_PASSWORD=<required for first-run auto-bootstrap if APP_USERS is empty>`

Fast path (recommended):

```bash
npm run setup:auth
```

This will:

- copy missing `.env` files from `.env.example`
- generate a secure `APP_JWT_SECRET` if still placeholder
- enable app auth
- create a bootstrap admin password in `apps/server/.env`
- persist first-run users to `apps/server/data/users.json`

`APP_USERS` JSON is still supported for explicit seeded user lists, but is no longer required.

Role model:

- `viewer`: read-only dashboards
- `operator`: viewer + power actions, snapshot create, clone
- `admin`: operator + snapshot rollback/delete, VM template conversion

When RBAC is enabled, users are persisted in `apps/server/data/users.json` (or `APP_USERS_FILE` if set).
The UI includes an **Admin Users** page for admin role to create users, change roles, reset passwords, and delete users.

## Alarm settings

Tune thresholds and frequency in `apps/server/.env`:

- `ALARMS_POLL_INTERVAL_SECONDS`
- `ALARM_CPU_WARN_PERCENT`
- `ALARM_MEM_WARN_PERCENT`
- `ALARM_DISK_WARN_PERCENT`
- `ALARM_STORAGE_WARN_PERCENT`
- `ALARM_WEBHOOK_ENABLED`
- `ALARM_WEBHOOK_URL`
- `ALARM_WEBHOOK_PROVIDER` (`generic`, `slack`, `teams`)
- `ALARM_WEBHOOK_RETRY_MAX`
- `ALARM_WEBHOOK_RETRY_BACKOFF_MS`
- `ALARM_WEBHOOK_AUDIT_LIMIT`

## Notes

- Most Proxmox installs use self-signed certs. Set `PROXMOX_ALLOW_SELF_SIGNED=true` for development.
- This is a strong foundation for advanced features like RBAC, alarms, templates, snapshots, HA orchestration, and lifecycle actions.

## API surface (starter)

- `GET /api/health`
- `GET /api/proxmox/version`
- `GET /api/proxmox/nodes`
- `GET /api/proxmox/storage`
- `GET /api/proxmox/cluster/status`
- `GET /api/proxmox/tasks/recent?limit=25`
- `GET /api/proxmox/events/recent?limit=25`
- `GET /api/proxmox/overview`
- `POST /api/proxmox/guests/:type/:node/:vmid/:action`
- `GET /api/proxmox/tasks/:upid/status?node=:node`
- `GET /api/proxmox/guests/:type/:node/:vmid/snapshots`
- `POST /api/proxmox/guests/:type/:node/:vmid/snapshots`
- `POST /api/proxmox/guests/:type/:node/:vmid/snapshots/:snapname/rollback`
- `DELETE /api/proxmox/guests/:type/:node/:vmid/snapshots/:snapname`
- `POST /api/proxmox/guests/:type/:node/:vmid/clone`
- `POST /api/proxmox/guests/:type/:node/:vmid/template` (QEMU only)
- `GET /api/proxmox/provisioning/templates`
- `POST /api/proxmox/provisioning/deploy-template`
- `GET /api/proxmox/provisioning/isos?node=:node`
- `POST /api/proxmox/provisioning/deploy-iso`
- `GET /api/alarms`
- `POST /api/alarms/:id/acknowledge`
- `POST /api/alarms/:id/silence`
- `POST /api/alarms/evaluate` (admin)
- `GET /api/alarms/notifications` (admin delivery audit)

## Project layout

- `apps/server`: Express API, Proxmox auth/session handling, aggregated overview endpoints
- `apps/web`: React dashboard for operations visibility

Additional docs:

- `docs/permissions.md`: role model, guardrails, and bootstrap behavior
- `CONTRIBUTING.md`: local setup and PR expectations

## Publish to GitHub

1. Verify local build:

```bash
npm run build
```

2. Confirm local-only secrets are ignored (`.env`, users DB, metrics DB).
3. Create a new GitHub repo and push:

```bash
git init
git add .
git commit -m "Initial open-source release"
git branch -M main
git remote add origin https://github.com/<org-or-user>/<repo>.git
git push -u origin main
```

4. CI runs automatically via `.github/workflows/ci.yml` on pushes and PRs.

## Open-source release checklist

Run this checklist before each public release:

1. Security preflight:
	- keep real credentials only in local `apps/server/.env`
	- verify `.env` and runtime DB files are ignored by git
	- rotate any token/password that was ever pasted into shared channels

2. Quality gate:

```bash
npm run build
```

3. Commit only intended files:

```bash
git status --short
```

4. Tag and release:

```bash
git tag v0.1.0
git push origin main --tags
```

## Built-in operations

- Guest power actions from UI: `start`, `stop`, `reboot`, `shutdown`
- Action execution uses Proxmox task UPID and polls status until completion
- Snapshot lifecycle from UI: `create`, `rollback`, `delete`
- Rollback and delete require explicit browser confirmation
- Task history supports status + text filters (node/type/user/id)
- Guest clone workflow from UI with VMID collision guardrail
- VM-to-template conversion workflow (QEMU-only, requires stopped VM, confirmation prompt)
- Template-based provisioning wizard (clone template + optional cloud-init + optional auto-start)
- ISO-based provisioning wizard (installer-ready VM with ISO attach + boot order + optional auto-start)
- Alarm engine with periodic health evaluation (node state/cpu/memory/disk, storage usage, failed tasks)
- Role-based alarm actions: viewer can view, operator/admin can acknowledge/silence, admin can force evaluation
- Webhook notifications for newly critical alarms (generic/slack/teams payload formats)
- Webhook delivery retry with exponential backoff and admin audit log endpoint
