import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal.jsx";

const THEME_OPTIONS = [
  { value: "midnight", label: "Midnight" },
  { value: "graphite", label: "Graphite" },
  { value: "ocean", label: "Ocean" }
];

const BACKGROUND_OPTIONS = [
  { value: "grid", label: "Grid" },
  { value: "glow", label: "Glow" },
  { value: "plain", label: "Plain" }
];

const ICON_OPTIONS = [
  { value: "rounded", label: "Rounded" },
  { value: "soft", label: "Soft" },
  { value: "sharp", label: "Sharp" }
];

function normalizeDevices(devices, kind, fallbackLabel) {
  return devices
    .filter((device) => device.kind === kind)
    .map((device, index) => ({
      value: device.deviceId,
      label: device.label || `${fallbackLabel} ${index + 1}`
    }));
}

export default function UserSettingsModal({ username, settings, onSave, onClose }) {
  const [form, setForm] = useState(settings);
  const [devices, setDevices] = useState({ audio: [], video: [] });
  const [deviceError, setDeviceError] = useState("");
  const [loadingDevices, setLoadingDevices] = useState(false);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const loadDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setDeviceError("Browser does not support device selection.");
      return;
    }

    setLoadingDevices(true);
    setDeviceError("");
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        audio: normalizeDevices(list, "audioinput", "Microphone"),
        video: normalizeDevices(list, "videoinput", "Camera")
      });
    } catch {
      setDeviceError("Could not load devices.");
    } finally {
      setLoadingDevices(false);
    }
  };

  useEffect(() => {
    void loadDevices();
  }, []);

  const labelsReady = useMemo(() => {
    return [...devices.audio, ...devices.video].some((device) => !/^Microphone \d+$|^Camera \d+$/.test(device.label));
  }, [devices.audio, devices.video]);

  const updateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="settings-form">
        <div className="settings-section">
          <div className="settings-section-head">
            <div>
              <p className="eyebrow">Profile</p>
              <h4>{username ? `@${username}` : "Local settings"}</h4>
            </div>
          </div>
          <div className="settings-grid three">
            <label>
              Theme
              <select value={form.theme} onChange={(event) => updateField("theme", event.target.value)}>
                {THEME_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Background
              <select
                value={form.background}
                onChange={(event) => updateField("background", event.target.value)}
              >
                {BACKGROUND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Icons
              <select
                value={form.iconStyle}
                onChange={(event) => updateField("iconStyle", event.target.value)}
              >
                {ICON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-head">
            <div>
              <p className="eyebrow">Devices</p>
              <h4>Microphone and camera</h4>
            </div>
            <button className="ghost" type="button" onClick={() => void loadDevices()}>
              {loadingDevices ? "Loading..." : "Refresh"}
            </button>
          </div>

          <div className="settings-grid">
            <label>
              Microphone
              <select
                value={form.audioInputId}
                onChange={(event) => updateField("audioInputId", event.target.value)}
              >
                <option value="">System default</option>
                {devices.audio.map((device) => (
                  <option key={device.value} value={device.value}>
                    {device.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Camera
              <select
                value={form.videoInputId}
                onChange={(event) => updateField("videoInputId", event.target.value)}
              >
                <option value="">System default</option>
                {devices.video.map((device) => (
                  <option key={device.value} value={device.value}>
                    {device.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {deviceError && <p className="form-error">{deviceError}</p>}
          {!labelsReady && !deviceError && (
            <p className="settings-hint">Device names appear after browser media permission.</p>
          )}
        </div>

        <div className="settings-preview">
          <div className="settings-preview-card">
            <span className="settings-preview-chip">Theme</span>
            <strong>{THEME_OPTIONS.find((item) => item.value === form.theme)?.label}</strong>
          </div>
          <div className="settings-preview-card">
            <span className="settings-preview-chip">Background</span>
            <strong>{BACKGROUND_OPTIONS.find((item) => item.value === form.background)?.label}</strong>
          </div>
          <div className="settings-preview-card">
            <span className="settings-preview-chip">Icons</span>
            <strong>{ICON_OPTIONS.find((item) => item.value === form.iconStyle)?.label}</strong>
          </div>
        </div>

        <div className="settings-actions">
          <button className="secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            type="button"
            onClick={() => {
              onSave(form);
              onClose();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
