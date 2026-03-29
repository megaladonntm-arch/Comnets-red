import { useEffect, useMemo, useRef, useState } from "react";
import UserGrid from "../components/UserGrid.jsx";
import WhiteboardCanvas from "../components/WhiteboardCanvas.jsx";
import TopBar from "../components/TopBar.jsx";
import { connectRoomSocket } from "../services/socket.js";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" }
];

const DEFAULT_MEDIA_STATE = {
  audioEnabled: true,
  videoEnabled: true
};

export default function Room({ room, username, token, isOwner, onLeave }) {
  const [participants, setParticipants] = useState({});
  const [selfId, setSelfId] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [selfSpeaking, setSelfSpeaking] = useState(false);
  const [mediaState, setMediaState] = useState(DEFAULT_MEDIA_STATE);
  const [mediaError, setMediaError] = useState("");
  const [socketState, setSocketState] = useState("connecting");
  const [roomError, setRoomError] = useState("");
  const [whiteboardEnabled, setWhiteboardEnabled] = useState(Boolean(room.whiteboard_enabled));
  const [whiteboardStrokes, setWhiteboardStrokes] = useState([]);
  const socketRef = useRef(null);
  const peersRef = useRef(new Map());
  const localStreamRef = useRef(null);
  const selfIdRef = useRef(null);
  const mediaStateRef = useRef(DEFAULT_MEDIA_STATE);
  const desiredMediaStateRef = useRef(DEFAULT_MEDIA_STATE);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);

  const dispatchWS = (payload) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  };

  const stopSpeakingMonitor = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setSelfSpeaking(false);
  };

  const startSpeakingMonitor = (stream) => {
    const [audioTrack] = stream.getAudioTracks();
    if (!audioTrack) {
      stopSpeakingMonitor();
      return;
    }

    if (audioCtxRef.current) return;

    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);

    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;

    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let index = 0; index < data.length; index += 1) {
        sum += data[index];
      }
      const avg = sum / data.length;
      setSelfSpeaking(avg > 18 && mediaStateRef.current.audioEnabled);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  };

  const closePeer = (peerId) => {
    const peer = peersRef.current.get(peerId);
    if (peer) {
      peer.pc.close();
      peersRef.current.delete(peerId);
    }
    setRemoteStreams((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  };

  const syncTracksWithState = (nextState) => {
    const stream = localStreamRef.current;
    if (!stream) return;

    stream.getAudioTracks().forEach((track) => {
      track.enabled = nextState.audioEnabled;
    });
    stream.getVideoTracks().forEach((track) => {
      track.enabled = nextState.videoEnabled;
    });

    if (!stream.getAudioTracks().length || !nextState.audioEnabled) {
      setSelfSpeaking(false);
    }
  };

  const publishMediaState = (nextState) => {
    mediaStateRef.current = nextState;
    setMediaState(nextState);
    syncTracksWithState(nextState);
    dispatchWS({
      type: "media_state",
      audio_enabled: nextState.audioEnabled,
      video_enabled: nextState.videoEnabled
    });
  };

  const attachLocalTracksToPeer = (peer) => {
    const stream = localStreamRef.current;
    if (!stream) return;

    stream.getTracks().forEach((track) => {
      const sender = peer.pc
        .getSenders()
        .find((item) => item.track && item.track.kind === track.kind);
      if (sender) {
        sender.replaceTrack(track);
        return;
      }
      peer.pc.addTrack(track, stream);
    });
  };

  const flushPendingCandidates = async (peer) => {
    if (!peer.pendingCandidates.length) return;
    const pending = [...peer.pendingCandidates];
    peer.pendingCandidates = [];
    for (const candidate of pending) {
      await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  };

  const ensurePeer = (peerId) => {
    if (!peerId || peerId === selfIdRef.current) return null;
    if (peersRef.current.has(peerId)) return peersRef.current.get(peerId);

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer = {
      pc,
      polite: (selfIdRef.current || 0) > peerId,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      pendingCandidates: []
    };

    attachLocalTracksToPeer(peer);

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      setRemoteStreams((prev) => ({ ...prev, [peerId]: stream }));
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      dispatchWS({
        type: "ice",
        target_id: peerId,
        payload: event.candidate
      });
    };

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        if (!pc.localDescription) return;
        dispatchWS({
          type: "offer",
          target_id: peerId,
          payload: pc.localDescription
        });
      } catch {
        // ignore unstable renegotiation noise
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.onconnectionstatechange = () => {
      if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
        closePeer(peerId);
      }
    };

    peersRef.current.set(peerId, peer);
    return peer;
  };

  const requestMissingTrack = async (kind) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === "audio"
          ? { audio: true }
          : {
              video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
              }
            }
      );
      const track = kind === "audio" ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
      if (!track) return false;

      const baseStream = localStreamRef.current || new MediaStream();
      localStreamRef.current = baseStream;
      baseStream.addTrack(track);
      setLocalStream(new MediaStream(baseStream.getTracks()));
      peersRef.current.forEach((peer) => attachLocalTracksToPeer(peer));

      if (kind === "audio") {
        startSpeakingMonitor(baseStream);
      }

      return true;
    } catch {
      setMediaError(
        kind === "audio"
          ? "Браузер не дал доступ к микрофону."
          : "Браузер не дал доступ к камере."
      );
      return false;
    }
  };

  const initLocalMedia = async () => {
    if (localStreamRef.current) return localStreamRef.current;

    const attempts = [
      { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } },
      { audio: true, video: false },
      { audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 } } }
    ];

    let stream = null;
    for (const constraints of attempts) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        break;
      } catch {
        // try reduced constraints
      }
    }

    if (!stream) {
      const emptyStream = new MediaStream();
      localStreamRef.current = emptyStream;
      setLocalStream(emptyStream);
      setMediaError("Не удалось открыть камеру и микрофон. Проверь доступ браузера к устройствам.");
      publishMediaState({ audioEnabled: false, videoEnabled: false });
      return emptyStream;
    }

    localStreamRef.current = stream;
    setLocalStream(stream);
    peersRef.current.forEach((peer) => attachLocalTracksToPeer(peer));
    startSpeakingMonitor(stream);

    const desired = desiredMediaStateRef.current;
    const nextState = {
      audioEnabled: stream.getAudioTracks().length > 0 && desired.audioEnabled,
      videoEnabled: stream.getVideoTracks().length > 0 && desired.videoEnabled
    };

    if (!stream.getAudioTracks().length || !stream.getVideoTracks().length) {
      setMediaError("Часть устройств недоступна. Комната продолжит работать с тем, что доступно.");
    }

    publishMediaState(nextState);
    return stream;
  };

  const setParticipant = (participant) => {
    if (!participant?.id || participant.id === selfIdRef.current) return;
    setParticipants((prev) => ({
      ...prev,
      [participant.id]: {
        id: participant.id,
        username: participant.username || `User #${participant.id}`,
        audioEnabled: participant.audio_enabled !== false,
        videoEnabled: participant.video_enabled !== false,
        online: true
      }
    }));
  };

  const removeParticipant = (userId) => {
    if (!userId) return;
    setParticipants((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    closePeer(userId);
  };

  const applyWhiteboardPayload = (payload) => {
    if (!payload?.mode) return;
    setWhiteboardStrokes((prev) => {
      if (payload.mode === "start" && payload.stroke) {
        return [...prev.filter((stroke) => stroke.id !== payload.stroke.id), payload.stroke];
      }
      if (payload.mode === "point" && payload.stroke_id && payload.point) {
        return prev.map((stroke) =>
          stroke.id === payload.stroke_id
            ? { ...stroke, points: [...stroke.points, payload.point] }
            : stroke
        );
      }
      return prev;
    });
  };

  const handleSignal = async (event) => {
    const fromId = event.from_id;
    if (!fromId) return;

    const peer = ensurePeer(fromId);
    if (!peer) return;

    if (event.type === "ice") {
      if (!event.payload) return;
      if (peer.pc.remoteDescription?.type) {
        try {
          await peer.pc.addIceCandidate(new RTCIceCandidate(event.payload));
        } catch {
          // ignore invalid candidates during reconnect churn
        }
      } else {
        peer.pendingCandidates.push(event.payload);
      }
      return;
    }

    const description = event.payload;
    if (!description) return;

    const readyForOffer =
      !peer.makingOffer &&
      (peer.pc.signalingState === "stable" || peer.isSettingRemoteAnswerPending);
    const offerCollision = description.type === "offer" && !readyForOffer;

    peer.ignoreOffer = !peer.polite && offerCollision;
    if (peer.ignoreOffer) return;

    peer.isSettingRemoteAnswerPending = description.type === "answer";

    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(description));
      await flushPendingCandidates(peer);

      if (description.type === "offer") {
        await initLocalMedia();
        await peer.pc.setLocalDescription();
        if (!peer.pc.localDescription) return;
        dispatchWS({
          type: "answer",
          target_id: fromId,
          payload: peer.pc.localDescription
        });
      }
    } catch {
      // ignore temporary signaling collisions
    } finally {
      peer.isSettingRemoteAnswerPending = false;
    }
  };

  const handleMediaToggle = async (kind) => {
    const current = mediaStateRef.current;
    const key = kind === "audio" ? "audioEnabled" : "videoEnabled";
    const nextValue = !current[key];

    desiredMediaStateRef.current = {
      ...desiredMediaStateRef.current,
      [key]: nextValue
    };

    if (nextValue && localStreamRef.current) {
      const hasTrack =
        kind === "audio"
          ? localStreamRef.current.getAudioTracks().length > 0
          : localStreamRef.current.getVideoTracks().length > 0;
      if (!hasTrack) {
        const restored = await requestMissingTrack(kind);
        if (!restored) {
          desiredMediaStateRef.current = current;
          return;
        }
      }
    }

    publishMediaState({
      ...current,
      [key]: nextValue
    });
  };

  const handleSocketEvent = async (event) => {
    if (event.type === "welcome") {
      setSocketState("connected");
      setRoomError("");
      setSelfId(event.self_id);
      selfIdRef.current = event.self_id;

      desiredMediaStateRef.current = {
        audioEnabled: event.self_state?.audio_enabled !== false,
        videoEnabled: event.self_state?.video_enabled !== false
      };

      const existingParticipants = {};
      (event.participants || []).forEach((participant) => {
        existingParticipants[participant.id] = {
          id: participant.id,
          username: participant.username || `User #${participant.id}`,
          audioEnabled: participant.audio_enabled !== false,
          videoEnabled: participant.video_enabled !== false,
          online: true
        };
      });
      setParticipants(existingParticipants);
      setWhiteboardEnabled(event.whiteboard?.enabled === true);
      setWhiteboardStrokes(event.whiteboard?.strokes || []);

      if (localStreamRef.current) {
        publishMediaState({
          audioEnabled:
            localStreamRef.current.getAudioTracks().length > 0 &&
            desiredMediaStateRef.current.audioEnabled,
          videoEnabled:
            localStreamRef.current.getVideoTracks().length > 0 &&
            desiredMediaStateRef.current.videoEnabled
        });
      }

      await initLocalMedia();
      (event.participants || []).forEach((participant) => ensurePeer(participant.id));
      return;
    }

    if (event.type === "participant_joined") {
      setParticipant(event.participant);
      ensurePeer(event.participant?.id);
      return;
    }

    if (event.type === "participant_state") {
      setParticipant(event.participant);
      if (event.participant?.id === selfIdRef.current) {
        const nextState = {
          audioEnabled: event.participant.audio_enabled !== false,
          videoEnabled: event.participant.video_enabled !== false
        };
        desiredMediaStateRef.current = nextState;
        mediaStateRef.current = nextState;
        setMediaState(nextState);
        syncTracksWithState(nextState);
      }
      return;
    }

    if (event.type === "participant_left") {
      removeParticipant(event.user_id);
      return;
    }

    if (event.type === "force_mute") {
      const nextState = {
        ...mediaStateRef.current,
        audioEnabled: false
      };
      desiredMediaStateRef.current = nextState;
      publishMediaState(nextState);
      return;
    }

    if (event.type === "whiteboard_status") {
      setWhiteboardEnabled(event.enabled === true);
      return;
    }

    if (event.type === "whiteboard_clear") {
      setWhiteboardStrokes([]);
      return;
    }

    if (event.type === "whiteboard_draw") {
      applyWhiteboardPayload(event.payload);
      return;
    }

    if (event.type === "offer" || event.type === "answer" || event.type === "ice") {
      await handleSignal(event);
    }
  };

  useEffect(() => {
    setParticipants({});
    setRemoteStreams({});
    setRoomError("");
    setSocketState("connecting");
    setWhiteboardEnabled(Boolean(room.whiteboard_enabled));
    setWhiteboardStrokes([]);
    setMediaError("");
    selfIdRef.current = null;
    mediaStateRef.current = DEFAULT_MEDIA_STATE;
    desiredMediaStateRef.current = DEFAULT_MEDIA_STATE;

    if (!token) return undefined;

    let socket;
    socket = connectRoomSocket(room.id, token, (event) => {
      Promise.resolve(handleSocketEvent(event)).catch(() => {
        setRoomError("Ошибка обработки комнаты. Обнови страницу или зайди заново.");
      });
    });

    socket.onopen = () => {
      setSocketState("connecting");
    };

    socket.onclose = (event) => {
      setSocketState("closed");
      if (event.code === 4003) {
        setRoomError("Доступ в комнату закрыт или тебя исключили.");
      } else if (event.code === 4005) {
        setRoomError("Комната уже заполнена.");
      } else {
        setRoomError((prev) => prev || "Соединение с комнатой прервалось.");
      }
    };

    socketRef.current = socket;
    void initLocalMedia();

    return () => {
      socket.close();
      peersRef.current.forEach((peer) => peer.pc.close());
      peersRef.current.clear();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
      stopSpeakingMonitor();
    };
  }, [room.id, room.whiteboard_enabled, token]);

  const slots = useMemo(() => {
    const list = [
      {
        id: "self",
        username: `${username} (you)`,
        audioEnabled: mediaState.audioEnabled,
        videoEnabled: mediaState.videoEnabled,
        self: true,
        speaking: selfSpeaking,
        online: socketState === "connected"
      },
      ...Object.values(participants)
    ];

    const filled = list.slice(0, 4);
    while (filled.length < 4) {
      filled.push(null);
    }
    return filled;
  }, [mediaState.audioEnabled, mediaState.videoEnabled, participants, selfSpeaking, socketState, username]);

  const videoTiles = useMemo(() => {
    const remoteTiles = Object.values(participants).map((participant) => ({
      id: participant.id,
      username: participant.username,
      stream: remoteStreams[participant.id] || null,
      audioEnabled: participant.audioEnabled,
      videoEnabled: participant.videoEnabled
    }));

    return [
      {
        id: "self",
        username: `${username} (you)`,
        stream: localStream,
        audioEnabled: mediaState.audioEnabled,
        videoEnabled: mediaState.videoEnabled,
        self: true
      },
      ...remoteTiles
    ];
  }, [localStream, mediaState.audioEnabled, mediaState.videoEnabled, participants, remoteStreams, username]);

  const handleBoardToggle = () => {
    dispatchWS({
      type: "whiteboard_toggle",
      enabled: !whiteboardEnabled
    });
  };

  const handleBoardClear = () => {
    dispatchWS({ type: "whiteboard_clear" });
  };

  const handleBoardDraw = (payload) => {
    applyWhiteboardPayload(payload);
    dispatchWS({
      type: "whiteboard_draw",
      payload
    });
  };

  return (
    <div className="app">
      <TopBar roomName={room.name} />

      <main className="room-layout">
        <section className="room-header room-hero card">
          <div>
            <p className="eyebrow">Room</p>
            <h2>{room.name}</h2>
            <p className="muted">
              {room.is_private ? "Private room" : "Public room"} · Owner: @{room.owner_username}
            </p>
          </div>
          <div className="room-actions">
            <button
              className={mediaState.audioEnabled ? "secondary" : "primary"}
              onClick={() => handleMediaToggle("audio")}
            >
              {mediaState.audioEnabled ? "Mute mic" : "Unmute mic"}
            </button>
            <button
              className={mediaState.videoEnabled ? "secondary" : "primary"}
              onClick={() => handleMediaToggle("video")}
            >
              {mediaState.videoEnabled ? "Stop camera" : "Start camera"}
            </button>
            <button className="danger" onClick={onLeave}>
              Leave
            </button>
          </div>
        </section>

        {(mediaError || roomError) && (
          <section className="room-alerts">
            {mediaError && <div className="alert-card">{mediaError}</div>}
            {roomError && <div className="alert-card error">{roomError}</div>}
          </section>
        )}

        <section className="room-overview">
          <div className="status-card card">
            <p className="eyebrow">Connection</p>
            <h3>{socketState === "connected" ? "Live" : "Reconnecting"}</h3>
            <p className="muted">
              WebRTC sync, room events and media state are now handled in real time.
            </p>
          </div>
          <div className="status-card card">
            <p className="eyebrow">Participants</p>
            <h3>{Object.keys(participants).length + 1}/4</h3>
            <p className="muted">Camera, microphone and moderation state stay synchronized.</p>
          </div>
          <div className="status-card card">
            <p className="eyebrow">Board</p>
            <h3>{whiteboardEnabled ? "Enabled" : "Disabled"}</h3>
            <p className="muted">
              {isOwner
                ? "You can switch the collaborative board on or off for everyone."
                : "Board availability is controlled by the room owner."}
            </p>
          </div>
        </section>

        <UserGrid
          slots={slots}
          isOwner={isOwner}
          onMute={(id) => dispatchWS({ type: "mute_user", user_id: id })}
          onBan={(id) => dispatchWS({ type: "ban_user", user_id: id })}
        />

        <section className="video-grid">
          {videoTiles.map((tile) => (
            <VideoTile key={tile.id} {...tile} />
          ))}
        </section>

        <WhiteboardCanvas
          enabled={whiteboardEnabled}
          canDraw={socketState === "connected" && whiteboardEnabled}
          isOwner={isOwner}
          strokes={whiteboardStrokes}
          clientId={selfId}
          onToggle={handleBoardToggle}
          onClear={handleBoardClear}
          onDrawEvent={handleBoardDraw}
        />

        <AudioGrid streams={remoteStreams} />
      </main>
    </div>
  );
}

function AudioGrid({ streams }) {
  return (
    <div style={{ display: "none" }}>
      {Object.entries(streams).map(([id, stream]) => (
        <audio key={id} autoPlay playsInline ref={(node) => bindMediaNode(node, stream)} />
      ))}
    </div>
  );
}

function VideoTile({ stream, username, self, videoEnabled, audioEnabled }) {
  const hasVideoTrack = stream?.getVideoTracks?.().length > 0;

  return (
    <div className="video-frame card">
      {videoEnabled && hasVideoTrack ? (
        <video
          className="video-tile"
          autoPlay
          playsInline
          muted={Boolean(self)}
          ref={(node) => bindMediaNode(node, stream)}
        />
      ) : (
        <div className="video-placeholder">
          <span>{username.slice(0, 2).toUpperCase()}</span>
          <p>Camera is off</p>
        </div>
      )}
      <div className="video-caption">
        <strong>{username}</strong>
        <span>{audioEnabled ? "Mic on" : "Mic off"}</span>
      </div>
    </div>
  );
}

function bindMediaNode(node, stream) {
  if (!node || !stream) return;
  if (node.srcObject !== stream) {
    node.srcObject = stream;
  }
}
