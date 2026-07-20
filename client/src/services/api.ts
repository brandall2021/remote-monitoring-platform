import axios from "axios";

const API_BASE = "/api";

const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
});

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("accessToken");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem("refreshToken");
      if (!refreshToken) {
        isRefreshing = false;
        localStorage.removeItem("accessToken");
        window.location.href = "/login";
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post(`${API_BASE}/auth/refresh`, {
          refreshToken,
        });
        localStorage.setItem("accessToken", data.accessToken);
        localStorage.setItem("refreshToken", data.refreshToken);
        processQueue(null, data.accessToken);
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        localStorage.removeItem("accessToken");
        localStorage.removeItem("refreshToken");
        window.location.href = "/login";
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  }
);

export interface User {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  role: { id: string; name: string };
  isActive: boolean;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface Device {
  id: string;
  hostname: string;
  operatingSystem: string;
  osVersion?: string;
  ipAddress: string;
  macAddress?: string;
  platform?: string;
  status: "ONLINE" | "OFFLINE";
  lastSeenAt?: string;
  registeredAt: string;
  agentVersion?: string;
  _count?: { commands: number; screenshots: number };
}

export interface DeviceStats {
  total: number;
  online: number;
  offline: number;
}

export interface Command {
  id: string;
  deviceId: string;
  commandType: string;
  status: string;
  createdAt: string;
  executedAt?: string;
  approvedAt?: string;
  result?: unknown;
  error?: string;
  requestedBy?: { username: string };
}

export interface Screenshot {
  id: string;
  deviceId: string;
  filePath: string;
  fileSize?: number;
  mimeType: string;
  width?: number;
  height?: number;
  createdAt: string;
  device?: Device;
  requestedBy?: User;
}

export interface AuditLog {
  id: string;
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  createdAt: string;
  user?: User;
}

export const authAPI = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>("/auth/login", { email, password }),
  refresh: (refreshToken: string) =>
    api.post<{ accessToken: string; refreshToken: string }>("/auth/refresh", { refreshToken }),
  logout: (refreshToken: string) =>
    api.post("/auth/logout", { refreshToken }),
  profile: () => api.get<User>("/auth/profile"),
};

export const usersAPI = {
  list: (page = 1, limit = 20) =>
    api.get<{ users: User[]; total: number }>(`/users?page=${page}&limit=${limit}`),
  get: (id: string) => api.get<User>(`/users/${id}`),
  create: (data: { email: string; username: string; password: string; firstName: string; lastName: string; roleId: string }) =>
    api.post<User>("/users", data),
  update: (id: string, data: Partial<{ firstName: string; lastName: string; email: string; isActive: boolean; roleId: string }>) =>
    api.put<User>(`/users/${id}`, data),
  delete: (id: string) => api.delete(`/users/${id}`),
  changePassword: (id: string, password: string) =>
    api.post(`/users/${id}/password`, { password }),
};

export const devicesAPI = {
  list: (page = 1, limit = 20, status?: string) =>
    api.get<{ devices: Device[]; total: number }>(`/devices?page=${page}&limit=${limit}${status ? `&status=${status}` : ""}`),
  get: (id: string) => api.get<Device>(`/devices/${id}`),
  stats: () => api.get<DeviceStats>("/devices/stats"),
  delete: (id: string) => api.delete(`/devices/${id}`),
};

export const commandsAPI = {
  list: (page = 1, limit = 20, status?: string) =>
    api.get<{ commands: Command[]; total: number }>(`/commands?page=${page}&limit=${limit}${status ? `&status=${status}` : ""}`),
  listByDevice: (deviceId: string, page = 1, limit = 20) =>
    api.get<{ commands: Command[]; total: number }>(`/commands/device/${deviceId}?page=${page}&limit=${limit}`),
  create: (data: { deviceId: string; commandType: string; payload?: Record<string, unknown> }) =>
    api.post<Command>("/commands", data),
  approve: (id: string) => api.post<Command>(`/commands/${id}/approve`),
  reject: (id: string) => api.post(`/commands/${id}/reject`),
};

export const screenshotsAPI = {
  list: (page = 1, limit = 20) =>
    api.get<{ screenshots: Screenshot[]; total: number }>(`/screenshots?page=${page}&limit=${limit}`),
  get: (id: string) => api.get<Screenshot>(`/screenshots/${id}`),
  listByDevice: (deviceId: string, page = 1, limit = 20) =>
    api.get<{ screenshots: Screenshot[]; total: number }>(`/screenshots/device/${deviceId}?page=${page}&limit=${limit}`),
  request: (deviceId: string, reason?: string) =>
    api.post<Command>("/screenshots/request", { deviceId, reason }),
  delete: (id: string) => api.delete(`/screenshots/${id}`),
};

export const auditAPI = {
  list: (page = 1, limit = 50, filters?: Record<string, string>) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.append(key, value);
      });
    }
    return api.get<{ logs: AuditLog[]; total: number }>(`/audit?${params.toString()}`);
  },
};

export default api;
