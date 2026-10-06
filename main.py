import os
import threading
import base64
import urllib.parse
import urllib.request
from typing import Optional
from pydantic import BaseModel
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import cv2
import numpy as np
from insightface.app import FaceAnalysis

app = FastAPI(title="Campus Track - Face Verification Backend")

# Enable CORS so your frontend HTML can communicate with this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
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

# Global holder and thread lock for lazy initialization
_face_app = None
_model_lock = threading.Lock()

def get_face_app():
    """Lazily loads and caches the lightweight FaceAnalysis model on first request.
    Prevents memory spikes and timeout during uvicorn startup on constrained environments (Render 512MB free tier).
    """
    global _face_app
    if _face_app is None:
        with _model_lock:
            if _face_app is None:
                # Use lightweight 'buffalo_s' (~20MB total model weights vs ~350MB for 'buffalo_l')
                model_name = os.getenv("INSIGHTFACE_MODEL", "buffalo_s")
                det_size = int(os.getenv("DET_SIZE", "640"))

                print(f"[Backend] Lazily initializing InsightFace with model: '{model_name}' (det_size: {det_size}x{det_size})...")
                face_analysis = FaceAnalysis(name=model_name, providers=["CPUExecutionProvider"])
                face_analysis.prepare(ctx_id=-1, det_size=(det_size, det_size))
                _face_app = face_analysis
                app.state.app_face = face_analysis
                print("[Backend] InsightFace initialized successfully.")
    return _face_app


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
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            raise HTTPException(status_code=400, detail="Invalid image file.")

        # Lazily obtain the model instance (loads only once on first request)
        face_app = get_face_app()

        # Detect faces and extract deep embeddings
        faces = face_app.get(img)

        if len(faces) == 0:
            return {"status": "no_face_detected"}

        # Return details of the detected face(s)
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


@app.post("/api/send-alert")
async def send_hod_alert(payload: HODAlertRequest):
    try:
        evidence_dir = os.path.join(STATIC_DIR, "evidence")
        os.makedirs(evidence_dir, exist_ok=True)

        saved_files = []
        clean_reg = "".join(c for c in payload.regNo if c.isalnum() or c in ("-", "_")) or "unknown"
        clean_id = "".join(c for c in payload.incidentId if c.isalnum() or c in ("-", "_")) or "inc"

        # Save live camera snapshot to disk if provided as data URL
        if payload.livePhoto and payload.livePhoto.startswith("data:"):
            try:
                _, b64data = payload.livePhoto.split(",", 1)
                img_data = base64.b64decode(b64data)
                live_filename = f"{clean_id}_{clean_reg}_live.jpg"
                live_path = os.path.join(evidence_dir, live_filename)
                with open(live_path, "wb") as f:
                    f.write(img_data)
                saved_files.append(f"/static/evidence/{live_filename}")
            except Exception as e:
                print(f"[Alert] Error saving live photo: {e}")

        # Send via WhatsApp API Gateway if credentials exist (e.g. UltraMsg)
        ultramsg_instance = os.getenv("ULTRAMSG_INSTANCE_ID")
        ultramsg_token = os.getenv("ULTRAMSG_TOKEN")
        if ultramsg_instance and ultramsg_token and payload.hodPhone:
            try:
                clean_phone = "".join(c for c in payload.hodPhone if c.isdigit())
                msg_data = urllib.parse.urlencode({
                    "token": ultramsg_token,
                    "to": clean_phone,
                    "body": payload.message
                }).encode("utf-8")
                req = urllib.request.Request(
                    f"https://api.ultramsg.com/{ultramsg_instance}/messages/chat",
                    data=msg_data,
                    headers={"Content-Type": "application/x-www-form-urlencoded"}
                )
                urllib.request.urlopen(req, timeout=5)

                if payload.livePhoto:
                    photo_data = urllib.parse.urlencode({
                        "token": ultramsg_token,
                        "to": clean_phone,
                        "image": payload.livePhoto,
                        "caption": f"Live Camera Snapshot - {payload.studentName} ({payload.regNo})"
                    }).encode("utf-8")
                    req_img = urllib.request.Request(
                        f"https://api.ultramsg.com/{ultramsg_instance}/messages/image",
                        data=photo_data,
                        headers={"Content-Type": "application/x-www-form-urlencoded"}
                    )
                    urllib.request.urlopen(req_img, timeout=5)
            except Exception as e:
                print(f"[Alert] UltraMsg dispatch error: {e}")

        print(f"[Alert] Direct HOD alert processed successfully for {payload.studentName} ({payload.regNo}) -> HOD Phone: {payload.hodPhone}")
        return {
            "status": "success",
            "message": f"Alert processed for HOD ({payload.hodPhone})",
            "incidentId": payload.incidentId,
            "savedEvidence": saved_files
        }
    except Exception as e:
        return {"status": "error", "detail": str(e)}


def get_app_html():
    """Returns the path to the main application HTML file, checking multiple names for compatibility."""
    if os.path.isdir(STATIC_DIR):
        for candidate in ["index.html", "campustrack.html", "campus track.html"]:
            p = os.path.join(STATIC_DIR, candidate)
            if os.path.isfile(p):
                return p
    raise HTTPException(status_code=404, detail="Frontend application HTML file not found.")


@app.get("/")
async def serve_index():
    """Serves your frontend mobile web application directly at the root URL."""
    return FileResponse(get_app_html())


# Direct routes for all filename variations so no link or bookmark throws 404
@app.get("/campustrack.html")
@app.get("/campus track.html")
@app.get("/campus%20track.html")
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
        return FileResponse(p)
    raise HTTPException(status_code=404, detail="sw.js not found")


# Mount static files and subdirectories
if os.path.isdir(STATIC_DIR):
    css_path = os.path.join(STATIC_DIR, "css")
    js_path = os.path.join(STATIC_DIR, "js")
    if os.path.isdir(css_path):
        app.mount("/css", StaticFiles(directory=css_path), name="css")
    if os.path.isdir(js_path):
        app.mount("/js", StaticFiles(directory=js_path), name="js")
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

if __name__ == "__main__":
    import uvicorn
    print("\n[CampusTrack AI] Server started at http://localhost:8080 (Press Ctrl+C to stop)\n")
    uvicorn.run(app, host="0.0.0.0", port=8080)