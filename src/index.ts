import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from './daemon.js';
import type { RegisterPayload, HeartbeatPayload, StatusResponse } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 默认单次命令无响应最大兜底时长（10 分钟）
const DEFAULT_SAFE_TIMEOUT_SECONDS = 600;

function postJson(pathname: string, data: any, port = DEFAULT_PORT): Promise<boolean> {
  return new Promise((resolve) => {
    const payload = JSON.stringify(data);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 1000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.write(payload);
    req.end();
  });
}

function fetchStatus(port = DEFAULT_PORT): Promise<StatusResponse | null> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: '127.0.0.1',
        port,
        path: '/status',
        timeout: 1500,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      }
    );

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function ensureDaemonRunning(): void {
  // 尝试连接看门狗服务，如果连不上则拉起单例
  postJson('/heartbeat', { pid: process.pid }).then((alive) => {
    if (!alive) {
      // 启动守护进程，必须以 detached 模式运行，让它独立于当前 Pi 的生命周期
      const daemonPath = path.resolve(__dirname, 'daemon.js');
      try {
        const child = spawn(process.execPath, [daemonPath], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.unref();

        // 稍作等待后注册自身
        setTimeout(() => {
          registerSelf();
        }, 600);
      } catch (err) {
        console.error('[Pi Hang Guard] Failed to spawn watchdog daemon:', err);
      }
    } else {
      registerSelf();
    }
  });
}

function registerSelf(): void {
  const payload: RegisterPayload = {
    pid: process.pid,
    cwd: process.cwd(),
  };
  postJson('/register', payload);
}

export default function (pi: ExtensionAPI) {
  // 1. 启动时确保单例看门狗存活并注册自身
  ensureDaemonRunning();

  // 2. 定期心跳（每 15 秒）
  const heartbeatTimer = setInterval(() => {
    postJson('/heartbeat', {
      pid: process.pid,
      status: 'idle',
    });
  }, 15000);

  // 进程退出时注销
  process.on('exit', () => {
    clearInterval(heartbeatTimer);
    try {
      // 同步注销（仅 best effort）
      postJson('/unregister', { pid: process.pid });
    } catch {}
  });

  // 3. 内层安全加固：监听 tool_call
  pi.on('tool_call', async (event: any) => {
    const tool = event.tool;
    const input = event.input || {};

    // A. 自动注入安全环境变量与默认超时，根除意外挂起
    if (tool === 'bash') {
      if (typeof input.command === 'string') {
        const cmd = input.command.trim();
        // 如果命令未注入非交互环境变量，自动注入前缀
        const antiInteractivePrefix = 'CI=true GIT_TERMINAL_PROMPT=0 GIT_EDITOR=true ';
        if (!cmd.includes('GIT_EDITOR=') && !cmd.includes('CI=')) {
          input.command = antiInteractivePrefix + input.command;
        }
      }

      // 如果未设超时，强制注入保底超时（10 分钟）
      if (input.timeout === undefined || input.timeout === null || input.timeout <= 0) {
        input.timeout = DEFAULT_SAFE_TIMEOUT_SECONDS;
      }
    } else if (tool === 'powershell') {
      if (input.timeout === undefined || input.timeout === null || input.timeout <= 0) {
        input.timeout = DEFAULT_SAFE_TIMEOUT_SECONDS;
      }
    }

    // B. 向看门狗同步当前执行状态
    postJson('/heartbeat', {
      pid: process.pid,
      status: 'running',
      currentTool: tool,
      currentCommand: typeof input.command === 'string' ? input.command.slice(0, 120) : undefined,
      toolStartTime: Date.now(),
    });
  });

  // 4. 监听 tool_result，恢复空闲状态
  pi.on('tool_result', async () => {
    postJson('/heartbeat', {
      pid: process.pid,
      status: 'idle',
      currentTool: undefined,
      currentCommand: undefined,
      toolStartTime: undefined,
    });
  });

  // 5. 注册 /hang 命令，查看所有并发 Pi 的健康状态
  pi.registerCommand('hang', {
    description: '查看所有并发运行中的 Pi 实例状态与卡滞检测',
    async handler(_args, ctx) {
      const status = await fetchStatus();
      if (!status) {
        ctx.ui.notify('看门狗守护进程未运行或已自动休眠退出', 'warning');
        return;
      }

      const lines: string[] = [];
      lines.push(`🔍 Pi Hang Guard 状态报告 (Watchdog PID: ${status.watchdogPid}, 运行 ${status.uptimeSeconds}s)`);
      lines.push(`并发活跃实例数: ${status.instances.length}`);
      lines.push('----------------------------------------------------');

      const now = Date.now();
      for (const inst of status.instances) {
        const isSelf = inst.pid === process.pid;
        const prefix = isSelf ? '👉 [当前]' : '   ';
        const folder = path.basename(inst.cwd || 'root');
        const activeSec = Math.floor((now - inst.lastHeartbeat) / 1000);
        let health = '🟢 正常';

        if (inst.status === 'running' && inst.toolStartTime) {
          const runMins = Math.floor((now - inst.toolStartTime) / 60000);
          if (runMins >= 10) {
            health = `🔴 卡滞警告 (${runMins}m)`;
          } else {
            health = `🟡 运行中 (${runMins}m)`;
          }
        }

        lines.push(
          `${prefix} PID ${inst.pid} | 目录: ${folder} | 状态: ${inst.status} | 健康: ${health} | 心跳: ${activeSec}s 前`
        );
        if (inst.currentTool) {
          lines.push(`      正在执行: [${inst.currentTool}] ${inst.currentCommand || ''}`);
        }
      }
      lines.push('----------------------------------------------------');

      ctx.ui.notify(lines.join('\n'), 'info');
    },
  });
}
