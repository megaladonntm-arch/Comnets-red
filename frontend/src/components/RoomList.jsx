import RoomCard from "./RoomCard.jsx";

export default function RoomList({ rooms, onJoin, disabled }) {
  if (!rooms.length) {
    return <div className="empty">No public rooms yet</div>;
  }

  return (
    <div className="room-list">
      {rooms.map((room) => (
        <RoomCard
          key={room.id}
          room={room}
          onJoin={() => onJoin(room.id)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
