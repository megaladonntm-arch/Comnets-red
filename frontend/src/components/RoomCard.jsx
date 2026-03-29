export default function RoomCard({ room, onJoin, disabled }) {
  return (
    <div className="room-card">
      <div className="room-card-copy">
        <div className="room-card-topline">
          <p className="eyebrow">Room</p>
          <span className={`room-privacy ${room.is_private ? "private" : "public"}`}>
            {room.is_private ? "Private" : "Public"}
          </span>
        </div>
        <h4>{room.name}</h4>
        <p className="muted">Owner @{room.owner_username || "unknown"}</p>
        <div className="room-card-meta">
          <span>{room.active_users}/4 online</span>
          <span>{room.whiteboard_enabled ? "Board enabled" : "Board disabled"}</span>
        </div>
      </div>
      <button className="secondary" onClick={onJoin} disabled={disabled} type="button">
        Join
      </button>
    </div>
  );
}
