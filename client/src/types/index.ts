export interface User {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  role: { name: string; description?: string };
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
}

export interface Device {
  id: string;
  hostname: string;
  agentVersion?: string;
  operatingSystem: string;
  osVersion?: string;
  ipAddress: string;
  macAddress?: string;
  platform: string;
  status: "ONLINE" | "OFFLINE";
  lastSeenAt?: string;
  registeredAt: string;
  _count?: { commands: number; screenshots: number };
}

export interface DeviceDetail extends Device {
  commands: DeviceCommand[];
  screenshots: Screenshot[];
  events: DeviceEvent[];
}

export interface DeviceCommand {
  id: string;
  deviceId: string;
  requestedById: string;
  commandType: string;
  payload?: any;
  status: string;
  result?: any;
  error?: string;
  createdAt: string;
  executedAt?: string;
  approvedAt?: string;
  requestedBy?: { username: string };
}

export interface Screenshot {
  id: string;
  deviceId: string;
  requestedById: string;
  filePath: string;
  fileSize?: number;
  mimeType: string;
  width?: number;
  height?: number;
  createdAt: string;
  device?: { hostname: string; id: string };
  requestedBy?: { username: string };
}

export interface DeviceEvent {
  id: string;
  deviceId: string;
  eventType: string;
  message?: string;
  data?: any;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: any;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
  user?: { username: string; email: string };
}

export interface PaginatedResponse {
  total: number;
  page: number;
  pages: number;
}

export interface DeviceStats {
  total: number;
  online: number;
  offline: number;
  recentCommands: number;
  recentScreenshots: number;
}
