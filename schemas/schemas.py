from typing import Optional

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
