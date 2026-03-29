import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal.jsx";

function formatDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

function buildProfilePayload(form) {
  return {
    display_name: form.display_name?.trim() || null,
    status_text: form.status_text?.trim() || null,
    bio: form.bio?.trim() || null,
    avatar_data: form.avatar_data || null,
    presence: form.presence
  };
}

async function fileToAvatarData(file) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file.");
  }

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(file);
  });

  const image = await new Promise((resolve, reject) => {
    const nextImage = new Image();
    nextImage.onload = () => resolve(nextImage);
    nextImage.onerror = () => reject(new Error("Could not load image."));
    nextImage.src = dataUrl;
  });

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const scale = Math.max(size / image.width, size / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const offsetX = (size - drawWidth) / 2;
  const offsetY = (size - drawHeight) / 2;

  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);

  return canvas.toDataURL("image/webp", 0.86);
}

export default function UserProfileModal({
  profile,
  editable = false,
  loading = false,
  onClose,
  onSave
}) {
  const [form, setForm] = useState(profile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(profile);
    setError("");
  }, [profile]);

  const title = useMemo(() => {
    if (!profile) return "Profile";
    return editable ? "My profile" : `@${profile.username}`;
  }, [editable, profile]);

  if (loading || !form) {
    return (
      <Modal title={title} onClose={onClose}>
        <div className="profile-shell">
          <div className="empty-slot">Loading profile...</div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="profile-shell">
        <div className="profile-hero">
          <div className="profile-avatar">
            {form.avatar_data ? (
              <img src={form.avatar_data} alt={form.username} />
            ) : (
              <span>{(form.display_name || form.username || "?").slice(0, 2).toUpperCase()}</span>
            )}
          </div>
          <div className="profile-meta">
            <div className="profile-meta-head">
              <h4>{form.display_name || form.username}</h4>
              <span className={`profile-presence ${form.presence || "online"}`}>
                {form.is_online ? "Online" : form.presence || "offline"}
              </span>
            </div>
            <p className="muted">@{form.username}</p>
            {form.status_text ? <p className="profile-status-text">{form.status_text}</p> : null}
          </div>
        </div>

        <div className="profile-stats">
          <div className="profile-stat">
            <span>Last seen</span>
            <strong>{form.is_online ? "Now" : formatDate(form.last_seen_at)}</strong>
          </div>
          <div className="profile-stat">
            <span>Rooms joined</span>
            <strong>{form.rooms_joined ?? 0}</strong>
          </div>
          <div className="profile-stat">
            <span>Rooms owned</span>
            <strong>{form.rooms_owned ?? 0}</strong>
          </div>
        </div>

        {form.active_room_name ? (
          <div className="profile-active-room">
            <span className="eyebrow">Active now</span>
            <strong>{form.active_room_name}</strong>
          </div>
        ) : null}

        {editable ? (
          <div className="profile-form">
            <div className="settings-grid">
              <label>
                Display name
                <input
                  value={form.display_name || ""}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, display_name: event.target.value.slice(0, 40) }))
                  }
                  placeholder="Display name"
                  maxLength={40}
                />
              </label>

              <label>
                Presence
                <select
                  value={form.presence || "online"}
                  onChange={(event) => setForm((prev) => ({ ...prev, presence: event.target.value }))}
                >
                  <option value="online">Online</option>
                  <option value="busy">Busy</option>
                  <option value="away">Away</option>
                  <option value="invisible">Invisible</option>
                </select>
              </label>
            </div>

            <label>
              Status
              <input
                value={form.status_text || ""}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, status_text: event.target.value.slice(0, 120) }))
                }
                placeholder="What are you doing?"
                maxLength={120}
              />
            </label>

            <label>
              About
              <textarea
                value={form.bio || ""}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, bio: event.target.value.slice(0, 280) }))
                }
                placeholder="Short bio"
                rows={4}
                maxLength={280}
              />
            </label>

            <div className="avatar-upload-row">
              <label className="avatar-upload">
                Avatar
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (event) => {
                    const [file] = event.target.files || [];
                    if (!file) return;
                    try {
                      const avatarData = await fileToAvatarData(file);
                      setForm((prev) => ({ ...prev, avatar_data: avatarData }));
                      setError("");
                    } catch (uploadError) {
                      setError(uploadError.message || "Could not load avatar.");
                    }
                  }}
                />
              </label>
              {form.avatar_data ? (
                <button
                  className="ghost"
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, avatar_data: null }))}
                >
                  Remove avatar
                </button>
              ) : null}
            </div>

            {error && <p className="form-error">{error}</p>}

            <div className="profile-form-actions">
              <button className="secondary" type="button" onClick={onClose}>
                Close
              </button>
              <button
                className="primary"
                type="button"
                disabled={saving}
                onClick={async () => {
                  if (!onSave) return;
                  setSaving(true);
                  setError("");
                  try {
                    const updated = await onSave(buildProfilePayload(form));
                    setForm(updated);
                    onClose();
                  } catch (saveError) {
                    setError(saveError.message || "Could not save profile.");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <div className="profile-readonly">
            <div className="profile-about">
              <span className="eyebrow">About</span>
              <p>{form.bio || "No bio yet."}</p>
            </div>
            <div className="profile-about">
              <span className="eyebrow">Joined</span>
              <p>{formatDate(form.created_at)}</p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
