from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import requests
import logging
from dotenv import load_dotenv
import json

load_dotenv()

app = Flask(__name__)
CORS(app)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PERPLEXITY_KEY = os.getenv("PERPLEXITY_API_KEY")
PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions"


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "healthy",
        "key_loaded": bool(PERPLEXITY_KEY)
    }), 200


def call_perplexity(payload):
    headers = {
        "Authorization": f"Bearer {PERPLEXITY_KEY}",
        "Content-Type": "application/json",
    }
    resp = requests.post(PERPLEXITY_URL, json=payload, headers=headers, timeout=20)
    logger.info(f"Perplexity status: {resp.status_code}")
    logger.info(f"Perplexity raw: {resp.text[:400]}")
    return resp


@app.route("/therapy", methods=["POST", "OPTIONS"])
def therapy():
    if request.method == "OPTIONS":
        return "", 204

    try:
        data = request.get_json() or {}
        message = (data.get("message") or "").strip()
        if not message:
            return jsonify({"error": "message is required"}), 400

        if not PERPLEXITY_KEY:
            logger.error("PERPLEXITY_API_KEY missing or not loaded")
            return jsonify({
                "reply": "Therapy engine is not configured correctly. Ask the developer to set PERPLEXITY_API_KEY.",
                "primary_emotion": "neutral",
                "overall_risk_level": "none",
                "rich_emotion": {}
            }), 500

        # -------- STEP 1: rich emotion + risk JSON --------
        emotion_prompt = f"""
You are assessing emotional state and suicide risk from a single chat message.

User message: "{message}"

1) Main and secondary emotions (sad, anxious, angry, lonely, hopeful, ashamed, guilty, etc.).
2) Emotional profile:
   - valence: negative | mixed | neutral | positive
   - arousal: low | medium | high
3) Suicidality (from text, including hidden cues):
   - suicidal_ideation: none | passive | active
   - suicide_plan: none | vague | specific
   - suicide_intent: none | low | medium | high
   - self_harm_risk: none | low | medium | high
4) Hidden risk markers (even if user never says "suicide"):
   - hopelessness: none | mild | moderate | severe
   - burdensomeness: none | mild | moderate | severe
   - entrapment_feeling: none | mild | moderate | severe
   - social_isolation: none | mild | moderate | severe
5) Based on ALL of the above, set:
   - overall_risk_level: none | low | medium | high
   - needs_immediate_help: true only if:
     * overall_risk_level is high, OR
     * suicidal_ideation is active with medium/high intent, OR
     * hidden markers show severe hopelessness PLUS severe entrapment.

Return ONLY valid JSON, no explanation:

{{
  "primary_emotion": "sad | anxious | angry | lonely | hopeful | neutral | ...",
  "secondary_emotions": ["...", "..."],
  "valence": "negative | mixed | neutral | positive",
  "arousal": "low | medium | high",
  "suicidal_ideation": "none | passive | active",
  "suicide_plan": "none | vague | specific",
  "suicide_intent": "none | low | medium | high",
  "self_harm_risk": "none | low | medium | high",
  "hopelessness": "none | mild | moderate | severe",
  "burdensomeness": "none | mild | moderate | severe",
  "entrapment_feeling": "none | mild | moderate | severe",
  "social_isolation": "none | mild | moderate | severe",
  "overall_risk_level": "none | low | medium | high",
  "needs_immediate_help": true
}}
"""

        emotion_payload = {
            "model": "sonar-pro",
            "messages": [{"role": "user", "content": emotion_prompt}],
            "max_tokens": 180,
            "temperature": 0.1,
            "stream": False
        }

        emotion_resp = call_perplexity(emotion_payload)

        rich_emotion = {
            "primary_emotion": "neutral",
            "secondary_emotions": [],
            "valence": "neutral",
            "arousal": "medium",
            "suicidal_ideation": "none",
            "suicide_plan": "none",
            "suicide_intent": "none",
            "self_harm_risk": "none",
            "hopelessness": "none",
            "burdensomeness": "none",
            "entrapment_feeling": "none",
            "social_isolation": "none",
            "overall_risk_level": "none",
            "needs_immediate_help": False
        }

        if emotion_resp.ok:
            try:
                raw = emotion_resp.json()["choices"][0]["message"]["content"]
                parsed = json.loads(raw)
                for k in rich_emotion.keys():
                    if k in parsed:
                        rich_emotion[k] = parsed[k]
            except Exception:
                logger.exception("Failed to parse emotion JSON, using defaults")

        primary_emotion = rich_emotion["primary_emotion"]
        overall_risk_level = rich_emotion["overall_risk_level"]

        # -------- STEP 2: therapy response using rich context --------
        therapy_prompt = f"""
You are a warm, empathetic therapist in a voice-based assistant.

User message: "{message}"

AI emotion + risk analysis:
- primary_emotion: {rich_emotion['primary_emotion']}
- secondary_emotions: {rich_emotion['secondary_emotions']}
- valence: {rich_emotion['valence']}
- arousal: {rich_emotion['arousal']}
- suicidal_ideation: {rich_emotion['suicidal_ideation']}
- suicide_plan: {rich_emotion['suicide_plan']}
- suicide_intent: {rich_emotion['suicide_intent']}
- self_harm_risk: {rich_emotion['self_harm_risk']}
- overall_risk_level: {rich_emotion['overall_risk_level']}
- needs_immediate_help: {rich_emotion['needs_immediate_help']}

Guidelines:
1. Start by validating how they feel in a very human, conversational way.
2. Ask ONE gentle, open question that helps them go deeper.
3. If overall_risk_level is medium or high OR needs_immediate_help is true:
   - Slow down the tone and focus on safety.
   - Encourage reaching out to a trusted person.
   - Suggest contacting a helpline if they feel unsafe.
   - Do NOT describe methods or give instructions.
4. Keep replies under 120 words.
5. Do NOT diagnose, label disorders, or mention being an AI model.
"""

        therapy_payload = {
            "model": "sonar-pro",
            "messages": [{"role": "user", "content": therapy_prompt}],
            "max_tokens": 250,
            "temperature": 0.7,
            "stream": False
        }

        therapy_resp = call_perplexity(therapy_payload)

        if not therapy_resp.ok:
            return jsonify({
                "reply": "I'm here with you. It sounds like a lot. If this feels overwhelming or unsafe, please reach out to someone you trust or call 9152987821 in India.",
                "primary_emotion": primary_emotion,
                "overall_risk_level": overall_risk_level,
                "rich_emotion": rich_emotion
            }), 503

        reply_text = therapy_resp.json()["choices"][0]["message"]["content"]

        return jsonify({
            "reply": reply_text,
            "primary_emotion": primary_emotion,
            "overall_risk_level": overall_risk_level,
            "rich_emotion": rich_emotion
        })

    except Exception:
        logger.exception("Unexpected error in /therapy")
        return jsonify({
            "reply": "I'm here listening. If this feels like an emergency, call 9152987821 (India) or 988 (USA).",
            "primary_emotion": "neutral",
            "overall_risk_level": "none",
            "rich_emotion": {}
        }), 500


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": "Server error"}), 500


if __name__ == "__main__":
    debug_mode = os.getenv("FLASK_ENV") == "development"
    app.run(host="0.0.0.0", port=5000, debug=debug_mode)

