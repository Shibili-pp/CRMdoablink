import axios from 'axios';
import { API_URL } from './config';

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
});

const TOKEN_KEY = 'orbit_access';

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config || {};
    const url = original.url || '';
    if (error.response?.status === 401 && !original._retry && !url.includes('/auth/login') && !url.includes('/auth/refresh')) {
      original._retry = true;
      refreshing = refreshing || api.post('/api/v1/auth/refresh', {}).then((response) => {
        setToken(response.data.data.accessToken);
        return response.data.data.accessToken;
      }).finally(() => {
        refreshing = null;
      });
      try {
        const token = await refreshing;
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch (refreshError) {
        setToken('');
      }
    }
    return Promise.reject(error);
  }
);

export function messageFrom(error, fallback = 'Something went wrong') {
  return error?.response?.data?.message || error.message || fallback;
}

export async function downloadFile(url, filename) {
  const response = await api.get(url, { responseType: 'blob' });
  const type = response.data?.type || '';
  if (type.includes('application/json')) {
    const text = await response.data.text();
    throw new Error(JSON.parse(text).message || 'Export failed');
  }
  const blobUrl = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(blobUrl);
}

export default api;
