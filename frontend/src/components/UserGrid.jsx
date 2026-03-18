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
                <p className={user.muted ? "muted" : "active"}>
                  {user.muted ? "Muted" : "Live"}
                </p>
              </div>
              {user.speaking && <span className="mic-pill">Mic</span>}
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
