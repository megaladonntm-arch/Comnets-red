from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, constr

UsernameStr = constr(
    strip_whitespace=True,
    min_length=3,
    max_length=24,
    pattern=r"^[A-Za-z0-9_][A-Za-z0-9_.-]{2,23}$",
)
PasswordStr = constr(min_length=8, max_length=128)
RoomNameStr = constr(strip_whitespace=True, min_length=3, max_length=80)
RoomCodeStr = constr(strip_whitespace=True, pattern=r"^\d{5}$")
DisplayNameStr = constr(strip_whitespace=True, min_length=1, max_length=40)
StatusTextStr = constr(strip_whitespace=True, min_length=1, max_length=120)
BioStr = constr(strip_whitespace=True, min_length=1, max_length=280)
AvatarDataStr = constr(strip_whitespace=True, min_length=20, max_length=600000)
PresenceStr = Literal["online", "busy", "away", "invisible"]


class StrictSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class UserCreate(StrictSchema):
    username: UsernameStr
    password: PasswordStr


class UserLogin(StrictSchema):
    username: UsernameStr
    password: PasswordStr


class Token(StrictSchema):
    access_token: str
    token_type: str = "bearer"


class UserProfileUpdate(StrictSchema):
    display_name: Optional[DisplayNameStr] = None
    status_text: Optional[StatusTextStr] = None
    bio: Optional[BioStr] = None
    avatar_data: Optional[AvatarDataStr] = None
    presence: PresenceStr = "online"


class UserProfileSummary(StrictSchema):
    id: int
    username: str
    display_name: Optional[str] = None
    status_text: str = ""
    avatar_data: Optional[str] = None
    presence: PresenceStr = "online"
    is_online: bool = False
    last_seen_at: Optional[datetime] = None


class UserProfileOut(UserProfileSummary):
    bio: str = ""
    created_at: Optional[datetime] = None
    rooms_joined: int = 0
    rooms_owned: int = 0
    active_room_id: Optional[int] = None
    active_room_name: Optional[str] = None


class RoomCreate(StrictSchema):
    name: RoomNameStr
    is_private: bool = False
    whiteboard_enabled: bool = False


class RoomJoin(StrictSchema):
    room_id: int = Field(gt=0)


class RoomJoinByCode(StrictSchema):
    code: RoomCodeStr


class RoomOut(StrictSchema):
    id: int
    name: str
    is_private: bool
    owner_id: int
    code: Optional[str] = None
    owner_username: Optional[str] = None
    whiteboard_enabled: bool = False
    active_users: int = 0

    model_config = ConfigDict(from_attributes=True, extra="forbid", str_strip_whitespace=True)


class RoomUserOut(StrictSchema):
    id: int
    user_id: int
    room_id: int
    is_muted: bool
    is_banned: bool
    is_active: bool

    model_config = ConfigDict(from_attributes=True, extra="forbid", str_strip_whitespace=True)
