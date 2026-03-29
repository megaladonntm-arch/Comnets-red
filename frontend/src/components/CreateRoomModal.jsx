import { useMemo, useState } from "react";
import Modal from "./Modal.jsx";

export default function CreateRoomModal({ onClose, onCreate, onEnter }) {
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [whiteboardEnabled, setWhiteboardEnabled] = useState(false);
  const [createdRoom, setCreatedRoom] = useState(null);

  const disabled = useMemo(() => !name.trim(), [name]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (disabled) return;
    const room = await onCreate({
      name: name.trim(),
      is_private: isPrivate,
      whiteboard_enabled: whiteboardEnabled
    });
    setCreatedRoom(room);
  };

  return (
    <Modal title="Create room" onClose={onClose}>
      <form className="create-form" onSubmit={handleSubmit}>
        <label>
          Room title
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Night shift"
          />
        </label>

        <div className="toggle-group">
          <button
            type="button"
            className={isPrivate ? "toggle" : "toggle active"}
            onClick={() => setIsPrivate(false)}
          >
            Public
          </button>
          <button
            type="button"
            className={isPrivate ? "toggle active" : "toggle"}
            onClick={() => setIsPrivate(true)}
          >
            Private
          </button>
        </div>

        <div className="toggle-group">
          <button
            type="button"
            className={whiteboardEnabled ? "toggle active" : "toggle"}
            onClick={() => setWhiteboardEnabled(true)}
          >
            Board on
          </button>
          <button
            type="button"
            className={whiteboardEnabled ? "toggle" : "toggle active"}
            onClick={() => setWhiteboardEnabled(false)}
          >
            Board off
          </button>
        </div>

        {isPrivate && !createdRoom && (
          <div className="code-box">
            <p className="eyebrow">Room code</p>
            <h4>Generated after create</h4>
            <p className="muted">The server will generate a 5-digit code.</p>
          </div>
        )}

        {createdRoom?.code && (
          <div className="code-box">
            <p className="eyebrow">Room code</p>
            <h4>{createdRoom.code}</h4>
            <p className="muted">Share this code with your friends.</p>
          </div>
        )}

        {!createdRoom ? (
          <button className="primary" type="submit" disabled={disabled}>
            Create
          </button>
        ) : (
          <button className="primary" type="button" onClick={() => onEnter(createdRoom)}>
            Enter room
          </button>
        )}
      </form>
    </Modal>
  );
}
