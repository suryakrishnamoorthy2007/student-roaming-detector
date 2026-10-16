# CampusTrack — v8: faster scanning, correct student face, mobile eye overlay

## 1. Faster real-time scanning
- **Embeddings only where needed.** The costly 128-number face embedding (the neural network that
  identifies the student) used to run for EVERY face in EVERY frame, even faces too small to be
  matched. Now faces + eye landmarks are found first, and embeddings are computed only for faces
  >= 60px, largest first (max 4 per live frame, 10 per snap). In a crowd this is the biggest saving.
  If anything in this fast path fails, it automatically falls back to the old pipeline.
- **GPU warm-up at start-up.** The three neural nets are run once on a blank image so the first real
  scan is not slow.
- **Snap & Verify early exit.** When the same student is confirmed in 2 frames, the 3rd frame is
  skipped (about 1/3 less waiting). Gap between frames reduced 85ms -> 40ms.
- **Phones start at 720p** (cheaper to upload each frame to the GPU), desktops stay 1080p.
- Model files and scripts are cached by the service worker, so later launches load faster.

## 2. Correct student face always shown
- The match dialog's "Master Photo" now always shows something: the enrolled photo, or a
  coloured initials avatar if the student has no photo (e.g. Excel-imported students) or the photo
  link is broken/blocked/offline. The live snapshot falls back to a fresh camera frame.
- Same fallback in the admin student list and the multi-student result list.
- Student names/photos are HTML-escaped in those templates.

## 3. Eye / face overlay on mobile
- **Root cause:** the overlay canvas was stretched to the phone's 3:4 camera box while the video is
  cropped with `object-fit: cover`, so face boxes and eye contours were drawn in the wrong place
  (and at ~0.4px thickness). The overlay is now drawn in screen space using the exact cover mapping
  (including CSS zoom and phone pixel density), with readable line widths and name pills kept
  on screen.
- Added a live **EYES OPEN / EYES CLOSED** indicator (Eye Aspect Ratio from the eye landmarks).
  It is an approximation shown for the operator; it is not an iris/gaze tracker or liveness check.

## About "AI/ML"
The scanner is already neural-network based (TinyFaceDetector, 68-point landmark CNN, ResNet face
embedding via face-api.js, running on WebGL). v8 makes that pipeline cheaper per frame; it does not
add a new model. Iris/gaze tracking or anti-spoof liveness would need an additional model
(e.g. MediaPipe) and should be added and tested separately.

## Checked here
- `node --check` passes for every JS file.
- Node tests: overlay coordinate mapping matches `object-fit: cover` (incl. zoom), descriptor cap and
  size filter, automatic fallback, eye-state maths, drawing code runs, avatar generation.
- NOT run on a real phone/camera here. Please test: (1) rear + front camera overlay alignment,
  (2) scan speed shown in the HUD (ms) before/after, (3) a student with no photo.
- If the "Fast split pipeline failed" message appears in the browser console, the app is using the
  old (slower, still working) pipeline — send me that console line.

## Still true from v7
Students must have an enrolled face (2-3 photos) to be recognised; logins are client-side;
lock down Firestore/Storage rules.
