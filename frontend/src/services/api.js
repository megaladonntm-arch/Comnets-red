const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

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

    const response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers
    });

    if (!response.ok) {
      let detail = "Request failed";
      try {
        const data = await response.json();
        detail = data.detail || detail;
      } catch {
        // ignore
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
