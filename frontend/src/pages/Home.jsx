import { useEffect, useMemo, useState } from "react";
import TopBar from "../components/TopBar.jsx";
import RoomList from "../components/RoomList.jsx";
import CreateRoomModal from "../components/CreateRoomModal.jsx";
import { normalizeRoomCode, validateRoomCode } from "../utils/validation.js";
import "../styles.css";

export default function Home({
  rooms,
  authed,
  username,
  onLogin,
  onRegister,
  onLogout,
  onRefresh,
  onCreateRoom,
  onEnterOwnerRoom,
  onJoinRoom,
  onJoinByCode,
  onJoinRandom,
  onOpenAuth
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);

  useEffect(() => {
    onRefresh();
  }, [onRefresh]);

  const roomCount = useMemo(() => rooms.length, [rooms]);

  const handleJoinCode = async (event) => {
    event.preventDefault();
    const normalizedCode = normalizeRoomCode(joinCode);
    const codeError = validateRoomCode(normalizedCode);
    if (codeError) {
      setJoinError(codeError);
      return;
    }

    setJoinLoading(true);
    setJoinError("");
    try {
      await onJoinByCode(normalizedCode);
    } catch (error) {
      setJoinError(error.message || "Unable to join room by code.");
    } finally {
      setJoinLoading(false);
    }
  };

  return (
    <div className="app">
      <TopBar
        authed={authed}
        username={username}
        onLogout={onLogout}
        onLoginClick={() => onOpenAuth("login")}
        onRegisterClick={() => onOpenAuth("register")}
      />

      <main className="layout">
        <section className="rooms-panel">
          <header className="panel-header">
            <div>
              <p className="eyebrow">Rooms</p>
              <h2>Public lounges</h2>
            </div>
            <button className="ghost" onClick={onRefresh}>
              Refresh
            </button>
          </header>

          <RoomList
            rooms={rooms}
            onJoin={async (roomId) => {
              setJoinLoading(true);
              setJoinError("");
              try {
                await onJoinRoom(roomId);
              } catch (error) {
                setJoinError(error.message || "Unable to join room.");
              } finally {
                setJoinLoading(false);
              }
            }}
            disabled={!authed || joinLoading}
          />
          {joinError && authed && <p className="form-error">{joinError}</p>}
          <div className="room-footer">{roomCount} rooms online</div>
        </section>

        <section className="side-panel">
          {!authed ? (
            <div className="card auth-card">
              <p className="eyebrow">Access</p>
              <h3>Login to join</h3>
              <p className="muted">
                Registration and login are now on a separate page.
              </p>
              <div className="join-actions">
                <button className="primary" onClick={() => onOpenAuth("login")}>
                  Open login
                </button>
                <button className="secondary" onClick={() => onOpenAuth("register")}>
                  Open register
                </button>
              </div>
            </div>
          ) : (
            <div className="card focus-card">
              <p className="eyebrow">Join</p>
              <h3>Enter a room</h3>
              <div className="join-actions">
                <button
                  className="primary"
                  onClick={async () => {
                    setJoinLoading(true);
                    setJoinError("");
                    try {
                      await onJoinRandom();
                    } catch (error) {
                      setJoinError(error.message || "Unable to join a random room.");
                    } finally {
                      setJoinLoading(false);
                    }
                  }}
                  disabled={joinLoading}
                >
                  Random room
                </button>
                <form onSubmit={handleJoinCode} className="code-form">
                  <input
                    placeholder="Enter code"
                    value={joinCode}
                    onChange={(e) => {
                      setJoinCode(normalizeRoomCode(e.target.value));
                      if (joinError) setJoinError("");
                    }}
                    inputMode="numeric"
                    maxLength={5}
                  />
                  <button className="secondary" type="submit" disabled={joinLoading}>
                    {joinLoading ? "Joining..." : "Join by code"}
                  </button>
                </form>
                {joinError && <p className="form-error">{joinError}</p>}
              </div>
            </div>
          )}

          <div className="card info-card">
            <p className="eyebrow">About</p>
            <h3>Comnot voice rooms</h3>
            <p className="muted">
              Quick rooms for 2-4 people. Create private lounges with a 5-digit
              code and keep the conversation tight.
            </p>
          </div>
        </section>
      </main>

      {authed && (
        <button className="floating" onClick={() => setShowCreate(true)}>
          +
        </button>
      )}

      {showCreate && (
        <CreateRoomModal
          onClose={() => setShowCreate(false)}
          onCreate={async (payload) => {
            return onCreateRoom(payload);
          }}
          onEnter={(room) => {
            onEnterOwnerRoom(room);
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}
