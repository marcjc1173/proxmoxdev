import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { issueToken } from "./auth.js";
import { apiRouter } from "./routes.js";

describe("guest snapshots routes", () => {
  it("does not treat '/snapshots' as a generic guest action", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api", apiRouter);

    const token = issueToken({ username: "test-admin", role: "admin" });

    const response = await request(app)
      .post("/api/proxmox/guests/qemu/test-node/100/snapshots")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    assert.equal(response.status, 400);
    assert.equal(response.body?.error, "Snapshot name is required");
    assert.notEqual(response.body?.error, "Invalid guest action");
  });

  it("matches snapshot rollback route and validates reason", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api", apiRouter);

    const token = issueToken({ username: "test-admin", role: "admin" });

    const response = await request(app)
      .post("/api/proxmox/guests/qemu/test-node/100/snapshots/before-update/rollback")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    assert.equal(response.status, 400);
    assert.equal(response.body?.error, "A reason (min 4 chars) is required for this action");
    assert.notEqual(response.body?.error, "Invalid guest action");
  });
});
