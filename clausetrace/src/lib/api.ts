import { auth } from './firebase';

/**
 * Returns Authorization headers including Firebase Auth ID Token or demo token fallback.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  try {
    if (auth.currentUser) {
      const token = await auth.currentUser.getIdToken();
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      headers['Authorization'] = `Bearer demo-token`;
    }
  } catch {
    headers['Authorization'] = `Bearer demo-token`;
  }

  return headers;
}

/**
 * Authenticated API fetch wrapper for CLAUSETRACE backend endpoints
 */
export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  const headers = {
    ...authHeaders,
    ...(options.headers || {}),
  };

  return fetch(url, {
    ...options,
    headers,
  });
}

/**
 * Safely fetches and parses JSON from CLAUSETRACE backend endpoints,
 * with strict validation against HTML error fallbacks.
 */
export async function apiFetchJson<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await apiFetch(url, options);
  const contentType = res.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    const rawText = await res.text();
    console.error(`API response from ${url} was non-JSON (${res.status}):`, rawText.slice(0, 150));
    throw new Error(`API server returned an invalid response (${res.status}). Please check your connection.`);
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || data.message || `API request failed with status ${res.status}`);
  }

  return data as T;
}
