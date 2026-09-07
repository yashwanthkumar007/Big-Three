import axios from "axios";

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL ?? "");

const api = axios.create({ baseURL: API_BASE_URL });

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
