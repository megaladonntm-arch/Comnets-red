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
            <p className="eyebrow">Realtime collaboration</p>
            <h2>Voice rooms that look premium and feel effortless to use.</h2>
            <p className="muted">
              Comnot packages private calls, live video, a shared board and moderation into a
              product surface that feels sharp from the first click.
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
                <span>public rooms live</span>
              </div>
              <div className="proof-item">
                <strong>4 seats</strong>
                <span>tight focused sessions</span>
              </div>
              <div className="proof-item">
                <strong>One flow</strong>
                <span>audio, video and board sync</span>
              </div>
            </div>
          </div>

          <div className="hero-showcase">
            <div className="spotlight-card">
              <p className="spotlight-kicker">Signature room experience</p>
              <strong>Private by default. Fast by design.</strong>
              <p>
                Create a controlled space with owner actions, instant access codes and a live
                shared canvas for decisions that need to happen now.
              </p>
              <div className="spotlight-metric">
                <span>05-digit access</span>
                <span>Moderation built in</span>
              </div>
            </div>
            <div className="showcase-stack">
              <div className="showcase-card">
                <p className="eyebrow">Use case</p>
                <h3>Client calls</h3>
                <p>Sharper presentation than a raw meeting link.</p>
              </div>
              <div className="showcase-card accent">
                <p className="eyebrow">Why it converts</p>
                <h3>People understand it instantly</h3>
                <p>Join, talk, sketch and move. No extra tabs, no friction, no noise.</p>
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
                  <h2>Browse live public rooms</h2>
                  <p className="muted">
                    Enter open lounges that already have motion, conversation and board activity.
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
                <h3>Open the product properly</h3>
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
                <h3>Join by code or jump into motion</h3>
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
              <p className="eyebrow">Positioning</p>
              <h3>Built for compact teams and polished client-facing sessions</h3>
              <p className="muted">
                Instead of a bare meeting link, Comnot gives you a branded-feeling environment
                with control, privacy and visual confidence.
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
