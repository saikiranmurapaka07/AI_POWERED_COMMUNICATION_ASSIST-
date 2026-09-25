import { useCallback, useEffect, useRef, useState } from "react";
import Peer from "peerjs";
import { AudioMixer } from "./AudioMixer";
import { buildIceServers } from "../config";

/**
 * useCall
 * -------
 * Wraps PeerJS (WebRTC signaling + STUN/TURN via its underlying
 * RTCPeerConnection) and an AudioMixer.
 *
 * Call flow:
 *  1. init(): getUserMedia -> AudioMixer wired to the mic -> Peer created.
 *  2. callPeer(id) / incoming "call" event starts the call with the
 *     raw local stream.
 *  3. Once the RTCPeerConnection reaches "connected", the audio sender
 *     track is replaced with the AudioMixer output track.
 *
 * Mobile recovery:
 *  - Fresh visit: camera/mic remain OFF until the user starts them.
 *  - A recently generated Peer ID is stored in sessionStorage.
 *  - If the tab is recreated within 30 seconds, the saved Peer ID is
 *    restored and camera/microphone are started automatically.
 */

export function useCall() {
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [myPeerId, setMyPeerId] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [localStreamVersion, setLocalStreamVersion] = useState(0);
  const [micMuted, setMicMuted] = useState(false);
  const [usingMixedTrack, setUsingMixedTrack] = useState(false);
  const [dataMessage, setDataMessage] = useState(null);
  const [localParticipantRole, setLocalParticipantRole] = useState(null);

  const peerRef = useRef(null);
  const callRef = useRef(null);
  const localStreamRef = useRef(null);
  const mixerRef = useRef(null);
  const dataConnectionRef = useRef(null);

  // ------------------------------------------------------------
  // MOBILE TAB RECOVERY
  // ------------------------------------------------------------

  const PEER_RECOVERY_KEY = "hydra.peerRecovery";
  const PEER_RECOVERY_MS = 30000;
  const recoveryInitRef = useRef(false);
  const manualReloadRef = useRef(false);

  const swapToMixedTrack = useCallback((call) => {
    const pc = call?.peerConnection;
    const mixedTrack = mixerRef.current?.getOutputAudioTrack();

    if (!pc || !mixedTrack) return;

    const sender = pc
      .getSenders()
      .find((s) => s.track && s.track.kind === "audio");

    if (!sender) return;

    sender
      .replaceTrack(mixedTrack)
      .then(() => setUsingMixedTrack(true))
      .catch((err) => setError(err.message || String(err)));
  }, []);

  const wireCall = useCallback(
    (call) => {
      callRef.current = call;

      call.on("stream", (stream) => {
        setRemoteStream(stream);
        setStatus("in-call");
      });

      call.on("close", () => {
        setStatus("ready");
        setRemoteStream(null);
        setUsingMixedTrack(false);
      });

      call.on("error", (err) => {
        setError(err.message || String(err));
      });

      const pc = call.peerConnection;

      if (pc) {
        if (pc.connectionState === "connected") {
          swapToMixedTrack(call);
        } else {
          const onStateChange = () => {
            if (pc.connectionState === "connected") {
              swapToMixedTrack(call);
              pc.removeEventListener(
                "connectionstatechange",
                onStateChange
              );
            }
          };

          pc.addEventListener(
            "connectionstatechange",
            onStateChange
          );
        }
      }
    },
    [swapToMixedTrack]
  );

  const wireDataConnection = useCallback((connection) => {
    dataConnectionRef.current = connection;

    connection.on("open", () => {
      console.log("PeerJS data connection opened.");
    });

    connection.on("data", (data) => {
      console.log("PeerJS data received:", data);
      setDataMessage(data);
    });

    connection.on("close", () => {
      if (dataConnectionRef.current === connection) {
        dataConnectionRef.current = null;
      }
    });

    connection.on("error", (err) => {
      console.error("PeerJS data connection error:", err);
    });
  }, []);

  // ------------------------------------------------------------
  // INIT
  // ------------------------------------------------------------

  const init = useCallback(
    async (preferredPeerId = null) => {
      // Prevent duplicate initialization.
      if (
        peerRef.current &&
        !peerRef.current.destroyed &&
        localStreamRef.current
      ) {
        console.log("HYDRA: camera/mic and PeerJS already initialized.");
        return;
      }

      setStatus("initializing");
      setError(null);

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "Camera and microphone require HTTPS. Open the HTTPS URL."
          );
        }

        const localStream =
          await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });

        localStreamRef.current = localStream;
        setLocalStreamVersion((v) => v + 1);

        const mixer = new AudioMixer();

        await mixer.resume();
        mixer.connectMicrophone(localStream);
        mixerRef.current = mixer;

        const peerId =
  typeof preferredPeerId === "string" &&
  preferredPeerId.trim()
    ? preferredPeerId.trim()
    : undefined;

const peer = new Peer(
  peerId,
  {
    config: {
      iceServers: buildIceServers(),
    },
  }
);

        peerRef.current = peer;

        peer.on("open", (id) => {
          console.log("HYDRA: Peer opened:", id);

          setMyPeerId(id);
          setStatus("ready");

          try {
            sessionStorage.setItem(
              PEER_RECOVERY_KEY,
              JSON.stringify({
                peerId: id,
                savedAt: Date.now(),
              })
            );

            console.log(
              "HYDRA: Peer recovery state saved."
            );
          } catch (storageError) {
            console.warn(
              "Peer recovery save failed:",
              storageError
            );
          }
        });

        peer.on("error", (err) => {
          console.error("HYDRA: Peer error:", err);

          setError(err.message || String(err));
          setStatus("error");
        });

        peer.on("call", (incomingCall) => {
          setLocalParticipantRole("B");
          console.log("HYDRA: Incoming call.");

          incomingCall.answer(localStreamRef.current);
          wireCall(incomingCall);
        });

        peer.on("connection", (connection) => {
          wireDataConnection(connection);
        });
      } catch (err) {
        console.error("HYDRA: init failed:", err);

        setError(err.message || String(err));
        setStatus("error");
      }
    },
    [wireCall, wireDataConnection]
  );
  // ------------------------------------------------------------
  // REFRESH RESET + MOBILE TAB RECOVERY
  // ------------------------------------------------------------

  useEffect(() => {
    try {
      const navigation =
        performance.getEntriesByType("navigation")[0];

      const navigationType = navigation?.type;

      // Chrome can report that the previous page was discarded.
      // A discarded page may look like a reload, but should recover.
      const wasDiscarded =
        document.wasDiscarded === true;

      const isNormalBrowserReload =
        navigationType === "reload" &&
        !wasDiscarded;

      console.log(
        "HYDRA navigation:",
        navigationType,
        "wasDiscarded:",
        wasDiscarded
      );

      // --------------------------------------------
      // NORMAL MANUAL REFRESH
      // --------------------------------------------

      if (isNormalBrowserReload) {
        console.log(
          "HYDRA: normal browser refresh detected. Clearing session."
        );

        sessionStorage.removeItem(
          PEER_RECOVERY_KEY
        );

        recoveryInitRef.current = false;

        setMyPeerId(null);
        setRemoteStream(null);
        setUsingMixedTrack(false);
        setStatus("idle");

        return;
      }

      // --------------------------------------------
      // RECENT MOBILE TAB RECOVERY
      // --------------------------------------------

      const saved =
        sessionStorage.getItem(PEER_RECOVERY_KEY);

      if (!saved) {
        return;
      }

      const snapshot = JSON.parse(saved);

      const validRecovery =
        typeof snapshot?.peerId === "string" &&
        snapshot.peerId.trim().length > 0 &&
        Number.isFinite(snapshot.savedAt) &&
        Date.now() - snapshot.savedAt <= PEER_RECOVERY_MS;

      if (!validRecovery) {
        console.log(
          "HYDRA: saved recovery expired or invalid."
        );

        sessionStorage.removeItem(
          PEER_RECOVERY_KEY
        );

        return;
      }

      console.log(
        "HYDRA: valid recovery found:",
        snapshot.peerId
      );

      setMyPeerId(snapshot.peerId);

      if (!recoveryInitRef.current) {
        recoveryInitRef.current = true;

        console.log(
          "HYDRA: restoring camera, microphone and PeerJS..."
        );

        init(snapshot.peerId);
      }
    } catch (error) {
      console.warn(
        "HYDRA: refresh/recovery handling failed:",
        error
      );
    }
  }, [init]);


  // ------------------------------------------------------------
  // SAVE PEER STATE WHEN TAB BECOMES HIDDEN / PAGE HIDES
  // ------------------------------------------------------------

  useEffect(() => {
    const savePeerRecovery = () => {
      try {
                if (manualReloadRef.current) {
          return;
        }

        if (!myPeerId) {
          return;
        }

        sessionStorage.setItem(
          PEER_RECOVERY_KEY,
          JSON.stringify({
            peerId: myPeerId,
            savedAt: Date.now(),
          })
        );

        console.log(
          "HYDRA: Peer recovery state refreshed."
        );
      } catch (error) {
        console.warn(
          "Peer recovery save failed:",
          error
        );
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        savePeerRecovery();
      }
    };

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );

    window.addEventListener(
      "pagehide",
      savePeerRecovery
    );

    return () => {
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );

      window.removeEventListener(
        "pagehide",
        savePeerRecovery
      );
    };
  }, [myPeerId]);

  // ------------------------------------------------------------
  // CALL PEER
  // ------------------------------------------------------------

  const callPeer = useCallback(
    (remotePeerId) => {
      if (
        !peerRef.current ||
        !localStreamRef.current
      ) {
        return;
      }

      setLocalParticipantRole("A");
      setStatus("calling");

      const call = peerRef.current.call(
        remotePeerId,
        localStreamRef.current
      );

      wireCall(call);

      const connection =
        peerRef.current.connect(remotePeerId);

      wireDataConnection(connection);
    },
    [wireCall, wireDataConnection]
  );

  // ------------------------------------------------------------
  // SEND DATA
  // ------------------------------------------------------------

  const sendData = useCallback((data) => {
    const connection = dataConnectionRef.current;

    if (!connection) {
      console.warn(
        "No PeerJS data connection available."
      );
      return false;
    }

    if (connection.open) {
      try {
        connection.send(data);

        console.log(
          "PeerJS data sent immediately."
        );

        return true;
      } catch (err) {
        console.error(
          "PeerJS data send failed:",
          err
        );

        return false;
      }
    }

    console.log(
      "PeerJS data connection not open yet."
    );

    const sendWhenOpen = () => {
      try {
        if (
          dataConnectionRef.current === connection &&
          connection.open
        ) {
          connection.send(data);

          console.log(
            "PeerJS queued data sent after connection opened."
          );
        }
      } catch (err) {
        console.error(
          "PeerJS delayed data send failed:",
          err
        );
      }
    };

    connection.once("open", sendWhenOpen);

    return false;
  }, []);

  // HANG UP
  // ------------------------------------------------------------

  const hangUp = useCallback(() => {
    callRef.current?.close();
    callRef.current = null;

    dataConnectionRef.current?.close();
    dataConnectionRef.current = null;

    setDataMessage(null);
    setLocalParticipantRole(null);
    setStatus("ready");
    setRemoteStream(null);
    setUsingMixedTrack(false);
  }, []);

  // ------------------------------------------------------------
  // TOGGLE MIC
  // ------------------------------------------------------------

  const toggleMic = useCallback(() => {
    setMicMuted((prev) => {
      const next = !prev;

      mixerRef.current?.setMicMuted(next);

      return next;
    });
  }, []);

  // ------------------------------------------------------------
  // SPEAK / TTS
  // ------------------------------------------------------------

  const speak = useCallback(async (arrayBuffer) => {
    if (!mixerRef.current) {
      throw new Error(
        "Call the mic/camera before speaking (mixer not ready)."
      );
    }

    await mixerRef.current.resume();

    return mixerRef.current.enqueueTTS(
      arrayBuffer
    );
  }, []);

  // ------------------------------------------------------------
  // CLEANUP
  // ------------------------------------------------------------

  useEffect(() => {
    return () => {
      callRef.current?.close();
      dataConnectionRef.current?.close();
      peerRef.current?.destroy();
      mixerRef.current?.close();

      localStreamRef.current
        ?.getTracks()
        .forEach((track) => track.stop());
    };
  }, []);

  return {
    status,
    error,
    myPeerId,
    remoteStream,
    micMuted,
    usingMixedTrack,
    localStream: localStreamRef.current,
    localStreamVersion,
    init,
    callPeer,
    hangUp,
    toggleMic,
    speak,
    sendData,
    dataMessage,
    localParticipantRole,
  };
}




