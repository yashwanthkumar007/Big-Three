import axios from "axios";
import { getAccessToken, getSession } from "../utils/auth";

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL ?? "");

const api = axios.create({ baseURL: API_BASE_URL });

// Attach the authenticated identity + current session id to every CRUD request.
// The backend resolves the accountType from its OWN database — these headers
// only identify WHO is calling, they never grant permissions by themselves.
// Without X-User-Email the backend rejects admin (PUT/DELETE) operations with
// "X-User-Email header is required".
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const session = getSession();
  if (session?.email) {
    config.headers["X-User-Email"] = session.email;
  }
  if (session?.sessionId) {
    config.headers["X-Session-Id"] = session.sessionId;
  }
  return config;
});

export async function listResources<T>(resource: string): Promise<T[]> {
  const { data } = await api.get<T[]>(`/api/${resource}`);
  return data;
}

export async function getResource<T>(resource: string, id: string): Promise<T> {
  const { data } = await api.get<T>(`/api/${resource}/${id}`);
  return data;
}

export async function createResource<T>(resource: string, payload: Record<string, unknown>): Promise<T> {
  const { data } = await api.post<T>(`/api/${resource}`, payload);
  return data;
}

export async function updateResource<T>(resource: string, id: string, payload: Record<string, unknown>): Promise<T> {
  const { data } = await api.put<T>(`/api/${resource}/${id}`, payload);
  return data;
}

export async function deleteResource(resource: string, id: string): Promise<void> {
  await api.delete(`/api/${resource}/${id}`);
}
