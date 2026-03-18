const BASE_WS = import.meta.env.VITE_WS_URL || "ws://localhost:8000";

export function connectRoomSocket(roomId, token, onMessage, silent = false) {
  const socket = new WebSocket(`${BASE_WS}/ws/rooms/${roomId}?token=${token}`);

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
