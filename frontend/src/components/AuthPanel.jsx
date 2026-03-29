import { useState } from "react";
import { validatePassword, validateUsername } from "../utils/validation.js";

export default function AuthPanel({ onLogin, onRegister, mode, onModeChange }) {
  const [internalMode, setInternalMode] = useState("login");
  const activeMode = mode || internalMode;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmedUsername = username.trim();
    const usernameError = validateUsername(trimmedUsername);
    const passwordError = validatePassword(password);
    if (usernameError || passwordError) {
      setError(usernameError || passwordError);
      return;
    }

    setLoading(true);
    setError("");
    try {
      if (activeMode === "login") {
        await onLogin({ username: trimmedUsername, password });
      } else {
        await onRegister({ username: trimmedUsername, password });
      }
    } catch (submitError) {
      setError(submitError.message || "Request failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card auth-card">
      <div className="auth-card-header">
        <p className="eyebrow">{activeMode === "login" ? "Welcome back" : "Create access"}</p>
        <h3>{activeMode === "login" ? "Enter your hub" : "Claim your profile"}</h3>
        <p className="muted">
          {activeMode === "login"
            ? "Back to your rooms."
            : "Create account and start fast."}
        </p>
      </div>

      <div className="tabs">
        <button
          className={activeMode === "login" ? "tab active" : "tab"}
          type="button"
          onClick={() => (onModeChange ? onModeChange("login") : setInternalMode("login"))}
        >
          Login
        </button>
        <button
          className={activeMode === "register" ? "tab active" : "tab"}
          type="button"
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
            onChange={(e) => {
              setUsername(e.target.value);
              if (error) setError("");
            }}
            placeholder="spacepilot"
            autoComplete="username"
            maxLength={24}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError("");
            }}
            placeholder="At least 8 characters"
            autoComplete={activeMode === "login" ? "current-password" : "new-password"}
            minLength={8}
            maxLength={128}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary" type="submit" disabled={loading}>
          {loading ? "Loading..." : activeMode === "login" ? "Login" : "Create account"}
        </button>
      </form>
    </div>
  );
}
