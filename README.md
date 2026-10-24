# pi-hang-guard

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Windows / macOS / Linux](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-brightgreen.svg)]()

> **Zero-Residue Concurrency Hang Watchdog & Safe Guard for [Pi Coding Agent](https://pi.dev)**
> 
> 针对 Pi 多并发工作流设计的「零残留跨实例看门狗」与「内层防卡死注入卫士」。彻底告别因交互式编辑器（Vim/Nano）、无界命令或事件循环未清空导致的长时间静默卡死。

---

## 🌟 核心特性 (Features)

### 1. 零残留单例看门狗 (Zero-Residue Singleton Watchdog)
- **随启随随**：第一个 Pi 实例启动时，在后台自动以脱钩（detached）模式唤起一个轻量看门狗进程。
- **开一批也只占一个进程**：后续并发启动的任意多个 Pi 实例（不论在哪个工作区或 git worktree），均自动复用该守护单例，内存占用仅 ~15MB，CPU 0.0%。
- **自动自毁物理退出**：当你关闭所有 Pi 窗口，看门狗检测到活跃 Pi 实例数降为 0 后，**自动调用 `process.exit(0)` 自杀释放**，不留任何后台孤儿进程。

### 2. 内层前置安全加固 (In-Process Safety Guard)
- **非交互式环境变量强制注入**：自动为 `bash` 工具注入 `GIT_TERMINAL_PROMPT=0 GIT_EDITOR=true CI=true`。当遇到 `git rebase` 或 `npm` 询问时，命令会立即非零报错返回，使 Agent 能够立即捕获并自我修正，杜绝挂起在 Vim / 键盘等待上。
- **兜底超时保护 (Default Fallback Timeout)**：对于未显式声明超时的 bash / powershell 命令，自动注入保底 10 分钟（600s）超时保护，杜绝无界盲等数小时。

### 3. 主动卡滞警报与系统通知 (Proactive Hang Alert)
- 轮询监控各 Pi 实例的工具运行时长与会话文件（`session.jsonl`）的输出心跳。
- 一旦检测到某个 Pi 实例工具停滞超过 10 分钟且输出静默：
  - **Windows**：原生 XML Toast 气泡通知 + 系统级硬件蜂鸣音 (`Beep`)；
  - **macOS / Linux**：系统级 Notification Center 提示与 Bell 提示；
  - 精准指明卡滞的 **PID、所在项目文件夹与阻塞的命令**。

### 4. 便捷内置指令 (`/hang`)
- 在任意 Pi 会话中输入 `/hang`，即可一览当前系统内所有并发 Pi 的实时存活状态、心跳耗时与卡滞风险报告。

---

## 🏗️ 架构与生命周期 (Architecture)

```text
【平时不开 Pi】
  系统内完全干净，0 进程常驻，0 资源消耗
       │
       ▼ 打开第 1 个 Pi
【Pi Extension 触发】
  尝试连接看门狗 (127.0.0.1:49152) ──> 连不上 ──> 自动脱钩启动单例 Watchdog
       │
       ▼ 并发打开第 2、3、N 个 Pi
【复用守护单例】
  所有 Pi 实例向同一个看门狗注册 PID 与工作区
  （后台始终仅保持 1 个守护进程，~15MB 内存）
       │
       ▼ 执行命令时
【内层安全注入】
  自动注入 CI=true、GIT_EDITOR=true 与 10m 保底超时
       │
       ▼ 假死监测
  看门狗每 20s 巡检：发现单实例卡滞 > 10m ──> 触发 Windows Toast + 蜂鸣预警
       │
       ▼ 任务完成，关闭所有 Pi 窗口
【自毁收尾】
  看门狗检测到活跃实例清零 ──> 自动终止销毁，恢复 0 进程
```

---

## 🚀 安装与使用 (Installation)

### 方式一：直接安装为 Pi 扩展（推荐）

可以通过 Pi 的扩展机制直接引入：

```bash
# 进入你个人 Pi 扩展目录
cd ~/.pi/agent/extensions

# 克隆本仓库并编译
git clone https://github.com/MiloMMIN/pi-hang-guard.git
cd pi-hang-guard
npm install
npm run build
```

或将编译后的产物复制到扩展目录即可使用。

### 方式二：手动测试运行守护进程

```bash
node dist/daemon.js
```

---

## ⌨️ 命令 (Commands)

| 命令 | 描述 |
| :--- | :--- |
| `/hang` | 在当前 Pi 终端中打印所有并发运行中 Pi 实例的健康列表与卡滞状态 |

---

## 📄 开源许可证 (License)

[MIT License](LICENSE) © 2025 MiloMMIN
