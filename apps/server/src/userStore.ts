import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AppRole } from "./auth.js";
import { config } from "./config.js";

interface StoredUser {
  username: string;
  password: string;
  role: AppRole;
}

let users: StoredUser[] = [];

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const defaultUsersFile = path.resolve(currentDir, "../data/users.json");
const usersFilePath = config.auth.usersFile
  ? path.resolve(process.cwd(), config.auth.usersFile)
  : defaultUsersFile;

function normalizeUsers(data: unknown): StoredUser[] {
  if (!Array.isArray(data)) {
    throw new Error("Users data must be an array");
  }

  const parsed: StoredUser[] = [];

  for (const entry of data) {
    const candidate = entry as Partial<StoredUser>;
    if (
      typeof candidate.username !== "string" ||
      typeof candidate.password !== "string" ||
      (candidate.role !== "viewer" && candidate.role !== "operator" && candidate.role !== "admin")
    ) {
      throw new Error("Invalid user entry in users store");
    }

    parsed.push({
      username: candidate.username.trim(),
      password: candidate.password,
      role: candidate.role
    });
  }

  const deduped = new Map<string, StoredUser>();
  for (const user of parsed) {
    if (!user.username) {
      throw new Error("Username cannot be empty");
    }
    deduped.set(user.username, user);
  }

  return [...deduped.values()];
}

async function persistUsers() {
  const directory = path.dirname(usersFilePath);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(usersFilePath, JSON.stringify(users, null, 2), "utf-8");
}

function ensureAdminExists(userList: StoredUser[]) {
  if (!userList.some((user) => user.role === "admin")) {
    throw new Error("At least one admin user is required");
  }
}

export async function initUserStore() {
  if (!config.auth.enabled) {
    users = [];
    return;
  }

  try {
    const existing = await fs.readFile(usersFilePath, "utf-8");
    users = normalizeUsers(JSON.parse(existing));
    ensureAdminExists(users);
  } catch {
    const seedUsers = config.auth.users.length
      ? config.auth.users
      : config.auth.bootstrap.adminPassword
        ? [
            {
              username: config.auth.bootstrap.adminUsername,
              password: config.auth.bootstrap.adminPassword,
              role: "admin" as const
            }
          ]
        : [];

    if (seedUsers.length === 0) {
      throw new Error(
        "RBAC bootstrap requires one of: existing users file, APP_USERS JSON, or APP_BOOTSTRAP_ADMIN_PASSWORD"
      );
    }

    users = normalizeUsers(seedUsers);
    ensureAdminExists(users);
    await persistUsers();
  }
}

export function listUsers(): Array<{ username: string; role: AppRole }> {
  return users.map((user) => ({ username: user.username, role: user.role }));
}

export function findUser(username: string): StoredUser | undefined {
  return users.find((user) => user.username === username);
}

export async function createUser(input: { username: string; password: string; role: AppRole }) {
  if (findUser(input.username)) {
    throw new Error("User already exists");
  }

  users.push({
    username: input.username,
    password: input.password,
    role: input.role
  });

  await persistUsers();
}

export async function updateUser(
  username: string,
  updates: { password?: string; role?: AppRole },
  actorUsername?: string
) {
  const user = findUser(username);
  if (!user) {
    throw new Error("User not found");
  }

  if (updates.role && user.role === "admin" && updates.role !== "admin") {
    const adminCount = users.filter((entry) => entry.role === "admin").length;
    if (adminCount <= 1) {
      throw new Error("Cannot remove the last admin user");
    }

    if (actorUsername === username) {
      throw new Error("You cannot demote your own account");
    }
  }

  if (updates.password) {
    user.password = updates.password;
  }

  if (updates.role) {
    user.role = updates.role;
  }

  ensureAdminExists(users);
  await persistUsers();
}

export async function deleteUser(username: string, actorUsername?: string) {
  const existing = findUser(username);
  if (!existing) {
    throw new Error("User not found");
  }

  if (actorUsername === username) {
    throw new Error("You cannot delete your own account");
  }

  const nextUsers = users.filter((user) => user.username !== username);
  ensureAdminExists(nextUsers);

  users = nextUsers;
  await persistUsers();
}
