const ENV_BASE_URL = (
  import.meta.env.VITE_BACKEND_URL ||
  import.meta.env.VITE_API_URL
)?.trim();

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function resolveBaseUrl() {
  if (ENV_BASE_URL) return trimTrailingSlash(ENV_BASE_URL);

  if (typeof window !== "undefined") {
    const { hostname, origin } = window.location;
    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
    return isLocalHost ? "http://localhost:8000" : trimTrailingSlash(origin);
  }

  return "http://localhost:8000";
}

const BASE_URL = resolveBaseUrl();

class ApiClient {
  constructor() {
    this.token = "";
  }

  setToken(token) {
    this.token = token || "";
  }

  async request(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    let response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers
      });
    } catch {
      throw new Error("Network error. Check server availability and try again.");
    }

    if (!response.ok) {
      let detail = "Request failed";
      try {
        const data = await response.json();
        detail = data.detail || detail;
      } catch {
        // ignore malformed error payloads
      }
      throw new Error(detail);
    }

    return response.json();
  }

  register(payload) {
    return this.request("/register", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  login(payload) {
    return this.request("/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  getMyProfile() {
    return this.request("/profile/me");
  }

  updateMyProfile(payload) {
    return this.request("/profile/me", {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  getUserProfile(userId) {
    return this.request(`/profile/users/${userId}`);
  }

  getRooms() {
    return this.request("/rooms");
  }

  getRoom(roomId) {
    return this.request(`/rooms/${roomId}`);
  }

  createRoom(payload) {
    return this.request("/rooms/create", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  joinRoom(payload) {
    return this.request("/rooms/join", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  joinByCode(payload) {
    return this.request("/rooms/join-by-code", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  joinRandom() {
    return this.request("/rooms/random", {
      method: "POST"
    });
  }
}

export const api = new ApiClient();
