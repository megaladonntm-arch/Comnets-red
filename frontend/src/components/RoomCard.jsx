export default function RoomCard({ room, onJoin, disabled }) {
  return (
    <div className="room-card">
      <div>
        <p className="eyebrow">Room</p>
        <h4>{room.name}</h4>
        <p className="muted">
          {room.active_users}/4 online · {room.whiteboard_enabled ? "board on" : "board off"}
        </p>
      </div>
      <button className="secondary" onClick={onJoin} disabled={disabled} type="button">
        Join
      </button>
    </div>
  );
}
