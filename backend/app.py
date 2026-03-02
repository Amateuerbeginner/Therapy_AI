from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import json
import logging
import requests
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

if not GOOGLE_API_KEY:
    raise ValueError("GOOGLE_API_KEY not set")


# ---------------- HEALTH CHECK ---------------- #

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "healthy"}), 200


# ---------------- GEMINI REST CALL ---------------- #

def safe_generate(prompt):

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key={GOOGLE_API_KEY}"

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt}
                ]
            }
        ]
    }

    try:
        resp = requests.post(url, json=payload, timeout=20)

        if resp.status_code != 200:
            logger.error("Gemini API error: %s", resp.text)
            return None

        data = resp.json()

        text = data["candidates"][0]["content"]["parts"][0]["text"]

        text = text.replace("```json", "").replace("```", "").strip()

        return text

    except Exception:
        logger.exception("Gemini REST error")
        return None


# ---------------- EMOTION ANALYSIS ---------------- #

def analyze_emotion_and_style(message):

    prompt = f"""
You are an emotion analysis system for a therapy AI.

User message:
{message}

Tasks:
1. Detect the user's emotional state
2. Decide the best therapeutic response emotion

Return ONLY valid JSON.

Format:

{{
"primary_emotion": "",
"secondary_emotions": [],
"valence": "positive|neutral|negative",
"arousal": "low|medium|high",
"response_emotion": "calming|supportive|encouraging|empathetic",
"voice_tone": "soft|warm|calm|supportive"
}}
"""

    text = safe_generate(prompt)

    if not text:
        return {
            "primary_emotion": "neutral",
            "secondary_emotions": [],
            "valence": "neutral",
            "arousal": "medium",
            "response_emotion": "supportive",
            "voice_tone": "soft"
        }

    try:
        return json.loads(text)

    except Exception:
        logger.warning("Emotion JSON parse failed")

        return {
            "primary_emotion": "neutral",
            "secondary_emotions": [],
            "valence": "neutral",
            "arousal": "medium",
            "response_emotion": "supportive",
            "voice_tone": "soft"
        }


# ---------------- RESPONSE GENERATION ---------------- #

def generate_response(message, emotion):

    prompt = f"""
You are a compassionate AI therapist.

User message:
{message}

Emotion analysis:
{json.dumps(emotion)}

Write a warm supportive therapy reply.

Rules:
- validate the user's feelings
- be empathetic and natural
- avoid sounding robotic
- ask ONE gentle follow-up question
- under 120 words

Response tone must match:

response_emotion: {emotion.get("response_emotion")}
voice_tone: {emotion.get("voice_tone")}
"""

    text = safe_generate(prompt)

    if not text:
        return "I'm here with you. Do you want to tell me more about what's been going on?"

    return text


# ---------------- MAIN ENDPOINT ---------------- #

@app.route("/therapy", methods=["POST", "OPTIONS"])
def therapy():

    if request.method == "OPTIONS":
        return "", 204

    try:
        data = request.get_json() or {}

        message = (data.get("message") or "").strip()

        if not message:
            return jsonify({"error": "message required"}), 400

        emotion = analyze_emotion_and_style(message)

        reply = generate_response(message, emotion)

        return jsonify({
            "reply": reply,
            "primary_emotion": emotion.get("primary_emotion", "neutral"),
            "overall_risk_level": "none",
            "rich_emotion": emotion
        })

    except Exception:
        logger.exception("Server error")

        return jsonify({
            "reply": "I'm here listening. Please tell me more.",
            "primary_emotion": "neutral",
            "overall_risk_level": "none",
            "rich_emotion": {}
        }), 500


# ---------------- ERROR HANDLERS ---------------- #

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "not found"}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": "server error"}), 500


# ---------------- RUN SERVER ---------------- #

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
