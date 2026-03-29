export default function RoomCard({ room, onJoin, disabled }) {
  return (
    <div className="room-card">
      <div className="room-card-copy">
        <div className="room-card-topline">
          <p className="eyebrow">Live room</p>
          <span className={`room-privacy ${room.is_private ? "private" : "public"}`}>
            {room.is_private ? "Private" : "Public"}
          </span>
        </div>
        <h4>{room.name}</h4>
        <p className="muted">Hosted by @{room.owner_username || "unknown"}</p>
      </div>
      <div className="room-card-cta">
        <div className="room-card-meta">
          <span>{room.active_users}/4 online</span>
          <span>{room.whiteboard_enabled ? "Board enabled" : "Board disabled"}</span>
        </div>
        <button className="secondary" onClick={onJoin} disabled={disabled} type="button">
          Enter room
        </button>
      </div>
    </div>
  );
}
