# CampusTrack real-time scanner performance update

## What changed
- Live Auto-Scan uses a single 256-input-size pass for the common Auto-range path. Snap & Verify keeps its thorough fallback behavior.
- The expensive corridor/high-resolution recovery pass is rate-limited to approximately once every 700 ms in live mode instead of being repeated on every unidentified frame. Far mode also uses a lighter 384 input-size pass in live mode.
- A missing match no longer automatically triggers a 608-input-size descriptor pass on every live frame. Manual Snap still receives higher-resolution recovery.
- Enrollment descriptor arrays are converted to typed vectors once when the matcher is rebuilt, instead of reconstructing every stored vector for every live match. Matching still compares each student's best template and rejects ambiguous closest candidates.
- Pass-1 match results are reused instead of matching the same detections twice.
- Live repeat-evidence retention is extended to 1.8 seconds so slower devices can confirm repeated observations. A small post-inference cooldown reduces constant CPU/GPU saturation.
- Service-worker cache was bumped to v4-realtime so browsers fetch the updated JavaScript.

## Run and test
1. Extract the ZIP into a new folder and keep your previous project/database backed up.
2. Start it from `roaming-detector-backend` with your current environment and command (for example, `uvicorn main:app --reload`).
3. Close older CampusTrack tabs, reopen the app, and hard-refresh with `Ctrl+Shift+R`. If it still uses old assets, unregister the old CampusTrack service worker from DevTools > Application > Service Workers and reload.
4. Wait until the AI models say Ready, then test near and far students, both Auto and Snap modes.
5. Compare the live scanner's displayed inference milliseconds before and after on the same device and camera. Results depend on browser, GPU, lighting, and number/size of faces in view.

## Important limitations
This is a performance-oriented code change, not a guarantee of a particular scan time or correct identity. It has passed static syntax/archive checks, but cannot be benchmarked here against your live webcam or actual roster. Tiny or heavily blurred/covered faces may still require a recovery scan or staff/ID confirmation. Identical twins may not be safely distinguishable by face alone; the ambiguity rejection remains enabled.
