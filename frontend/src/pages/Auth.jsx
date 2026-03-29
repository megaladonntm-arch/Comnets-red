import AuthPanel from "../components/AuthPanel.jsx";
import TopBar from "../components/TopBar.jsx";

export default function AuthPage({ mode, onModeChange, onLogin, onRegister, onBack }) {
  return (
    <div className="app">
      <TopBar roomName="Auth" onBack={onBack} />
      <main className="auth-page">
        <section className="auth-layout">
          <div className="card auth-showcase">
            <p className="eyebrow">Commercial onboarding</p>
            <h2>Access the room experience that feels ready for clients.</h2>
            <p className="muted">
              Log in to create focused collaboration spaces with instant codes, live board tools
              and owner controls that stay clean under pressure.
            </p>
            <div className="feature-stack">
              <div className="feature-item">
                <span className="feature-kicker">Fast start</span>
                <strong>Create a room in seconds</strong>
                <p className="muted">No setup maze, no extra switching between tools.</p>
              </div>
              <div className="feature-item">
                <span className="feature-kicker">Premium feel</span>
                <strong>Sharper surface for team and client calls</strong>
                <p className="muted">A cleaner first impression than a bare utility interface.</p>
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
