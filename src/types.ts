export interface InstanceRecord {
  pid: number;
  cwd: string;
  sessionId?: string;
  sessionFile?: string;
  startTime: number;
  lastHeartbeat: number;
  status: 'idle' | 'running';
  currentTool?: string;
  currentCommand?: string;
  toolStartTime?: number;
  warnedAt?: number;
}

export interface RegisterPayload {
  pid: number;
  cwd: string;
  sessionId?: string;
  sessionFile?: string;
}

export interface HeartbeatPayload {
  pid: number;
  status?: 'idle' | 'running';
  currentTool?: string;
  currentCommand?: string;
  toolStartTime?: number;
}

export interface StatusResponse {
  watchdogPid: number;
  uptimeSeconds: number;
  instances: InstanceRecord[];
}
