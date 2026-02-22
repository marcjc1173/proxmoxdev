import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import process from "node:process";

const root = process.cwd();
const serverEnvExample = path.join(root, "apps", "server", ".env.example");
const serverEnv = path.join(root, "apps", "server", ".env");
const webEnvExample = path.join(root, "apps", "web", ".env.example");
const webEnv = path.join(root, "apps", "web", ".env");

const args = new Set(process.argv.slice(2));
const enableAuth = args.has("--enable-auth");

function ensureFileFromExample(examplePath, targetPath) {
  if (!existsSync(targetPath)) {
    copyFileSync(examplePath, targetPath);
    return true;
  }

  return false;
}

function setEnvVar(content, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");

  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }

  return `${content.trimEnd()}\n${line}\n`;
}

function ensureServerEnvDefaults() {
  let content = readFileSync(serverEnv, "utf-8");

  if (/APP_JWT_SECRET=replace_with_long_random_secret/.test(content)) {
    content = setEnvVar(content, "APP_JWT_SECRET", randomBytes(32).toString("hex"));
  }

  content = setEnvVar(content, "APP_USERS", "");
  content = setEnvVar(content, "APP_USERS_FILE", "apps/server/data/users.json");

  if (enableAuth) {
    content = setEnvVar(content, "APP_AUTH_ENABLED", "true");

    if (/^APP_BOOTSTRAP_ADMIN_PASSWORD=\s*$/m.test(content)) {
      content = setEnvVar(content, "APP_BOOTSTRAP_ADMIN_PASSWORD", randomBytes(12).toString("base64url"));
    }
  }

  writeFileSync(serverEnv, content, "utf-8");

  const adminPasswordMatch = content.match(/^APP_BOOTSTRAP_ADMIN_PASSWORD=(.*)$/m);
  const adminUserMatch = content.match(/^APP_BOOTSTRAP_ADMIN_USERNAME=(.*)$/m);

  return {
    adminUsername: (adminUserMatch?.[1] ?? "admin").trim() || "admin",
    adminPassword: (adminPasswordMatch?.[1] ?? "").trim()
  };
}

const createdServerEnv = ensureFileFromExample(serverEnvExample, serverEnv);
const createdWebEnv = ensureFileFromExample(webEnvExample, webEnv);
const admin = ensureServerEnvDefaults();

console.log("✅ Environment setup complete");
console.log(`- server .env: ${createdServerEnv ? "created" : "updated"}`);
console.log(`- web .env: ${createdWebEnv ? "created" : "unchanged"}`);

if (enableAuth) {
  console.log("- APP auth: enabled");
  console.log(`- Bootstrap admin: ${admin.adminUsername}`);
  if (admin.adminPassword) {
    console.log(`- Bootstrap password: ${admin.adminPassword}`);
  }
}

console.log("\nNext steps:");
console.log("1) Fill Proxmox connection values in apps/server/.env");
console.log("2) Run: npm run dev");
