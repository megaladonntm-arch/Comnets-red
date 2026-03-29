import json
from copy import deepcopy
from typing import Any, Dict, Optional, Set, Tuple

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import SessionLocal
from models.models import Room, RoomUser, User
from services.auth import decode_token
from services.rooms import MAX_ROOM_USERS, count_room_users, get_room_by_id, get_room_user

router = APIRouter()


def clone_jsonable(value: Any):
    return deepcopy(value)


class ConnectionManager:
    def __init__(self):
        self.active: Dict[int, Set[WebSocket]] = {}
        self.user_sockets: Dict[Tuple[int, int], WebSocket] = {}
        self.socket_meta: Dict[WebSocket, Tuple[int, int]] = {}
        self.room_participants: Dict[int, Dict[int, dict]] = {}
        self.whiteboards: Dict[int, dict] = {}

    async def connect(
        self,
        room_id: int,
        user_id: int,
        websocket: WebSocket,
        participant: dict,
        whiteboard_enabled: bool,
    ):
        existing_socket = self.user_sockets.get((room_id, user_id))
        if existing_socket and existing_socket is not websocket:
            self.active.get(room_id, set()).discard(existing_socket)
            self.socket_meta.pop(existing_socket, None)
            try:
                await existing_socket.close(code=4006)
            except RuntimeError:
                pass

        await websocket.accept()
        self.active.setdefault(room_id, set()).add(websocket)
        self.user_sockets[(room_id, user_id)] = websocket
        self.socket_meta[websocket] = (room_id, user_id)
        self.room_participants.setdefault(room_id, {})[user_id] = participant
        self.whiteboards.setdefault(room_id, {"enabled": whiteboard_enabled, "strokes": []})

    def disconnect(self, room_id: int, user_id: int, websocket: WebSocket) -> bool:
        was_current_socket = self.user_sockets.get((room_id, user_id)) is websocket

        room_sockets = self.active.get(room_id)
        if room_sockets:
            room_sockets.discard(websocket)
            if not room_sockets:
                self.active.pop(room_id, None)

        self.socket_meta.pop(websocket, None)

        if was_current_socket:
            self.user_sockets.pop((room_id, user_id), None)
            room_participants = self.room_participants.get(room_id)
            if room_participants:
                room_participants.pop(user_id, None)
                if not room_participants:
                    self.room_participants.pop(room_id, None)

        if room_id not in self.active:
            self.whiteboards.pop(room_id, None)

        return was_current_socket

    async def broadcast(self, room_id: int, message: dict, exclude_user_id: Optional[int] = None):
        sockets = list(self.active.get(room_id, set()))
        if not sockets:
            return

        data = json.dumps(message)
        stale_sockets = []
        for ws in sockets:
            meta = self.socket_meta.get(ws)
            if exclude_user_id is not None and meta == (room_id, exclude_user_id):
                continue
            try:
                await ws.send_text(data)
            except RuntimeError:
                stale_sockets.append(ws)

        for ws in stale_sockets:
            meta = self.socket_meta.get(ws)
            if not meta:
                continue
            stale_room_id, stale_user_id = meta
            self.disconnect(stale_room_id, stale_user_id, ws)

    async def close_user(self, room_id: int, user_id: int):
        ws = self.user_sockets.get((room_id, user_id))
        if ws:
            await ws.close(code=4003)

    async def send_to_user(self, room_id: int, user_id: int, message: dict):
        ws = self.user_sockets.get((room_id, user_id))
        if not ws:
            return
        try:
            await ws.send_text(json.dumps(message))
        except RuntimeError:
            self.disconnect(room_id, user_id, ws)

    def list_participants(self, room_id: int) -> list[dict]:
        participants = self.room_participants.get(room_id, {})
        return [clone_jsonable(participant) for participant in participants.values()]

    def get_participant(self, room_id: int, user_id: int) -> Optional[dict]:
        participant = self.room_participants.get(room_id, {}).get(user_id)
        return clone_jsonable(participant) if participant else None

    def set_participant_state(self, room_id: int, user_id: int, **updates) -> Optional[dict]:
        participant = self.room_participants.get(room_id, {}).get(user_id)
        if not participant:
            return None
        participant.update(updates)
        return clone_jsonable(participant)

    def get_whiteboard_state(self, room_id: int, default_enabled: bool = False) -> dict:
        whiteboard = self.whiteboards.setdefault(
            room_id, {"enabled": default_enabled, "strokes": []}
        )
        return clone_jsonable(whiteboard)

    def set_whiteboard_enabled(self, room_id: int, enabled: bool) -> dict:
        whiteboard = self.whiteboards.setdefault(room_id, {"enabled": enabled, "strokes": []})
        whiteboard["enabled"] = enabled
        return clone_jsonable(whiteboard)

    def clear_whiteboard(self, room_id: int) -> dict:
        whiteboard = self.whiteboards.setdefault(room_id, {"enabled": False, "strokes": []})
        whiteboard["strokes"] = []
        return clone_jsonable(whiteboard)

    def apply_whiteboard_draw(self, room_id: int, payload: dict) -> Optional[dict]:
        whiteboard = self.whiteboards.setdefault(room_id, {"enabled": False, "strokes": []})
        mode = payload.get("mode")
        if mode not in {"start", "point", "end"}:
            return None

        if mode == "start":
            stroke = payload.get("stroke") or {}
            stroke_id = stroke.get("id")
            points = stroke.get("points") or []
            if not stroke_id or not points:
                return None
            filtered_strokes = [
                item for item in whiteboard["strokes"] if item.get("id") != stroke_id
            ]
            filtered_strokes.append(
                {
                    "id": stroke_id,
                    "author_id": stroke.get("author_id"),
                    "color": stroke.get("color", "#f6c344"),
                    "width": stroke.get("width", 3),
                    "points": points,
                }
            )
            whiteboard["strokes"] = filtered_strokes
            return {"mode": "start", "stroke": clone_jsonable(filtered_strokes[-1])}

        stroke_id = payload.get("stroke_id")
        if not stroke_id:
            return None

        stroke = next(
            (item for item in whiteboard["strokes"] if item.get("id") == stroke_id), None
        )
        if not stroke:
            return None

        if mode == "point":
            point = payload.get("point")
            if not point:
                return None
            stroke.setdefault("points", []).append(point)
            return {"mode": "point", "stroke_id": stroke_id, "point": clone_jsonable(point)}

        return {"mode": "end", "stroke_id": stroke_id}


manager = ConnectionManager()


def get_db() -> AsyncSession:
    return SessionLocal()


async def get_user_by_username(db: AsyncSession, username: str) -> Optional[User]:
    result = await db.execute(select(User).where(User.username == username))
    return result.scalar_one_or_none()


def build_participant_state(user: User, room_user: RoomUser, video_enabled: bool = True) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "audio_enabled": not room_user.is_muted,
        "video_enabled": video_enabled,
    }


async def set_room_user_active(
    db: AsyncSession, room_user: RoomUser, *, is_active: bool
) -> RoomUser:
    room_user.is_active = is_active
    await db.commit()
    await db.refresh(room_user)
    return room_user


async def set_room_user_muted(db: AsyncSession, room_user: RoomUser, *, is_muted: bool) -> RoomUser:
    room_user.is_muted = is_muted
    await db.commit()
    await db.refresh(room_user)
    return room_user


async def ensure_room_access(
    db: AsyncSession, username: str, room_id: int
) -> tuple[Optional[User], Optional[Room], Optional[RoomUser], Optional[str]]:
    user = await get_user_by_username(db, username)
    if not user:
        return None, None, None, "invalid_user"

    room = await get_room_by_id(db, room_id)
    if not room:
        return user, None, None, "room_not_found"

    room_user = await get_room_user(db, room_id, user.id)
    if not room_user or room_user.is_banned:
        return user, room, room_user, "forbidden"

    if not room_user.is_active and await count_room_users(db, room_id) >= MAX_ROOM_USERS:
        return user, room, room_user, "room_full"

    return user, room, room_user, None


def require_owner(room: Room, user: User):
    if room.owner_id != user.id:
        raise ValueError("not_owner")


@router.websocket("/ws/rooms/{room_id}")
async def room_ws(websocket: WebSocket, room_id: int):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001)
        return

    username = decode_token(token)
    if not username:
        await websocket.close(code=4002)
        return

    db = get_db()
    room = None
    room_user = None
    user = None
    try:
        user, room, room_user, error = await ensure_room_access(db, username, room_id)
        if error == "invalid_user":
            await websocket.close(code=4002)
            return
        if error == "room_not_found":
            await websocket.close(code=4004)
            return
        if error == "forbidden":
            await websocket.close(code=4003)
            return
        if error == "room_full":
            await websocket.close(code=4005)
            return

        room_user = await set_room_user_active(db, room_user, is_active=True)
        participant = build_participant_state(user, room_user)

        await manager.connect(room_id, user.id, websocket, participant, room.whiteboard_enabled)
        await websocket.send_text(
            json.dumps(
                {
                    "type": "welcome",
                    "self_id": user.id,
                    "room": {
                        "id": room.id,
                        "name": room.name,
                        "owner_id": room.owner_id,
                        "whiteboard_enabled": room.whiteboard_enabled,
                    },
                    "self_state": {
                        "audio_enabled": participant["audio_enabled"],
                        "video_enabled": participant["video_enabled"],
                    },
                    "participants": [
                        item
                        for item in manager.list_participants(room_id)
                        if item["id"] != user.id
                    ],
                    "whiteboard": manager.get_whiteboard_state(
                        room_id, default_enabled=room.whiteboard_enabled
                    ),
                }
            )
        )

        await manager.broadcast(
            room_id,
            {"type": "participant_joined", "participant": participant},
            exclude_user_id=user.id,
        )

        while True:
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
            except json.JSONDecodeError:
                await websocket.send_text(
                    json.dumps({"type": "error", "detail": "invalid_json"})
                )
                continue

            event_type = payload.get("type")
            if event_type == "media_state":
                audio_enabled = payload.get("audio_enabled")
                video_enabled = payload.get("video_enabled")
                if isinstance(audio_enabled, bool):
                    room_user = await set_room_user_muted(
                        db, room_user, is_muted=not audio_enabled
                    )
                participant = manager.set_participant_state(
                    room_id,
                    user.id,
                    audio_enabled=(
                        audio_enabled
                        if isinstance(audio_enabled, bool)
                        else manager.get_participant(room_id, user.id)["audio_enabled"]
                    ),
                    video_enabled=(
                        video_enabled
                        if isinstance(video_enabled, bool)
                        else manager.get_participant(room_id, user.id)["video_enabled"]
                    ),
                )
                if participant:
                    await manager.broadcast(
                        room_id, {"type": "participant_state", "participant": participant}
                    )
            elif event_type == "mute_user":
                target_id = payload.get("user_id")
                try:
                    require_owner(room, user)
                except ValueError:
                    await websocket.send_text(
                        json.dumps({"type": "error", "detail": "not_owner"})
                    )
                    continue

                if not target_id or target_id == user.id:
                    continue

                target_room_user = await get_room_user(db, room.id, target_id)
                if not target_room_user or target_room_user.is_banned:
                    continue

                await set_room_user_muted(db, target_room_user, is_muted=True)
                participant = manager.set_participant_state(
                    room_id, target_id, audio_enabled=False
                )
                if participant:
                    await manager.broadcast(
                        room_id, {"type": "participant_state", "participant": participant}
                    )
                await manager.send_to_user(room_id, target_id, {"type": "force_mute"})
            elif event_type == "ban_user":
                target_id = payload.get("user_id")
                try:
                    require_owner(room, user)
                except ValueError:
                    await websocket.send_text(
                        json.dumps({"type": "error", "detail": "not_owner"})
                    )
                    continue

                if not target_id or target_id == user.id:
                    continue

                target_room_user = await get_room_user(db, room.id, target_id)
                if not target_room_user:
                    continue
                target_room_user.is_banned = True
                target_room_user.is_active = False
                await db.commit()
                await manager.close_user(room_id, target_id)
            elif event_type in {"offer", "answer", "ice"}:
                target_id = payload.get("target_id")
                if not target_id:
                    await websocket.send_text(
                        json.dumps({"type": "error", "detail": "missing_target"})
                    )
                    continue
                relay = {
                    "type": event_type,
                    "from_id": user.id,
                    "payload": payload.get("payload"),
                }
                await manager.send_to_user(room_id, target_id, relay)
            elif event_type == "whiteboard_toggle":
                try:
                    require_owner(room, user)
                except ValueError:
                    await websocket.send_text(
                        json.dumps({"type": "error", "detail": "not_owner"})
                    )
                    continue

                enabled = bool(payload.get("enabled"))
                room.whiteboard_enabled = enabled
                await db.commit()
                whiteboard = manager.set_whiteboard_enabled(room_id, enabled)
                await manager.broadcast(
                    room_id,
                    {
                        "type": "whiteboard_status",
                        "enabled": whiteboard["enabled"],
                    },
                )
            elif event_type == "whiteboard_clear":
                try:
                    require_owner(room, user)
                except ValueError:
                    await websocket.send_text(
                        json.dumps({"type": "error", "detail": "not_owner"})
                    )
                    continue

                manager.clear_whiteboard(room_id)
                await manager.broadcast(room_id, {"type": "whiteboard_clear"})
            elif event_type == "whiteboard_draw":
                whiteboard = manager.get_whiteboard_state(room_id, room.whiteboard_enabled)
                if not whiteboard["enabled"]:
                    await websocket.send_text(
                        json.dumps({"type": "error", "detail": "whiteboard_disabled"})
                    )
                    continue

                draw_payload = manager.apply_whiteboard_draw(room_id, payload.get("payload") or {})
                if not draw_payload:
                    await websocket.send_text(
                        json.dumps({"type": "error", "detail": "invalid_whiteboard_payload"})
                    )
                    continue

                await manager.broadcast(
                    room_id,
                    {"type": "whiteboard_draw", "payload": draw_payload, "from_id": user.id},
                    exclude_user_id=user.id,
                )
            else:
                await websocket.send_text(
                    json.dumps({"type": "error", "detail": "unknown_event"})
                )
    except WebSocketDisconnect:
        pass
    finally:
        if user and room_user:
            disconnected_current = manager.disconnect(room_id, user.id, websocket)
            if disconnected_current:
                await set_room_user_active(db, room_user, is_active=False)
                await manager.broadcast(
                    room_id, {"type": "participant_left", "user_id": user.id}
                )
        await db.close()
