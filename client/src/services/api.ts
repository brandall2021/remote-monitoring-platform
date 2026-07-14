import axios from "axios";

const API_BASE = "/api";

const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
});

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
      originalRequest._retry = true;
      const refreshToken = localStorage.getItem("refreshToken");
      if (refreshToken) {
        try {
          const { data } = await axios.post(`${API_BASE}/auth/refresh`, {
            refreshToken,
          });
          localStorage.setItem("accessToken", data.accessToken);
          localStorage.setItem("refreshToken", data.refreshToken);
          originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
          return api(originalRequest);
        } catch {
          localStorage.removeItem("accessToken");
          localStorage.removeItem("refreshToken");
          window.location.href = "/login";
        }
      }
    }
    return Promise.reject(error);
  }
);

export const authAPI = {
  login: (email: string, password: string) =>
    api.post("/auth/login", { email, password }),
  refresh: (refreshToken: string) =>
    api.post("/auth/refresh", { refreshToken }),
  logout: (refreshToken: string) =>
    api.post("/auth/logout", { refreshToken }),
  profile: () => api.get("/auth/profile"),
};

export const usersAPI = {
  list: (page = 1, limit = 20) => api.get(`/users?page=${page}&limit=${limit}`),
  get: (id: string) => api.get(`/users/${id}`),
  create: (data: any) => api.post("/users", data),
  update: (id: string, data: any) => api.put(`/users/${id}`, data),
  delete: (id: string) => api.delete(`/users/${id}`),
  changePassword: (id: string, password: string) =>
    api.post(`/users/${id}/password`, { password }),
};

export const devicesAPI = {
  list: (page = 1, limit = 20, status?: string) =>
    api.get(`/devices?page=${page}&limit=${limit}${status ? `&status=${status}` : ""}`),
  get: (id: string) => api.get(`/devices/${id}`),
  stats: () => api.get("/devices/stats"),
  delete: (id: string) => api.delete(`/devices/${id}`),
};

export const commandsAPI = {
  list: (page = 1, limit = 20, status?: string) =>
    api.get(`/commands?page=${page}&limit=${limit}${status ? `&status=${status}` : ""}`),
  listByDevice: (deviceId: string, page = 1, limit = 20) =>
    api.get(`/commands/device/${deviceId}?page=${page}&limit=${limit}`),
  create: (data: any) => api.post("/commands", data),
  approve: (id: string) => api.post(`/commands/${id}/approve`),
  reject: (id: string) => api.post(`/commands/${id}/reject`),
};

export const screenshotsAPI = {
  list: (page = 1, limit = 20) =>
    api.get(`/screenshots?page=${page}&limit=${limit}`),
  get: (id: string) => api.get(`/screenshots/${id}`),
  listByDevice: (deviceId: string, page = 1, limit = 20) =>
    api.get(`/screenshots/device/${deviceId}?page=${page}&limit=${limit}`),
  request: (deviceId: string, reason?: string) =>
    api.post("/screenshots/request", { deviceId, reason }),
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
    return api.get(`/audit?${params.toString()}`);
  },
};

export default api;
