# CampusTrack Face + Eye Detection — Fixes Applied (v6)

## What was changed

1. **Reliable model initialization**
   - The scanner no longer reports AI as ready unless the face detector, recognition model, and landmark model all load.
   - It tries the tiny facial-landmark model first and uses the full landmark model as a fallback.
   - TensorFlow attempts WebGL and falls back to CPU if the browser cannot initialize WebGL.

2. **Face and eye-region overlay**
   - The existing face-box and left/right eye-region overlay can now rely on a successfully loaded landmark model.
   - Eye-region outlines/reticles are landmark guides, not a medical-grade iris/pupil tracker.

3. **Safer student face enrollment**
   - Removed silent enrollment to the hardcoded demo register number from the quick-enrollment path.
   - The operator must enter a register number and confirm the student before attaching a new sample.
   - Up to three real face descriptors are retained to help accommodate angle, lighting, and appearance changes.
   - Enrollment updates the cloud roster when cloud sync is available and no longer creates an incident merely because a face was enrolled.

4. **Firebase startup and student roster sync**
   - Anonymous authentication is awaited before attaching Firestore listeners.
   - An empty first cloud snapshot will not immediately overwrite a roster already saved on the current device; saved local entries are seeded to the empty collection.
   - Student images are resized/compressed before cloud storage. Firebase Storage is preferred; if a Storage upload is not permitted, the compressed image data is used as a fallback.
   - The service-worker cache name was incremented so browsers can fetch the updated script files.

5. **Backend startup and CORS**
   - InsightFace is imported only when `/verify-face` is called, allowing the health endpoint and web frontend to start even if the optional InsightFace package is missing.
   - `/verify-face` returns a clear HTTP 503 error when InsightFace is not installed.
   - Disabled wildcard CORS credentials, which browsers reject as an invalid combination.
   - The root and `roaming-detector-backend` copies are kept in sync.

## Run on Windows

Open a terminal in the `student-roaming-detector` folder and run:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080
```

Then open `http://localhost:8080` in Chrome or Edge. Allow camera permission. Face-API model weights are downloaded from the configured external model sources, so an internet connection is needed when models are not cached.

If you run the alternate copy, change into `roaming-detector-backend` before running the same commands.

## Checks completed in this package

- `node --check` passed for every JavaScript file in the primary frontend.
- Python compilation passed for both `main.py` files.
- FastAPI smoke tests returned HTTP 200 for `/health`, `/`, `/js/face-ai.js`, and `/manifest.json`.

## Important limits / deployment setup

- Face recognition is not guaranteed to distinguish identical twins. Ambiguous matches should be rejected and manually checked.
- Additional current enrollment photos can help with baldness or hairstyle changes, but cannot guarantee identification under every lighting, pose, blur, or occlusion condition.
- The face/eye overlay shows facial landmarks and eye regions. It is not a dedicated iris scanner or liveness detector.
- Firebase settings/rules, Anonymous Authentication, and Storage permissions depend on your Firebase console and could not be verified here. Check the browser console and Firebase logs on your devices.
- The original app contains demo/default login credentials. Change them and configure restrictive Firestore/Storage rules before using real student records in production.
