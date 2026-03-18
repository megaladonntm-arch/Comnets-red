export default function RoomCard({ room, onJoin, disabled }) {
  return (
    <div className="room-card">
      <div>
        <p className="eyebrow">Room</p>
        <h4>{room.name}</h4>
        <p className="muted">Participants: 0</p>
      </div>
      <button className="secondary" onClick={onJoin} disabled={disabled}>
        Join
      </button>
    </div>
  );
}
