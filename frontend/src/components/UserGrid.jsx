export default function UserGrid({ slots, isOwner, onMute, onBan }) {
  return (
    <div className="grid">
      {slots.map((user, index) => (
        <div key={index} className="user-card">
          {user ? (
            <>
              <div className="avatar">{user.username.slice(0, 2).toUpperCase()}</div>
              <div>
                <h4>{user.username}</h4>
                <p className={user.online ? "active" : "muted"}>
                  {user.online ? "Connected" : "Offline"}
                </p>
              </div>
              {user.speaking && <span className="mic-pill">Mic</span>}
              <div className="status-row">
                <span className={user.audioEnabled ? "status-chip active" : "status-chip off"}>
                  {user.audioEnabled ? "Mic on" : "Mic off"}
                </span>
                <span className={user.videoEnabled ? "status-chip active" : "status-chip off"}>
                  {user.videoEnabled ? "Cam on" : "Cam off"}
                </span>
              </div>
              {isOwner && !user.self && (
                <div className="owner-actions">
                  <button className="ghost" onClick={() => onMute(user.id)}>
                    Mute
                  </button>
                  <button className="danger" onClick={() => onBan(user.id)}>
                    Ban
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="empty-slot">Empty</div>
          )}
        </div>
      ))}
    </div>
  );
}
