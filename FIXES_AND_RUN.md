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
