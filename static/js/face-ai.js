/* ==========================================================================
   CampusTrack AI Enterprise - Face-API Neural Networks & Detection Loop
   ========================================================================== */

let faceMatcher = null;
let faceModelsReady = false;
let useTinyLandmarks = false;
let isDetectionPaused = false;
let detectionInProgress = false;
let scanMode = 'snap';
let scanInterval = null;
let autoScanFlushTimer = null;
let autoScanCandidates = new Map();
let recentAutoScanStudents = new Map();

/**
 * Initializes Face-API models asynchronously in the background.
 */
async function initAI() {
  const dot = document.getElementById('sys-pulse');
  const label = document.getElementById('sys-label');
  if (!window.faceapi) {
    if (label) label.innerText = 'AI library loading...';
    return;
  }

  try {
    if (label) label.innerText = 'Loading scan models...';
    let tinyLandmarksLoaded = false;
    const tinyLandmarksPromise = faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL)
      .then(() => { tinyLandmarksLoaded = true; })
      .catch(tinyModelError => {
        console.warn('Tiny landmark model unavailable; using standard landmarks:', tinyModelError);
      });

    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      tinyLandmarksPromise
    ]);

    if (tinyLandmarksLoaded) {
      useTinyLandmarks = true;
    } else {
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
      useTinyLandmarks = false;
    }

    faceModelsReady = true;
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-500';
    if (label) label.innerText = 'AI Ready · Start camera';
    showToast('Scanner AI is ready');
    rebuildFaceMatcher();
  } catch (err) {
    faceModelsReady = false;
    console.error('Face scanning models failed to load:', err);
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-amber-500';
    if (label) label.innerText = 'AI Models Unavailable';
    showToast('Face scanner could not load AI models. Check internet connection and reload.');
  }
}

function rebuildFaceMatcher() {
  try {
    const students = getStudents();
    const labeledDescriptors = [];
    students.forEach(student => {
      if (student.faceDescriptor && student.faceDescriptor.length === 128) {
        labeledDescriptors.push(new faceapi.LabeledFaceDescriptors(
          student.regNo,
          [new Float32Array(student.faceDescriptor)]
        ));
      }
    });

    if (labeledDescriptors.length > 0) {
      // 0.42 distance threshold for strict matching
      faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.42);
    } else {
      faceMatcher = null;
    }
  } catch (e) {
    console.error("FaceMatcher init error:", e);
  }
}

async function createFaceDescriptor(imageSource) {
  if (!faceModelsReady) throw new Error('Face models are not ready. Wait for AI models to load.');
  const image = new Image();
  const imageLoaded = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('The selected photo could not be opened.'));
  });
  image.src = imageSource;
  await imageLoaded;
  const detection = await faceapi.detectSingleFace(
    image,
    new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.35 })
  ).withFaceLandmarks(useTinyLandmarks).withFaceDescriptor();
  return detection ? Array.from(detection.descriptor) : null;
}

/**
 * Mobile-optimized continuous detection loop.
 * Throttles execution to ~4-5 FPS so the mobile main thread remains responsive.
 */
let lastFrameTime = 0;
const FRAME_THROTTLE_MS = 220; // ~4.5 FPS keeps phone cool and UI fluid

function startContinuousDetectionLoop() {
  if (scanInterval) {
    cancelAnimationFrame(scanInterval);
    scanInterval = null;
  }
}

async function detectAndProcessFrame(manualSnap = false, detectorOptions = null, snapshotImage = null, snapshotImageUrl = null) {
  const videoEl = document.getElementById('webcam');
  const canvasEl = document.getElementById('overlay');
  const imageSource = snapshotImage || videoEl;
  if (!detectorOptions) {
    detectorOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 });
  }

  if (detectionInProgress || !faceModelsReady || !faceMatcher || !imageSource || (!snapshotImage && videoEl.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)) return;
  detectionInProgress = true;
  try {
    const displaySize = {
      width: imageSource.videoWidth || imageSource.naturalWidth || 1280,
      height: imageSource.videoHeight || imageSource.naturalHeight || 720
    };
    const detections = await faceapi.detectAllFaces(imageSource, detectorOptions).withFaceLandmarks(useTinyLandmarks).withFaceDescriptors();
    const resizedDetections = faceapi.resizeResults(detections, displaySize);
    const ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    const badge = document.getElementById('confidence-badge');

    if (!resizedDetections.length) {
      if (badge) badge.classList.add('hidden');
      if (manualSnap) showToast('No face detected in the captured photo');
      return;
    }

    const matches = resizedDetections.map(result => {
      const best = faceMatcher.findBestMatch(result.descriptor);
      const conf = Math.max(15, Math.round((1 - best.distance) * 100));
      const box = result.detection.box;
      const recognized = best.label !== 'unknown' && conf >= 50;
      ctx.strokeStyle = recognized ? '#22c55e' : '#f59e0b';
      ctx.lineWidth = 3;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      ctx.fillStyle = recognized ? '#22c55e' : '#f59e0b';
      ctx.font = 'bold 12px Space Grotesk';
      ctx.fillText(`${recognized ? best.label : 'UNKNOWN'} ${conf}%`, box.x, Math.max(14, box.y - 6));
      return { regNo: best.label, conf, recognized };
    });
    const bestVisibleMatch = matches.find(match => match.recognized) || matches[0];
    if (badge) badge.classList.remove('hidden');
    const confValEl = document.getElementById('conf-val');
    if (confValEl) confValEl.innerText = `${bestVisibleMatch.conf}%`;

    const recognizedMatches = matches.filter(match => match.recognized);
    if (scanMode === 'auto' && recognizedMatches.length) {
      queueAutomaticMatches(recognizedMatches);
    } else if (scanMode === 'snap' && manualSnap && recognizedMatches.length) {
      const image = snapshotImageUrl || captureScannerFrame(0.82);
      if (recognizedMatches.length >= 2) automaticallyDispatchGroup(recognizedMatches, image);
      else triggerVerification(recognizedMatches[0].regNo, image, recognizedMatches[0].conf);
    } else if (scanMode === 'snap' && manualSnap) {
      showToast('No recognized student in the captured photo');
    }
    const statusEl = document.getElementById('scan-capture-status');
    if (manualSnap && statusEl) statusEl.innerText = `Photo captured at ${new Date().toLocaleTimeString()}. Face check complete.`;
  } catch (error) {
    console.warn('Face scan failed:', error);
    if (manualSnap) showToast('Face check failed for the captured photo');
  } finally {
    detectionInProgress = false;
    const statusEl = document.getElementById('scan-capture-status');
    if (manualSnap && statusEl) statusEl.innerText = `Photo captured at ${new Date().toLocaleTimeString()}. Face check finished.`;
  }
}

function queueAutomaticMatches(matches) {
  const now = Date.now();
  const unseenMatches = matches.filter(match => {
    const lastSeenAt = recentAutoScanStudents.get(match.regNo) || 0;
    return !autoScanCandidates.has(match.regNo) && now - lastSeenAt >= 12000;
  });
  if (unseenMatches.length) {
    const livePhoto = captureScannerFrame();
    unseenMatches.forEach(match => {
      autoScanCandidates.set(match.regNo, { ...match, livePhoto });
      recentAutoScanStudents.set(match.regNo, now);
    });
  }

  if (autoScanCandidates.size >= 2) {
    clearTimeout(autoScanFlushTimer);
    autoScanFlushTimer = null;
    const candidates = Array.from(autoScanCandidates.values());
    autoScanCandidates.clear();
    dispatchAutomaticScanGroup(candidates);
    return;
  }

  if (!autoScanFlushTimer && autoScanCandidates.size === 1) {
    autoScanFlushTimer = setTimeout(() => {
      autoScanFlushTimer = null;
      const [candidate] = autoScanCandidates.values();
      autoScanCandidates.clear();
      if (candidate) triggerVerification(candidate.regNo, candidate.livePhoto, candidate.conf);
    }, 250);
  }
}

function dispatchAutomaticScanGroup(candidates) {
  const uniqueCandidates = Array.from(new Map(candidates.map(item => [item.regNo, item])).values());
  const signature = uniqueCandidates.map(item => item.regNo).sort().join('|');
  const now = Date.now();
  if (signature === lastAutomaticGroupAlert.signature && now - lastAutomaticGroupAlert.timestamp < 15000) return;
  lastAutomaticGroupAlert = { signature, timestamp: now };

  const studentsByRegNo = new Map(getStudents().map(student => [student.regNo, student]));
  const incidentStudents = uniqueCandidates
    .filter(candidate => studentsByRegNo.has(candidate.regNo))
    .map(candidate => createIncidentStudent(studentsByRegNo.get(candidate.regNo), candidate.livePhoto, candidate.conf));
  if (incidentStudents.length < 2) return;
  roamingGroup = incidentStudents;
  updateGroupTrayUI();
  showToast(`${incidentStudents.length} students detected. Alert ready to send.`);
  dispatchIncidentReport(incidentStudents);
  clearIncidentGroup();
}

async function snapScanFrame() {
  if (scanMode !== 'snap') return;
  const videoEl = document.getElementById('webcam');
  if (!videoStream || !videoEl || videoEl.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    showToast('Camera is not ready');
    return;
  }
  if (!faceModelsReady || !faceMatcher) {
    showToast('Face recognition is still loading');
    return;
  }
  if (detectionInProgress) {
    showToast('A face check is already in progress');
    return;
  }

  const capturedImageUrl = captureScannerFrame(0.82);
  const capturedImage = new Image();
  capturedImage.src = capturedImageUrl;
  try {
    await capturedImage.decode();
  } catch (error) {
    showToast('Could not read the captured photo');
    return;
  }
  const status = document.getElementById('scan-capture-status');
  status.innerText = `Photo captured at ${new Date().toLocaleTimeString()}. Checking for a match...`;
  await detectAndProcessFrame(true, undefined, capturedImage, capturedImageUrl);
}
