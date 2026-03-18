import { useState } from "react";

export default function AuthPanel({ onLogin, onRegister, mode, onModeChange }) {
  const [internalMode, setInternalMode] = useState("login");
  const activeMode = mode || internalMode;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!username || !password) return;
    setLoading(true);
    try {
      if (activeMode === "login") {
        await onLogin({ username, password });
      } else {
        await onRegister({ username, password });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card auth-card">
      <div className="tabs">
        <button
          className={activeMode === "login" ? "tab active" : "tab"}
          onClick={() => (onModeChange ? onModeChange("login") : setInternalMode("login"))}
        >
          Login
        </button>
        <button
          className={activeMode === "register" ? "tab active" : "tab"}
          onClick={() =>
            onModeChange ? onModeChange("register") : setInternalMode("register")
          }
        >
          Register
        </button>
      </div>

      <form onSubmit={handleSubmit} className="auth-form">
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="spacepilot"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="????????"
          />
        </label>
        <button className="primary" type="submit" disabled={loading}>
          {loading ? "Loading..." : activeMode === "login" ? "Login" : "Create account"}
        </button>
      </form>
    </div>
  );
}
