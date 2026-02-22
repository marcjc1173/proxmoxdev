import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config.js";

export type AppRole = "viewer" | "operator" | "admin";

interface AuthPayload {
  sub: string;
  role: AppRole;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        username: string;
        role: AppRole;
      };
    }
  }
}

const roleRank: Record<AppRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3
};

function extractBearerToken(header: string | undefined): string | null {
  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim();
}

export function issueToken(input: { username: string; role: AppRole }): string {
  if (!config.auth.jwtSecret) {
    throw new Error("APP_JWT_SECRET is not configured");
  }

  return jwt.sign(
    {
      sub: input.username,
      role: input.role
    } satisfies AuthPayload,
    config.auth.jwtSecret,
    { expiresIn: "12h" }
  );
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!config.auth.enabled) {
    req.authUser = {
      username: "local",
      role: "admin"
    };
    return next();
  }

  const token = extractBearerToken(req.header("Authorization"));
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const payload = jwt.verify(token, config.auth.jwtSecret as string) as AuthPayload;
    req.authUser = {
      username: payload.sub,
      role: payload.role
    };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(minRole: AppRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.auth.enabled) {
      return next();
    }

    if (!req.authUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (roleRank[req.authUser.role] < roleRank[minRole]) {
      return res.status(403).json({ error: `Insufficient role. Requires ${minRole}` });
    }

    return next();
  };
}
