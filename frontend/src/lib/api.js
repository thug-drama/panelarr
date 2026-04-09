class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch(path, options = {}) {
  const { body, ...rest } = options;
  const config = {
    headers: { "Content-Type": "application/json" },
    ...rest,
  };
  if (body !== undefined) {
    config.body = JSON.stringify(body);
  }
  const resp = await fetch(`/api${path}`, config);
  if (!resp.ok) {
    // Redirect to login on 401 (except for auth endpoints)
    if (resp.status === 401 && !path.startsWith("/auth/")) {
      window.location.href = "/login";
      throw new ApiError(401, "Authentication required");
    }
    let message = `Request failed (${resp.status})`;
    try {
      const data = await resp.json();
      message = data.detail || message;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(resp.status, message);
  }
  if (resp.status === 204) return null;
  return resp.json();
}
