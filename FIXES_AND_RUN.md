# CampusTrack / Student Roaming Detector — face matching fixes

## Changes made
- Removed artificial/synthetic face descriptors from the two sample students. A stock/demo photo or generated number vector must not be used to identify a real person.
- Added validation for real 128-value face descriptors.
- Added conservative matching: reject weak matches and reject ambiguous matches when the closest two enrolled students are too similar.
- Rejects tiny face crops (under 60 px wide or high) rather than guessing an identity.
- Makes the face matcher safely unavailable until models are ready and at least one real face descriptor is enrolled.
- Synced the fixed `face-ai.js` and `config.js` into both frontend folders so either backend launch path uses the same code.

## Important before testing
The sample records now have `faceDescriptor: null`. This is intentional. Enroll each student's real face using the app's face-enrollment workflow. Do not use generated descriptors or stock internet photos as a student's identity template. If the roster in Firebase still contains old synthetic descriptors, clear/re-enroll those `faceDescriptor` values in Firebase; otherwise old records could still be used by the app.

## Run
1. Extract the ZIP.
2. Install backend dependencies from `roaming-detector-backend/requirements.txt` (or the root `requirements.txt`).
3. Start the FastAPI app using your existing setup. For example, from the project root: `uvicorn main:app --reload`.
4. Open the served frontend, connect the camera, wait for the model status to show ready, and enroll real student faces before scanning.
5. Test using several known students and unknown people under the actual camera/lighting conditions. Adjust `FACE_MATCH_MAX_DISTANCE` and `FACE_MATCH_MIN_GAP` only after evaluating false matches and missed matches.

## Limitations
This is a conservative code-level correction, not a guarantee of perfect recognition. The project still uses browser-side face-api.js embeddings for roster matching; the Python InsightFace endpoint detects faces but does not perform identity matching. Do not automatically send disciplinary alerts solely from a face match—require staff confirmation. Firebase security rules, consent, and enrollment quality must also be reviewed before real-world deployment.

## Face recognition matching and enrollment update

This version improves the enrollment descriptor path and matcher:
- Enrollment now tries detector input sizes 320, 416, and 608 with progressively more tolerant detection thresholds.
- Matching accepts both legacy `faceDescriptor` data and the optional `faceDescriptors` array, comparing against all valid templates and using the closest distance per student.
- The match distance and ambiguity gap are modestly relaxed to reduce false unknowns, while ambiguous matches are still rejected.
- Both frontend copies (`static/js/` and `roaming-detector-backend/static/js/`) are updated.

### Important re-enrollment step
Students who were previously added to the roster without a real face descriptor must be re-enrolled with a clear, front-facing photo. Being present in the student roster alone does not mean the face-recognition model has a descriptor for that student. After updating, restart the app, open the admin/student enrollment screen, edit each affected student, and upload/select their face photo again so the descriptor is regenerated. Test with several consenting students and do not use this for consequential decisions without a manual fallback.


## Follow-up fix for occasional false unknowns
- Snap & Verify now captures up to three short-spaced camera frames and retries only after a miss; a busy response from the live scanner is retried instead of being displayed as an unknown student.
- Enrollment supports up to three actual photos per student. Use clear, separate front/slight-left/slight-right photos of the same student. The matcher compares live descriptors against all valid saved templates.
- Matching distance is now 0.52 with an ambiguity gap of 0.055. This modestly reduces false rejects while retaining an ambiguity check. It must be tested against your own consenting student samples; no single threshold guarantees correct identity for every camera.
- Re-uploading a photo deliberately regenerates the descriptor, even if the same image is selected again. Existing students without valid descriptors should be re-enrolled.
- The snap retry helps motion blur from a single frame. It cannot restore detail from a heavily blurred, dark, distant, or occluded face; improve lighting and move the camera closer where practical.

- Service-worker cache version was bumped so the browser is less likely to keep serving the older face-matching JavaScript. After launching this ZIP, refresh the page once; if it still looks unchanged, close the tab and reopen the app.


## Twin, face-covering, and appearance-change safeguards (v3)
- The matcher now rejects ambiguous top candidates with a wider distance margin. This can reduce mix-ups but may mean more `Unknown` results.
- The Snap & Verify workflow analyses all available frames and only confirms a registration number seen in at least two frames. Live auto-scan also requires repeated evidence before triggering verification.
- Enrollment photo processing rejects images with more than one detected face, preventing an arbitrary face from being selected from a group photo.
- For a student who is now bald or has changed appearance, re-enroll with up to three clear photos of that same student in their current appearance (front, slight left, slight right). Keep the full face visible where practical. A prior photo with hair can be kept as an additional genuine photo only if desired, but current photos should be included.
- A partly covered face has less identifying information. The scanner may return Unknown or ambiguous and should not guess. Ask for a clear view where practical; otherwise verify with student ID/QR or authorized staff.
- Identical twins cannot be reliably distinguished by face-only matching in every case. If the best candidates are close, the app rejects the match; use a separate credential (ID/QR/RFID) or staff verification for twin cases. Do not lower thresholds to force a name.
- These are risk-reduction measures, not a guarantee of correct identity. Test with consenting students in the real camera/lighting setup. Do not issue disciplinary actions from a face match alone.

## Latest real-time performance update (v4)
See [`REALTIME_PERFORMANCE_FIX.md`](REALTIME_PERFORMANCE_FIX.md) for the live-scanning optimization details. Live Auto mode now uses a lighter common pass, throttles high-resolution recovery, caches enrolled descriptor vectors, and keeps repeat evidence long enough for slower devices. The full recovery path remains available in Snap mode. Test both near and far mode on your own camera; a browser-side code change cannot guarantee a specific latency on every device.
