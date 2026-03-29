const ENV_BACKEND_URL = (
  import.meta.env.VITE_BACKEND_URL ||
  import.meta.env.VITE_API_URL
)?.trim();
const ENV_WS_URL = import.meta.env.VITE_WS_URL?.trim();

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function toWsUrl(value) {
  if (!value) return "";
  if (value.startsWith("ws://") || value.startsWith("wss://")) {
    return trimTrailingSlash(value);
  }
  if (value.startsWith("https://")) {
    return trimTrailingSlash(`wss://${value.slice("https://".length)}`);
  }
  if (value.startsWith("http://")) {
    return trimTrailingSlash(`ws://${value.slice("http://".length)}`);
  }
  return trimTrailingSlash(value);
}

function resolveWsBase() {
  if (ENV_WS_URL) return toWsUrl(ENV_WS_URL);
  if (ENV_BACKEND_URL) return toWsUrl(ENV_BACKEND_URL);

  if (typeof window !== "undefined") {
    const { hostname, protocol, host } = window.location;
    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
    if (isLocalHost) return "ws://localhost:8000";
    return `${protocol === "https:" ? "wss" : "ws"}://${host}`;
  }

  return "ws://localhost:8000";
}

const BASE_WS = resolveWsBase();

export function connectRoomSocket(roomId, token, onMessage, silent = false) {
  const socket = new WebSocket(`${BASE_WS}/ws/rooms/${roomId}?token=${encodeURIComponent(token)}`);

  socket.onmessage = (event) => {
    if (!onMessage) return;
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch {
      if (!silent) console.warn("Invalid WS payload", event.data);
    }
  };

  socket.onerror = () => {
    if (!silent) console.warn("WebSocket error");
  };

  return socket;
}
