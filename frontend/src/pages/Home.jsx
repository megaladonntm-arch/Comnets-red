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

      <main className="home-shell">
        <section className="hero-panel card">
          <div className="hero-copy">
            <p className="eyebrow">Realtime rooms</p>
            <h2>Voice hubs with stage energy, sharp hierarchy and zero clutter.</h2>
            <p className="muted">
              Comnot brings together live voice, video, a shared board and moderation inside a
              room UI that feels active the moment people join.
            </p>
            <div className="hero-actions">
              {authed ? (
                <>
                  <button className="primary" onClick={() => setShowCreate(true)} type="button">
                    Create a room
                  </button>
                  <button
                    className="secondary"
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
                    type="button"
                    disabled={joinLoading}
                  >
                    Jump into live room
                  </button>
                </>
              ) : (
                <>
                  <button className="primary" onClick={() => onOpenAuth("register")} type="button">
                    Create account
                  </button>
                  <button
                    className="secondary"
                    onClick={() => onOpenAuth("login")}
                    type="button"
                  >
                    Open login
                  </button>
                </>
              )}
            </div>
            <div className="hero-proof">
              <div className="proof-item">
                <strong>{roomCount}</strong>
                <span>public hubs live</span>
              </div>
              <div className="proof-item">
                <strong>4 seats</strong>
                <span>tight stage format</span>
              </div>
              <div className="proof-item">
                <strong>One flow</strong>
                <span>voice, video and board sync</span>
              </div>
            </div>
          </div>

          <div className="hero-showcase">
            <div className="spotlight-card">
              <p className="spotlight-kicker">Hub preview</p>
              <strong>Channel-style rooms with their own pulse.</strong>
              <p>
                Spin up a controlled room with owner actions, instant access codes and a live
                shared canvas that stays inside the conversation instead of around it.
              </p>
              <div className="spotlight-metric">
                <span>5-digit access</span>
                <span>Stage controls built in</span>
              </div>
            </div>
            <div className="showcase-stack">
              <div className="showcase-card">
                <p className="eyebrow">Use case</p>
                <h3>Team hubs</h3>
                <p>Drop into a room that already feels organized and alive.</p>
              </div>
              <div className="showcase-card accent">
                <p className="eyebrow">Flow</p>
                <h3>Join, talk, sketch and move</h3>
                <p>No extra tabs, no buried controls and no dead-feeling interface.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="layout">
          <section className="rooms-panel">
            <section className="card discovery-panel">
              <header className="panel-header">
                <div>
                  <p className="eyebrow">Discovery</p>
                  <h2>Browse live public hubs</h2>
                  <p className="muted">
                    Enter open rooms that already have motion, conversation and board activity.
                  </p>
                </div>
                <button className="ghost" onClick={onRefresh} type="button">
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
              <div className="room-footer">{roomCount} rooms online right now</div>
            </section>
          </section>

          <section className="side-panel">
            {!authed ? (
              <div className="card auth-card">
                <p className="eyebrow">Access</p>
                <h3>Enter your hub first</h3>
                <p className="muted">
                  Sign in once to create rooms, jump into live sessions and share private access
                  codes without friction.
                </p>
                <div className="join-actions">
                  <button className="primary" onClick={() => onOpenAuth("login")} type="button">
                    Open login
                  </button>
                  <button
                    className="secondary"
                    onClick={() => onOpenAuth("register")}
                    type="button"
                  >
                    Create account
                  </button>
                </div>
              </div>
            ) : (
              <div className="card focus-card">
                <p className="eyebrow">Quick entry</p>
                <h3>Join by code or jump into a live room</h3>
                <p className="muted">
                  Use direct access for private sessions or land in a live public room instantly.
                </p>
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
                    type="button"
                  >
                    Random room
                  </button>
                  <form onSubmit={handleJoinCode} className="code-form">
                    <input
                      placeholder="Enter 5-digit code"
                      value={joinCode}
                      onChange={(e) => {
                        setJoinCode(normalizeRoomCode(e.target.value));
                        if (joinError) setJoinError("");
                      }}
                      inputMode="numeric"
                      maxLength={5}
                    />
                    <button className="secondary" type="submit" disabled={joinLoading}>
                      {joinLoading ? "Joining..." : "Join"}
                    </button>
                  </form>
                  {joinError && <p className="form-error">{joinError}</p>}
                </div>
              </div>
            )}

            <div className="card info-card">
              <p className="eyebrow">Why it works</p>
              <h3>Built like a compact community tool, not a blank meeting window</h3>
              <p className="muted">
                Comnot gives rooms a stronger sense of place: visible presence, clear actions and
                better energy than a bare utility link.
              </p>
            </div>

            <div className="card feature-stack">
              <div className="feature-item">
                <span className="feature-kicker">Calls</span>
                <strong>Live media with smoother recovery</strong>
                <p className="muted">Rooms stay more stable through reconnect churn.</p>
              </div>
              <div className="feature-item">
                <span className="feature-kicker">Whiteboard</span>
                <strong>Sketch, annotate and export in one flow</strong>
                <p className="muted">Shared board actions stay inside the room context.</p>
              </div>
              <div className="feature-item">
                <span className="feature-kicker">Moderation</span>
                <strong>Owner controls without product clutter</strong>
                <p className="muted">Mute, remove and manage participation from the same surface.</p>
              </div>
            </div>
          </section>
        </section>
      </main>

      {authed && (
        <button className="floating" onClick={() => setShowCreate(true)} type="button">
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
