import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { sendAlertNotification } from './notifier.js';
import type { InstanceRecord, RegisterPayload, HeartbeatPayload, StatusResponse } from './types.js';

export const DEFAULT_PORT = 49152;
export const HANG_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
export const CHECK_INTERVAL_MS = 20 * 1000; // 20 seconds
const GRACE_PERIOD_CHECKS = 2; // Empty instances grace checks before self-exit

class HangGuardDaemon {
  private instances = new Map<number, InstanceRecord>();
  private emptyChecks = 0;
  private server: http.Server | null = null;
  private startTime = Date.now();
  private checkTimer: NodeJS.Timeout | null = null;

  start(port = DEFAULT_PORT) {
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      
      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          let payload: any = {};
          try {
            payload = body ? JSON.parse(body) : {};
          } catch {}

          if (url.pathname === '/register') {
            this.handleRegister(payload as RegisterPayload);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } else if (url.pathname === '/heartbeat') {
            this.handleHeartbeat(payload as HeartbeatPayload);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } else if (url.pathname === '/unregister') {
            if (payload.pid) {
              this.instances.delete(payload.pid);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(404);
            res.end();
          }
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/status') {
        const response: StatusResponse = {
          watchdogPid: process.pid,
          uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
          instances: Array.from(this.instances.values())
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response, null, 2));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    this.server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        // Another instance is already running as singleton watchdog
        process.exit(0);
      } else {
        console.error('[Pi Hang Guard] Server error:', err);
        process.exit(1);
      }
    });

    this.server.listen(port, '127.0.0.1', () => {
      console.log(`[Pi Hang Guard] Daemon started on 127.0.0.1:${port} (PID: ${process.pid})`);
      this.checkTimer = setInterval(() => this.runCheck(), CHECK_INTERVAL_MS);
    });
  }

  private handleRegister(payload: RegisterPayload) {
    if (!payload.pid) return;
    this.emptyChecks = 0; // Reset empty counter

    const existing = this.instances.get(payload.pid);
    const record: InstanceRecord = {
      pid: payload.pid,
      cwd: payload.cwd || '',
      sessionId: payload.sessionId,
      sessionFile: payload.sessionFile,
      startTime: existing?.startTime || Date.now(),
      lastHeartbeat: Date.now(),
      status: existing?.status || 'idle'
    };
    this.instances.set(payload.pid, record);
  }

  private handleHeartbeat(payload: HeartbeatPayload) {
    if (!payload.pid) return;
    const record = this.instances.get(payload.pid);
    if (!record) return;

    record.lastHeartbeat = Date.now();
    if (payload.status) record.status = payload.status;
    if (payload.currentTool !== undefined) record.currentTool = payload.currentTool;
    if (payload.currentCommand !== undefined) record.currentCommand = payload.currentCommand;
    if (payload.toolStartTime !== undefined) record.toolStartTime = payload.toolStartTime;
  }

  private runCheck() {
    const now = Date.now();

    // 1. Verify process liveness
    for (const [pid, record] of Array.from(this.instances.entries())) {
      try {
        process.kill(pid, 0); // Check if process is still running
      } catch (e: any) {
        if (e.code === 'ESRCH') {
          // Process exited
          this.instances.delete(pid);
          continue;
        }
      }

      // 2. Check for hang conditions
      let isStalled = false;
      let reason = '';

      if (record.status === 'running' && record.toolStartTime) {
        const runningDuration = now - record.toolStartTime;
        if (runningDuration > HANG_THRESHOLD_MS) {
          isStalled = true;
          const mins = Math.floor(runningDuration / 60000);
          reason = `Tool '${record.currentTool || 'unknown'}' has been running for ${mins}m`;
        }
      }

      // Check session file update time if available
      if (record.sessionFile && fs.existsSync(record.sessionFile)) {
        try {
          const stats = fs.statSync(record.sessionFile);
          const fileIdleTime = now - stats.mtimeMs;
          if (fileIdleTime > HANG_THRESHOLD_MS && record.status === 'running') {
            isStalled = true;
            const idleMins = Math.floor(fileIdleTime / 60000);
            reason = `Session output has been silent for ${idleMins}m while active`;
          }
        } catch {}
      }

      if (isStalled) {
        // Prevent alert spam: alert at most once every 10 minutes
        if (!record.warnedAt || (now - record.warnedAt > HANG_THRESHOLD_MS)) {
          record.warnedAt = now;
          const folderName = path.basename(record.cwd || 'pi');
          const title = `⚠️ Pi 卡滞警报 [PID: ${record.pid}]`;
          const message = `项目 [${folderName}]: ${reason}，请及时检查！`;
          
          console.warn(`[Pi Hang Guard] ALERT: ${title} - ${message}`);
          sendAlertNotification(title, message);
        }
      }
    }

    // 3. Auto-termination when no Pi instances remain
    if (this.instances.size === 0) {
      this.emptyChecks++;
      if (this.emptyChecks >= GRACE_PERIOD_CHECKS) {
        console.log('[Pi Hang Guard] No active Pi instances detected. Auto-terminating daemon gracefully.');
        if (this.checkTimer) clearInterval(this.checkTimer);
        this.server?.close(() => {
          process.exit(0);
        });
      }
    } else {
      this.emptyChecks = 0;
    }
  }
}

// Start if executed directly
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv.includes('--daemon')) {
  const daemon = new HangGuardDaemon();
  daemon.start();
}

export { HangGuardDaemon };
