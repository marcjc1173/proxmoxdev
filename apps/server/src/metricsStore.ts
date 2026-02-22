import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface MetricRecord {
  id?: number;
  timestamp: number;
  guestType: "qemu" | "lxc";
  node: string;
  vmid: number;
  cpu: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  netin?: number;
  netout?: number;
}

interface MetricQuery {
  guestType: "qemu" | "lxc";
  node: string;
  vmid: number;
  startTime: number;
  endTime?: number;
}

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    const dbPath = path.join(__dirname, "../data/metrics.db");
    db = new Database(dbPath);
    
    // Create table if it doesn't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        guestType TEXT NOT NULL,
        node TEXT NOT NULL,
        vmid INTEGER NOT NULL,
        cpu REAL,
        mem INTEGER,
        maxmem INTEGER,
        disk INTEGER,
        maxdisk INTEGER,
        netin INTEGER,
        netout INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_metrics_lookup 
        ON metrics(guestType, node, vmid, timestamp);

      CREATE INDEX IF NOT EXISTS idx_metrics_timestamp 
        ON metrics(timestamp);
    `);
    
    console.log("[metrics] Database initialized at", dbPath);
  }
  return db;
}

export function insertMetric(metric: MetricRecord): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO metrics (timestamp, guestType, node, vmid, cpu, mem, maxmem, disk, maxdisk, netin, netout)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    metric.timestamp,
    metric.guestType,
    metric.node,
    metric.vmid,
    metric.cpu,
    metric.mem,
    metric.maxmem,
    metric.disk,
    metric.maxdisk,
    metric.netin ?? null,
    metric.netout ?? null
  );
}

export function getMetrics(query: MetricQuery): MetricRecord[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM metrics
    WHERE guestType = ? AND node = ? AND vmid = ? AND timestamp >= ?
    ${query.endTime ? "AND timestamp <= ?" : ""}
    ORDER BY timestamp ASC
  `);

  const params = [query.guestType, query.node, query.vmid, query.startTime];
  if (query.endTime) {
    params.push(query.endTime);
  }

  return stmt.all(...params) as MetricRecord[];
}

export function cleanOldMetrics(olderThanSeconds = 86400): void {
  const db = getDb();
  const cutoffTime = Math.floor(Date.now() / 1000) - olderThanSeconds;
  const stmt = db.prepare("DELETE FROM metrics WHERE timestamp < ?");
  const result = stmt.run(cutoffTime);
  
  if (result.changes > 0) {
    console.log(`[metrics] Cleaned ${result.changes} old metric records`);
  }
}

// Initialize cleanup schedule
export function initMetricsStore(): void {
  // Trigger database initialization
  getDb();
  
  // Clean old metrics on startup
  cleanOldMetrics();

  // Schedule cleanup every hour
  setInterval(() => {
    cleanOldMetrics();
  }, 3600000);
}
