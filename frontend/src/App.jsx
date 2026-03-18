import { useCallback, useEffect, useMemo, useState } from "react";
import Home from "./pages/Home.jsx";
import Room from "./pages/Room.jsx";
import AuthPage from "./pages/Auth.jsx";
import { api } from "./services/api.js";

const STORAGE_KEY = "comnot_auth";

export default function App() {
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [rooms, setRooms] = useState([]);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [isOwner, setIsOwner] = useState(false);
  const [authView, setAuthView] = useState({ open: false, mode: "login" });

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const data = JSON.parse(raw);
        setToken(data.token || "");
        setUsername(data.username || "");
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => {
    api.setToken(token);
    if (!token) {
      setCurrentRoom(null);
      setIsOwner(false);
    }
  }, [token]);

  const authed = useMemo(() => Boolean(token), [token]);

  const persistAuth = (nextToken, nextUsername) => {
    setToken(nextToken);
    setUsername(nextUsername);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ token: nextToken, username: nextUsername })
    );
    setAuthView({ open: false, mode: "login" });
  };

  const logout = () => {
    setToken("");
    setUsername("");
    localStorage.removeItem(STORAGE_KEY);
  };

  const refreshRooms = useCallback(async () => {
    const list = await api.getRooms();
    setRooms(list || []);
  }, []);

  const handleLogin = async (payload) => {
    const data = await api.login(payload);
    persistAuth(data.access_token, payload.username);
  };

  const handleRegister = async (payload) => {
    const data = await api.register(payload);
    persistAuth(data.access_token, payload.username);
  };

  const handleCreateRoom = async (payload) => {
    const room = await api.createRoom(payload);
    return room;
  };

  const enterRoomAsOwner = (room) => {
    setCurrentRoom(room);
    setIsOwner(true);
  };

  const handleJoinRoom = async (roomId) => {
    await api.joinRoom({ room_id: roomId });
    const room = rooms.find((r) => r.id === roomId) || {
      id: roomId,
      name: "Room",
      is_private: false,
      owner_id: null
    };
    setCurrentRoom(room);
    setIsOwner(false);
  };

  const handleJoinByCode = async (code) => {
    const roomUser = await api.joinByCode({ code });
    setCurrentRoom({
      id: roomUser.room_id,
      name: "Private room",
      is_private: true,
      owner_id: null
    });
    setIsOwner(false);
  };

  const handleJoinRandom = async () => {
    const room = await api.joinRandom();
    setCurrentRoom(room);
    setIsOwner(false);
  };

  if (currentRoom) {
    return (
      <Room
        room={currentRoom}
        username={username}
        token={token}
        isOwner={isOwner}
        onLeave={() => setCurrentRoom(null)}
      />
    );
  }

  if (authView.open) {
    return (
      <AuthPage
        mode={authView.mode}
        onModeChange={(mode) => setAuthView({ open: true, mode })}
        onLogin={handleLogin}
        onRegister={handleRegister}
        onBack={() => setAuthView({ open: false, mode: "login" })}
      />
    );
  }

  return (
    <Home
      rooms={rooms}
      authed={authed}
      username={username}
      onLogin={handleLogin}
      onRegister={handleRegister}
      onLogout={logout}
      onRefresh={refreshRooms}
      onCreateRoom={handleCreateRoom}
      onEnterOwnerRoom={enterRoomAsOwner}
      onJoinRoom={handleJoinRoom}
      onJoinByCode={handleJoinByCode}
      onJoinRandom={handleJoinRandom}
      onOpenAuth={(mode) => setAuthView({ open: true, mode })}
    />
  );
}
