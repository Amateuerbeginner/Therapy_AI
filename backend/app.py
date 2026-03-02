from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import json
import logging
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv()

app = Flask(__name__)
CORS(app)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------- GEMINI SETUP ---------------- #

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

if not GOOGLE_API_KEY:
    logger.warning("GOOGLE_API_KEY not set. API calls may fail.")

genai.configure(api_key=GOOGLE_API_KEY)

model = genai.GenerativeModel("gemini-1.5-flash")

# ---------------- HEALTH ---------------- #

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "healthy"}), 200


# ---------------- SAFE GEMINI ---------------- #

def safe_generate(prompt):
    try:
        response = model.generate_content(prompt)

        if not response or not response.text:
            return None

        text = response.text.strip()
        text = text.replace("```json", "").replace("```", "")

        return text

    except Exception:
        logger.exception("Gemini API error")
        return None


# ---------------- EMOTION + STYLE ---------------- #

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
        logger.warning("Emotion JSON parse failed")

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

        # Step 1: emotion analysis
        emotion = analyze_emotion_and_style(message)

        # Step 2: therapy reply
        reply = generate_response(message, emotion)

        return jsonify({
            "reply": reply,
            "primary_emotion": emotion.get("primary_emotion", "neutral"),
            "overall_risk_level": "none",
            "rich_emotion": emotion
        })

    except Exception:
        logger.exception("Unexpected error in /therapy")

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
    app.run(host="0.0.0.0", port=5000)
