import axios from "axios";
import { getAccessToken, setAccessToken, clearAccessToken } from "./tokenStore";

const API_BASE = "/api";

const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
  // Necesario para que la cookie HttpOnly del refresh token viaje en las llamadas a /api/auth/*.
  withCredentials: true,
});

let refreshing: Promise<string | null> | null = null;

// Una sola renovación en vuelo: si cinco requests devuelven 401 al mismo tiempo, las cinco esperan
// el mismo refresh en lugar de rotar el token cinco veces (la rotación invalida el anterior).
async function refreshSession(): Promise<string | null> {
  if (!refreshing) {
    refreshing = axios
      .post(`${API_BASE}/auth/refresh`, {}, { withCredentials: true })
      .then(({ data }) => {
        setAccessToken(data.accessToken);
        return data.accessToken as string;
      })
      .catch(() => {
        clearAccessToken();
        return null;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;
      const token = await refreshSession();
      if (!token) {
        window.location.href = "/login";
        return Promise.reject(error);
      }
      originalRequest.headers.Authorization = `Bearer ${token}`;
      return api(originalRequest);
    }
    return Promise.reject(error);
  }
);

export { refreshSession, getAccessToken, setAccessToken, clearAccessToken };

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
  user: User;
}

export interface Device {
  id: string;
  hostname: string;
  alias?: string | null;
  operatingSystem: string;
  osVersion?: string;
  ipAddress: string;
  macAddress?: string;
  platform?: string;
  role?: "ASESOR" | "SUPERVISOR";
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
  // filePath ya no viaja en la API: la ruta absoluta del servidor se reemplazó por GET /api/screenshots/:id/image.
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
  // El server rota el refresh token y lo escribe como cookie HttpOnly; el cuerpo ya no lo trae.
  refresh: () => api.post<{ accessToken: string }>("/auth/refresh"),
  logout: () => api.post("/auth/logout"),
  profile: () => api.get<User>("/auth/profile"),
  changeOwnPassword: (currentPassword: string, newPassword: string) =>
    api.post("/users/me/password", { currentPassword, newPassword }),
};

export const usersAPI = {
  list: (page = 1, limit = 20) =>
    api.get<{ users: User[]; total: number }>(`/users?page=${page}&limit=${limit}`),
  get: (id: string) => api.get<User>(`/users/${id}`),
  create: (data: { email: string; username: string; password: string; firstName: string; lastName: string; role: string }) =>
    api.post<User>("/users", data),
  update: (id: string, data: Partial<{ firstName: string; lastName: string; email: string; isActive: boolean; role: string }>) =>
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
  update: (id: string, data: Partial<{ role: "ASESOR" | "SUPERVISOR"; alias: string | null }>) =>
    api.put<Device>(`/devices/${id}`, data),
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
  // El binario ya no se sirve por /uploads/screenshots (monte estático público). Se pide por id y
  // el server valida JWT + SCREENSHOTS_VIEW; devuelve un Blob porque un <img src> no manda header.
  imageBlob: async (id: string) => {
    const res = await api.get(`/screenshots/${id}/image`, { responseType: "blob" });
    return res.data as Blob;
  },
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
