import { accessToken } from "../stores/auth";
import { get } from "svelte/store";
import { API_PATH } from "../lib/common";

export async function apiFetch(url, params = {}) {
  let token = get(accessToken);

  const headers = new Headers(params.headers || {});
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_PATH}/${url}`, { ...params, headers });

  if (response.status === 401) {
    // Попробуем обновить access-токен
    const refreshRes = await fetch(`${API_PATH}/auth/refresh-token`, {
      method: "POST",
      credentials: "include", // чтобы передать httpOnly cookie
    });

    if (refreshRes.ok) {
      const data = await refreshRes.json();
      accessToken.set(data.accessToken);

      // Повторим оригинальный запрос с новым токеном
      const retryHeaders = new Headers(params.headers || {});
      retryHeaders.set("Authorization", `Bearer ${data.accessToken}`);

      return fetch(`${API_PATH}/${url}`, { ...params, headers: retryHeaders });
    } else {
      accessToken.set(null); // refresh тоже не сработал
    }
  }

  return response;
}
