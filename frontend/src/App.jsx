import { useCallback, useEffect, useMemo, useState } from "react";
import Home from "./pages/Home.jsx";
import Room from "./pages/Room.jsx";
import AuthPage from "./pages/Auth.jsx";
import UserSettingsModal from "./components/UserSettingsModal.jsx";
import UserProfileModal from "./components/UserProfileModal.jsx";
import { api } from "./services/api.js";

const STORAGE_KEY = "comnot_auth";
const SETTINGS_STORAGE_PREFIX = "comnot_settings";
const DEFAULT_SETTINGS = {
  theme: "midnight",
  background: "grid",
  iconStyle: "rounded",
  audioInputId: "",
  videoInputId: ""
};

export default function App() {
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [rooms, setRooms] = useState([]);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [isOwner, setIsOwner] = useState(false);
  const [authView, setAuthView] = useState({ open: false, mode: "login" });
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currentProfile, setCurrentProfile] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);

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
      setCurrentProfile(null);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const loadProfile = async () => {
      try {
        const profile = await api.getMyProfile();
        if (!cancelled) setCurrentProfile(profile);
      } catch {
        if (!cancelled) setCurrentProfile(null);
      }
    };

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [currentRoom?.id, token]);

  useEffect(() => {
    const storageKey = `${SETTINGS_STORAGE_PREFIX}_${username || "guest"}`;
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      setSettings(DEFAULT_SETTINGS);
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      setSettings({ ...DEFAULT_SETTINGS, ...parsed });
    } catch {
      localStorage.removeItem(storageKey);
      setSettings(DEFAULT_SETTINGS);
    }
  }, [username]);

  useEffect(() => {
    const storageKey = `${SETTINGS_STORAGE_PREFIX}_${username || "guest"}`;
    localStorage.setItem(storageKey, JSON.stringify(settings));
  }, [settings, username]);

  useEffect(() => {
    document.documentElement.dataset.themePreset = settings.theme;
    document.documentElement.dataset.backgroundPreset = settings.background;
    document.documentElement.dataset.iconPreset = settings.iconStyle;

    return () => {
      delete document.documentElement.dataset.themePreset;
      delete document.documentElement.dataset.backgroundPreset;
      delete document.documentElement.dataset.iconPreset;
    };
  }, [settings.background, settings.iconStyle, settings.theme]);

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

  const saveProfile = async (payload) => {
    const profile = await api.updateMyProfile(payload);
    setCurrentProfile(profile);
    return profile;
  };

  const refreshRooms = useCallback(async () => {
    try {
      const list = await api.getRooms();
      setRooms(list || []);
    } catch {
      setRooms([]);
    }
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
    void refreshRooms();
    return room;
  };

  const enterRoomAsOwner = (room) => {
    setCurrentRoom(room);
    setIsOwner(room.owner_username === username);
  };

  const handleJoinRoom = async (roomId) => {
    const room = await api.joinRoom({ room_id: roomId });
    setCurrentRoom(room);
    setIsOwner(room.owner_username === username);
  };

  const handleJoinByCode = async (code) => {
    const room = await api.joinByCode({ code });
    setCurrentRoom(room);
    setIsOwner(room.owner_username === username);
  };

  const handleJoinRandom = async () => {
    const room = await api.joinRandom();
    setCurrentRoom(room);
    setIsOwner(room.owner_username === username);
  };

  if (currentRoom) {
    return (
      <>
        <Room
          room={currentRoom}
          username={username}
          token={token}
          isOwner={isOwner}
          settings={settings}
          currentProfile={currentProfile}
          onLeave={() => setCurrentRoom(null)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenProfile={() => setProfileOpen(true)}
        />
        {settingsOpen && (
          <UserSettingsModal
            username={username}
            settings={settings}
            onClose={() => setSettingsOpen(false)}
            onSave={setSettings}
          />
        )}
        {profileOpen && currentProfile && (
          <UserProfileModal
            profile={currentProfile}
            editable
            onClose={() => setProfileOpen(false)}
            onSave={saveProfile}
          />
        )}
      </>
    );
  }

  if (authView.open) {
    return (
      <>
        <AuthPage
          mode={authView.mode}
          onModeChange={(mode) => setAuthView({ open: true, mode })}
          onLogin={handleLogin}
          onRegister={handleRegister}
          onBack={() => setAuthView({ open: false, mode: "login" })}
        />
        {settingsOpen && (
          <UserSettingsModal
            username={username}
            settings={settings}
            onClose={() => setSettingsOpen(false)}
            onSave={setSettings}
          />
        )}
        {profileOpen && currentProfile && (
          <UserProfileModal
            profile={currentProfile}
            editable
            onClose={() => setProfileOpen(false)}
            onSave={saveProfile}
          />
        )}
      </>
    );
  }

  return (
    <>
      <Home
        rooms={rooms}
        authed={authed}
        username={username}
        currentProfile={currentProfile}
        onLogout={logout}
        onRefresh={refreshRooms}
        onCreateRoom={handleCreateRoom}
        onEnterOwnerRoom={enterRoomAsOwner}
        onJoinRoom={handleJoinRoom}
        onJoinByCode={handleJoinByCode}
        onJoinRandom={handleJoinRandom}
        onOpenAuth={(mode) => setAuthView({ open: true, mode })}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenProfile={() => setProfileOpen(true)}
      />
      {settingsOpen && (
        <UserSettingsModal
          username={username}
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={setSettings}
        />
      )}
      {profileOpen && currentProfile && (
        <UserProfileModal
          profile={currentProfile}
          editable
          onClose={() => setProfileOpen(false)}
          onSave={saveProfile}
        />
      )}
    </>
  );
}
