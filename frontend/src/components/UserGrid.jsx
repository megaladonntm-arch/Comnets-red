export default function UserGrid({ slots, isOwner, onMute, onBan }) {
  return (
    <div className="grid">
      {slots.map((user, index) => (
        <div key={index} className="user-card">
          {user ? (
            <>
              <div className="user-card-head">
                <div className="avatar">{user.username.slice(0, 2).toUpperCase()}</div>
                <div className="user-card-copy">
                  <p className="eyebrow">{user.self ? "You" : `Seat 0${index + 1}`}</p>
                  <h4>{user.username}</h4>
                  <p className={user.online ? "active" : "muted"}>
                    {user.online ? "Connected now" : "Offline"}
                  </p>
                </div>
                {user.speaking && <span className="mic-pill">Speaking</span>}
              </div>
              <div className="status-row">
                <span className={user.audioEnabled ? "status-chip active" : "status-chip off"}>
                  {user.audioEnabled ? "Mic on" : "Mic muted"}
                </span>
                <span className={user.videoEnabled ? "status-chip active" : "status-chip off"}>
                  {user.videoEnabled ? "Camera on" : "Camera off"}
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
            <div className="empty-slot">
              <strong>Seat available</strong>
              <span>Invite another participant into the room.</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
