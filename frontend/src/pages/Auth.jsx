import AuthPanel from "../components/AuthPanel.jsx";
import TopBar from "../components/TopBar.jsx";

export default function AuthPage({ mode, onModeChange, onLogin, onRegister, onBack }) {
  return (
    <div className="app">
      <TopBar roomName="Auth" onBack={onBack} />
      <main className="auth-page">
        <AuthPanel
          mode={mode}
          onModeChange={onModeChange}
          onLogin={onLogin}
          onRegister={onRegister}
        />
      </main>
    </div>
  );
}
