# Proxmox Center Setup Walkthrough (Copy/Paste)

Use this when you want a command-by-command setup flow.

## 5-minute quick path (token mode)

Run these from repo root:

```powershell
cd C:\proxmoxdev
npm install
npm run setup
notepad apps\server\.env
```

In `apps/server/.env`, set:

```dotenv
PROXMOX_BASE_URL=https://YOUR_PROXMOX_IP_OR_DNS:8006
PROXMOX_ALLOW_SELF_SIGNED=true
PROXMOX_AUTH_MODE=token
PROXMOX_API_TOKEN_ID=proxmox-center@pve!app
PROXMOX_API_TOKEN_SECRET=replace_with_real_secret
```

Start and verify:

```powershell
npm run dev
```

Open:

- Web UI: `http://localhost:5173`
- API health: `http://localhost:4000/api/health`

Optional API check in a second terminal:

```powershell
Invoke-RestMethod -Uri "http://localhost:4000/api/proxmox/overview" -Method GET | ConvertTo-Json -Depth 5
```

## 0) Prerequisites

- Node.js 20+
- npm
- Proxmox VE reachable at `https://<host>:8006`
- A Proxmox API token (recommended) or user/password

Quick local preflight:

```powershell
node -v
npm -v
```

## 0.1) Create Proxmox role/user/token (recommended command flow)

Run these on a Proxmox node shell as root:

```bash
# Create service user (skip if already present)
pveum user add proxmox-center@pve --comment "Proxmox Center API user"

# Create role with required privileges
pveum role add ProxmoxCenterRole -privs "VM.Audit VM.Allocate VM.PowerMgmt VM.Config.CPU VM.Config.Memory VM.Config.Network VM.Config.Options VM.Config.Disk VM.Config.HWType VM.Clone VM.Snapshot Datastore.Audit Datastore.AllocateSpace Datastore.AllocateTemplate Sys.Audit Pool.Audit SDN.Use"

# If role exists already, update it instead
pveum role modify ProxmoxCenterRole -privs "VM.Audit VM.Allocate VM.PowerMgmt VM.Config.CPU VM.Config.Memory VM.Config.Network VM.Config.Options VM.Config.Disk VM.Config.HWType VM.Clone VM.Snapshot Datastore.Audit Datastore.AllocateSpace Datastore.AllocateTemplate Sys.Audit Pool.Audit SDN.Use"

# Grant role from Datacenter root
pveum aclmod / -user proxmox-center@pve -role ProxmoxCenterRole

# Create token and save secret (shown once)
pveum user token add proxmox-center@pve app --privsep 0
```

Use these in `apps/server/.env`:

```dotenv
PROXMOX_AUTH_MODE=token
PROXMOX_API_TOKEN_ID=proxmox-center@pve!app
PROXMOX_API_TOKEN_SECRET=replace_with_token_secret
```

## 0.2) Verify role/ACL/token wiring

Run these on the Proxmox node shell:

```bash
# Confirm role privileges
pveum role show ProxmoxCenterRole

# Confirm ACL assignment at /
pveum acl list | grep proxmox-center@pve

# Confirm token exists
pveum user token list proxmox-center@pve
```

Expected result:

- `ProxmoxCenterRole` includes the required VM/Datastore/System privileges
- ACL output shows `proxmox-center@pve` with role `ProxmoxCenterRole` on path `/`
- token list includes token `app`

## 1) Run from repo root

```powershell
cd C:\proxmoxdev
npm install
npm run setup
```

## 2) Configure Proxmox connection

Open server env file:

```powershell
notepad apps\server\.env
```

### Recommended: token mode

Paste/update these values in `apps/server/.env`:

```dotenv
PROXMOX_BASE_URL=https://YOUR_PROXMOX_IP_OR_DNS:8006
PROXMOX_ALLOW_SELF_SIGNED=true
PROXMOX_AUTH_MODE=token
PROXMOX_API_TOKEN_ID=proxmox-center@pve!app
PROXMOX_API_TOKEN_SECRET=replace_with_real_secret
```

### Alternative: password mode

```dotenv
PROXMOX_BASE_URL=https://YOUR_PROXMOX_IP_OR_DNS:8006
PROXMOX_ALLOW_SELF_SIGNED=true
PROXMOX_AUTH_MODE=password
PROXMOX_USERNAME=root
PROXMOX_PASSWORD=replace_with_real_password
PROXMOX_REALM=pam
```

Validate you did not leave placeholders in `apps/server/.env`:

```powershell
Get-Content apps\server\.env | Select-String "replace_with|YOUR_PROXMOX_IP_OR_DNS"
```

If this command returns any lines, update those values before continuing.

## 3) Start the app

```powershell
npm run dev
```

Open:

- Web UI: `http://localhost:5173`
- API health: `http://localhost:4000/api/health`

## 4) Verify API is working

In a second terminal:

```powershell
Invoke-RestMethod -Uri "http://localhost:4000/api/health" -Method GET | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri "http://localhost:4000/api/auth/config" -Method GET | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri "http://localhost:4000/api/proxmox/version" -Method GET | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri "http://localhost:4000/api/proxmox/overview" -Method GET | ConvertTo-Json -Depth 5
```

## 5) Optional: enable app login (RBAC)

```powershell
npm run setup:auth
```

Check bootstrap admin values in env:

```powershell
Get-Content apps\server\.env | Select-String "APP_AUTH_ENABLED|APP_BOOTSTRAP_ADMIN_USERNAME|APP_BOOTSTRAP_ADMIN_PASSWORD"
```

Then restart:

```powershell
npm run dev
```

## 6) If dev server fails to start

### A) Build check

```powershell
npm run build
```

### B) Run server only to see backend error directly

```powershell
npm run dev -w apps/server
```

### C) Clear common port conflicts and start again

```powershell
$ports = 4000,5173; foreach ($p in $ports) { $conn = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if ($conn) { $conn | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } } }
npm run dev
```

## Proxmox token reminder

- Token ID format is: `user@realm!tokenname`
- Examples: `proxmox-center@pve!app`, `root@pam!api`
- If token/ACL rights are too limited, some features (snapshots, clone, provisioning) will fail with permission errors.

## Common ACL/permission errors and fixes

- **`403 Permission check failed` on power actions**
	- Re-check role includes `VM.PowerMgmt` and `VM.Audit`.

- **Snapshot create/rollback/delete fails with permission denied**
	- Re-check role includes `VM.Snapshot`.

- **Clone fails (`/clone` endpoint) with permission denied**
	- Re-check role includes `VM.Clone`, `VM.Allocate`, and VM config privileges.

- **Provisioning fails when creating or configuring VM**
	- Re-check role includes `VM.Allocate`, `VM.Config.CPU`, `VM.Config.Memory`, `VM.Config.Network`, `VM.Config.Options`, `VM.Config.Disk`, `VM.Config.HWType`.

- **Storage or ISO-related calls fail**
	- Re-check role includes `Datastore.Audit`, `Datastore.AllocateSpace`, `Datastore.AllocateTemplate`.

- **Works for some nodes/VMs but not others**
	- ACL scope is likely too narrow. Ensure ACL is set at `/` (Datacenter root):

```bash
pveum aclmod / -user proxmox-center@pve -role ProxmoxCenterRole
```

- **Token exists but still unauthorized**
	- Confirm `PROXMOX_API_TOKEN_ID` matches token exactly (`user@realm!tokenname`).
	- Regenerate token secret if needed and update `PROXMOX_API_TOKEN_SECRET`.
	- Verify token is listed:

```bash
pveum user token list proxmox-center@pve
```

- **Need to reset role quickly to known-good permissions**

```bash
pveum role modify ProxmoxCenterRole -privs "VM.Audit VM.Allocate VM.PowerMgmt VM.Config.CPU VM.Config.Memory VM.Config.Network VM.Config.Options VM.Config.Disk VM.Config.HWType VM.Clone VM.Snapshot Datastore.Audit Datastore.AllocateSpace Datastore.AllocateTemplate Sys.Audit Pool.Audit SDN.Use"
```

## Done

If health and overview endpoints return data, setup is complete and the app is ready to use.
