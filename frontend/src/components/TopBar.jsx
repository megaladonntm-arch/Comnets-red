export default function TopBar({
  authed,
  username,
  onLogout,
  roomName,
  onLoginClick,
  onRegisterClick,
  onBack
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo">
          <img src="/photos/COMNOT.png" alt="Comnot" />
        </div>
        <div>
          <p className="eyebrow">Comnot</p>
          <h1>{roomName || "Voice rooms"}</h1>
        </div>
      </div>

      {!roomName && (
        <div className="top-actions">
          {authed ? (
            <>
              <div className="user-chip">
                <div className="avatar-sm">{(username || "?").slice(0, 2).toUpperCase()}</div>
                <span>@{username}</span>
              </div>
              <button className="ghost" onClick={onLogout}>
                Logout
              </button>
            </>
          ) : (
            <>
              <button className="ghost" onClick={onLoginClick}>
                Login
              </button>
              <button className="secondary" onClick={onRegisterClick}>
                Register
              </button>
            </>
          )}
        </div>
      )}

      {roomName === "Auth" && (
        <div className="top-actions">
          <button className="ghost" onClick={onBack}>
            Back
          </button>
        </div>
      )}
    </header>
  );
}
