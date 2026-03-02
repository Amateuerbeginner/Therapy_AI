import { useState, useRef, useEffect } from 'react';
import './App.css';

const API_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:5000';

function App() {
  const [messages, setMessages] = useState([
    {
      id: Date.now(),
      role: 'bot',
      content:
        'Voice Therapy Assistant\n\nSpeak when you are ready. I listen and respond by voice.\nEmergency (India): 9152987821',
      timestamp: Date.now(),
      primaryEmotion: 'neutral',
      suicideRiskLevel: 'none',
      richEmotion: {},
    },
  ]);

  const [isListening, setIsListening] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [autoListen, setAutoListen] = useState(true);
  const [pendingText, setPendingText] = useState('');
  const [inputText, setInputText] = useState('');

  const recognitionRef = useRef(null);
  const messagesEndRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const ttsVoiceRef = useRef(null);

  const utteranceIdRef = useRef(0);
  const hasSentForUtteranceRef = useRef(false);

  // Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Select voice
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;

    const synth = window.speechSynthesis;

    const pickVoice = () => {
      const voices = synth.getVoices();
      if (!voices || voices.length === 0) return;

      let preferred =
        voices.find((v) => /en-IN/i.test(v.lang)) ||
        voices.find((v) => /India/i.test(v.name));

      if (!preferred) {
        preferred = voices.find((v) => /en-/i.test(v.lang));
      }

      ttsVoiceRef.current = preferred || voices[0];
    };

    pickVoice();

    if (synth.onvoiceschanged !== undefined) {
      synth.onvoiceschanged = pickVoice;
    }
  }, []);

  // Speech Recognition
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-IN';

    recognition.onstart = () => {
      utteranceIdRef.current += 1;
      hasSentForUtteranceRef.current = false;
      setPendingText('');
      setLiveTranscript('');
    };

    recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalPhrase = '';

      const i = event.results.length - 1;
      const result = event.results[i];

      if (result.isFinal && result[0].confidence > 0) {
        finalPhrase = result[0].transcript;
      } else {
        interimTranscript = result[0].transcript;
      }

      if (interimTranscript) {
        setLiveTranscript(interimTranscript);
      }

      if (finalPhrase.trim()) {
        setPendingText(finalPhrase.trim());
      }

      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }

      const currentId = utteranceIdRef.current;

      silenceTimerRef.current = setTimeout(() => {
        if (currentId !== utteranceIdRef.current) return;

        setLiveTranscript('');
        setIsListening(false);

        if (!hasSentForUtteranceRef.current) {
          hasSentForUtteranceRef.current = true;

          setPendingText((textToSend) => {
            const trimmed = textToSend.trim();

            if (trimmed && !isResponding) {
              handleSend(trimmed);
            }

            return '';
          });
        }
      }, 3000);
    };

    recognition.onerror = () => {
      setIsListening(false);
      setLiveTranscript('');
      setPendingText('');
      hasSentForUtteranceRef.current = false;
    };

    recognition.onend = () => {
      setLiveTranscript('');
    };

    recognitionRef.current = recognition;
  }, [isResponding]);

  const toggleMicrophone = () => {
    if (!recognitionRef.current || isResponding || isSpeaking) return;

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      setLiveTranscript('');
      setAutoListen(false);
    } else {
      setLiveTranscript('');
      setAutoListen(true);

      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch {}
    }
  };

  const handleSend = (text) => {
    const trimmed = text.trim();

    if (!trimmed || isResponding) return;

    const userId = Date.now() + Math.random();

    setMessages((prev) => [
      ...prev,
      {
        id: userId,
        role: 'user',
        content: trimmed,
        timestamp: Date.now(),
      },
    ]);

    sendMessage(trimmed);
  };

  const sendMessage = async (userText) => {
    setIsResponding(true);

    try {
      const response = await fetch(`${API_URL}/therapy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText }),
      });

      const data = await response.json();

      const replyText =
        data.reply || 'I am here with you. Please continue.';

      const primaryEmotion = data.primary_emotion || 'neutral';

      const overallRiskLevel =
        data.overall_risk_level || 'none';

      const richEmotion = data.rich_emotion || {};

      const replyId = Date.now() + Math.random();

      setMessages((prev) => [
        ...prev,
        {
          id: replyId,
          role: 'bot',
          content: replyText,
          primaryEmotion,
          suicideRiskLevel: overallRiskLevel,
          richEmotion,
          timestamp: Date.now(),
        },
      ]);

      speakResponse(
        replyText,
        primaryEmotion,
        overallRiskLevel
      );
    } catch (error) {
      console.error('API error:', error);

      const fallback =
        'There was a connection problem. If this feels like an emergency please call 9152987821.';

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          role: 'bot',
          content: fallback,
          primaryEmotion: 'neutral',
          suicideRiskLevel: 'none',
          richEmotion: {},
        },
      ]);

      speakResponse(fallback, 'neutral', 'none');
    } finally {
      setIsResponding(false);
    }
  };

  const speakResponse = (
    text,
    emotion = 'neutral',
    overallRisk = 'none'
  ) => {
    if (!('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    if (ttsVoiceRef.current) {
      utterance.voice = ttsVoiceRef.current;
    }

    let rate = 1.1;
    let pitch = 1.0;

    if (emotion === 'sad' || emotion === 'lonely') {
      rate = 1.0;
      pitch = 0.9;
    } else if (emotion === 'anxious') {
      rate = 1.15;
      pitch = 1.05;
    } else if (emotion === 'happy') {
      rate = 1.2;
      pitch = 1.1;
    }

    if (overallRisk === 'high') {
      rate = 0.85;
      pitch = 0.85;
    }

    utterance.rate = rate;
    utterance.pitch = pitch;

    utterance.onstart = () => {
      setIsSpeaking(true);

      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }

      setIsListening(false);
    };

    utterance.onend = () => {
      setIsSpeaking(false);

      if (autoListen && recognitionRef.current) {
        recognitionRef.current.start();
        setIsListening(true);
      }
    };

    window.speechSynthesis.speak(utterance);
  };

  const handleTextSend = () => {
    if (!inputText.trim()) return;

    handleSend(inputText.trim());
    setInputText('');
  };

  return (
    <div className="app">
      <div className="chat-container">

        <div className="header">
          <h1>🧠 Voice Therapy Assistant</h1>
          <p className="subtitle">
            Speak or type. I will listen and respond with care.
          </p>
        </div>

        <div className="messages-area">
          {messages.map((msg, idx) => (
            <div key={msg.id || idx} className={`message-container ${msg.role}`}>
              <div className={`message-bubble emotion-${msg.primaryEmotion}`}>
                <div className="message-text">{msg.content}</div>

                {msg.role === 'bot' && (
                  <div className="emotion-meta">
                    <span className="emotion-tag">{msg.primaryEmotion}</span>
                    <span className={`risk-tag risk-${msg.suicideRiskLevel}`}>
                      {msg.suicideRiskLevel}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}

          <div ref={messagesEndRef} />
        </div>

        <div className="voice-control">

          <button
            onClick={toggleMicrophone}
            disabled={isResponding || isSpeaking}
            className={`voice-button ${isListening ? 'recording' : ''}`}
          >
            {isListening ? '🔴 Stop' : '🎤 Speak'}
          </button>

          <div className="voice-status">
            {isResponding
              ? 'AI is responding...'
              : isSpeaking
              ? 'AI is speaking...'
              : isListening
              ? `Listening... "${liveTranscript}"`
              : 'Click Speak or type below'}
          </div>

          <div className="text-input-wrapper big-under-mic">
            <input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Type your message..."
              className="text-input-field"
            />

            <button
              onClick={handleTextSend}
              className="text-send-button"
            >
              Send
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}

export default App;
