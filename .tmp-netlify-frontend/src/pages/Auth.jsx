import AuthPanel from "../components/AuthPanel.jsx";
import TopBar from "../components/TopBar.jsx";

export default function AuthPage({ mode, onModeChange, onLogin, onRegister, onBack }) {
  return (
    <div className="app">
      <TopBar roomName="Auth" onBack={onBack} />
      <main className="auth-page">
        <section className="auth-layout">
          <div className="card auth-showcase">
            <p className="eyebrow">Hub access</p>
            <h2>Step into a room flow that feels alive from the first second.</h2>
            <p className="muted">Minimal room flow. Fast entry. Clear controls.</p>
            <div className="feature-stack">
              <div className="feature-item">
                <span className="feature-kicker">Fast start</span>
                <strong>Open a hub in seconds</strong>
                <p className="muted">No setup maze and no messy context switching.</p>
              </div>
              <div className="feature-item">
                <span className="feature-kicker">Room energy</span>
                <strong>Stage, roster and whiteboard in one flow</strong>
                <p className="muted">More like a live product space than a raw meeting link.</p>
              </div>
            </div>
          </div>

          <div className="auth-panel-shell">
            <AuthPanel
              mode={mode}
              onModeChange={onModeChange}
              onLogin={onLogin}
              onRegister={onRegister}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
