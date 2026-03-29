import json
import math
import re
from copy import deepcopy
from typing import Any, Dict, Optional, Set, Tuple

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import SessionLocal
from models.models import Room, RoomUser, User
from services.auth import decode_token
from services.profiles import get_user_by_id, touch_user_last_seen
from services.rooms import MAX_ROOM_USERS, count_room_users, get_room_by_id, get_room_user

router = APIRouter()

MAX_WS_MESSAGE_SIZE = 128_000
MAX_WHITEBOARD_ELEMENTS = 300
MAX_STROKE_POINTS = 600
MAX_TEXT_LENGTH = 160
MAX_TEXT_LINES = 5
DEFAULT_BRUSH_COLOR = "#f6c344"
DEFAULT_TEXT_SIZE = 24
DEFAULT_STROKE_WIDTH = 3
ID_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
HEX_COLOR_PATTERN = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def clone_jsonable(value: Any):
    return deepcopy(value)


def clamp_number(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def normalize_element_id(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value or not ID_PATTERN.fullmatch(value):
        return None
    return value


def normalize_color(value: Any, default: str = DEFAULT_BRUSH_COLOR) -> str:
    if isinstance(value, str) and HEX_COLOR_PATTERN.fullmatch(value.strip()):
        return value.strip().lower()
    return default


def normalize_point(value: Any) -> Optional[dict]:
    if not isinstance(value, dict):
        return None

    x = value.get("x")
    y = value.get("y")
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return None
    if not math.isfinite(x) or not math.isfinite(y):
        return None

    return {
        "x": round(clamp_number(float(x), 0.0, 1.0), 4),
        "y": round(clamp_number(float(y), 0.0, 1.0), 4),
    }


def normalize_stroke_width(value: Any) -> int:
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        return DEFAULT_STROKE_WIDTH
    return int(round(clamp_number(float(value), 1.0, 18.0)))


def normalize_font_size(value: Any) -> int:
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        return DEFAULT_TEXT_SIZE
    return int(round(clamp_number(float(value), 14.0, 72.0)))


def normalize_text_value(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None

    text = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text or len(text) > MAX_TEXT_LENGTH:
        return None

    lines = text.split("\n")
    if len(lines) > MAX_TEXT_LINES:
        return None

    return "\n".join(line[:80] for line in lines)


def normalize_stroke_payload(payload: Any, author_id: int) -> Optional[dict]:
    if not isinstance(payload, dict):
        return None

    stroke_id = normalize_element_id(payload.get("id"))
    points = payload.get("points")
    if not stroke_id or not isinstance(points, list) or not points:
        return None

    normalized_points = []
    for point in points[:MAX_STROKE_POINTS]:
        normalized_point = normalize_point(point)
        if not normalized_point:
            return None
        normalized_points.append(normalized_point)

    return {
        "kind": "stroke",
        "id": stroke_id,
        "author_id": author_id,
        "color": normalize_color(payload.get("color")),
        "width": normalize_stroke_width(payload.get("width")),
        "points": normalized_points,
    }


def normalize_text_payload(payload: Any, author_id: int) -> Optional[dict]:
    if not isinstance(payload, dict):
        return None

    text_id = normalize_element_id(payload.get("id"))
    point = normalize_point(payload.get("point"))
    text = normalize_text_value(payload.get("text"))
    if not text_id or not point or not text:
        return None

    return {
        "kind": "text",
        "id": text_id,
        "author_id": author_id,
        "color": normalize_color(payload.get("color")),
        "size": normalize_font_size(payload.get("size")),
        "point": point,
        "text": text,
    }


def sanitize_board_element(element: Any) -> Optional[dict]:
    if not isinstance(element, dict):
        return None

    kind = element.get("kind")
    author_id = element.get("author_id")
    if not isinstance(author_id, int) or author_id <= 0:
        author_id = 0

    if kind == "text":
        return normalize_text_payload(element, author_id)
    return normalize_stroke_payload(element, author_id)


def sanitize_whiteboard_state(raw_state: Any, fallback_enabled: bool = False) -> dict:
    parsed_state = raw_state
    if isinstance(raw_state, str):
        try:
            parsed_state = json.loads(raw_state)
        except json.JSONDecodeError:
            parsed_state = {}

    if not isinstance(parsed_state, dict):
        parsed_state = {}

    raw_elements = parsed_state.get("elements")
    if raw_elements is None:
        raw_elements = parsed_state.get("strokes")
    if not isinstance(raw_elements, list):
        raw_elements = []

    elements = []
    for element in raw_elements:
        normalized = sanitize_board_element(element)
        if normalized:
            elements.append(normalized)
        if len(elements) >= MAX_WHITEBOARD_ELEMENTS:
            break

    return {
        "enabled": bool(parsed_state.get("enabled", fallback_enabled)),
        "elements": elements,
    }


def serialize_whiteboard_state(state: dict) -> str:
    return json.dumps(state, ensure_ascii=False, separators=(",", ":"))


def validate_media_state_payload(payload: dict) -> Optional[dict]:
    audio_enabled = payload.get("audio_enabled")
    video_enabled = payload.get("video_enabled")
    if audio_enabled is not None and not isinstance(audio_enabled, bool):
        return None
    if video_enabled is not None and not isinstance(video_enabled, bool):
        return None
    return {"audio_enabled": audio_enabled, "video_enabled": video_enabled}


def validate_whiteboard_event(payload: Any, author_id: int) -> Optional[dict]:
    if not isinstance(payload, dict):
        return None

    mode = payload.get("mode")
    if mode == "start":
        stroke = normalize_stroke_payload(payload.get("stroke"), author_id)
        return {"mode": "start", "stroke": stroke} if stroke else None

    if mode == "point":
        stroke_id = normalize_element_id(payload.get("stroke_id"))
        point = normalize_point(payload.get("point"))
        if not stroke_id or not point:
            return None
        return {"mode": "point", "stroke_id": stroke_id, "point": point}

    if mode == "end":
        stroke_id = normalize_element_id(payload.get("stroke_id"))
        return {"mode": "end", "stroke_id": stroke_id} if stroke_id else None

    if mode == "text":
        text_item = normalize_text_payload(payload.get("text"), author_id)
        return {"mode": "text", "text": text_item} if text_item else None

    return None


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
        whiteboard_state: dict,
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
        self.whiteboards.setdefault(room_id, sanitize_whiteboard_state(whiteboard_state))

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
            room_id, {"enabled": default_enabled, "elements": []}
        )
        return clone_jsonable(whiteboard)

    def set_whiteboard_enabled(self, room_id: int, enabled: bool) -> dict:
        whiteboard = self.whiteboards.setdefault(room_id, {"enabled": enabled, "elements": []})
        whiteboard["enabled"] = enabled
        return clone_jsonable(whiteboard)

    def clear_whiteboard(self, room_id: int) -> dict:
        whiteboard = self.whiteboards.setdefault(room_id, {"enabled": False, "elements": []})
        whiteboard["elements"] = []
        return clone_jsonable(whiteboard)

    def apply_whiteboard_draw(self, room_id: int, payload: dict) -> Optional[dict]:
        whiteboard = self.whiteboards.setdefault(room_id, {"enabled": False, "elements": []})
        mode = payload.get("mode")
        if mode not in {"start", "point", "end", "text"}:
            return None

        elements = whiteboard["elements"]

        if mode == "start":
            stroke = payload.get("stroke")
            if not stroke:
                return None
            filtered = [item for item in elements if item.get("id") != stroke["id"]]
            if len(filtered) >= MAX_WHITEBOARD_ELEMENTS and not any(
                item.get("id") == stroke["id"] for item in elements
            ):
                return None
            filtered.append(clone_jsonable(stroke))
            whiteboard["elements"] = filtered
            return {"mode": "start", "stroke": clone_jsonable(stroke)}

        if mode == "text":
            text_item = payload.get("text")
            if not text_item:
                return None
            filtered = [item for item in elements if item.get("id") != text_item["id"]]
            if len(filtered) >= MAX_WHITEBOARD_ELEMENTS and not any(
                item.get("id") == text_item["id"] for item in elements
            ):
                return None
            filtered.append(clone_jsonable(text_item))
            whiteboard["elements"] = filtered
            return {"mode": "text", "text": clone_jsonable(text_item)}

        stroke_id = normalize_element_id(payload.get("stroke_id"))
        if not stroke_id:
            return None

        stroke = next(
            (
                item
                for item in whiteboard["elements"]
                if item.get("kind") == "stroke" and item.get("id") == stroke_id
            ),
            None,
        )
        if not stroke:
            return None

        if mode == "point":
            point = payload.get("point")
            if not point:
                return None
            points = stroke.setdefault("points", [])
            if len(points) >= MAX_STROKE_POINTS:
                return None
            points.append(point)
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
        "display_name": user.display_name,
        "status_text": user.status_text or "",
        "avatar_data": user.avatar_data,
        "presence": user.presence or "online",
        "last_seen_at": user.last_seen_at.isoformat() if user.last_seen_at else None,
        "is_online": True,
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


async def persist_room_whiteboard_state(db: AsyncSession, room: Room, whiteboard_state: dict):
    room.whiteboard_enabled = whiteboard_state["enabled"]
    room.whiteboard_state = serialize_whiteboard_state(whiteboard_state)
    await db.commit()


def load_room_whiteboard_state(room: Room) -> dict:
    return sanitize_whiteboard_state(room.whiteboard_state, fallback_enabled=room.whiteboard_enabled)


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
        user = await touch_user_last_seen(db, user)
        participant = build_participant_state(user, room_user)
        whiteboard_state = load_room_whiteboard_state(room)

        await manager.connect(room_id, user.id, websocket, participant, whiteboard_state)
        await websocket.send_text(
            json.dumps(
                {
                    "type": "welcome",
                    "self_id": user.id,
                    "room": {
                        "id": room.id,
                        "name": room.name,
                        "owner_id": room.owner_id,
                        "whiteboard_enabled": whiteboard_state["enabled"],
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
                        room_id, default_enabled=whiteboard_state["enabled"]
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
            if len(data) > MAX_WS_MESSAGE_SIZE:
                await websocket.close(code=1009)
                return

            try:
                payload = json.loads(data)
            except json.JSONDecodeError:
                await websocket.send_text(
                    json.dumps({"type": "error", "detail": "invalid_json"})
                )
                continue

            if not isinstance(payload, dict):
                await websocket.send_text(
                    json.dumps({"type": "error", "detail": "invalid_payload"})
                )
                continue

            event_type = payload.get("type")
            if not isinstance(event_type, str):
                await websocket.send_text(
                    json.dumps({"type": "error", "detail": "invalid_event_type"})
                )
                continue

            if event_type == "media_state":
                validated = validate_media_state_payload(payload)
                current_participant = manager.get_participant(room_id, user.id)
                if not validated or not current_participant:
                    await websocket.send_text(
                        json.dumps({"type": "error", "detail": "invalid_media_state"})
                    )
                    continue

                audio_enabled = validated["audio_enabled"]
                video_enabled = validated["video_enabled"]
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
                        else current_participant["audio_enabled"]
                    ),
                    video_enabled=(
                        video_enabled
                        if isinstance(video_enabled, bool)
                        else current_participant["video_enabled"]
                    ),
                )
                if participant:
                    await manager.broadcast(
                        room_id, {"type": "participant_state", "participant": participant}
                    )
            elif event_type == "profile_refresh":
                refreshed_user = await get_user_by_id(db, user.id)
                current_participant = manager.get_participant(room_id, user.id)
                if not refreshed_user or not current_participant:
                    continue

                participant = manager.set_participant_state(
                    room_id,
                    user.id,
                    display_name=refreshed_user.display_name,
                    status_text=refreshed_user.status_text or "",
                    avatar_data=refreshed_user.avatar_data,
                    presence=refreshed_user.presence or "online",
                    is_online=True,
                    last_seen_at=(
                        refreshed_user.last_seen_at.isoformat()
                        if refreshed_user.last_seen_at
                        else None
                    ),
                )
                if participant:
                    participant["audio_enabled"] = current_participant["audio_enabled"]
                    participant["video_enabled"] = current_participant["video_enabled"]
                    manager.set_participant_state(
                        room_id,
                        user.id,
                        audio_enabled=current_participant["audio_enabled"],
                        video_enabled=current_participant["video_enabled"],
                    )
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

                if not isinstance(target_id, int) or target_id <= 0 or target_id == user.id:
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

                if not isinstance(target_id, int) or target_id <= 0 or target_id == user.id:
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
                if not isinstance(target_id, int) or target_id <= 0 or target_id == user.id:
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

                enabled = payload.get("enabled")
                if not isinstance(enabled, bool):
                    await websocket.send_text(
                        json.dumps({"type": "error", "detail": "invalid_whiteboard_toggle"})
                    )
                    continue

                whiteboard = manager.set_whiteboard_enabled(room_id, enabled)
                await persist_room_whiteboard_state(db, room, whiteboard)
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

                whiteboard = manager.clear_whiteboard(room_id)
                await persist_room_whiteboard_state(db, room, whiteboard)
                await manager.broadcast(room_id, {"type": "whiteboard_clear"})
            elif event_type == "whiteboard_draw":
                whiteboard = manager.get_whiteboard_state(room_id, room.whiteboard_enabled)
                if not whiteboard["enabled"]:
                    await websocket.send_text(
                        json.dumps({"type": "error", "detail": "whiteboard_disabled"})
                    )
                    continue

                draw_payload = validate_whiteboard_event(payload.get("payload"), user.id)
                if not draw_payload:
                    await websocket.send_text(
                        json.dumps({"type": "error", "detail": "invalid_whiteboard_payload"})
                    )
                    continue

                applied_payload = manager.apply_whiteboard_draw(room_id, draw_payload)
                if not applied_payload:
                    await websocket.send_text(
                        json.dumps({"type": "error", "detail": "invalid_whiteboard_payload"})
                    )
                    continue

                if applied_payload["mode"] in {"start", "end", "text"}:
                    await persist_room_whiteboard_state(
                        db,
                        room,
                        manager.get_whiteboard_state(room_id, room.whiteboard_enabled),
                    )

                await manager.broadcast(
                    room_id,
                    {"type": "whiteboard_draw", "payload": applied_payload, "from_id": user.id},
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
                await touch_user_last_seen(db, user)
                await manager.broadcast(
                    room_id, {"type": "participant_left", "user_id": user.id}
                )
        await db.close()
