# CampusTrack face + eye-region detection update

## What changed
- The existing fast face-api.js pass now draws a box around every detected face, including faces that do not match an enrolled student.
- The existing 68-point facial landmark model draws the jaw outline and both eye-region contours with center reticles. No second neural-network pass is required for the overlay, so the eye visualization reuses the same scan results.
- An unmatched face is labeled `FACE + EYES DETECTED · NOT VERIFIED`; it is not assigned a student identity.
- Face/eye detection remains enabled even when no student descriptor templates have been enrolled.
- The service-worker cache version was changed so installed copies can load the updated JavaScript.

## Important limitation
The current face-api.js 68-point landmark model outlines the eye regions. The small center reticle is the geometric center of the eye landmarks; it is **not** a separate iris/pupil detector and should not be interpreted as exact eyeball tracking. A dedicated iris/pupil or gaze-tracking feature would require an additional model and should be integrated/tested separately.

## Verification
Test in a well-lit environment with one face centered in the camera, then test two faces, glasses, closed eyes, side angles, and an unknown person. If the face is seen but no identity is confirmed, the app should show the cyan dashed face box and eye contours without displaying a student's name. Validate on the actual phone and desktop hardware before using it in live college workflows.
