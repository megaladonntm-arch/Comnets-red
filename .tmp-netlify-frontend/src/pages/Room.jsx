import { useEffect, useMemo, useRef, useState } from "react";
import UserGrid from "../components/UserGrid.jsx";
import WhiteboardCanvas from "../components/WhiteboardCanvas.jsx";
import TopBar from "../components/TopBar.jsx";
import UserProfileModal from "../components/UserProfileModal.jsx";
import { api } from "../services/api.js";
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

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000];

export default function Room({
  room,
  username,
  token,
  isOwner,
  onLeave,
  settings,
  currentProfile,
  onOpenSettings,
  onOpenProfile
}) {
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
  const [whiteboardElements, setWhiteboardElements] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const socketRef = useRef(null);
  const peersRef = useRef(new Map());
  const localStreamRef = useRef(null);
  const selfIdRef = useRef(null);
  const mediaStateRef = useRef(DEFAULT_MEDIA_STATE);
  const desiredMediaStateRef = useRef(DEFAULT_MEDIA_STATE);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const shuttingDownRef = useRef(false);

  const buildAudioConstraints = (deviceId, strict = true) => {
    if (!deviceId) return true;
    return { deviceId: strict ? { exact: deviceId } : deviceId };
  };

  const buildVideoConstraints = (deviceId, strict = true) => {
    const base = {
      width: { ideal: 1280 },
      height: { ideal: 720 }
    };
    if (!deviceId) return base;
    return {
      ...base,
      deviceId: strict ? { exact: deviceId } : deviceId
    };
  };

  const dispatchWS = (payload) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  };

  const toParticipantState = (participant) => ({
    id: participant.id,
    username: participant.display_name || participant.username || `User #${participant.id}`,
    profileUsername: participant.username || `user${participant.id}`,
    avatarData: participant.avatar_data || null,
    statusText: participant.status_text || "",
    presence: participant.presence || "online",
    lastSeenAt: participant.last_seen_at || null,
    audioEnabled: participant.audio_enabled !== false,
    videoEnabled: participant.video_enabled !== false,
    online: participant.is_online !== false
  });

  const stopSpeakingMonitor = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
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

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const audioCtx = new AudioCtx();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    if (audioCtx.state === "suspended") {
      void audioCtx.resume().catch(() => {});
    }

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

  const clearPeerRestartTimer = (peer) => {
    if (peer?.restartTimer) {
      clearTimeout(peer.restartTimer);
      peer.restartTimer = null;
    }
  };

  const closePeer = (peerId) => {
    const peer = peersRef.current.get(peerId);
    if (peer) {
      clearPeerRestartTimer(peer);
      peer.pc.close();
      peersRef.current.delete(peerId);
    }
    setRemoteStreams((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  };

  const closeAllPeers = () => {
    peersRef.current.forEach((peer, peerId) => {
      clearPeerRestartTimer(peer);
      peer.pc.close();
      peersRef.current.delete(peerId);
    });
    setRemoteStreams({});
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
        void sender.replaceTrack(track);
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

  const schedulePeerRestart = (peerId, delayMs = 1500) => {
    const peer = peersRef.current.get(peerId);
    if (!peer) return;
    clearPeerRestartTimer(peer);
    peer.restartTimer = setTimeout(async () => {
      const currentPeer = peersRef.current.get(peerId);
      if (!currentPeer || socketRef.current?.readyState !== WebSocket.OPEN) return;
      if (currentPeer.pc.connectionState === "connected") return;

      try {
        if (typeof currentPeer.pc.restartIce === "function") {
          currentPeer.pc.restartIce();
        }
        if (currentPeer.pc.signalingState !== "stable") return;
        const offer = await currentPeer.pc.createOffer({ iceRestart: true });
        await currentPeer.pc.setLocalDescription(offer);
        dispatchWS({
          type: "offer",
          target_id: peerId,
          payload: currentPeer.pc.localDescription
        });
      } catch {
        // ignore restart failures during unstable reconnects
      }
    }, delayMs);
  };

  const requestMissingTrack = async (kind) => {
    const preferredDeviceId =
      kind === "audio" ? settings?.audioInputId || "" : settings?.videoInputId || "";
    const preferredConstraints =
      kind === "audio" ? buildAudioConstraints(preferredDeviceId) : buildVideoConstraints(preferredDeviceId);
    const fallbackConstraints =
      kind === "audio" ? true : { width: { ideal: 1280 }, height: { ideal: 720 } };

    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(
          kind === "audio"
            ? { audio: preferredConstraints }
            : { video: preferredConstraints }
        );
      } catch {
        stream = await navigator.mediaDevices.getUserMedia(
          kind === "audio" ? { audio: fallbackConstraints } : { video: fallbackConstraints }
        );
      }
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

    const preferredAudio = settings?.audioInputId || "";
    const preferredVideo = settings?.videoInputId || "";
    const attempts = [
      {
        audio: buildAudioConstraints(preferredAudio),
        video: buildVideoConstraints(preferredVideo)
      },
      {
        audio: buildAudioConstraints(preferredAudio),
        video: false
      },
      {
        audio: false,
        video: buildVideoConstraints(preferredVideo)
      },
      { audio: true, video: buildVideoConstraints("") },
      { audio: true, video: false },
      { audio: false, video: buildVideoConstraints("") }
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
      setMediaError(
        "Не удалось получить доступ к камере и микрофону. Проверь разрешения браузера."
      );
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
    } else {
      setMediaError("");
    }

    publishMediaState(nextState);
    return stream;
  };

  const ensurePeer = (peerId) => {
    if (!peerId || peerId === selfIdRef.current) return null;
    if (peersRef.current.has(peerId)) return peersRef.current.get(peerId);

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 10 });
    const peer = {
      pc,
      polite: (selfIdRef.current || 0) > peerId,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      pendingCandidates: [],
      restartTimer: null
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
      if (socketRef.current?.readyState !== WebSocket.OPEN) return;
      try {
        peer.makingOffer = true;
        await initLocalMedia();
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (!pc.localDescription) return;
        dispatchWS({
          type: "offer",
          target_id: peerId,
          payload: pc.localDescription
        });
      } catch {
        // ignore negotiation noise during reconnect churn
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        clearPeerRestartTimer(peer);
        return;
      }
      if (pc.connectionState === "failed") {
        schedulePeerRestart(peerId, 200);
        return;
      }
      if (pc.connectionState === "closed") {
        closePeer(peerId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        clearPeerRestartTimer(peer);
      } else if (pc.iceConnectionState === "disconnected") {
        schedulePeerRestart(peerId, 2500);
      } else if (pc.iceConnectionState === "failed") {
        schedulePeerRestart(peerId, 300);
      }
    };

    peersRef.current.set(peerId, peer);
    return peer;
  };

  const setParticipant = (participant) => {
    if (!participant?.id || participant.id === selfIdRef.current) return;
    setParticipants((prev) => ({
      ...prev,
      [participant.id]: toParticipantState(participant)
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
    setWhiteboardElements((prev) => {
      if (payload.mode === "start" && payload.stroke) {
        return [
          ...prev.filter((item) => item.id !== payload.stroke.id),
          { kind: "stroke", ...payload.stroke }
        ];
      }
      if (payload.mode === "point" && payload.stroke_id && payload.point) {
        return prev.map((item) =>
          item.id === payload.stroke_id
            ? { ...item, points: [...(item.points || []), payload.point] }
            : item
        );
      }
      if (payload.mode === "text" && payload.text) {
        return [
          ...prev.filter((item) => item.id !== payload.text.id),
          { kind: "text", ...payload.text }
        ];
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
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
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
      reconnectAttemptRef.current = 0;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
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
        existingParticipants[participant.id] = toParticipantState(participant);
      });
      setParticipants(existingParticipants);
      setWhiteboardEnabled(event.whiteboard?.enabled === true);
      setWhiteboardElements(event.whiteboard?.elements || event.whiteboard?.strokes || []);

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
      setWhiteboardElements([]);
      return;
    }

    if (event.type === "whiteboard_draw") {
      applyWhiteboardPayload(event.payload);
      return;
    }

    if (event.type === "error") {
      if (event.detail === "whiteboard_disabled") {
        setRoomError("Доска была отключена владельцем комнаты.");
      }
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
    setWhiteboardElements([]);
    setMediaError("");
    setSelfId(null);
    setSelectedProfile(null);
    setProfileLoading(false);
    selfIdRef.current = null;
    mediaStateRef.current = DEFAULT_MEDIA_STATE;
    desiredMediaStateRef.current = DEFAULT_MEDIA_STATE;
    reconnectAttemptRef.current = 0;
    shuttingDownRef.current = false;

    if (!token) return undefined;

    const connectSocket = () => {
      if (shuttingDownRef.current) return;

      closeAllPeers();
      const socket = connectRoomSocket(room.id, token, (event) => {
        Promise.resolve(handleSocketEvent(event)).catch(() => {
          setRoomError("Ошибка обработки комнаты. Обнови страницу или войди заново.");
        });
      });

      socket.onopen = () => {
        setSocketState(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");
      };

      socket.onclose = (event) => {
        socketRef.current = null;
        closeAllPeers();

        if (shuttingDownRef.current) return;

        const terminalErrors = {
          4003: "Доступ в комнату закрыт или тебя исключили.",
          4004: "Комната не найдена.",
          4005: "Комната уже заполнена."
        };

        if (terminalErrors[event.code]) {
          setSocketState("closed");
          setRoomError(terminalErrors[event.code]);
          return;
        }

        const delay =
          RECONNECT_DELAYS[Math.min(reconnectAttemptRef.current, RECONNECT_DELAYS.length - 1)];
        reconnectAttemptRef.current += 1;
        setSocketState("reconnecting");
        setRoomError("Соединение прервалось. Пытаюсь переподключиться...");

        reconnectTimerRef.current = setTimeout(() => {
          connectSocket();
        }, delay);
      };

      socketRef.current = socket;
    };

    void initLocalMedia();
    connectSocket();

    return () => {
      shuttingDownRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      closeAllPeers();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
      setLocalStream(null);
      stopSpeakingMonitor();
    };
  }, [room.id, room.whiteboard_enabled, settings?.audioInputId, settings?.videoInputId, token]);

  useEffect(() => {
    if (!currentProfile?.id) return;
    dispatchWS({ type: "profile_refresh" });
  }, [
    currentProfile?.avatar_data,
    currentProfile?.bio,
    currentProfile?.display_name,
    currentProfile?.presence,
    currentProfile?.status_text
  ]);

  const slots = useMemo(() => {
    const list = [
      {
        id: "self",
        username: currentProfile?.display_name || `${username} (you)`,
        profileUsername: username,
        avatarData: currentProfile?.avatar_data || null,
        statusText: currentProfile?.status_text || "",
        presence: currentProfile?.presence || "online",
        lastSeenAt: currentProfile?.last_seen_at || null,
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
  }, [
    currentProfile?.avatar_data,
    currentProfile?.display_name,
    currentProfile?.last_seen_at,
    currentProfile?.presence,
    currentProfile?.status_text,
    mediaState.audioEnabled,
    mediaState.videoEnabled,
    participants,
    selfSpeaking,
    socketState,
    username
  ]);

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

  const handleOpenProfile = async (user) => {
    if (!user) return;
    if (user.self && onOpenProfile) {
      onOpenProfile();
      return;
    }

    if (!user.id) return;
    setProfileLoading(true);
    try {
      const profile = await api.getUserProfile(user.id);
      setSelectedProfile(profile);
    } catch (error) {
      setRoomError(error.message || "Could not load profile.");
    } finally {
      setProfileLoading(false);
    }
  };

  return (
    <div className="app">
      <TopBar
        roomName={room.name}
        username={username}
        profile={currentProfile}
        onSettingsClick={onOpenSettings}
        onProfileClick={onOpenProfile}
      />

      <main className="room-layout">
        <section className="room-hero card">
          <div className="room-hero-copy">
            <p className="eyebrow">Live room</p>
            <h2>{room.name}</h2>
            <p className="muted">Live media, board and controls in one room.</p>
            <div className="room-meta-strip">
              <span className="room-meta-chip">{room.is_private ? "Private room" : "Public room"}</span>
              <span className="room-meta-chip">Owner @{room.owner_username}</span>
              <span className="room-meta-chip">
                {Object.keys(participants).length + 1}/4 participants
              </span>
              {room.is_private && room.code ? (
                <span className="room-meta-chip">Code {room.code}</span>
              ) : null}
            </div>
          </div>
          <div className="room-actions">
            <button
              className={mediaState.audioEnabled ? "secondary" : "primary"}
              onClick={() => handleMediaToggle("audio")}
              type="button"
            >
              {mediaState.audioEnabled ? "Mute mic" : "Unmute mic"}
            </button>
            <button
              className={mediaState.videoEnabled ? "secondary" : "primary"}
              onClick={() => handleMediaToggle("video")}
              type="button"
            >
              {mediaState.videoEnabled ? "Stop camera" : "Start camera"}
            </button>
            <button className="danger" onClick={onLeave} type="button">
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
            <h3>
              {socketState === "connected"
                ? "Live"
                : socketState === "closed"
                  ? "Offline"
                  : "Reconnecting"}
            </h3>
            <p className="muted">Room link status.</p>
          </div>
          <div className="status-card card">
            <p className="eyebrow">Participants</p>
            <h3>{Object.keys(participants).length + 1}/4</h3>
            <p className="muted">Live member status.</p>
          </div>
          <div className="status-card card">
            <p className="eyebrow">Board</p>
            <h3>{whiteboardEnabled ? "Enabled" : "Disabled"}</h3>
            <p className="muted">
              {isOwner
                ? "Board control is yours."
                : "Board is controlled by owner."}
            </p>
          </div>
        </section>

        <section className="room-sections">
          <section className="stage-panel card">
            <div className="section-intro">
              <div>
                <p className="eyebrow">Live stage</p>
                <h3>Video presence</h3>
                <p className="muted">Clean stage view.</p>
              </div>
              <div className="stage-badge">{videoTiles.length} feeds ready</div>
            </div>
            <div className="video-grid">
              {videoTiles.map((tile) => (
                <VideoTile key={tile.id} {...tile} />
              ))}
            </div>
          </section>

          <section className="user-panel card">
            <div className="section-intro">
              <div>
                <p className="eyebrow">Participants</p>
                <h3>Room roster</h3>
                <p className="muted">Simple roster and status.</p>
              </div>
            </div>
            <UserGrid
              slots={slots}
              isOwner={isOwner}
              onOpenProfile={handleOpenProfile}
              onMute={(id) => dispatchWS({ type: "mute_user", user_id: id })}
              onBan={(id) => dispatchWS({ type: "ban_user", user_id: id })}
            />
          </section>
        </section>

        <WhiteboardCanvas
          enabled={whiteboardEnabled}
          canDraw={socketState === "connected" && whiteboardEnabled}
          isOwner={isOwner}
          elements={whiteboardElements}
          clientId={selfId}
          onToggle={handleBoardToggle}
          onClear={handleBoardClear}
          onDrawEvent={handleBoardDraw}
        />

        <AudioGrid streams={remoteStreams} />

        {(selectedProfile || profileLoading) && (
          <UserProfileModal
            profile={selectedProfile}
            loading={profileLoading}
            onClose={() => {
              setSelectedProfile(null);
              setProfileLoading(false);
            }}
          />
        )}
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
  const playPromise = node.play?.();
  if (playPromise?.catch) {
    playPromise.catch(() => {});
  }
}
