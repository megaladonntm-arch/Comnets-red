const USERNAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{2,23}$/;
const ROOM_CODE_PATTERN = /^\d{5}$/;

export function validateUsername(username) {
  const value = username.trim();
  if (!value) return "Username is required.";
  if (!USERNAME_PATTERN.test(value)) {
    return "Use 3-24 chars: letters, numbers, underscore, dot or dash.";
  }
  return "";
}

export function validatePassword(password) {
  if (!password) return "Password is required.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 128) return "Password is too long.";
  return "";
}

export function validateRoomName(name) {
  const value = name.trim();
  if (!value) return "Room name is required.";
  if (value.length < 3) return "Room name must be at least 3 characters.";
  if (value.length > 80) return "Room name must be 80 characters or fewer.";
  return "";
}

export function normalizeRoomCode(code) {
  return code.replace(/\D/g, "").slice(0, 5);
}

export function validateRoomCode(code) {
  if (!ROOM_CODE_PATTERN.test(code)) return "Code must contain exactly 5 digits.";
  return "";
}
