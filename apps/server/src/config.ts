import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const schema = z.object({
  PORT: z.string().optional().default("4000"),
  CORS_ORIGIN: z.string().optional().default("http://localhost:5173"),
  APP_AUTH_ENABLED: z
    .string()
    .optional()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  APP_JWT_SECRET: z.string().optional(),
  APP_USERS: z.string().optional(),
  APP_USERS_FILE: z.string().optional(),
  APP_BOOTSTRAP_ADMIN_USERNAME: z.string().optional().default("admin"),
  APP_BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
  ALARMS_POLL_INTERVAL_SECONDS: z.string().optional().default("30"),
  ALARM_CPU_WARN_PERCENT: z.string().optional().default("85"),
  ALARM_MEM_WARN_PERCENT: z.string().optional().default("90"),
  ALARM_DISK_WARN_PERCENT: z.string().optional().default("90"),
  ALARM_STORAGE_WARN_PERCENT: z.string().optional().default("90"),
  ALARM_WEBHOOK_ENABLED: z
    .string()
    .optional()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  ALARM_WEBHOOK_URL: z.string().optional(),
  ALARM_WEBHOOK_PROVIDER: z.enum(["generic", "slack", "teams"]).optional().default("generic"),
  ALARM_WEBHOOK_RETRY_MAX: z.string().optional().default("3"),
  ALARM_WEBHOOK_RETRY_BACKOFF_MS: z.string().optional().default("1000"),
  ALARM_WEBHOOK_AUDIT_LIMIT: z.string().optional().default("200"),
  PROXMOX_BASE_URL: z.string().url(),
  PROXMOX_ALLOW_SELF_SIGNED: z
    .string()
    .optional()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  PROXMOX_AUTH_MODE: z.enum(["token", "password"]).default("token"),
  PROXMOX_API_TOKEN_ID: z.string().optional(),
  PROXMOX_API_TOKEN_SECRET: z.string().optional(),
  PROXMOX_USERNAME: z.string().optional(),
  PROXMOX_PASSWORD: z.string().optional(),
  PROXMOX_REALM: z.string().optional().default("pam")
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const message = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${message}`);
}

const env = parsed.data;

let appUsers: Array<{ username: string; password: string; role: "viewer" | "operator" | "admin" }> = [];

if (env.APP_AUTH_ENABLED) {
  if (!env.APP_JWT_SECRET) {
    throw new Error("APP_AUTH_ENABLED=true requires APP_JWT_SECRET");
  }

  if (env.APP_USERS) {
    try {
      const parsedUsers = JSON.parse(env.APP_USERS) as Array<{
        username: string;
        password: string;
        role: "viewer" | "operator" | "admin";
      }>;

      appUsers = parsedUsers;
    } catch {
      throw new Error("APP_USERS must be valid JSON array of users");
    }
  }
}

if (env.PROXMOX_AUTH_MODE === "token") {
  if (!env.PROXMOX_API_TOKEN_ID || !env.PROXMOX_API_TOKEN_SECRET) {
    throw new Error(
      "Token mode requires PROXMOX_API_TOKEN_ID and PROXMOX_API_TOKEN_SECRET"
    );
  }
}

if (env.PROXMOX_AUTH_MODE === "password") {
  if (!env.PROXMOX_USERNAME || !env.PROXMOX_PASSWORD) {
    throw new Error("Password mode requires PROXMOX_USERNAME and PROXMOX_PASSWORD");
  }
}

export const config = {
  port: Number(env.PORT),
  corsOrigin: env.CORS_ORIGIN,
  auth: {
    enabled: env.APP_AUTH_ENABLED,
    jwtSecret: env.APP_JWT_SECRET,
    users: appUsers,
    usersFile: env.APP_USERS_FILE,
    bootstrap: {
      adminUsername: env.APP_BOOTSTRAP_ADMIN_USERNAME,
      adminPassword: env.APP_BOOTSTRAP_ADMIN_PASSWORD
    }
  },
  alarms: {
    pollIntervalSeconds: Number(env.ALARMS_POLL_INTERVAL_SECONDS),
    cpuWarnPercent: Number(env.ALARM_CPU_WARN_PERCENT),
    memWarnPercent: Number(env.ALARM_MEM_WARN_PERCENT),
    diskWarnPercent: Number(env.ALARM_DISK_WARN_PERCENT),
    storageWarnPercent: Number(env.ALARM_STORAGE_WARN_PERCENT),
    webhookEnabled: env.ALARM_WEBHOOK_ENABLED,
    webhookUrl: env.ALARM_WEBHOOK_URL,
    webhookProvider: env.ALARM_WEBHOOK_PROVIDER,
    webhookRetryMax: Number(env.ALARM_WEBHOOK_RETRY_MAX),
    webhookRetryBackoffMs: Number(env.ALARM_WEBHOOK_RETRY_BACKOFF_MS),
    webhookAuditLimit: Number(env.ALARM_WEBHOOK_AUDIT_LIMIT)
  },
  proxmox: {
    baseUrl: env.PROXMOX_BASE_URL,
    allowSelfSigned: env.PROXMOX_ALLOW_SELF_SIGNED,
    authMode: env.PROXMOX_AUTH_MODE,
    tokenId: env.PROXMOX_API_TOKEN_ID,
    tokenSecret: env.PROXMOX_API_TOKEN_SECRET,
    username: env.PROXMOX_USERNAME,
    password: env.PROXMOX_PASSWORD,
    realm: env.PROXMOX_REALM
  }
} as const;
