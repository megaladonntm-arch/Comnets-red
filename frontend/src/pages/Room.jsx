import { useEffect, useMemo, useRef, useState } from "react";
import UserGrid from "../components/UserGrid.jsx";
import TopBar from "../components/TopBar.jsx";
import { connectRoomSocket } from "../services/socket.js";

export default function Room({ room, username, token, isOwner, onLeave }) {
  const [participants, setParticipants] = useState({});
  const [selfMuted, setSelfMuted] = useState(false);
  const [selfId, setSelfId] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [selfSpeaking, setSelfSpeaking] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const socketRef = useRef(null);
  const peersRef = useRef(new Map());
  const localStreamRef = useRef(null);
  const selfIdRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);

  const initLocalMedia = async () => {
    if (localStreamRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    localStreamRef.current = stream;
    setLocalStream(stream);
    startSpeakingMonitor(stream);
    peersRef.current.forEach((pc) => {
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });
    });
  };

  const startSpeakingMonitor = (stream) => {
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
      for (let i = 0; i < data.length; i += 1) sum += data[i];
      const avg = sum / data.length;
      setSelfSpeaking(avg > 18 && !selfMuted);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
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

  const closePeer = (peerId) => {
    const pc = peersRef.current.get(peerId);
    if (pc) {
      pc.close();
      peersRef.current.delete(peerId);
    }
  };

  const createPeerConnection = (peerId, socket) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    const localStream = localStreamRef.current;
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });
    }

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      setRemoteStreams((prev) => ({ ...prev, [peerId]: stream }));
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      dispatchWS(socket, {
        type: "ice",
        target_id: peerId,
        payload: event.candidate
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        closePeer(peerId);
      }
    };

    return pc;
  };

  const createOffer = async (peerId, pc, socket) => {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    dispatchWS(socket, {
      type: "offer",
      target_id: peerId,
      payload: offer
    });
  };

  const ensurePeer = (peerId, myId, socket) => {
    if (!peerId || !myId || peerId === myId) return;
    if (peersRef.current.has(peerId)) return;

    const pc = createPeerConnection(peerId, socket);
    peersRef.current.set(peerId, pc);

    if (myId < peerId) {
      createOffer(peerId, pc, socket);
    }
  };

  const handleOffer = async (event, socket) => {
    const fromId = event.from_id;
    if (!fromId) return;
    let pc = peersRef.current.get(fromId);
    if (!pc) {
      pc = createPeerConnection(fromId, socket);
      peersRef.current.set(fromId, pc);
    }
    await pc.setRemoteDescription(new RTCSessionDescription(event.payload));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    dispatchWS(socket, {
      type: "answer",
      target_id: fromId,
      payload: answer
    });
  };

  const handleAnswer = async (event) => {
    const fromId = event.from_id;
    const pc = peersRef.current.get(fromId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(event.payload));
  };

  const handleIce = async (event) => {
    const fromId = event.from_id;
    const pc = peersRef.current.get(fromId);
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(event.payload));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    setParticipants({});
    setRemoteStreams({});
    if (!token) return;

    const socket = connectRoomSocket(room.id, token, (event) => {
      if (event.type === "welcome") {
        setSelfId(event.user_id);
        selfIdRef.current = event.user_id;
        const existing = event.participants || [];
        setParticipants((prev) => {
          const next = { ...prev };
          existing.forEach((peerId) => {
            if (!next[peerId]) {
              next[peerId] = {
                id: peerId,
                username: `User #${peerId}`,
                muted: false
              };
            }
          });
          return next;
        });
        initLocalMedia().then(() => {
          existing.forEach((peerId) => {
            ensurePeer(peerId, event.user_id, socket);
          });
        });
      }
      if (event.type === "join") {
        setParticipants((prev) => {
          if (prev[event.user_id]) return prev;
          return {
            ...prev,
            [event.user_id]: {
              id: event.user_id,
              username: `User #${event.user_id}`,
              muted: false
            }
          };
        });
        const me = selfIdRef.current;
        if (me && event.user_id) {
          initLocalMedia().then(() => ensurePeer(event.user_id, me, socket));
        }
      }
      if (event.type === "leave" || event.type === "ban_user") {
        setParticipants((prev) => {
          const next = { ...prev };
          delete next[event.user_id];
          return next;
        });
        closePeer(event.user_id);
        setRemoteStreams((prev) => {
          const next = { ...prev };
          delete next[event.user_id];
          return next;
        });
      }
      if (event.type === "mute_user") {
        setParticipants((prev) => {
          if (!prev[event.user_id]) return prev;
          return {
            ...prev,
            [event.user_id]: { ...prev[event.user_id], muted: true }
          };
        });
      }
      if (event.type === "offer") {
        handleOffer(event, socket);
      }
      if (event.type === "answer") {
        handleAnswer(event);
      }
      if (event.type === "ice") {
        handleIce(event);
      }
    });
    socketRef.current = socket;

    initLocalMedia();

    return () => {
      socket.close();
      peersRef.current.forEach((pc) => pc.close());
      peersRef.current.clear();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
      stopSpeakingMonitor();
    };
  }, [room.id, token]);

  useEffect(() => {
    if (!localStreamRef.current) return;
    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !selfMuted;
    });
  }, [selfMuted]);

  const slots = useMemo(() => {
    const list = [
      {
        id: "self",
        username: `${username} (you)`,
        muted: selfMuted,
        self: true,
        speaking: selfSpeaking
      },
      ...Object.values(participants)
    ];
    const filled = list.slice(0, 4);
    while (filled.length < 4) {
      filled.push(null);
    }
    return filled;
  }, [participants, selfMuted, username, selfSpeaking]);

  return (
    <div className="app">
      <TopBar roomName={room.name} />

      <main className="room-layout">
        <section className="room-header">
          <div>
            <p className="eyebrow">Room</p>
            <h2>{room.name}</h2>
            <p className="muted">
              {room.is_private ? "Private" : "Public"} - max 4 users
            </p>
          </div>
          <div className="room-actions">
            <button className="secondary" onClick={() => setSelfMuted((m) => !m)}>
              {selfMuted ? "Unmute" : "Mute"}
            </button>
            <button className="danger" onClick={onLeave}>
              Leave
            </button>
          </div>
        </section>

        <UserGrid
          slots={slots}
          isOwner={isOwner}
          onMute={(id) => dispatchWS(socketRef.current, { type: "mute_user", user_id: id })}
          onBan={(id) => dispatchWS(socketRef.current, { type: "ban_user", user_id: id })}
        />
        <VideoGrid streams={remoteStreams} localStream={localStream} />
        <AudioGrid streams={remoteStreams} localStream={localStream} />
      </main>
    </div>
  );
}

function dispatchWS(socket, payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function AudioGrid({ streams, localStream }) {
  return (
    <div style={{ display: "none" }}>
      {Object.entries(streams).map(([id, stream]) => (
        <audio key={id} autoPlay playsInline ref={(el) => el && (el.srcObject = stream)} />
      ))}
      {localStream && (
        <audio
          autoPlay
          playsInline
          ref={(el) => {
            if (el) {
              el.srcObject = localStream;
              el.volume = 0.25;
            }
          }}
        />
      )}
    </div>
  );
}

function VideoGrid({ streams, localStream }) {
  return (
    <div className="video-grid">
      {localStream && (
        <video
          className="video-tile"
          autoPlay
          playsInline
          muted
          ref={(el) => el && (el.srcObject = localStream)}
        />
      )}
      {Object.entries(streams).map(([id, stream]) => (
        <video
          key={id}
          className="video-tile"
          autoPlay
          playsInline
          ref={(el) => el && (el.srcObject = stream)}
        />
      ))}
    </div>
  );
}
