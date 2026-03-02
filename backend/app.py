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


# ---------------- HEALTH ---------------- #

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "healthy"}), 200


# ---------------- GEMINI REST CALL ---------------- #

def safe_generate(prompt):

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={GOOGLE_API_KEY}"

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

        if not resp.ok:
            logger.error(resp.text)
            return None

        data = resp.json()

        text = data["candidates"][0]["content"]["parts"][0]["text"]

        text = text.replace("```json", "").replace("```", "")

        return text.strip()

    except Exception:
        logger.exception("Gemini REST error")
        return None


# ---------------- EMOTION ANALYSIS ---------------- #

def analyze_emotion_and_style(message):

    prompt = f"""
User message:
"{message}"

1. Detect the user's emotional state
2. Decide the best therapist response tone

Return ONLY JSON:

{{
 "primary_emotion":"",
 "secondary_emotions":[],
 "valence":"positive|neutral|negative",
 "arousal":"low|medium|high",
 "response_emotion":"",
 "voice_tone":"soft|warm|calm|supportive"
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
        logger.warning("JSON parse failed")

        return {
            "primary_emotion": "neutral",
            "secondary_emotions": [],
            "valence": "neutral",
            "arousal": "medium",
            "response_emotion": "supportive",
            "voice_tone": "soft"
        }


# ---------------- THERAPY RESPONSE ---------------- #

def generate_response(message, emotion):

    prompt = f"""
User message:
"{message}"

Emotion analysis:
{emotion}

Write a warm supportive therapy reply.

Rules:
- under 120 words
- validate feelings
- sound natural
- ask one gentle question
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
