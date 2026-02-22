# Permissions and Guardrails

## Roles

- `viewer`: read-only dashboards and inventory
- `operator`: viewer + acknowledge/silence alarms + power actions + snapshot create + clone
- `admin`: operator + snapshot rollback/delete + VM template conversion + user admin + policy admin + forced alarm evaluation

## Automatic RBAC bootstrap

Use:

```bash
npm run setup:auth
```

Then set Proxmox credentials in `apps/server/.env` and run:

```bash
npm run dev
```

On first start, if `apps/server/data/users.json` does not exist, the server seeds an admin account from:

- `APP_BOOTSTRAP_ADMIN_USERNAME` (default `admin`)
- `APP_BOOTSTRAP_ADMIN_PASSWORD` (required for bootstrap)

## Explicit seeded users (optional)

If you want fixed users from env instead of bootstrap-only:

```dotenv
APP_USERS=[{"username":"admin","password":"<pw>","role":"admin"},{"username":"ops","password":"<pw>","role":"operator"}]
```

When present, `APP_USERS` is used to seed the store if the users file is missing.

## Guardrail behavior

Guardrails can block lifecycle actions by:

- protected VM IDs
- protected guest names
- maintenance windows (UTC)

Admin users can bypass guardrails only when `policyOverride=true` is sent on supported actions.
