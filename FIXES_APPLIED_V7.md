# CampusTrack — Fixes Applied (v7)

## "No registered student" even though the student is registered
- **Accurate message:** if no student has an enrolled face profile, the scanner now says so
  (`noProfiles`) instead of the generic "No registered students recognized".
  Being in the roster (Excel import / demo data) is NOT enough — each student needs 2–3 enrolled
  face photos (Admin → enroll, or the photo-ZIP import).
- **Cloud sync no longer erases face profiles** (`firebase-sync.js`):
  - A cloud copy that has no face data can no longer overwrite face data already on the device;
    the recovered profile is pushed back to the cloud.
  - Student saves now use `set(..., {merge: true})` and skip empty face fields, so a save from
    another phone (e.g. after an Excel import) can't wipe descriptors for every device.
- **Excel re-import** (`admin.js`): stale face profiles are cleared when the photo changes
  (both `faceDescriptor` and `faceDescriptors`); same photo keeps its profile.

## Frontend
- `incident.js`: alert sending no longer fails silently — HTTP/server errors are checked, logged
  and shown as a toast.
- `campus-track.html` / `campus track.html` were missing the Firebase Storage script; all four
  HTML copies are now identical to `index.html`.
- `sw.js`: cache renamed to `v7`; same-origin files are network-first (updates show immediately,
  offline still works); API, `/verify-face` and Firebase calls are never cached; one missing file
  no longer aborts precaching.
- `manifest.json`: real local PNG icons (`static/icons/`), maskable icon, `start_url: "./"`.

## Backend (`main.py`, both copies in sync)
- Alert + verify endpoints no longer block the server (thread pool).
- Alert failures return real HTTP status codes (401 / 429 / 502 / 500) and a `delivery` field.
- Evidence photos are stored in a private `evidence/` folder (override with `EVIDENCE_DIR`),
  NOT under `/static`, with unguessable file names.
- Per-IP rate limit on `/api/send-alert` (`ALERT_RATE_LIMIT`, `ALERT_RATE_WINDOW`);
  optional `ALERT_API_KEY` header check; `ALLOWED_ORIGINS` env to restrict CORS.
- Removed the dead `/campus%20track.html` route; added `/index.html` and `/campus-track.html`.
- Port can be set with `PORT` (default 8080).
- InsightFace is now OPTIONAL: `requirements.txt` has only what the web app needs; install
  `requirements-insightface.txt` only if you want server-side `/verify-face`
  (the browser app never calls it).

## Run on Windows
```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080
```
Open http://localhost:8080. After updating, reload once (or twice on phones that had v5/v6 cached).

## Checked here
- `node --check` passes for every JS file; `main.py` compiles.
- Node tests of the matcher and cloud-merge logic passed (no profiles -> `noProfiles`, normal match,
  profile survives an empty cloud copy).
- Backend logic (rate limit, evidence saving, API key) tested with stubbed FastAPI. A real
  FastAPI/browser run was NOT possible here, so please test camera + Firebase on your devices.

## NOT changed — needs your action
- **Logins are client-side only** (`admin`/`admin123`, `scanner`/`scanner123`, plain-text passwords in
  browser storage). Change them in `admin.js` / `config.js`; real security needs server-side login.
- **Firestore/Storage rules** must be locked down in the Firebase console (anonymous sign-in alone
  is not protection for student photos/records).
- UltraMsg token entered in the app settings is stored in the browser; prefer the server env vars
  `ULTRAMSG_INSTANCE_ID` / `ULTRAMSG_TOKEN`.
- Matching thresholds are unchanged (`FACE_MATCH_MAX_DISTANCE = 0.52`, `FACE_MATCH_MIN_GAP = 0.075`
  in `face-ai.js`) to avoid wrongly identifying students.
- Existing students without an enrolled face still need to be enrolled once.
