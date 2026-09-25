import { useCallback, useEffect, useRef, useState } from "react";
import { useCall } from "./webrtc/useCall";
import ttsManager from "./tts/ttsCache";
import translationManager from "./translation/translationCache";
import { BACKEND_URL } from "./config";
import { transcribeAudio, searchAssist, needsSearch } from "./api/backend";

const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", sarvam: "en-IN" },
  { code: "hi", label: "Hindi", sarvam: "hi-IN" },
  { code: "bn", label: "Bengali", sarvam: "bn-IN" },
  { code: "ta", label: "Tamil", sarvam: "ta-IN" },
  { code: "te", label: "Telugu", sarvam: "te-IN" },
  { code: "gu", label: "Gujarati", sarvam: "gu-IN" },
  { code: "kn", label: "Kannada", sarvam: "kn-IN" },
  { code: "ml", label: "Malayalam", sarvam: "ml-IN" },
  { code: "mr", label: "Marathi", sarvam: "mr-IN" },
  { code: "pa", label: "Punjabi", sarvam: "pa-IN" },
  { code: "or", label: "Odia", sarvam: "od-IN" },
];

const SUPPORTED_TRANSLATION = [
  "en",
  "hi",
  "bn",
  "ta",
  "te",
  "gu",
  "kn",
  "ml",
  "mr",
  "pa",
  "or",
];

const MAX_CONTEXT_MESSAGES = 10;

const EMERGENCY_REPLIES = [
  "I need help.",
  "Please call emergency services.",
  "I need medical assistance.",
  "I am not feeling safe.",
  "Please stay with me.",
  "I cannot speak right now.",
];
const EMOTION_PRESETS = {
  friendly: {
    label: "Friendly",
    emoji: "\u{1F60A}",
    pace: 1.0,
    temperature: 0.55,
  },
  happy: {
    label: "Happy",
    emoji: "\u{1F604}",
    pace: 1.08,
    temperature: 0.70,
  },
  calm: {
    label: "Calm",
    emoji: "\u{1F60C}",
    pace: 0.88,
    temperature: 0.35,
  },
  professional: {
    label: "Professional",
    emoji: "\u{1F399}\u{FE0F}",
    pace: 0.95,
    temperature: 0.40,
  },
  sad: {
    label: "Sad",
    emoji: "\u{1F614}",
    pace: 0.85,
    temperature: 0.30,
  },
  serious: {
    label: "Serious",
    emoji: "\u{1F610}",
    pace: 0.90,
    temperature: 0.25,
  },
  energetic: {
    label: "Energetic",
    emoji: "\u{26A1}",
    pace: 1.15,
    temperature: 0.75,
  },
  expressive: {
    label: "Expressive",
    emoji: "\u{1F3AD}",
    pace: 1.05,
    temperature: 0.85,
  },
};
// ------------------------------------------------------------
// HYDRA AI SUMMARY HEADING EMOJIS
// ------------------------------------------------------------
const decorateHydraSummaryHeadings = (text) => {
  if (!text) {
    return text;
  }

  // The AI can return literal "\\n" or "\\\\n".
  // Normalize either form into real line breaks.
  let result = String(text).replace(/\\+n/g, "\n");

  const headingEmojis = {
    "Conversation Summary": "📝",
    "Important Points": "💡",
    "People / Places / Organizations Mentioned": "👥",
    "Dates / Times Mentioned": "📅",
    "Plans / Decisions": "✅",
    "Tasks / Follow-ups": "📋"
  };

  Object.entries(headingEmojis).forEach(([heading, emoji]) => {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    result = result.replace(
      new RegExp(`(^|\\n)\\s*(?:${emoji}\\s*)?${escaped}\\s*`, "gi"),
      (_, prefix) => `${prefix}${emoji} ${heading}\\n`
    );
  });

  return result
    .replace(/[ \t]+\\n/g, "\\n")
    .replace(/\\n{3,}/g, "\\n\\n")
    .trim();
};
const renderHydraSummary = (text) => {
  if (!text) {
    return null;
  }

  let normalized = String(text)
    .replace(/\\+n/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();

  const sectionDefinitions = [
    {
      heading: "Conversation Summary",
      emoji: "📝",
    },
    {
      heading: "Important Points",
      emoji: "💡",
    },
    {
      heading: "People / Places / Organizations Mentioned",
      emoji: "👥",
    },
    {
      heading: "Dates / Times Mentioned",
      emoji: "📅",
    },
    {
      heading: "Plans / Decisions",
      emoji: "✅",
    },
    {
      heading: "Tasks / Follow-ups",
      emoji: "📋",
    },
  ];

  const headingPattern = sectionDefinitions
    .map((item) =>
      item.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    )
    .join("|");

  const parts = normalized.split(
    new RegExp(
      `(${headingPattern})`,
      "gi"
    )
  );

  const sections = [];
  let current = null;

  parts.forEach((part) => {
    const value = part.trim();

    if (!value) {
      return;
    }

    const definition = sectionDefinitions.find(
      (item) =>
        item.heading.toLowerCase() ===
        value.toLowerCase()
    );

    if (definition) {
      current = {
        heading: definition.heading,
        emoji: definition.emoji,
        content: "",
      };

      sections.push(current);
      return;
    }

    if (current) {
      current.content +=
        (current.content ? "\n" : "") +
        value;
    } else {
      sections.push({
        heading: "",
        emoji: "",
        content: value,
      });
    }
  });

  if (sections.length === 0) {
    return (
      <div className="ai-result-box">
        <div className="translated-text">
          {normalized}
        </div>
      </div>
    );
  }

  return (
    <div
      className="hydra-summary-sections"
      style={{
        display: "grid",
        gap: "10px",
      }}
    >
      {sections.map((section, index) => (
        <div
          key={`${section.heading}-${index}`}
          style={{
            padding: "12px 14px",
            borderRadius: "10px",
            background: "rgba(255,255,255,0.045)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {section.heading && (
            <div
              style={{
                fontWeight: 700,
                marginBottom: "6px",
                lineHeight: 1.35,
              }}
            >
              {section.emoji} {section.heading}
            </div>
          )}

          <div
            className="translated-text"
            style={{
              whiteSpace: "pre-wrap",
              lineHeight: 1.55,
            }}
          >
            {section.content.trim()}
          </div>
        </div>
      ))}
    </div>
  );
};


export default function App() {
  const {
    status,
    error,
    myPeerId,
    remoteStream,
    micMuted,
    usingMixedTrack,
    localStream,
    localStreamVersion,
    init,
    callPeer,
    hangUp,
    toggleMic,
    speak,
    sendData,
    dataMessage,
    localParticipantRole,
  } = useCall();

  const [remoteId, setRemoteId] = useState("");
  const [sourceLang, setSourceLang] = useState("en");
  const [targetLang, setTargetLang] = useState("hi");
  const [message, setMessage] = useState("");
  const [cameraOff, setCameraOff] = useState(false);
  const [translatedText, setTranslatedText] = useState("");

  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState(null);

  const [speaking, setSpeaking] = useState(false);
  const [speakError, setSpeakError] = useState(null);
  const [preparing, setPreparing] = useState(false);

  const [speaker, setSpeaker] = useState("default");
  const [pace, setPace] = useState(1.0);
  const [temperature, setTemperature] = useState(0.5);
  const [emotion, setEmotion] = useState("friendly");

          <span>Context-aware AI</span>
  const [conversationHistory, setConversationHistory] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [aiSuggestions, setAiSuggestions] = useState([]);
  const [aiSuggestionsLoading, setAiSuggestionsLoading] = useState(false);
  const [searchAssistAnswer, setSearchAssistAnswer] = useState("");
  const [searchAssistQuestion, setSearchAssistQuestion] = useState("");
  const [searchAssistLoading, setSearchAssistLoading] = useState(false);
  const [searchAssistError, setSearchAssistError] = useState(null);
  const [aiImprovedText, setAiImprovedText] = useState("");
  const [aiSummary, setAiSummary] = useState("");
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState(null);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
const remoteRecorderRef = useRef(null);
const remoteRecordingTimerRef = useRef(null);
const remoteTranscriptionBusyRef = useRef(false);
  const conversationHistoryRef = useRef([]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, localStreamVersion]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const inCall = status === "in-call";

  const getLangLabel = (code) =>
    SUPPORTED_LANGUAGES.find((l) => l.code === code)?.label || code;

  const toggleCamera = () => {
    const stream = localStream;

    if (!stream) {
      return;
    }

    const videoTracks = stream.getVideoTracks();

    if (!videoTracks.length) {
      return;
    }

    const nextCameraOff = !cameraOff;

    videoTracks.forEach((track) => {
      track.enabled = !nextCameraOff;
    });

    setCameraOff(nextCameraOff);
  };
  // ------------------------------------------------------------
  // CONVERSATION CONTEXT
  // ------------------------------------------------------------

  const addConversationMessage = useCallback((role, content) => {
  const trimmed = (content || "").trim();

  if (!trimmed) {
    return;
  }

  const currentHistory =
    conversationHistoryRef.current || [];

  const nextHistory = [
    ...currentHistory,
    {
      role,
      content: trimmed,
    },
  ].slice(-MAX_CONTEXT_MESSAGES);

  conversationHistoryRef.current = nextHistory;
  setConversationHistory(nextHistory);
  }, []);
useEffect(() => {
  if (!remoteStream) return;

  const audioTracks = remoteStream.getAudioTracks();

  if (!audioTracks.length) {
    console.warn("Remote stream has no audio track.");
    return;
  }

  const audioStream = new MediaStream(audioTracks);

  let audioContext = null;
  let analyser = null;
  let sourceNode = null;
  let animationFrame = null;
  let recorder = null;
  let chunks = [];
  let cancelled = false;

  let speaking = false;
  let speechStartedAt = 0;
  let silenceStartedAt = 0;
  let speechCandidateStartedAt = 0;
  let speechCandidateSilenceStartedAt = 0;
  let speechConfirmed = false;

  // Balanced VAD settings:
  // low enough to capture normal speech, but with
  // sustained-speech confirmation to reject short noises.
  const SPEECH_THRESHOLD = 0.023;
  const SILENCE_THRESHOLD = 0.017;

  // Confirm speech quickly, while recording immediately
  // so the first words are preserved.
  const SPEECH_CONFIRMATION_MS = 120;

  // A candidate may briefly dip below the speech threshold
  // without being rejected.
  const CANDIDATE_SILENCE_MS = 300;

  // Allow natural pauses between words/sentences.
  const MIN_SPEECH_MS = 500;
  const SILENCE_MS = 1200;

  // Allow longer complete phrases.
  const MAX_SPEECH_MS = 12000;

  const startRecording = () => {
    if (
      cancelled ||
      recorder ||
      remoteTranscriptionBusyRef.current
    ) {
      return;
    }

    try {
      recorder = MediaRecorder.isTypeSupported(
        "audio/webm;codecs=opus"
      )
        ? new MediaRecorder(audioStream, {
            mimeType: "audio/webm;codecs=opus",
          })
        : new MediaRecorder(audioStream);
    } catch (error) {
      console.error("Remote MediaRecorder error:", error);
      recorder = null;
      return;
    }

    chunks = [];

    recorder.ondataavailable = (event) => {
      if (event.data?.size > 0) {
        chunks.push(event.data);
      }
    };

    recorder.onstop = async () => {
      const currentRecorder = recorder;
      recorder = null;

      if (cancelled) return;

      // Capture the confirmation state BEFORE it can be reset.
      // This prevents confirmed speech from being discarded
      // when the VAD finishes the recording.
      const wasSpeechConfirmed = speechConfirmed;
      speechConfirmed = false;

      if (!wasSpeechConfirmed) {
        chunks = [];
        return;
      }

      const blob = new Blob(chunks, {
        type: currentRecorder?.mimeType || "audio/webm",
      });

      chunks = [];

      if (blob.size < 1500) {
        return;
      }

      remoteTranscriptionBusyRef.current = true;

      try {
        const result = await transcribeAudio(blob, {
          language: sourceLang,
          filename: "remote-call.webm",
        });

        const transcript =
          typeof result?.text === "string"
            ? result.text.trim()
            : "";

        if (!transcript) {
          return;
        }

        if (window.__lastRemoteTranscript === transcript) {
          return;
        }

        window.__lastRemoteTranscript = transcript;

        console.log("USER B:", transcript);

        // Search Assist decides whether this is a factual
        // lookup. When search is needed, its grounded
        // suggestions are used instead of generic AI replies.
        // The remote participant's speech is only added
        // to local conversation memory here.
        // Do NOT run Search Assist again from remote STT.
        // The original speaker already triggered Search Assist
        // and sent the result to the intended receiver.

        const currentHistory =
          conversationHistoryRef.current || [];

        const nextHistory = [
          ...currentHistory,
          {
            role: "user",
            content: transcript,
          },
        ].slice(-MAX_CONTEXT_MESSAGES);

        conversationHistoryRef.current = nextHistory;
        setConversationHistory(nextHistory);

      } catch (error) {
        console.error(
          "Remote STT / AI suggestions failed:",
          error
        );

        setAiError(
          error?.message ||
            "Could not generate response suggestions."
        );
      } finally {
        remoteTranscriptionBusyRef.current = false;
      }
    };

    recorder.onerror = (event) => {
      console.error(
        "Remote recorder error:",
        event.error
      );

      recorder = null;
      chunks = [];
      speechConfirmed = false;
      remoteTranscriptionBusyRef.current = false;
    };

    remoteRecorderRef.current = recorder;
    recorder.start();
  };

  const stopRecording = () => {
    if (!recorder) return;

    try {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    } catch (error) {
      console.error(
        "Could not stop remote recorder:",
        error
      );

      recorder = null;
      remoteRecorderRef.current = null;
    }
  };

  const detectVoice = () => {
    if (cancelled || !analyser) return;

    const buffer = new Uint8Array(
      analyser.fftSize
    );

    analyser.getByteTimeDomainData(buffer);

    let sum = 0;

    for (let i = 0; i < buffer.length; i++) {
      const normalized =
        (buffer[i] - 128) / 128;

      sum += normalized * normalized;
    }

    const rms = Math.sqrt(
      sum / buffer.length
    );

    const now = performance.now();

    if (
      !speaking &&
      !remoteTranscriptionBusyRef.current
    ) {
      if (rms > SPEECH_THRESHOLD) {
        if (!speechCandidateStartedAt) {
          speechCandidateStartedAt = now;
          speechCandidateSilenceStartedAt = 0;
          speechConfirmed = false;

          // Start immediately so the beginning of the
          // spoken phrase is captured.
          startRecording();
        } else {
          // Real speech returned; clear any brief dip.
          speechCandidateSilenceStartedAt = 0;
        }

        if (
          now - speechCandidateStartedAt >=
          SPEECH_CONFIRMATION_MS
        ) {
          speaking = true;
          speechStartedAt = speechCandidateStartedAt;
          silenceStartedAt = 0;
          speechCandidateStartedAt = 0;
          speechCandidateSilenceStartedAt = 0;
          speechConfirmed = true;

          console.log("Remote speech detected.");
        }
      } else if (speechCandidateStartedAt) {
        // Do not reject immediately. Normal speech can have
        // short RMS dips between sounds.
        if (rms < SILENCE_THRESHOLD) {
          if (!speechCandidateSilenceStartedAt) {
            speechCandidateSilenceStartedAt = now;
          }

          if (
            now - speechCandidateSilenceStartedAt >=
            CANDIDATE_SILENCE_MS
          ) {
            console.log(
              "Remote speech candidate rejected."
            );

            speechCandidateStartedAt = 0;
            speechCandidateSilenceStartedAt = 0;
            speechConfirmed = false;

            stopRecording();
          }
        } else {
          speechCandidateSilenceStartedAt = 0;
        }
      }
    }

    if (speaking) {
      if (rms < SILENCE_THRESHOLD) {
        if (!silenceStartedAt) {
          silenceStartedAt = now;
        }

        if (
          now - silenceStartedAt >= SILENCE_MS &&
          now - speechStartedAt >= MIN_SPEECH_MS
        ) {
          speaking = false;
          silenceStartedAt = 0;
          speechCandidateStartedAt = 0;
          speechCandidateSilenceStartedAt = 0;

          console.log("Remote speech ended.");

          stopRecording();
        }
      } else {
        silenceStartedAt = 0;
      }

      if (
        now - speechStartedAt >= MAX_SPEECH_MS
      ) {
        speaking = false;
        silenceStartedAt = 0;

        console.log(
          "Maximum remote speech duration reached."
        );

        stopRecording();
      }
    }

    animationFrame =
      requestAnimationFrame(detectVoice);
  };

  try {
    audioContext = new (
      window.AudioContext ||
      window.webkitAudioContext
    )();

    sourceNode =
      audioContext.createMediaStreamSource(
        audioStream
      );

    analyser =
      audioContext.createAnalyser();

    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.15;

    sourceNode.connect(analyser);

    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }

    detectVoice();
  } catch (error) {
    console.error(
      "Remote VAD initialization failed:",
      error
    );
  }

  const decorateSummaryHeadings = (text) => {
    if (!text) {
      return text;
    }

    const emojiMap = {
      "discussed": "💬",
      "meeting time": "🕐",
      "location": "📍",
      "project / task": "📋",
      "project/task": "📋",
      "project": "📋",
      "task": "📋",
      "follow-up": "🔔",
      "follow up": "🔔",
      "date & time": "📅",
      "date and time": "📅",
      "duration": "⏱️",
      "conversation summary": "📝",
      "important points": "💡",
      "transcript": "📄",
      "detected languages": "🌐"
    };

    return text.split(/\r?\n/).map((line) => {
      if (Object.values(emojiMap).some((emoji) => line.includes(emoji))) {
        return line;
      }

      const match = line.match(/^(\s*(?:#{1,3}\s*)?(?:\*\*)?)(Location|Duration|Participants|Main Topics|Topics|Key Points|Sentiment|Tone|Outcome|Action Items|Next Steps|Decisions|Important Details)(.*)$/i);

      if (!match) {
        return line;
      }

      const emoji = emojiMap[match[2].toLowerCase()];

      if (!emoji) {
        return line;
      }

      return `${match[1]}${emoji} ${match[2]}${match[3]}`;
    }).join("\n");
  };

  return () => {
    cancelled = true;

    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
    }

    try {
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
    } catch {}

    recorder = null;
    remoteRecorderRef.current = null;
    remoteTranscriptionBusyRef.current = false;

    try {
      sourceNode?.disconnect();
    } catch {}

    try {
      analyser?.disconnect();
    } catch {}

    try {
      audioContext?.close();
    } catch {}
  };
}, [remoteStream, sourceLang]);
  const runSearchAssist = useCallback(
    async (transcript, speaker, localOnly = false) => {
      const question =
        (transcript || "").trim();

      if (!question) {
        return false;
      }

      console.log(
        "SEARCH ASSIST STARTED:",
        {
          speaker,
          question,
        }
      );

      try {
        const decision = await needsSearch({
          message: question,
          language: "English",
        });

        console.log(
          "SEARCH DECISION:",
          decision
        );

        if (!decision?.needs_search) {
          console.log(
            "SEARCH NOT NEEDED:",
            question
          );
          return false;
        }

        setSearchAssistLoading(true);
        setSearchAssistError(null);

        let result = await searchAssist({
          speaker,
          message: question,
          conversationHistory:
            conversationHistoryRef.current || [],
          language: "English",
        });

        console.log(
          "SEARCH ASSIST RESULT:",
          result
        );

        const groundedSuggestions =
          Array.isArray(result?.suggestions)
            ? result.suggestions
                .map((item) =>
                  typeof item === "string"
                    ? item.trim()
                    : ""
                )
                .filter(Boolean)
                .slice(0, 3)
            : [];

        const answer =
          typeof result?.answer === "string"
            ? result.answer.trim()
            : "";

        const finalSuggestions =
          groundedSuggestions.length > 0
            ? groundedSuggestions
            : answer
              ? [answer]
              : [];

        if (
          finalSuggestions.length === 0
        ) {
          console.warn(
            "SEARCH ASSIST RETURNED NO SUGGESTIONS:",
            result
          );
          return true;
        }

        // Manual Search Assist is local-only.
        // Show the web-grounded result to the participant
        // who clicked the Search Assist button.
        if (localOnly) {
          setSearchAssistQuestion(question);
          setSearchAssistAnswer(finalSuggestions[0]);
          setAiSuggestions(finalSuggestions);
          setAiImprovedText("");
          setAiError(null);

          console.log(
            "LOCAL SEARCH ASSIST RESULT:",
            {
              speaker,
              question,
              suggestions: finalSuggestions,
            }
          );

          return true;
        }

        const receiver =
          speaker === "A"
            ? "B"
            : "A";

        const searchAssistMessage = {
          type: "search-assist",
          question,
          answer: finalSuggestions[0],
          suggestions: finalSuggestions,
          sender: speaker,
          receiver,
        };

        console.log(
          "SEARCH ASSIST PAYLOAD:",
          searchAssistMessage
        );

        let sent = false;

        for (
          const delay of [0, 500, 1000, 2000]
        ) {
          if (delay > 0) {
            await new Promise(
              (resolve) =>
                setTimeout(resolve, delay)
            );
          }

          try {
            sent = sendData(
              searchAssistMessage
            );
          } catch (error) {
            console.error(
              "SEARCH ASSIST SEND ERROR:",
              error
            );
            sent = false;
          }

          console.log(
            "SEARCH ASSIST SEND ATTEMPT:",
            {
              delay,
              sent,
            }
          );

          if (sent) {
            break;
          }
        }

        console.log(
          "SEARCH + AI SUGGESTIONS SENT TO OTHER PARTICIPANT:",
          sent,
          searchAssistMessage
        );

        // IMPORTANT:
        // Do NOT call setAiSuggestions(),
        // setMessage(), setSearchAssistAnswer(),
        // or setSearchAssistQuestion() here.
        // The sender must not display the remote reply.

        return true;

      } catch (error) {

        console.error(
          "Search Assist failed:",
          error
        );

        setSearchAssistError(
          error?.message ||
            "Search Assist could not find an answer."
        );

        return true;

      } finally {
        setSearchAssistLoading(false);
      }
    },
    []
  );

  // ------------------------------------------------------------
  // RECEIVE SEARCH ASSIST FROM OTHER PARTICIPANT
  // ------------------------------------------------------------

  useEffect(() => {
    if (!dataMessage) {
      return;
    }

    if (
      dataMessage.type !== "search-assist"
    ) {
      return;
    }

    console.log(
      "SEARCH ASSIST RECEIVED BY LOCAL USER:",
      dataMessage
    );

    const question =
      typeof dataMessage.question === "string"
        ? dataMessage.question.trim()
        : "";

    const answer =
      typeof dataMessage.answer === "string"
        ? dataMessage.answer.trim()
        : "";

    const suggestions =
      Array.isArray(
        dataMessage.suggestions
      )
        ? dataMessage.suggestions
            .map((item) =>
              typeof item === "string"
                ? item.trim()
                : ""
            )
            .filter(Boolean)
            .slice(0, 3)
        : [];

    const finalSuggestions =
      suggestions.length > 0
        ? suggestions
        : answer
          ? [answer]
          : [];

    if (
      !question ||
      finalSuggestions.length === 0
    ) {
      console.warn(
        "RECEIVED SEARCH ASSIST IS EMPTY:",
        dataMessage
      );
      return;
    }

    // ----------------------------------------------------------
    // ONLY THE RECEIVER UPDATES SUGGESTIONS/UI
    // ----------------------------------------------------------

    setSearchAssistQuestion(
      question
    );

    setSearchAssistAnswer(
      finalSuggestions[0]
    );

    setAiSuggestions(
      finalSuggestions
    );

    // Do not auto-fill the textbox.
    // User must click a suggestion to select it.

    setAiImprovedText("");
    setAiError(null);
    setSearchAssistError(null);

    // ----------------------------------------------------------
    console.log(
      "RECEIVER AI SUGGESTIONS:",
      finalSuggestions
    );

  }, [dataMessage]);
  // AI CONTEXT-AWARE REPLY
  // ------------------------------------------------------------

  const handleSuggestionSelect = (suggestion) => {
    const trimmed = (suggestion || "").trim();
    if (!trimmed) return;

    setMessage(trimmed);
    setAiImprovedText(trimmed);
    setAiError(null);
    setSearchAssistAnswer("");
    setSearchAssistError(null);
  };
  const handleManualSearchAssist = async () => {
    const history = conversationHistoryRef.current || conversationHistory;

    const latestRemoteMessage = [...history]
      .reverse()
      .find(
        (turn) =>
          turn?.role === "user" &&
          turn?.content?.trim()
      );

    const question =
      latestRemoteMessage?.content?.trim() || message.trim();

    if (!question) {
      setSearchAssistError(
        "No question is available for Search Assist."
      );
      return;
    }

    if (!localParticipantRole) {
      setSearchAssistError(
        "Participant role is not established yet. Please connect the call first."
      );
      return;
    }

    const questionSpeaker =
      localParticipantRole === "A" ? "B" : "A";

    console.log(
      "MANUAL SEARCH ASSIST CLICKED:",
      {
        localParticipantRole,
        questionSpeaker,
        question,
      }
    );

    setSearchAssistError(null);
    setSearchAssistQuestion(question);

    await runSearchAssist(question, questionSpeaker, true);
  };

  const handleGenerateAISuggestions = async () => {
    const history = (conversationHistoryRef.current || conversationHistory).slice(-MAX_CONTEXT_MESSAGES);

    if (!history.length) {
      setAiError('No conversation has been recorded yet.');
      return;
    }

    setAiSuggestionsLoading(true);
    setAiError(null);

    try {
      const response = await fetch(
          `${BACKEND_URL}/api/ai/suggestions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            conversation_history: history,
            language: getLangLabel(sourceLang),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        const detail =
          typeof data?.detail === 'string'
            ? data.detail
            : data?.detail
              ? JSON.stringify(data.detail)
                : "Suggestion request failed: " + response.status;
        throw new Error(detail);
      }

      const suggestions = Array.isArray(data?.suggestions)
        ? data.suggestions
            .filter((item) => typeof item === 'string' && item.trim())
            .map((item) => item.trim())
            .slice(0, 3)
        : [];

      setAiSuggestions(suggestions);
      setAiError(null);
    } catch (error) {
      console.error('Manual AI Suggestions failed:', error);
      setAiError(error?.message || 'Could not generate response suggestions.');
    } finally {
      setAiSuggestionsLoading(false);
    }
  };

  const handleAISummary = async () => {
    if (!conversationHistory.length) {
      setAiSummaryError("No conversation has been recorded yet.");
      return;
    }

    setAiSummaryLoading(true);
    setAiSummaryError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/ai/summary`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "Create a concise summary of this conversation.",
          conversation_history: conversationHistory,
          language: getLangLabel(sourceLang),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const detail =
          typeof data?.detail === "string"
            ? data.detail
            : data?.detail
              ? JSON.stringify(data.detail)
              : typeof data?.message === "string"
                ? data.message
                : `Summary request failed with status ${response.status}`;

        throw new Error(detail);
      }

      const summary =
        typeof data?.reply_text === "string"
          ? data.reply_text.trim()
          : "";

      if (!summary) {
        throw new Error("AI returned an empty summary.");
      }

      setAiSummary(summary);
    } catch (error) {
      console.error("Conversation summary failed:", error);
      setAiSummaryError(
        error instanceof Error
          ? error.message
          : "Unable to generate conversation summary."
      );
    } finally {
      setAiSummaryLoading(false);
    }
  };

  const handleAIImprove = async () => {
    const source = message.trim();

    if (!source) {
      return;
    }

    setAiLoading(true);
    setAiError(null);
    setAiImprovedText("");

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/ai/reply`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: source,
            conversation_history:
              conversationHistoryRef.current || conversationHistory,
            language: getLangLabel(sourceLang),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.detail ||
            data?.message ||
            `AI request failed with status ${response.status}`
        );
      }

      const reply =
        typeof data.reply_text === "string"
          ? data.reply_text.trim()
          : "";

      if (!reply) {
        throw new Error(
          "AI returned an empty reply."
        );
      }

      setAiImprovedText(reply);
      setMessage(reply);

     
    } catch (err) {
      console.error(
        "AI context reply failed:",
        err
      );

      setAiError(
        err?.message ||
          "AI is unavailable. Please try again."
      );
    } finally {
      setAiLoading(false);
    }
  };

  // ------------------------------------------------------------
  // HANG UP + CLEAR CONTEXT
  // ------------------------------------------------------------
const clearConversationContext = () => {
  conversationHistoryRef.current = [];
  setConversationHistory([]);

  setAiSuggestions([]);
  setAiImprovedText("");
  setAiSummary("");
  setAiSummaryError(null);

  setSearchAssistAnswer("");
  setSearchAssistQuestion("");

  setAiError(null);
  setSearchAssistError(null);
};
  const handleHangUp = () => {
    hangUp();
    clearConversationContext();
  };

  // ------------------------------------------------------------
  // TRANSLATION
  // ------------------------------------------------------------

  const executeTranslation = useCallback(
    async (text, src, tgt) => {
      const trimmed = (text || "").trim();

      if (!trimmed) {
        setTranslatedText("");
        setTranslationError(null);
        setTranslating(false);
        return "";
      }

      if (!SUPPORTED_TRANSLATION.includes(tgt)) {
        setTranslatedText(trimmed);
        setTranslationError(null);
        setTranslating(false);
        return trimmed;
      }

      if (src === tgt) {
        setTranslatedText(trimmed);
        setTranslationError(null);
        setTranslating(false);
        return trimmed;
      }

      setTranslating(true);
      setTranslationError(null);

      try {
        const result = await translationManager.translate(
          trimmed,
          src,
          tgt
        );

        setTranslatedText(result);
        return result;
      } catch (err) {
        setTranslationError(err.message || String(err));
        throw err;
      } finally {
        setTranslating(false);
      }
    },
    []
  );

  // ------------------------------------------------------------
  // MANUAL TRANSLATION ONLY
  // Translation is triggered only by the Translate button.
  // ------------------------------------------------------------

  useEffect(() => {
    const trimmed = message.trim();

    if (!trimmed) {
      setTranslatedText("");
      setTranslationError(null);
      setTranslating(false);
      return;
    }

    // Do not call the translation API automatically.
    // Clear the previous translation when the text or
    // selected languages change.
    setTranslatedText("");
    setTranslationError(null);
    setTranslating(false);
  }, [message, sourceLang, targetLang]);



  // LANGUAGE HANDLERS
  // ------------------------------------------------------------

  const handleSourceChange = (e) => {
    setSourceLang(e.target.value);
  };

  const handleTargetChange = (e) => {
    setTargetLang(e.target.value);
  };

  const handleSwap = () => {
    const prevSrc = sourceLang;
    const prevTgt = targetLang;

    setSourceLang(prevTgt);
    setTargetLang(prevSrc);

    if (
      translatedText &&
      translatedText !== message
    ) {
      const prevMsg = message;

      setMessage(translatedText);
      setTranslatedText(prevMsg);
    }
  };

  const handleManualTranslate = () => {
    if (!message.trim()) {
      return;
    }

    executeTranslation(
      message,
      sourceLang,
      targetLang
    ).catch(() => {});
  };

  // ------------------------------------------------------------
  // TTS PREFETCH
  // ------------------------------------------------------------

  useEffect(() => {
    const textToPrefetch =
      sourceLang === targetLang
        ? message.trim()
        : translatedText.trim();

    if (!textToPrefetch || !inCall) {
      setPreparing(false);
      return;
    }

    const ttsOptions = {
      language: targetLang,
      speaker,
      pace,
      temperature,
    };

    if (
      ttsManager.hasAudio(
        textToPrefetch,
        ttsOptions
      )
    ) {
      setPreparing(false);
      return;
    }

    if (
      ttsManager.isPending(
        textToPrefetch,
        ttsOptions
      )
    ) {
      setPreparing(true);

      ttsManager
        .prefetch(
          textToPrefetch,
          ttsOptions
        )
        .finally(() => setPreparing(false));

      return;
    }

    setPreparing(true);

    const timer = setTimeout(() => {
      ttsManager
        .prefetch(
          textToPrefetch,
          ttsOptions
        )
        .then(() => setPreparing(false))
        .catch((err) => {
          console.debug(
            "App: prefetch error (ignored) for",
            textToPrefetch,
            err
          );

          setPreparing(false);
        });
    }, 400);

    return () => clearTimeout(timer);
  }, [
    message,
    translatedText,
    sourceLang,
    targetLang,
    inCall,
    speaker,
    pace,
    temperature,
  ]);

  // ------------------------------------------------------------
  // SPEAK
  // ------------------------------------------------------------

  const handleSpeak = async () => {
    const rawInput = message.trim();

    if (!rawInput) {
      return;
    }

    setSpeakError(null);
    setSpeaking(true);

    try {
      let textToSpeak =
        sourceLang === targetLang
          ? rawInput
          : translatedText.trim();

      if (sourceLang !== targetLang && !textToSpeak) {
        setSpeakError("Please click Translate before using Speak.");
        setSpeaking(false);
        return;
      }

      if (!textToSpeak) {
        textToSpeak = rawInput;
      }

      const audioBytes =
        await ttsManager.getAudio(
          textToSpeak,
          {
            language: targetLang,
            speaker,
            pace,
            temperature,
          }
        );

      await speak(audioBytes);
      setMessage("");
// Save User A's successfully spoken response.
      const currentHistory =
        conversationHistoryRef.current || [];

      const lastTurn =
        currentHistory[currentHistory.length - 1];

      if (
        !lastTurn ||
        lastTurn.role !== "assistant" ||
        lastTurn.content !== rawInput
      ) {
        const nextHistory = [
          ...currentHistory,
          {
            role: "assistant",
            content: rawInput,
          },
        ].slice(-MAX_CONTEXT_MESSAGES);

        conversationHistoryRef.current = nextHistory;
        setConversationHistory(nextHistory);


      }
    } catch (err) {
      setSpeakError(
        err.message || String(err)
      );
    } finally {
      setSpeaking(false);
    }
  };
  // ------------------------------------------------------------
  // UI
  // ------------------------------------------------------------

  return (
    <main className="app">
      <h1>
        AI Accessible Communication Assistant
      </h1>

      {status === "idle" && (
        <button onClick={init}>
          Start camera &amp; microphone
        </button>
      )}

      {status === "initializing" && (
        <p aria-live="polite">
          Requesting camera and microphone
        </p>
      )}

      {status === "error" && (
        <p
          role="alert"
          className="error"
        >
          {error}
        </p>
      )}

      {myPeerId && (
        <p>
          Your call ID:{" "}
          <code>{myPeerId}</code>
          {" "}
          <span>with the other participant so they can call you.</span>
        </p>
      )}

      {(status === "ready" ||
        status === "calling" ||
        inCall) && (
        <div className="call-controls">
      <label htmlFor="remote-id"
            className="sr-only"
          >
            Remote participant&apos;s call ID
          </label>

          <input
            id="remote-id"
            placeholder="Enter the other participant's call ID"
            value={remoteId}
            onChange={(e) =>
              setRemoteId(e.target.value)
            }
            disabled={inCall}
          />

          <button
            disabled={
              !remoteId ||
              status !== "ready"
            }
            onClick={() =>
              callPeer(remoteId)
            }
          >
            Call
          </button>

          <button
            disabled={!inCall}
            onClick={handleHangUp}
          >
            Hang up
          </button>

          <button
            onClick={toggleMic}
            disabled={
              status === "idle" ||
              status === "initializing"
            }
          >
            {micMuted
              ? "Unmute microphone"
              : "Mute microphone"}
          </button>
          <button
            type="button"
            onClick={toggleCamera}
            aria-label={
              cameraOff
                ? "Turn camera on"
                : "Turn camera off"
            }
          >
            {cameraOff
              ? "Camera On"
              : "Camera Off"}
          </button>
        </div>
      )}

      {inCall && (
        <p
          aria-live="polite"
          className="status-line"
        >
          {usingMixedTrack
            ? "Connected"
            : "Connected"
        }
        </p>
      )}

      <div className="video-grid">
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          aria-label="Your camera"
        />

        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          aria-label="Remote participant"
        />
      </div>

      <section
        className="speech-section"
        aria-label="Type, translate, and speak into the call"
      >

        {/* -------------------------------------------------- */}
        {/* CONTEXT STATUS */}
        {/* -------------------------------------------------- */}

        <div className="context-status">
  <span>🧠 AI Conversation Memory</span>
  <span style={{ marginLeft: "10px" }}>
    <span style={{ color: "#22c55e", fontWeight: 600 }}>
      {conversationHistory.length}
    </span>{" "}
    messages
  </span>
</div>

        {/* AI CONTEXT BUTTON */}
        {/* -------------------------------------------------- */}

        <div className="ai-controls">
          <button
            type="button"
            className="secondary-btn"
            disabled={aiSuggestionsLoading || conversationHistory.length === 0}
            onClick={handleGenerateAISuggestions}
          >
            {aiSuggestionsLoading ? "Generating..." : "🤖 AI Suggestions"}
          </button>
          <button
            type="button"
            className="secondary-btn"
            disabled={
  searchAssistLoading ||
  !localParticipantRole ||
  conversationHistory.length === 0
}
            onClick={handleManualSearchAssist}
          >
            {searchAssistLoading ? "Searching…" : "🔎 Search Assist"}
          </button>

          <button
            type="button"
            className="secondary-btn"
            disabled={aiSummaryLoading || conversationHistory.length === 0}
            onClick={handleAISummary}
          >
            {aiSummaryLoading ? "Summarizing…" : "📝 Summary"}
          </button>
          <button
            type="button"
            className="secondary-btn"
            disabled={
              aiLoading ||
              !message.trim()
            }
            onClick={handleAIImprove}
          >
            {aiLoading
              ? "AI is thinking..."
              : "\u2728 AI Improve"}
          </button>

          <button
            type="button"
            className="chip"
            disabled={
              conversationHistory.length === 0
            }
            onClick={() => {
              clearConversationContext();
              setMessage("");
              
            }}
          >
             🧹 Clear Context
          </button>
        </div>

        {aiError && (
          <p
            role="alert"
            className="error"
          >
            AI error: {aiError}
          </p>
        )}

        {aiImprovedText && (
          <div
            className="ai-result-box"
            aria-live="polite"
          >
            <span className="direction-badge">
          <span>Context-aware AI</span>
            </span>

            <p className="translated-text">
              {aiImprovedText}
            </p>
          </div>
        )}

        {/* -------------------------------------------------- */}
        {/* -------------------------------------------------- */}
        {/* EMERGENCY REPLIES */}
        {/* -------------------------------------------------- */}

        <div className="emergency-replies">
          <strong>
             🚨 Emergency replies
          </strong>

          <div className="suggestion-list">
            {EMERGENCY_REPLIES.map(
              (reply, index) => (
                <button
                  key={`emergency-${index}`}
                  type="button"
                  className="chip emergency-chip"
                  onClick={() =>
                    handleSuggestionSelect(reply)
                  }
                >
                  {reply}
                </button>
              )
            )}
          </div>
        </div>

        {/* AI SUGGESTIONS */}
        {/* -------------------------------------------------- */}

        {aiSuggestions.length > 0 && (
          <div className="ai-suggestions">
            <strong>
              Suggested replies:
            </strong>

            <div className="suggestion-list">
              {aiSuggestions.map(
                (suggestion, index) => (
                  <button
                    key={`${suggestion}-${index}`}
                    type="button"
                    className="chip"
                    onClick={() =>
                      handleSuggestionSelect(
                        suggestion
                      )
                    }
                  >
                    {suggestion}
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {/* -------------------------------------------------- */}
        {/* TRANSLATION */}
        {/* -------------------------------------------------- */}

        {translating && (
          <p
            aria-live="polite"
            className="translating"
          >
            Translating ({getLangLabel(sourceLang)} - {getLangLabel(targetLang)})...
          </p>
        )}

        {translationError && (
          <p
            role="alert"
            className="error"
          >
            Translation error:{" "}
            {translationError}
          </p>
        )}

        {translatedText && (
          <div
            className="translation-result-box"
            aria-live="polite"
          >
            <span className="direction-badge">              {getLangLabel(sourceLang)} - {getLangLabel(targetLang)}
            </span>

            <p className="translated-text">
              {translatedText}
            </p>
          </div>
        )}


        {speakError && (
          <p
            role="alert"
            className="error"
          >
            {speakError}
          </p>
        )}

        {/* -------------------------------------------------- */}
        <div
          className="sticky-speech-navbar"
          style={{
            position: "sticky",
            bottom: 0,
            top: "auto",
            zIndex: 1000,
            background: "rgba(13, 21, 38, 0.98)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            padding: "8px 0 12px",
            boxShadow: "0 -4px 14px rgba(0,0,0,0.18)",
            borderTop: "1px solid rgba(255,255,255,0.10)",
          }}
        >
        {/* LANGUAGE SELECTORS */}
        {/* -------------------------------------------------- */}

        <div className="language-toolbar">
          <div className="lang-group">
            <label htmlFor="source-lang">
              Source:
            </label>

            <select
              id="source-lang"
              value={sourceLang}
              onChange={handleSourceChange}
            >
              {SUPPORTED_LANGUAGES.map(
                (language) => (
                  <option
                    key={language.code}
                    value={language.code}
                  >
                    {language.label}
                  </option>
                )
              )}
            </select>
          </div>

          <button
            type="button"
            className="swap-btn"
            onClick={handleSwap}
            title="Swap source and target languages"
            aria-label="Swap source and target languages"
          >
            &#x1F504; Swap
          </button>

          <div className="lang-group">
            <label htmlFor="target-lang">
              Target:
            </label>

            <select
              id="target-lang"
              value={targetLang}
              onChange={handleTargetChange}
            >
              {SUPPORTED_LANGUAGES.map(
                (language) => (
                  <option
                    key={language.code}
                    value={language.code}
                  >
                    {language.label}
                  </option>
                )
              )}
            </select>
          </div>
        </div>

        {/* -------------------------------------------------- */}
        {/* TEXT INPUT */}
        {/* -------------------------------------------------- */}

        <div>
          <label
            htmlFor="message"
            className="sr-only"
          >
            Type message in{" "}
            {getLangLabel(sourceLang)}
          </label>

          <textarea
            id="message"
            value={message}
            onChange={(e) =>
              setMessage(e.target.value)
            }
            placeholder={`Type a message in ${getLangLabel(sourceLang)}...`}
            rows={3}
          />
        </div>
        {/* -------------------------------------------------- */}
        {/* ACTION BUTTONS */}
        {/* -------------------------------------------------- */}

        <div className="action-row">
          <button
            type="button"
            className="secondary-btn"
            disabled={
              translating ||
              !message.trim()
            }
            onClick={handleManualTranslate}
          >
            Translate
          </button>

          <button
            type="button"
            disabled={
              speaking ||
              !message.trim() ||
              (sourceLang !== targetLang &&
                !translatedText &&
                !translating)
            }
            onClick={handleSpeak}
          >
            {speaking
              ? "🔊 Speaking..."
              : "🔊 Speak"}
          </button>

          {preparing && (
            <span
              aria-live="polite"
              className="preparing"
            >
              Preparing voice...
            </span>
          )}
        </div>

        {/* -------------------------------------------------- */}

        {/* -------------------------------------------------- */}
        {/* VOICE CONTROLS */}
        {/* -------------------------------------------------- */}

        <div className="voice-controls">
          <label htmlFor="speaker">
            Speaker:
          </label>

          <select
            id="speaker"
            value={speaker}
            onChange={(e) =>
              setSpeaker(e.target.value)
            }
          >
            <option value="default">
              🎙️ Default
            </option>
            <option value="bulbul_male">
              👨 Male
            </option>
            <option value="bulbul_female">
              👩 Female
            </option>
            <option value="bulbul_neutral">
              Neutral
            </option>
          </select>

          <label htmlFor="emotion">
            Emotion / Tone:
          </label>

          <select
            id="emotion"
            value={emotion}
            onChange={(e) => {
              const selectedEmotion =
                e.target.value;

              setEmotion(selectedEmotion);

              const preset =
                EMOTION_PRESETS[
                  selectedEmotion
                ];

              if (preset) {
                setPace(preset.pace);
                setTemperature(
                  preset.temperature
                );
              }
            }}
          >
            {Object.entries(
              EMOTION_PRESETS
            ).map(([key, preset]) => (
              <option
                key={key}
                value={key}
              >
                {preset.emoji}{" "}
                {preset.label}
              </option>
            ))}
          </select>

          <label htmlFor="pace">
            Pace: {pace}
          </label>

          <input
            id="pace"
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={pace}
            onChange={(e) =>
              setPace(
                Number(e.target.value)
              )
            }
          />

          <label htmlFor="temperature">
            Temperature:{" "}
            {temperature}
          </label>

          <input
            id="temperature"
            type="range"
            min="0.01"
            max="1.0"
            step="0.01"
            value={temperature}
            onChange={(e) =>
              setTemperature(
                Number(e.target.value)
              )
            }
          />
        </div>
        </div>
      </section>
    
      {(aiSummary || aiSummaryError) && (
        <section className="ai-summary-section"
          aria-label="AI conversation summary"
          style={{
            marginTop: "24px",
            paddingTop: "20px",
            borderTop: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <h2
            style={{
              margin: "0 0 12px 0",
              fontSize: "18px",
            }}
          >
            📝✨ AI Conversation Summary
          </h2>
          {aiSummaryError && (
            <p role="alert" className="error">
              Summary error: {aiSummaryError}
            </p>
          )}
          {aiSummary && (
            <div
              className="ai-result-box"
              aria-live="polite"
            >
              {renderHydraSummary(aiSummary)}
            </div>
          )}
        </section>
      )}

    </main>
  );
}














































