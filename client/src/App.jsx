import { useState, useRef, useEffect } from 'react';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function App() {
  const [messages, setMessages] = useState([
    {
      id: Date.now(),
      role: 'bot',
      content:
        '🧠 Voice Therapy Assistant\n\nSpeak when you are ready. I listen and respond by voice.\nEmergency (India): 9152987821',
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

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Pick TTS voice (prefer Indian English)
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;

    const pickVoice = () => {
      const voices = synth.getVoices();
      if (!voices || voices.length === 0) return;

      // Prefer en-IN or India-named voices
      let preferred =
        voices.find((v) => /en-IN/i.test(v.lang)) ||
        voices.find((v) => /India/i.test(v.name));

      // Fallback: any English female-ish voice
      if (!preferred) {
        preferred = voices.find(
          (v) =>
            /en-/i.test(v.lang) &&
            /female|woman|girl/i.test(v.name)
        );
      }

      ttsVoiceRef.current = preferred || voices[0];
    };

    pickVoice();
    if (synth.onvoiceschanged !== undefined) {
      synth.onvoiceschanged = pickVoice;
    }
  }, []);

  // Speech recognition with 3s silence-based sending (only last result)
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.log('Speech recognition not supported in this browser');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-IN';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      console.log('Voice recognition started');
      utteranceIdRef.current += 1;
      hasSentForUtteranceRef.current = false;
      setPendingText('');
      setLiveTranscript('');
    };

    recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalPhrase = '';

      // Use only last result entry to avoid duplicate phrases
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

      // Reset 3s silence timer
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }

      const currentUtteranceId = utteranceIdRef.current;

      silenceTimerRef.current = setTimeout(() => {
        if (currentUtteranceId !== utteranceIdRef.current) return;

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

    recognition.onerror = (event) => {
      console.log('Voice error:', event.error);
      if (event.error !== 'aborted') {
        setIsListening(false);
        setLiveTranscript('');
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      setPendingText('');
      hasSentForUtteranceRef.current = false;
    };

    recognition.onend = () => {
      console.log('Recognition ended');
      setLiveTranscript('');
      // no sending here; timer handles sending
    };

    recognitionRef.current = recognition;
  }, [isResponding]);

  const toggleMicrophone = () => {
    if (!recognitionRef.current || isResponding || isSpeaking) return;

    if (isListening) {
      // Stop listening
      try {
        recognitionRef.current.stop();
      } catch (err) {
        console.log('Error stopping recognition:', err);
      }
      setIsListening(false);
      setLiveTranscript('');
      setAutoListen(false);
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      setPendingText('');
      hasSentForUtteranceRef.current = false;
    } else {
      // Start listening
      setLiveTranscript('');
      setAutoListen(true);
      setPendingText('');
      hasSentForUtteranceRef.current = false;
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (err) {
        console.log('Error starting recognition:', err);
      }
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
    if (!userText || isResponding) return;

    setIsResponding(true);

    try {
      const response = await fetch(`${API_URL}/therapy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const replyText =
        data.reply || 'I am here with you. Please continue.';

      const primaryEmotion = data.primary_emotion || 'neutral';
      const overallRiskLevel = data.overall_risk_level || 'none';
      const richEmotion = data.rich_emotion || {};

      const replyId = Date.now() + Math.random();

      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'bot' && last.content === replyText) {
          return prev;
        }
        return [
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
        ];
      });

      const needsImmediateHelp = richEmotion.needs_immediate_help === true;
      const hopeless = richEmotion.hopelessness || 'none';
      const entrapment = richEmotion.entrapment_feeling || 'none';
      const extraSevere =
        (hopeless === 'severe' || hopeless === 'moderate') &&
        (entrapment === 'severe' || entrapment === 'moderate');

      speakResponse(
        replyText,
        primaryEmotion,
        overallRiskLevel,
        needsImmediateHelp || extraSevere
      );
    } catch (error) {
      console.error('API error:', error);
      const fallback =
        'There was a connection problem. If this feels like an emergency, please call 9152987821 in India or 988 in the USA.';
      const fallbackId = Date.now() + Math.random();
      setMessages((prev) => [
        ...prev,
        {
          id: fallbackId,
          role: 'bot',
          content: fallback,
          primaryEmotion: 'neutral',
          suicideRiskLevel: 'none',
          richEmotion: {},
          timestamp: Date.now(),
        },
      ]);
      speakResponse(fallback, 'neutral', 'none', false);
    } finally {
      setIsResponding(false);
    }
  };

  const speakResponse = (
    text,
    emotion = 'neutral',
    overallRisk = 'none',
    needsImmediateHelp = false
  ) => {
    if (!('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    if (ttsVoiceRef.current) {
      utterance.voice = ttsVoiceRef.current;
      utterance.lang = ttsVoiceRef.current.lang || 'en-IN';
    } else {
      utterance.lang = 'en-IN';
    }

    // Stronger risk-aware base
    let rate = 1.1;
    let pitch = 1.0;

    if (overallRisk === 'high' || needsImmediateHelp) {
      rate = 0.85;
      pitch = 0.85;
    } else if (overallRisk === 'medium') {
      rate = 0.95;
      pitch = 0.9;
    } else if (overallRisk === 'low') {
      rate = 1.05;
      pitch = 1.0;
    } else {
      // none
      rate = 1.15;
      pitch = 1.0;
    }

    // Emotion overlay when risk is not high
    if (overallRisk === 'none' || overallRisk === 'low') {
      if (
        emotion === 'sad' ||
        emotion === 'depressed' ||
        emotion === 'lonely'
      ) {
        rate = Math.min(rate, 1.0);
        pitch = 0.9;
      } else if (emotion === 'anxious' || emotion === 'stressed') {
        rate = Math.max(rate, 1.15);
        pitch = 1.05;
      } else if (emotion === 'angry') {
        rate = Math.max(rate, 1.2);
        pitch = 1.0;
      } else if (emotion === 'happy' || emotion === 'hopeful') {
        rate = Math.max(rate, 1.25);
        pitch = 1.1;
      }
    }

    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = 1.0;

    utterance.onstart = () => {
      setIsSpeaking(true);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (err) {
          console.log('Error stopping recognition before TTS:', err);
        }
      }
      setIsListening(false);
      setLiveTranscript('');
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      setPendingText('');
      hasSentForUtteranceRef.current = false;
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      if (autoListen && recognitionRef.current && !isResponding) {
        setLiveTranscript('');
        setPendingText('');
        hasSentForUtteranceRef.current = false;
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
        try {
          recognitionRef.current.start();
          setIsListening(true);
        } catch (err) {
          console.log('Error restarting recognition after TTS:', err);
        }
      }
    };

    window.speechSynthesis.speak(utterance);
  };

  const handleTextSend = () => {
    if (!inputText.trim() || isResponding) return;
    handleSend(inputText.trim());
    setInputText('');
  };

  return (
    <div className="app">
      <div className="chat-container">
        {/* Header */}
        <div className="header">
          <h1>🧠 Voice Therapy Assistant</h1>
          <p className="subtitle">
            Speak or type. I will listen and respond with care.
          </p>
        </div>

        {/* Messages */}
        <div className="messages-area">
          {messages.map((msg, idx) => (
            <div
              key={msg.id || idx}
              className={`message-container ${msg.role}`}
            >
              <div
                className={
                  'message-bubble ' +
                  (msg.primaryEmotion
                    ? `emotion-${msg.primaryEmotion}`
                    : '')
                }
              >
                <div className="message-text">{msg.content}</div>

                {msg.role === 'bot' && msg.primaryEmotion && (
                  <div className="emotion-meta">
                    <span className="emotion-tag">
                      {msg.primaryEmotion}
                    </span>
                    <span
                      className={`risk-tag risk-${msg.suicideRiskLevel}`}
                    >
                      {msg.suicideRiskLevel.replace('_', ' ')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Voice + Text Controls */}
        <div className="voice-control">
          <button
            onClick={toggleMicrophone}
            disabled={isResponding || isSpeaking}
            className={`voice-button ${
              isListening ? 'recording' : ''
            }`}
          >
            {isListening ? '🔴 Stop' : '🎤 Speak'}
          </button>

          <div className="voice-status">
            {isResponding
              ? 'AI is responding...'
              : isSpeaking
              ? 'AI is speaking...'
              : isListening
              ? (
                <>
                  Listening...
                  {liveTranscript && (
                    <span className="live-preview">
                      "{liveTranscript}"
                    </span>
                  )}
                </>
                )
              : 'Click Speak to start talking, or type below'}
          </div>

          <div className="text-input-wrapper big-under-mic">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTextSend();
              }}
              placeholder="Type your message here..."
              disabled={isResponding}
              className="text-input-field"
            />
            <button
              onClick={handleTextSend}
              disabled={!inputText.trim() || isResponding}
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

