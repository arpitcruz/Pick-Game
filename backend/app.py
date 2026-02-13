"""
Pick Game — Python Flask Backend
Auth (register/login) + Scores + Leaderboard + Stages
Uses stdlib hashlib/hmac for tokens (no pyjwt/bcrypt deps)
"""

import os
import sqlite3
import hashlib
import hmac
import json
import time
import secrets
from functools import wraps

from flask import Flask, request, jsonify, g
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

SECRET_KEY = os.environ.get("SECRET_KEY", secrets.token_hex(32))
DB_PATH = os.path.join(os.path.dirname(__file__), "pickgame.db")

# ──────────────────── Stage definitions ────────────────────
STAGES = {
    1: {
        "name": "Easy Pickings",
        "duration": 45,
        "pendulum_speed": 0.025,
        "max_swing": 1.1,
        "coin_ratio": 0.70,
        "gift_chance": 0.10,
        "item_count": 8,
        "required_score": 0,
    },
    2: {
        "name": "Getting Tricky",
        "duration": 40,
        "pendulum_speed": 0.032,
        "max_swing": 1.2,
        "coin_ratio": 0.60,
        "gift_chance": 0.08,
        "item_count": 9,
        "required_score": 100,
    },
    3: {
        "name": "Speed Demon",
        "duration": 35,
        "pendulum_speed": 0.040,
        "max_swing": 1.3,
        "coin_ratio": 0.50,
        "gift_chance": 0.06,
        "item_count": 10,
        "required_score": 300,
    },
    4: {
        "name": "Bomb Storm",
        "duration": 30,
        "pendulum_speed": 0.048,
        "max_swing": 1.35,
        "coin_ratio": 0.40,
        "gift_chance": 0.05,
        "item_count": 11,
        "required_score": 600,
    },
    5: {
        "name": "Master Grab",
        "duration": 25,
        "pendulum_speed": 0.055,
        "max_swing": 1.4,
        "coin_ratio": 0.35,
        "gift_chance": 0.04,
        "item_count": 12,
        "required_score": 1000,
    },
}

# ──────────────────── Password hashing (stdlib) ────────────────────
def hash_password(password):
    salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000)
    return salt + ":" + hashed.hex()


def verify_password(password, stored):
    parts = stored.split(":", 1)
    if len(parts) != 2:
        return False
    salt, expected_hex = parts
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000)
    return hmac.compare_digest(hashed.hex(), expected_hex)


# ──────────────────── Token (HMAC-based, no JWT needed) ────────────────────
def create_token(user_id, username):
    payload = json.dumps({"user_id": user_id, "username": username, "exp": int(time.time()) + 86400 * 30})
    sig = hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return payload.encode().hex() + "." + sig


def decode_token(token):
    try:
        parts = token.split(".", 1)
        if len(parts) != 2:
            return None
        payload_hex, sig = parts
        payload_bytes = bytes.fromhex(payload_hex)
        expected_sig = hmac.new(SECRET_KEY.encode(), payload_bytes, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None
        data = json.loads(payload_bytes.decode())
        if data.get("exp", 0) < time.time():
            return None
        return data
    except Exception:
        return None


# ──────────────────── Database ────────────────────
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            username    TEXT UNIQUE NOT NULL,
            password    TEXT NOT NULL,
            best_score  INTEGER DEFAULT 0,
            total_score INTEGER DEFAULT 0,
            max_stage   INTEGER DEFAULT 1,
            created_at  TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS scores (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            stage      INTEGER NOT NULL,
            score      INTEGER NOT NULL,
            coins      INTEGER DEFAULT 0,
            bombs      INTEGER DEFAULT 0,
            max_combo  INTEGER DEFAULT 0,
            played_at  TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
    """)
    db.close()


# ──────────────────── Auth decorator ────────────────────
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        token = auth[7:] if auth.startswith("Bearer ") else None
        if not token:
            return jsonify({"error": "Token required"}), 401
        data = decode_token(token)
        if not data:
            return jsonify({"error": "Invalid or expired token"}), 401
        g.user_id = data["user_id"]
        g.username = data["username"]
        return f(*args, **kwargs)
    return decorated


# ──────────────────── Auth routes ────────────────────
@app.route("/api/register", methods=["POST"])
def register():
    data = request.get_json() or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not username or len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters"}), 400
    if len(password) < 4:
        return jsonify({"error": "Password must be at least 4 characters"}), 400

    hashed = hash_password(password)
    db = get_db()
    try:
        db.execute("INSERT INTO users (username, password) VALUES (?, ?)", (username, hashed))
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"error": "Username already taken"}), 409

    user = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    token = create_token(user["id"], username)
    return jsonify({"token": token, "username": username, "best_score": 0, "total_score": 0, "max_stage": 1}), 201


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json() or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not user or not verify_password(password, user["password"]):
        return jsonify({"error": "Invalid username or password"}), 401

    token = create_token(user["id"], username)
    return jsonify({
        "token": token,
        "username": user["username"],
        "best_score": user["best_score"],
        "total_score": user["total_score"],
        "max_stage": user["max_stage"],
    })


# ──────────────────── Profile ────────────────────
@app.route("/api/me", methods=["GET"])
@token_required
def get_profile():
    db = get_db()
    user = db.execute("SELECT username, best_score, total_score, max_stage FROM users WHERE id = ?",
                      (g.user_id,)).fetchone()
    if not user:
        return jsonify({"error": "User not found"}), 404
    return jsonify(dict(user))


# ──────────────────── Stages ────────────────────
@app.route("/api/stages", methods=["GET"])
@token_required
def get_stages():
    db = get_db()
    user = db.execute("SELECT max_stage, total_score FROM users WHERE id = ?", (g.user_id,)).fetchone()
    stages_out = []
    for num, cfg in STAGES.items():
        unlocked = user["total_score"] >= cfg["required_score"]
        stages_out.append({
            "stage": num,
            "name": cfg["name"],
            "unlocked": unlocked,
            "required_score": cfg["required_score"],
            "duration": cfg["duration"],
            "pendulum_speed": cfg["pendulum_speed"],
            "max_swing": cfg["max_swing"],
            "coin_ratio": cfg["coin_ratio"],
            "gift_chance": cfg["gift_chance"],
            "item_count": cfg["item_count"],
        })
    return jsonify({"stages": stages_out, "total_score": user["total_score"]})


# ──────────────────── Score submission ────────────────────
@app.route("/api/scores", methods=["POST"])
@token_required
def submit_score():
    data = request.get_json() or {}
    stage = data.get("stage", 1)
    score = data.get("score", 0)
    coins = data.get("coins", 0)
    bombs = data.get("bombs", 0)
    max_combo = data.get("max_combo", 0)

    if stage not in STAGES:
        return jsonify({"error": "Invalid stage"}), 400

    db = get_db()
    db.execute(
        "INSERT INTO scores (user_id, stage, score, coins, bombs, max_combo) VALUES (?, ?, ?, ?, ?, ?)",
        (g.user_id, stage, score, coins, bombs, max_combo),
    )

    user = db.execute("SELECT best_score, total_score, max_stage FROM users WHERE id = ?",
                      (g.user_id,)).fetchone()
    new_best = user["best_score"]
    new_total = user["total_score"] + score
    is_new_best = False

    if score > new_best:
        new_best = score
        is_new_best = True

    new_max_stage = 1
    for num, cfg in STAGES.items():
        if new_total >= cfg["required_score"]:
            new_max_stage = num

    db.execute("UPDATE users SET best_score = ?, total_score = ?, max_stage = ? WHERE id = ?",
               (new_best, new_total, new_max_stage, g.user_id))
    db.commit()

    return jsonify({
        "is_new_best": is_new_best,
        "best_score": new_best,
        "total_score": new_total,
        "max_stage": new_max_stage,
    })


# ──────────────────── Leaderboard ────────────────────
@app.route("/api/leaderboard", methods=["GET"])
def leaderboard():
    db = get_db()
    rows = db.execute(
        "SELECT username, best_score, total_score FROM users ORDER BY best_score DESC LIMIT 20"
    ).fetchall()
    return jsonify({"leaderboard": [dict(r) for r in rows]})


# ──────────────────── Boot ────────────────────
init_db()

if __name__ == "__main__":
    print("Pick Game backend running on http://0.0.0.0:5000")
    app.run(host="0.0.0.0", port=5000, debug=True)
