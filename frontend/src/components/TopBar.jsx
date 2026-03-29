export default function TopBar({
  authed,
  username,
  profile,
  onLogout,
  roomName,
  onLoginClick,
  onRegisterClick,
  onBack,
  onSettingsClick,
  onProfileClick
}) {
  const avatarLabel = (profile?.display_name || username || "?").slice(0, 2).toUpperCase();
  const profileName = profile?.display_name || username;

  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo">
          <img src="/photos/COMNOT.png" alt="Comnot" />
        </div>
        <div className="brand-copy">
          <p className="eyebrow">Comnot</p>
          <h1>{roomName || "Voice rooms and live hubs"}</h1>
          <p className="brand-note">
            {roomName === "Auth"
              ? "Secure access into your collaboration hub."
              : roomName
                ? "Stage controls, live media and whiteboard sync in one room."
                : "Private calls, shared board and moderation in one fast community-style surface."}
          </p>
        </div>
      </div>

      {!roomName && (
        <div className="top-actions">
          <div className="top-status">
            <span className="status-dot" />
            <span>Realtime online</span>
          </div>
          {authed ? (
            <>
              <div className="user-chip">
                <div className="avatar-sm">
                  {profile?.avatar_data ? (
                    <img src={profile.avatar_data} alt={profileName || username} />
                  ) : (
                    avatarLabel
                  )}
                </div>
                <span>{profileName || username}</span>
              </div>
              <button className="ghost" onClick={onProfileClick} type="button">
                Profile
              </button>
              <button className="ghost" onClick={onSettingsClick} type="button">
                Settings
              </button>
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

      {roomName && roomName !== "Auth" && onSettingsClick && (
        <div className="top-actions">
          {onProfileClick && (
            <button className="ghost" onClick={onProfileClick} type="button">
              Profile
            </button>
          )}
          <button className="ghost" onClick={onSettingsClick} type="button">
            Settings
          </button>
        </div>
      )}
    </header>
  );
}
