import os
import re
import time
import uuid
import threading
import base64
import urllib.parse
import urllib.request
from collections import defaultdict, deque
from typing import Optional
from pydantic import BaseModel
from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
import cv2
import numpy as np

app = FastAPI(title="Campus Track - Face Verification Backend")

# CORS: the bundled frontend is served by this same server, so same-origin requests need no CORS.
# Set ALLOWED_ORIGINS="https://your-site.com,https://other.com" to restrict cross-origin callers.
# The default "*" keeps older setups (frontend hosted elsewhere) working.
_origins_env = os.getenv("ALLOWED_ORIGINS", "*").strip()
ALLOWED_ORIGINS = ["*"] if _origins_env == "*" else [o.strip() for o in _origins_env.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Resolve static directory path safely (works if run from repo root or subfolder)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if os.path.isdir(os.path.join(BASE_DIR, "static")):
    STATIC_DIR = os.path.join(BASE_DIR, "static")
elif os.path.isdir(os.path.join(BASE_DIR, "..", "static")):
    STATIC_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "static"))
elif os.path.isdir("static"):
    STATIC_DIR = os.path.abspath("static")
else:
    STATIC_DIR = "static"

# Evidence photos contain student faces. They are stored OUTSIDE the public static folder and
# are never mounted as a web route. (On Render's free tier this disk is wiped on every restart.)
EVIDENCE_DIR = os.getenv("EVIDENCE_DIR", os.path.join(BASE_DIR, "evidence"))

# Optional shared secret for /api/send-alert. If ALERT_API_KEY is set, callers must send it
# in the "X-API-Key" header. Leave unset for the bundled same-origin frontend.
ALERT_API_KEY = os.getenv("ALERT_API_KEY", "").strip()

# Simple in-memory rate limit so the alert endpoint cannot be used to spam WhatsApp.
RATE_LIMIT_MAX = int(os.getenv("ALERT_RATE_LIMIT", "20"))      # requests ...
RATE_LIMIT_WINDOW = int(os.getenv("ALERT_RATE_WINDOW", "60"))  # ... per this many seconds, per IP
_rate_hits = defaultdict(deque)
_rate_lock = threading.Lock()

# Global holder and thread lock for lazy initialization
_face_app = None
_model_lock = threading.Lock()


def _rate_limited(client_id: str) -> bool:
    now = time.monotonic()
    with _rate_lock:
        hits = _rate_hits[client_id]
        while hits and now - hits[0] > RATE_LIMIT_WINDOW:
            hits.popleft()
        if len(hits) >= RATE_LIMIT_MAX:
            return True
        hits.append(now)
        return False


def get_face_app():
    """Lazily loads and caches the InsightFace model on first /verify-face request.
    InsightFace is OPTIONAL: the bundled web app does its own face recognition in the browser
    (face-api.js) and never calls this endpoint. Install requirements-insightface.txt only if
    you want the server-side /verify-face detector.
    """
    global _face_app
    if _face_app is None:
        with _model_lock:
            if _face_app is None:
                try:
                    from insightface.app import FaceAnalysis
                except ImportError as import_error:
                    raise HTTPException(
                        status_code=503,
                        detail="InsightFace is not installed. Run: pip install -r requirements-insightface.txt and restart the server."
                    ) from import_error

                # 'buffalo_s' is the smaller model pack (much lighter than 'buffalo_l'); its files are
                # downloaded automatically on first use, so the first request needs internet access.
                model_name = os.getenv("INSIGHTFACE_MODEL", "buffalo_s")
                det_size = int(os.getenv("DET_SIZE", "640"))

                print(f"[Backend] Lazily initializing InsightFace with model: '{model_name}' (det_size: {det_size}x{det_size})...")
                face_analysis = FaceAnalysis(name=model_name, providers=["CPUExecutionProvider"])
                face_analysis.prepare(ctx_id=-1, det_size=(det_size, det_size))
                _face_app = face_analysis
                app.state.app_face = face_analysis
                print("[Backend] InsightFace initialized successfully.")
    return _face_app


def _detect_faces(img):
    """CPU-heavy work; always called through run_in_threadpool so it never blocks the event loop."""
    face_app = get_face_app()
    return face_app.get(img)


@app.get("/health")
def health_check():
    """Lightweight health check endpoint for Render/uptime monitors without triggering model loading."""
    return {
        "status": "ok",
        "model_loaded": _face_app is not None
    }


@app.post("/verify-face")
async def verify_face(file: UploadFile = File(...)):
    try:
        # Read the uploaded image from the frontend camera snapshot
        contents = await file.read()
        if len(contents) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Image too large (max 10 MB).")
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            raise HTTPException(status_code=400, detail="Invalid image file.")

        # Run model loading + inference in a worker thread so other requests keep being served.
        faces = await run_in_threadpool(_detect_faces, img)

        if len(faces) == 0:
            return {"status": "no_face_detected"}

        detected_results = []
        for face in faces:
            detected_results.append({
                "bbox": face.bbox.tolist(),
                "det_score": float(face.det_score)
            })

        return {"status": "success", "faces": detected_results}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class HODAlertRequest(BaseModel):
    hodPhone: str
    hodName: Optional[str] = "HOD"
    hodEmail: Optional[str] = None
    studentName: str
    regNo: str
    department: Optional[str] = ""
    year: Optional[int] = 0
    section: Optional[str] = ""
    location: Optional[str] = "Campus Grounds"
    period: Optional[str] = ""
    timeRange: Optional[str] = ""
    faculty: Optional[str] = ""
    incidentId: str
    message: str
    masterPhoto: Optional[str] = None
    livePhoto: Optional[str] = None
    compositeFrame: Optional[str] = None  # sent by the frontend; accepted but not stored


def _post_form(url: str, fields: dict):
    data = urllib.parse.urlencode(fields).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    with urllib.request.urlopen(req, timeout=8) as resp:
        resp.read()


# Plain "def" (not "async def"): FastAPI runs it in a worker thread, so the blocking
# urllib calls to the WhatsApp gateway no longer freeze the whole server.
@app.post("/api/send-alert")
def send_hod_alert(payload: HODAlertRequest, request: Request):
    if ALERT_API_KEY and request.headers.get("x-api-key", "") != ALERT_API_KEY:
        return JSONResponse(status_code=401, content={"status": "error", "detail": "Invalid or missing API key."})

    client_ip = request.client.host if request.client else "unknown"
    if _rate_limited(client_ip):
        return JSONResponse(status_code=429, content={"status": "error", "detail": "Too many alerts. Please wait a minute."})

    try:
        saved_files = []
        clean_reg = "".join(c for c in payload.regNo if c.isalnum() or c in ("-", "_")) or "unknown"
        clean_id = "".join(c for c in payload.incidentId if c.isalnum() or c in ("-", "_")) or "inc"

        # Save live camera snapshot to the private evidence folder if provided as a data URL.
        # The random suffix makes file names unguessable.
        if payload.livePhoto and payload.livePhoto.startswith("data:"):
            try:
                os.makedirs(EVIDENCE_DIR, exist_ok=True)
                _, b64data = payload.livePhoto.split(",", 1)
                img_data = base64.b64decode(b64data)
                live_filename = f"{clean_id}_{clean_reg}_{uuid.uuid4().hex[:8]}_live.jpg"
                with open(os.path.join(EVIDENCE_DIR, live_filename), "wb") as f:
                    f.write(img_data)
                saved_files.append(live_filename)
            except Exception as e:
                print(f"[Alert] Error saving live photo: {e}")

        delivery = "not_configured"
        errors = []

        # Send via WhatsApp API Gateway if credentials exist (e.g. UltraMsg)
        ultramsg_instance = os.getenv("ULTRAMSG_INSTANCE_ID")
        ultramsg_token = os.getenv("ULTRAMSG_TOKEN")
        if ultramsg_instance and ultramsg_token and payload.hodPhone:
            clean_phone = "".join(c for c in payload.hodPhone if c.isdigit())
            safe_instance = re.sub(r"[^A-Za-z0-9_\-]", "", ultramsg_instance)
            try:
                _post_form(
                    f"https://api.ultramsg.com/{safe_instance}/messages/chat",
                    {"token": ultramsg_token, "to": clean_phone, "body": payload.message},
                )
                delivery = "sent"
            except Exception as e:
                delivery = "failed"
                errors.append(f"text: {e}")
                print(f"[Alert] UltraMsg text dispatch error: {e}")

            if payload.livePhoto:
                try:
                    _post_form(
                        f"https://api.ultramsg.com/{safe_instance}/messages/image",
                        {
                            "token": ultramsg_token,
                            "to": clean_phone,
                            "image": payload.livePhoto,
                            "caption": f"Live Camera Snapshot - {payload.studentName} ({payload.regNo})",
                        },
                    )
                except Exception as e:
                    errors.append(f"image: {e}")
                    print(f"[Alert] UltraMsg image dispatch error: {e}")

        print(f"[Alert] HOD alert processed for {payload.studentName} ({payload.regNo}) delivery={delivery}")
        if delivery == "failed":
            return JSONResponse(
                status_code=502,
                content={
                    "status": "error",
                    "detail": "WhatsApp gateway call failed: " + "; ".join(errors),
                    "incidentId": payload.incidentId,
                    "savedEvidence": saved_files,
                },
            )
        return {
            "status": "success",
            "delivery": delivery,
            "message": f"Alert processed for HOD ({payload.hodPhone})",
            "incidentId": payload.incidentId,
            "savedEvidence": saved_files,
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "detail": str(e)})


def get_app_html():
    """Returns the path to the main application HTML file, checking multiple names for compatibility."""
    if os.path.isdir(STATIC_DIR):
        for candidate in ["index.html", "campustrack.html", "campus-track.html", "campus track.html"]:
            p = os.path.join(STATIC_DIR, candidate)
            if os.path.isfile(p):
                return p
    raise HTTPException(status_code=404, detail="Frontend application HTML file not found.")


@app.get("/")
async def serve_index():
    """Serves your frontend mobile web application directly at the root URL."""
    return FileResponse(get_app_html())


# Direct routes for the filename variations so older links or bookmarks do not 404.
# (A space in the URL arrives already decoded, so "/campus track.html" covers "%20" too.)
@app.get("/index.html")
@app.get("/campustrack.html")
@app.get("/campus-track.html")
@app.get("/campus track.html")
async def serve_campustrack_pages():
    return FileResponse(get_app_html())


@app.get("/manifest.json")
async def serve_manifest():
    p = os.path.join(STATIC_DIR, "manifest.json")
    if os.path.isfile(p):
        return FileResponse(p)
    raise HTTPException(status_code=404, detail="manifest.json not found")


@app.get("/sw.js")
async def serve_sw():
    p = os.path.join(STATIC_DIR, "sw.js")
    if os.path.isfile(p):
        # No long-lived caching of the service worker file itself, so updates are detected.
        return FileResponse(p, media_type="application/javascript", headers={"Cache-Control": "no-cache"})
    raise HTTPException(status_code=404, detail="sw.js not found")


# Mount static files and subdirectories
if os.path.isdir(STATIC_DIR):
    for _name in ("css", "js", "icons"):
        _path = os.path.join(STATIC_DIR, _name)
        if os.path.isdir(_path):
            app.mount(f"/{_name}", StaticFiles(directory=_path), name=_name)
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8080"))
    print(f"\n[CampusTrack AI] Server started at http://localhost:{port} (Press Ctrl+C to stop)\n")
    uvicorn.run(app, host="0.0.0.0", port=port)
