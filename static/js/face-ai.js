/* ==========================================================================
   CampusTrack AI Enterprise - Ultra-Fast Multi-Distance Neural Scanner
   ========================================================================== */

let faceMatcher = null;
let faceModelsReady = false;
let useTinyLandmarks = true;
let isDetectionPaused = false;
let detectionInProgress = false;

// Multi-Distance and Workflow Configuration
let scanDistanceMode = 'auto'; // 'auto' | 'near' | 'far'
let scanWorkflow = 'snap';     // 'snap' | 'live'
let currentZoomLevel = 1.0;
let lastInferenceTimeMs = 0;
let liveScanAnimFrame = null;
let lastLiveFrameTime = 0;

// Auto-Scan tracking and cooldowns
let recentAutoScanStudents = new Map();
// Require repeat evidence before live-mode verification to reduce one-frame mix-ups.
let liveRecognitionEvidence = new Map();
let lastFaceMatchFailureReason = 'unknown';

/**
 * Initializes Face-API models with WebGL GPU hardware acceleration.
 */
async function initAI() {
  const dot = document.getElementById('sys-pulse');
  const label = document.getElementById('sys-label');
  if (!window.faceapi) {
    if (label) label.innerText = 'AI library loading...';
    setTimeout(initAI, 200);
    return;
  }

  try {
    if (label) label.innerText = 'Accelerating GPU...';

    // Enable WebGL GPU acceleration flags for ultra-fast tensor operations
    if (window.faceapi.tf) {
      try {
        await faceapi.tf.setBackend('webgl');
        faceapi.tf.env().set('WEBGL_PACK', true);
        faceapi.tf.env().set('WEBGL_FORCE_F16_TEXTURES', true);
        console.log('[FaceAI] WebGL acceleration active:', faceapi.tf.getBackend());
      } catch (e) {
        console.warn('[FaceAI] WebGL config note:', e);
      }
    }

    if (label) label.innerText = 'Loading scan models...';

    // Model URLs: verified high-speed CDNs with manifests
    const modelUrls = [
      MODEL_URL,
      'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights',
      'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights'
    ];

    let loaded = false;
    for (const url of modelUrls) {
      try {
        let tinyLandmarksLoaded = false;
        const tinyLandmarksPromise = faceapi.nets.faceLandmark68TinyNet.loadFromUri(url)
          .then(() => { tinyLandmarksLoaded = true; })
          .catch(() => {});

        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(url),
          faceapi.nets.faceRecognitionNet.loadFromUri(url),
          tinyLandmarksPromise
        ]);

        if (tinyLandmarksLoaded) {
          useTinyLandmarks = true;
        } else {
          await faceapi.nets.faceLandmark68Net.loadFromUri(url).catch(() => {});
          useTinyLandmarks = false;
        }
        loaded = true;
        break;
      } catch (e) {
        console.warn('Model source fallback:', url);
      }
    }

    if (!loaded) throw new Error('Could not load AI models');

    faceModelsReady = true;
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-500';
    if (label) label.innerText = 'Ultra-Fast AI Ready';
    
    const speedPill = document.getElementById('scanner-speed-text');
    if (speedPill) speedPill.innerText = '⚡ Ultra-Fast AI (Ready)';

    showToast('Scanner AI ready · Dual-range active');
    rebuildFaceMatcher();

    // If initial workflow is live, start loop
    if (scanWorkflow === 'live') {
      startLiveAutoScanLoop();
    }
  } catch (err) {
    faceModelsReady = false;
    console.error('Face scanning models failed to load:', err);
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-amber-500';
    if (label) label.innerText = 'AI Offline';
    showToast('Face scanner could not load AI models. Check internet connection.');
  }
}

/**
 * Rebuilds the facial descriptor matcher from student roster embeddings.
 */
// Matching is deliberately conservative: a weak/ambiguous match is rejected.
// face-api.js descriptors are 128-dimensional Float32 vectors; only real enrolled
// descriptors are accepted. Synthetic/default descriptors must never identify people.
const FACE_MATCH_MAX_DISTANCE = 0.52;
// A wider candidate margin is intentional: twins and similar-looking students should
// fall back to ID/staff verification instead of being guessed from face alone.
const FACE_MATCH_MIN_GAP = 0.075;
const MATCH_FAILURE_PRIORITY = { unknown: 0, lowSimilarity: 1, lowQuality: 2, inconsistent: 2, ambiguous: 3 };
function noteFaceMatchFailure(reason) {
  if ((MATCH_FAILURE_PRIORITY[reason] || 0) >= (MATCH_FAILURE_PRIORITY[lastFaceMatchFailureReason] || 0)) {
    lastFaceMatchFailureReason = reason;
  }
}

function isValidFaceDescriptor(value) {
  if (!Array.isArray(value) || value.length !== 128 ||
      !value.every(n => Number.isFinite(Number(n)))) return false;

  // Reject legacy demo vectors created by the old generateSynthetic128DDescriptor()
  // function, including copies that may still exist in Firebase or localStorage.
  for (const seed of [1.42, 2.98]) {
    let matchesLegacyDemo = true;
    for (let i = 0; i < 128; i++) {
      const expected = Math.sin(seed * (i + 1) * 0.45) * 0.2;
      if (Math.abs(Number(value[i]) - expected) > 1e-6) {
        matchesLegacyDemo = false;
        break;
      }
    }
    if (matchesLegacyDemo) return false;
  }
  return true;
}

function rebuildFaceMatcher() {
  try {
    if (!window.faceapi || !faceModelsReady) {
      faceMatcher = null;
      return;
    }
    const students = getStudents();
    const seen = new Set();
    const labeledDescriptors = [];
    students.forEach(student => {
      const regNo = String(student.regNo || '').trim();
      if (!regNo || seen.has(regNo)) return;
      // Accept the current single-template format and the newer multi-template format.
      const rawTemplates = Array.isArray(student.faceDescriptors) && student.faceDescriptors.length
        ? student.faceDescriptors
        : [student.faceDescriptor];
      const templates = rawTemplates.filter(isValidFaceDescriptor)
        .map(d => new Float32Array(d.map(Number)));
      if (!templates.length) return;
      seen.add(regNo);
      labeledDescriptors.push(new faceapi.LabeledFaceDescriptors(regNo, templates));
    });
    faceMatcher = labeledDescriptors.length
      ? new faceapi.FaceMatcher(labeledDescriptors, FACE_MATCH_MAX_DISTANCE)
      : null;
  } catch (e) {
    faceMatcher = null;
    console.error('FaceMatcher init error:', e);
  }
}

function findReliableStudentMatch(descriptor, students) {
  if (!window.faceapi || !isValidFaceDescriptor(Array.from(descriptor || []))) {
    noteFaceMatchFailure('lowQuality');
    return null;
  }
  const probe = new Float32Array(descriptor.map(Number));
  const candidates = (students || []).filter(s => s && String(s.regNo || '').trim())
    .map(student => {
      const rawTemplates = Array.isArray(student.faceDescriptors) && student.faceDescriptors.length
        ? student.faceDescriptors
        : [student.faceDescriptor];
      const distances = rawTemplates.filter(isValidFaceDescriptor).map(template =>
        faceapi.euclideanDistance(probe, new Float32Array(template.map(Number)))
      ).filter(Number.isFinite);
      return distances.length ? { student, distance: Math.min(...distances) } : null;
    }).filter(Boolean).sort((a, b) => a.distance - b.distance);

  if (!candidates.length) {
    noteFaceMatchFailure('lowQuality');
    return null;
  }
  const best = candidates[0];
  const second = candidates[1];
  if (best.distance > FACE_MATCH_MAX_DISTANCE) {
    noteFaceMatchFailure('lowSimilarity');
    return null;
  }
  // If another enrolled student is also plausible and the margin is narrow,
  // especially for twins, don't select one merely because it is ranked first.
  if (second && second.distance <= FACE_MATCH_MAX_DISTANCE + 0.04 &&
      (second.distance - best.distance) < FACE_MATCH_MIN_GAP) {
    noteFaceMatchFailure('ambiguous');
    return null;
  }
  return { student: best.student, distance: best.distance,
    confidence: Math.round(Math.max(0, Math.min(99, (1 - best.distance) * 100))) };
}

/**
 * Estimates distance in meters and classification based on face bounding box scale.
 */
function estimateDistanceMeters(bbox, frameWidth, frameHeight) {
  const faceH = bbox.height;
  const ratio = faceH / Math.max(1, frameHeight);

  if (ratio > 0.18) {
    const dist = Math.max(0.5, (0.28 / ratio) * 1.0).toFixed(1);
    return { category: 'near', label: 'Near', meters: dist, badgeColor: 'bg-emerald-500' };
  } else if (ratio > 0.07) {
    const dist = Math.max(1.8, (0.12 / ratio) * 2.2).toFixed(1);
    return { category: 'mid', label: 'Mid-Range', meters: dist, badgeColor: 'bg-cyan-600' };
  } else {
    const dist = Math.max(4.5, (0.05 / Math.max(0.015, ratio)) * 4.0).toFixed(1);
    return { category: 'far', label: 'Corridor Far', meters: dist, badgeColor: 'bg-indigo-600' };
  }
}

/**
 * Switches distance range mode: 'auto' | 'near' | 'far'.
 */
function setDistanceMode(mode) {
  scanDistanceMode = mode;

  const btnAuto = document.getElementById('btn-range-auto');
  const btnNear = document.getElementById('btn-range-near');
  const btnFar = document.getElementById('btn-range-far');

  const activeCls = 'flex-1 sm:flex-initial px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 bg-cyan-700 text-white shadow-sm';
  const inactiveCls = 'flex-1 sm:flex-initial px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition flex items-center justify-center gap-1.5';

  if (btnAuto) btnAuto.className = mode === 'auto' ? activeCls : inactiveCls;
  if (btnNear) btnNear.className = mode === 'near' ? activeCls : inactiveCls;
  if (btnFar) btnFar.className = mode === 'far' ? activeCls : inactiveCls;

  const hudRangeText = document.getElementById('hud-range-text');
  const corridorGuides = document.getElementById('corridor-guide-lines');
  const reticleLabel = document.getElementById('reticle-label');

  if (mode === 'near') {
    if (hudRangeText) hudRangeText.innerText = 'SHORT RANGE (0.5-3m)';
    if (corridorGuides) corridorGuides.classList.add('hidden');
    if (reticleLabel) reticleLabel.innerText = 'NEAR SCANNING TARGET';
    showToast('Short Range Active: ⚡ Ultra-Fast 25ms Close-up Detection');
  } else if (mode === 'far') {
    if (hudRangeText) hudRangeText.innerText = 'CORRIDOR FAR (3-20m)';
    if (corridorGuides) corridorGuides.classList.remove('hidden');
    if (reticleLabel) reticleLabel.innerText = 'CORRIDOR FAR TARGET';
    if (currentZoomLevel < 1.5) {
      setZoomMultiplier(2.0);
    }
    showToast('Corridor Far Active: High-Sensitivity Distant Recognition');
  } else {
    if (hudRangeText) hudRangeText.innerText = 'AUTO RANGE';
    if (corridorGuides) corridorGuides.classList.add('hidden');
    if (reticleLabel) reticleLabel.innerText = 'DYNAMIC AUTO TARGET';
    showToast('Auto Range Active: Smart Multi-Distance Scanner');
  }
}

/**
 * Switches scanner workflow: 'snap' | 'live'.
 */
function setScanWorkflow(workflow) {
  scanWorkflow = workflow;

  const btnLive = document.getElementById('btn-workflow-live');
  const btnSnap = document.getElementById('btn-workflow-snap');
  const liveBanner = document.getElementById('live-scan-banner');
  const snapContainer = document.getElementById('snap-action-container');

  const activeCls = 'px-2.5 py-1.5 rounded-lg text-xs font-bold bg-cyan-700 text-white shadow-sm transition flex items-center gap-1.5';
  const inactiveCls = 'px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition flex items-center gap-1.5';

  if (btnLive) btnLive.className = workflow === 'live' ? activeCls : inactiveCls;
  if (btnSnap) btnSnap.className = workflow === 'snap' ? activeCls : inactiveCls;

  if (workflow === 'live') {
    if (typeof unfreezeScannerView === 'function') unfreezeScannerView();
    if (liveBanner) liveBanner.classList.remove('hidden');
    if (snapContainer) snapContainer.classList.add('hidden');
    startLiveAutoScanLoop();
    showToast('Live Auto-Scan Active: Tracking corridor in real-time');
  } else {
    if (typeof unfreezeScannerView === 'function') unfreezeScannerView();
    if (liveBanner) liveBanner.classList.add('hidden');
    if (snapContainer) snapContainer.classList.remove('hidden');
    stopLiveAutoScanLoop();
    showToast('Snap Mode Active: Tap button for instant face verification');
  }
}

/**
 * Applies optical / digital zoom level across camera hardware and viewfinder.
 */
async function setZoomMultiplier(level) {
  level = parseFloat(level);
  currentZoomLevel = level;

  const slider = document.getElementById('camera-zoom');
  const valLabel = document.getElementById('camera-zoom-value');
  if (slider) slider.value = level;
  if (valLabel) valLabel.innerText = `${level.toFixed(1)}x`;

  ['1', '15', '2', '3'].forEach(id => {
    const btn = document.getElementById(`zoom-btn-${id}`);
    if (btn) {
      const btnLevel = id === '15' ? 1.5 : parseFloat(id);
      if (Math.abs(btnLevel - level) < 0.05) {
        btn.className = 'px-2 py-0.5 rounded-lg text-xs font-mono font-bold bg-cyan-600 text-white transition shadow-sm';
      } else {
        btn.className = 'px-2 py-0.5 rounded-lg text-xs font-mono font-bold text-slate-300 hover:text-white hover:bg-slate-800 transition';
      }
    }
  });

  const track = videoStream?.getVideoTracks()[0];
  const capabilities = track?.getCapabilities ? track.getCapabilities() : {};

  if (capabilities.zoom && track) {
    try {
      const targetZoom = Math.min(capabilities.zoom.max, Math.max(capabilities.zoom.min, level));
      await track.applyConstraints({ advanced: [{ zoom: targetZoom }] });
    } catch (err) {
      console.warn('Hardware zoom note:', err);
    }
  }

  const video = document.getElementById('webcam');
  if (video) {
    if (!capabilities.zoom) {
      video.style.transform = level > 1.0 ? `scale(${level})` : 'scale(1)';
    } else {
      video.style.transform = 'scale(1)';
    }
  }
}

function handleZoomSlider(val) {
  setZoomMultiplier(parseFloat(val));
}

/**
 * Core Ultra-Fast Multi-Distance Neural Scanning Engine.
 * Executes detection without main-thread blocking or redundant conversions.
 */
async function executeUltraFastScan(manualSnap = false, sourceInput = null) {
  const video = document.getElementById('webcam');
  const canvas = document.getElementById('overlay');
  const badge = document.getElementById('confidence-badge');

  const inputElement = sourceInput || video;
  if (!inputElement || (!sourceInput && (!videoStream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA))) {
    return { matches: [], error: 'Camera stream inactive' };
  }
  if (!faceModelsReady) {
    return { matches: [], error: 'AI models are still initializing. Please try again shortly.' };
  }
  if (!faceMatcher) {
    return { matches: [], error: 'No valid face descriptors are enrolled. Re-enroll the student with a clear face photo.' };
  }
  if (detectionInProgress) {
    return { matches: [], busy: true };
  }

  detectionInProgress = true;
  const startTime = performance.now();
  lastFaceMatchFailureReason = 'unknown';

  try {
    const origW = sourceInput ? (sourceInput.width || 1280) : (video ? (video.videoWidth || 1280) : 1280);
    const origH = sourceInput ? (sourceInput.height || 720) : (video ? (video.videoHeight || 720) : 720);

    if (canvas && (canvas.width !== origW || canvas.height !== origH)) {
      canvas.width = origW;
      canvas.height = origH;
    }

    let rawDetections = [];
    let detectedFromCrop = false;
    let cropOffsetX = 0;
    let cropOffsetY = 0;

    // --- PIPELINE BRANCHING BASED ON DISTANCE MODE ---
    if (scanDistanceMode === 'near') {
      // 1. SHORT RANGE (0.5m - 3m): Ultra-fast 320px tensor (~20ms)
      const detectorOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.28 });
      rawDetections = await faceapi.detectAllFaces(inputElement, detectorOpts)
        .withFaceLandmarks(useTinyLandmarks)
        .withFaceDescriptors();

    } else if (scanDistanceMode === 'far') {
      // 2. CORRIDOR FAR RANGE (3m - 20m): Center 65% corridor crop at native HD resolution
      const cropW = Math.round(origW * 0.65);
      const cropH = Math.round(origH * 0.70);
      cropOffsetX = Math.round((origW - cropW) / 2);
      cropOffsetY = Math.round((origH - cropH) / 2);

      if (!window._corridorCropCanvas) {
        window._corridorCropCanvas = document.createElement('canvas');
      }
      const cropCanvas = window._corridorCropCanvas;
      cropCanvas.width = cropW;
      cropCanvas.height = cropH;
      const cropCtx = cropCanvas.getContext('2d');
      cropCtx.drawImage(inputElement, cropOffsetX, cropOffsetY, cropW, cropH, 0, 0, cropW, cropH);

      const detectorOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.16 });
      rawDetections = await faceapi.detectAllFaces(cropCanvas, detectorOpts)
        .withFaceLandmarks(useTinyLandmarks)
        .withFaceDescriptors();

      detectedFromCrop = true;

    } else {
      // 3. AUTO RANGE (SMART PROGRESSIVE HIERARCHICAL):
      // Pass 1: Fast Near/Mid pass (320px)
      const fastOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.25 });
      const pass1Detections = await faceapi.detectAllFaces(inputElement, fastOpts)
        .withFaceLandmarks(useTinyLandmarks)
        .withFaceDescriptors();

      // Check if Pass 1 detected any enrolled student
      let foundEnrolled = false;
      if (pass1Detections && pass1Detections.length > 0) {
        for (const det of pass1Detections) {
          const best = faceMatcher.findBestMatch(det.descriptor);
          if (findReliableStudentMatch(det.descriptor, getStudents())) {
            foundEnrolled = true;
            break;
          }
        }
      }

      if (foundEnrolled) {
        rawDetections = pass1Detections;
      } else {
        // Pass 2: Distant Corridor Sensitivity Pass
        const cropW = Math.round(origW * 0.65);
        const cropH = Math.round(origH * 0.70);
        cropOffsetX = Math.round((origW - cropW) / 2);
        cropOffsetY = Math.round((origH - cropH) / 2);

        if (!window._corridorCropCanvas) {
          window._corridorCropCanvas = document.createElement('canvas');
        }
        const cropCanvas = window._corridorCropCanvas;
        cropCanvas.width = cropW;
        cropCanvas.height = cropH;
        const cropCtx = cropCanvas.getContext('2d');
        cropCtx.drawImage(inputElement, cropOffsetX, cropOffsetY, cropW, cropH, 0, 0, cropW, cropH);

        const farOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.16 });
        const pass2Detections = await faceapi.detectAllFaces(cropCanvas, farOpts)
          .withFaceLandmarks(useTinyLandmarks)
          .withFaceDescriptors();

        if (pass2Detections && pass2Detections.length > 0) {
          // Keep full-frame results as well as corridor results. Replacing the first pass
          // can discard a valid face near the edge of the camera image.
          const mergedDetections = (pass1Detections || []).slice();
          for (const cropDet of pass2Detections) {
            const cropBox = cropDet.detection.box;
            const fullBox = {
              x: cropBox.x + cropOffsetX,
              y: cropBox.y + cropOffsetY,
              width: cropBox.width,
              height: cropBox.height
            };
            const duplicate = mergedDetections.some(existing => {
              const b = existing.detection.box;
              const left = Math.max(b.x, fullBox.x);
              const top = Math.max(b.y, fullBox.y);
              const right = Math.min(b.x + b.width, fullBox.x + fullBox.width);
              const bottom = Math.min(b.y + b.height, fullBox.y + fullBox.height);
              const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
              const union = b.width * b.height + fullBox.width * fullBox.height - intersection;
              return union > 0 && intersection / union > 0.30;
            });
            if (!duplicate) {
              cropDet.detection.box = fullBox;
              mergedDetections.push(cropDet);
            }
          }
          rawDetections = mergedDetections;
          detectedFromCrop = false;
          cropOffsetX = 0;
          cropOffsetY = 0;
        } else {
          rawDetections = pass1Detections || [];
          detectedFromCrop = false;
          cropOffsetX = 0;
          cropOffsetY = 0;
        }
      }
    }

    // Recovery pass: only runs when the normal pass finds no face.
    // A larger detector input and lower threshold can recover small/soft faces;
    // this is still the same pretrained ML model, not a guarantee for heavily blurred images.
    if (!rawDetections || rawDetections.length === 0) {
      try {
        const recoveryOpts = new faceapi.TinyFaceDetectorOptions({
          inputSize: 608,
          scoreThreshold: 0.10
        });
        const recoveryDetections = await faceapi.detectAllFaces(inputElement, recoveryOpts)
          .withFaceLandmarks(useTinyLandmarks)
          .withFaceDescriptors();
        if (recoveryDetections && recoveryDetections.length > 0) {
          rawDetections = recoveryDetections;
          detectedFromCrop = false;
          cropOffsetX = 0;
          cropOffsetY = 0;
          console.info('[FaceAI] Recovery pass detected face(s).');
        }
      } catch (recoveryError) {
        console.warn('[FaceAI] Recovery pass failed:', recoveryError);
      }
    }

    // Measure and report speed in HUD
    let durationMs = Math.max(12, Math.round(performance.now() - startTime));
    lastInferenceTimeMs = durationMs;
    const speedPill = document.getElementById('scanner-speed-text');
    if (speedPill) {
      speedPill.innerText = `⚡ ${durationMs}ms · Ultra-Fast`;
    }

    // Match faces against enrolled student database
    const students = getStudents();
    const recognizedMatches = [];

    if (rawDetections && rawDetections.length > 0) {
      for (const det of rawDetections) {
        let box = det.detection.box;
        if (detectedFromCrop) {
          box = {
            x: box.x + cropOffsetX,
            y: box.y + cropOffsetY,
            width: box.width,
            height: box.height
          };
        }

        // Very small faces have unreliable descriptors. Fail closed instead of guessing.
        if (box.width < 60 || box.height < 60) continue;
        const reliableMatch = findReliableStudentMatch(det.descriptor, students);
        if (reliableMatch) {
          const student = reliableMatch.student;
          const matchConf = reliableMatch.confidence;
          const distance = estimateDistanceMeters(box, origW, origH);
          const sched = typeof evaluateStudentTimetable === 'function' ? evaluateStudentTimetable(student) : null;
          const isViolation = sched && sched.type === 'VIOLATION';

          recognizedMatches.push({
            student,
            regNo: student.regNo,
            conf: matchConf,
            matchDistance: reliableMatch.distance,
            box,
            distance,
            isViolation,
            sched,
            descriptor: Array.from(det.descriptor)
          });
        }
      }
    }

    // Recognition recovery pass: also run when a face was detected but none matched.
    // The previous implementation only retried when *no face was detected*, so a poor
    // descriptor from a blurry frame could never benefit from a better full-frame pass.
    if (recognizedMatches.length === 0) {
      try {
        const retryOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.10 });
        const retryDetections = await faceapi.detectAllFaces(inputElement, retryOpts)
          .withFaceLandmarks(useTinyLandmarks)
          .withFaceDescriptors();
        for (const det of (retryDetections || [])) {
          const box = det.detection.box;
          if (box.width < 60 || box.height < 60) continue;
          const reliableMatch = findReliableStudentMatch(det.descriptor, students);
          if (!reliableMatch) continue;
          const student = reliableMatch.student;
          const sched = typeof evaluateStudentTimetable === 'function' ? evaluateStudentTimetable(student) : null;
          recognizedMatches.push({
            student,
            regNo: student.regNo,
            conf: reliableMatch.confidence,
            matchDistance: reliableMatch.distance,
            box,
            distance: estimateDistanceMeters(box, origW, origH),
            isViolation: Boolean(sched && sched.type === 'VIOLATION'),
            sched,
            descriptor: Array.from(det.descriptor)
          });
        }
        if (recognizedMatches.length > 0) console.info('[FaceAI] High-resolution recognition retry succeeded.');
      } catch (retryError) {
        console.warn('[FaceAI] High-resolution recognition retry failed:', retryError);
      }
      durationMs = Math.max(12, Math.round(performance.now() - startTime));
      lastInferenceTimeMs = durationMs;
      const retrySpeedPill = document.getElementById('scanner-speed-text');
      if (retrySpeedPill) retrySpeedPill.innerText = `⚡ ${durationMs}ms · Recovery scan`;
    }

    // --- DRAW BOUNDING BOXES ON OVERLAY ---
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (recognizedMatches.length > 0) {
        recognizedMatches.forEach(m => {
          const { x, y, width, height } = m.box;
          const strokeColor = m.isViolation ? '#f43f5e' : '#22c55e';
          const bgColor = m.isViolation ? 'rgba(225, 29, 72, 0.92)' : 'rgba(16, 185, 129, 0.92)';

          // High-tech reticle corners
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = 3;
          ctx.strokeRect(x, y, width, height);

          // Subtle corner accents
          const cornerLen = Math.min(16, width * 0.25);
          ctx.lineWidth = 5;
          ctx.beginPath();
          // Top-left
          ctx.moveTo(x, y + cornerLen); ctx.lineTo(x, y); ctx.lineTo(x + cornerLen, y);
          // Top-right
          ctx.moveTo(x + width - cornerLen, y); ctx.lineTo(x + width, y); ctx.lineTo(x + width, y + cornerLen);
          // Bottom-left
          ctx.moveTo(x, y + height - cornerLen); ctx.lineTo(x, y + height); ctx.lineTo(x + cornerLen, y + height);
          // Bottom-right
          ctx.moveTo(x + width - cornerLen, y + height); ctx.lineTo(x + width, y + height); ctx.lineTo(x + width, y + height - cornerLen);
          ctx.stroke();

          // Label pill with Distance Tag
          const distTag = m.distance.category === 'far' ? `🔭 ${m.distance.meters}m` : `${m.distance.meters}m`;
          const labelText = `${m.student.name} (${m.conf}%) · ${distTag}`;
          ctx.font = 'bold 12px "Space Grotesk", sans-serif';
          const textW = ctx.measureText(labelText).width;
          const pillH = 22;
          const pillY = Math.max(0, y - pillH - 4);

          ctx.fillStyle = bgColor;
          ctx.beginPath();
          ctx.roundRect(x, pillY, textW + 14, pillH, 6);
          ctx.fill();

          ctx.fillStyle = '#ffffff';
          ctx.fillText(labelText, x + 7, pillY + 15);
        });

        // Update confidence pill
        if (badge) {
          badge.classList.remove('hidden');
          const confVal = document.getElementById('conf-val');
          if (confVal) {
            confVal.innerText = `${recognizedMatches.length} Student${recognizedMatches.length > 1 ? 's' : ''} (${recognizedMatches[0].conf}%)`;
          }
        }

        // Auto-clear overlay timer for live manual scan (keep on frozen snapshot until retake)
        if (manualSnap && !sourceInput) {
          if (window._overlayClearTimer) clearTimeout(window._overlayClearTimer);
          window._overlayClearTimer = setTimeout(() => {
            if (canvas) {
              const c = canvas.getContext('2d');
              c.clearRect(0, 0, canvas.width, canvas.height);
            }
            if (badge) badge.classList.add('hidden');
          }, 2500);
        }
      } else {
        if (badge) badge.classList.add('hidden');
      }
    }

    // Save first detected face descriptor globally for quick demo enrollment
    if (recognizedMatches[0]) {
      window._lastCapturedFace = {
        descriptor: recognizedMatches[0].descriptor,
        photoUrl: recognizedMatches[0].student.photoUrl,
        scorePct: recognizedMatches[0].conf
      };
    }

    return {
      matches: recognizedMatches,
      reason: recognizedMatches.length ? null : lastFaceMatchFailureReason,
      durationMs,
      timestamp: Date.now()
    };

  } catch (error) {
    console.error('Ultra-fast scan error:', error);
    return { matches: [], error: error.message };
  } finally {
    detectionInProgress = false;
  }
}

/**
 * Freezes the scanner viewport display with the captured photo so the operator
 * does not have to keep pointing the camera at the student while AI verifies.
 */
function freezeScannerView(imageUrl) {
  window._lastCapturedSnapshotUrl = imageUrl;
  const freezeImg = document.getElementById('snap-freeze-preview');
  const freezeIndicator = document.getElementById('snap-frozen-indicator');
  const reticle = document.getElementById('main-reticle');

  if (freezeImg) {
    freezeImg.src = imageUrl;
    freezeImg.classList.remove('hidden');
  }
  if (freezeIndicator) {
    freezeIndicator.classList.remove('hidden');
    const textEl = document.getElementById('snap-frozen-text');
    if (textEl) textEl.innerText = '📸 Photo Captured · Verifying face...';
  }
  if (reticle) reticle.classList.add('opacity-30');
}

/**
 * Unfreezes the scanner viewport and returns cleanly to live camera feed.
 */
function unfreezeScannerView() {
  window._lastCapturedSnapshotUrl = null;
  const freezeImg = document.getElementById('snap-freeze-preview');
  const freezeIndicator = document.getElementById('snap-frozen-indicator');
  const canvas = document.getElementById('overlay');
  const badge = document.getElementById('confidence-badge');
  const reticle = document.getElementById('main-reticle');
  const snapBtn = document.getElementById('snap-btn');

  if (freezeImg) {
    freezeImg.classList.add('hidden');
    freezeImg.src = '';
  }
  if (freezeIndicator) {
    freezeIndicator.classList.add('hidden');
  }
  if (canvas) {
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, canvas.width, canvas.height);
  }
  if (badge) badge.classList.add('hidden');
  if (reticle) reticle.classList.remove('opacity-30');

  if (snapBtn && !detectionInProgress) {
    snapBtn.disabled = false;
    snapBtn.classList.remove('opacity-80', 'cursor-not-allowed');
    snapBtn.innerHTML = `
      <i class="fa-solid fa-bolt-lightning text-amber-300 text-base"></i>
      <span>Snap &amp; Verify Student</span>
    `;
  }
}

/**
 * Instant Snap & Verify Handler:
 * Captures the photo ONCE at the instant of the click into an offscreen canvas,
 * freezes the viewfinder with the captured photo immediately,
 * and executes AI face recognition and verification exclusively on that captured photo.
 * The user does NOT need to keep the phone held continuously facing the student.
 */
async function handleSnapAndVerify() {
  const snapBtn = document.getElementById('snap-btn');
  const resultArea = document.getElementById('verify-result');
  const video = document.getElementById('webcam');

  // If already frozen from a previous snap, unfreeze first to allow fresh capture
  if (window._lastCapturedSnapshotUrl) {
    unfreezeScannerView();
    await new Promise(r => requestAnimationFrame(r));
  }

  if (!video || !videoStream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    showToast('Camera is not active or ready');
    return;
  }

  // 1. Shutter sound cue & screen flash effect
  if (typeof playCue === 'function') {
    playCue('snap');
  }
  const shutterFlash = document.getElementById('camera-shutter-flash');
  if (shutterFlash) {
    shutterFlash.style.opacity = '0.9';
    setTimeout(() => { shutterFlash.style.opacity = '0'; }, 130);
  }

  // 2. Immediately capture the still photo frame from the camera stream at this exact instant
  const snapCanvas = document.createElement('canvas');
  snapCanvas.width = video.videoWidth || 1280;
  snapCanvas.height = video.videoHeight || 720;
  const snapCtx = snapCanvas.getContext('2d');
  snapCtx.drawImage(video, 0, 0, snapCanvas.width, snapCanvas.height);
  let liveSnapshotUrl = snapCanvas.toDataURL('image/jpeg', 0.88);

  // 3. Freeze the viewfinder with the captured photo right away
  freezeScannerView(liveSnapshotUrl);

  // 4. Update Snap button to reassure the user that photo is already captured
  if (snapBtn) {
    snapBtn.disabled = true;
    snapBtn.classList.add('opacity-80', 'cursor-not-allowed');
    snapBtn.innerHTML = `
      <i class="fa-solid fa-circle-notch fa-spin text-base"></i>
      <span>Analyzing Photo... (You can lower camera)</span>
    `;
  }

  if (resultArea) {
    resultArea.innerHTML = `
      <div class="flex items-center justify-between gap-3 text-cyan-800 bg-cyan-50 border border-cyan-200 rounded-xl p-3.5 text-xs font-medium w-full">
        <div class="flex items-center gap-2.5">
          <i class="fa-solid fa-circle-notch fa-spin text-cyan-600 text-base shrink-0"></i>
          <div>
            <p class="font-bold text-slate-800">Photo Captured · Checking Face...</p>
            <p class="text-[11px] text-slate-500">The scanner captures up to 3 quick frames to recover from a blurry frame. Keep the student's face in view briefly.</p>
          </div>
        </div>
        <img src="${liveSnapshotUrl}" class="w-10 h-10 rounded-lg object-cover border border-cyan-300 shadow-sm shrink-0">
      </div>
    `;
  }

  try {
    // Capture two additional frames from the live stream. The initial photo is still instant;
    // the backup frames are only analyzed if the first frame does not produce a reliable match.
    const scanFrames = [snapCanvas];
    for (let frameIndex = 1; frameIndex < 3; frameIndex++) {
      await new Promise(resolve => setTimeout(resolve, 85));
      if (!videoStream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) break;
      const backupCanvas = document.createElement('canvas');
      backupCanvas.width = video.videoWidth || snapCanvas.width;
      backupCanvas.height = video.videoHeight || snapCanvas.height;
      const backupContext = backupCanvas.getContext('2d', { alpha: false });
      if (!backupContext) break;
      backupContext.drawImage(video, 0, 0, backupCanvas.width, backupCanvas.height);
      scanFrames.push(backupCanvas);
    }

    // A live auto-scan may still be finishing when the Snap button is pressed.
    // Retry brief "busy" responses instead of misreporting them as an unknown student.
    const scanFrameWithBusyRetry = async (frame) => {
      let result = { matches: [], busy: true };
      for (let attempt = 0; attempt < 8; attempt++) {
        result = await executeUltraFastScan(true, frame);
        if (!result.busy) return result;
        await new Promise(resolve => setTimeout(resolve, 60));
      }
      return { ...result, busy: true, error: 'Scanner is busy. Please try again.' };
    };

    const processingStarted = performance.now();
    let scanResult = { matches: [], error: 'No scan result' };
    const frameResults = [];
    let selectedFrameIndex = 0;
    for (let frameIndex = 0; frameIndex < scanFrames.length; frameIndex++) {
      const frameResult = await scanFrameWithBusyRetry(scanFrames[frameIndex]);
      frameResults.push({ frameIndex, result: frameResult });
      scanResult = frameResult;
      if (frameResult.error && !frameResult.busy) break;
    }

    // Confirm a student only when the same registration number is independently matched
    // in at least two frames. This reduces transient blur/occlusion errors; it does NOT
    // guarantee that face-only recognition can distinguish identical twins.
    const votes = new Map();
    for (const item of frameResults) {
      const frameIds = new Set();
      for (const match of (item.result.matches || [])) {
        const regNo = String(match.regNo || match.student?.regNo || '');
        if (!regNo || frameIds.has(regNo)) continue;
        frameIds.add(regNo);
        let vote = votes.get(regNo);
        if (!vote) {
          vote = { frames: new Set(), best: match, bestFrameIndex: item.frameIndex };
          votes.set(regNo, vote);
        }
        vote.frames.add(item.frameIndex);
        if (match.conf > (vote.best.conf || 0)) {
          vote.best = match;
          vote.bestFrameIndex = item.frameIndex;
        }
      }
    }
    const confirmedVotes = [...votes.values()].filter(vote => vote.frames.size >= 2);
    if (confirmedVotes.length) {
      confirmedVotes.sort((a, b) => b.best.conf - a.best.conf);
      selectedFrameIndex = confirmedVotes[0].bestFrameIndex;
      scanResult = {
        ...frameResults.find(item => item.frameIndex === selectedFrameIndex)?.result,
        matches: confirmedVotes.map(vote => vote.best),
        reason: null
      };
    } else {
      const reasons = frameResults.map(item => item.result.reason).filter(Boolean);
      const onlyOneFrameMatched = votes.size > 0;
      const reason = reasons.includes('ambiguous') ? 'ambiguous' : (onlyOneFrameMatched ? 'inconsistent' : (reasons.includes('lowQuality') ? 'lowQuality' : (reasons.includes('lowSimilarity') ? 'lowSimilarity' : 'unknown')));
      scanResult = { ...(frameResults[frameResults.length - 1]?.result || scanResult), matches: [], reason };
    }
    scanResult.durationMs = Math.max(1, Math.round(performance.now() - processingStarted));

    if (selectedFrameIndex > 0) {
      liveSnapshotUrl = scanFrames[selectedFrameIndex].toDataURL('image/jpeg', 0.88);
      freezeScannerView(liveSnapshotUrl);
      const processingThumb = resultArea?.querySelector('img');
      if (processingThumb) processingThumb.src = liveSnapshotUrl;
    }

    const matches = scanResult.matches || [];

    if (matches.length > 0) {
      if (typeof playCue === 'function') {
        playCue('match');
      }

      const freezeIndicatorText = document.getElementById('snap-frozen-text');
      if (freezeIndicatorText) {
        freezeIndicatorText.innerText = `📸 Identified ${matches.length} Student${matches.length > 1 ? 's' : ''}`;
      }

      // Render recognized students
      if (resultArea) {
        let html = `
          <div class="space-y-2.5 w-full">
            <div class="flex items-center justify-between border-b border-slate-200 pb-2">
              <span class="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                <i class="fa-solid fa-users-viewfinder text-cyan-600"></i>
                ${matches.length} Student${matches.length > 1 ? 's' : ''} Identified (${scanResult.durationMs}ms)
              </span>
              <button type="button" onclick="unfreezeScannerView()" class="text-[11px] font-bold text-cyan-700 hover:text-cyan-900 bg-cyan-50 hover:bg-cyan-100 border border-cyan-200 px-2.5 py-1 rounded-lg transition flex items-center gap-1 cursor-pointer">
                <i class="fa-solid fa-camera-rotate text-[10px]"></i>
                <span>Retake / Resume</span>
              </button>
            </div>
            <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
        `;

        matches.forEach(m => {
          const s = m.student;
          const sched = m.sched;
          const isViolation = m.isViolation;
          const distBadge = m.distance.category === 'far'
            ? `<span class="bg-indigo-100 text-indigo-800 font-mono text-[9px] px-1.5 py-0.5 rounded font-bold">🔭 Far (${m.distance.meters}m)</span>`
            : `<span class="bg-emerald-100 text-emerald-800 font-mono text-[9px] px-1.5 py-0.5 rounded font-bold">⚡ Near (${m.distance.meters}m)</span>`;

          html += `
            <div class="flex items-center justify-between p-2.5 rounded-xl border ${isViolation ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'} text-xs">
              <div class="flex items-center gap-2.5 min-w-0">
                <img src="${s.photoUrl || liveSnapshotUrl}" class="w-10 h-10 rounded-lg object-cover border border-slate-300 shadow-sm shrink-0">
                <div class="min-w-0">
                  <div class="flex items-center gap-1.5">
                    <p class="font-bold text-slate-900 truncate">${s.name}</p>
                    ${distBadge}
                  </div>
                  <p class="text-[10px] font-mono text-slate-500">${s.regNo} · ${s.department} Yr ${s.year}-${s.section}</p>
                  <p class="text-[11px] font-semibold ${isViolation ? 'text-rose-700' : 'text-emerald-700'} truncate">
                    ${isViolation ? '🚨 Class in Session (Roaming Violation)' : (sched ? sched.badge : 'Authorized')}
                  </p>
                </div>
              </div>
              <div class="text-right shrink-0 ml-2">
                <span class="${isViolation ? 'bg-rose-600' : 'bg-emerald-600'} text-white font-mono text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
                  ${m.conf}% Match
                </span>
                <button onclick="triggerVerification('${s.regNo}', '${liveSnapshotUrl}', ${m.conf})" class="mt-1 block text-[11px] font-bold ${isViolation ? 'text-rose-700 hover:text-rose-900' : 'text-emerald-700 hover:text-emerald-900'} underline cursor-pointer">
                  Details &rarr;
                </button>
              </div>
            </div>
          `;
        });

        if (matches.length >= 2) {
          html += `
            <button onclick="dispatchMultiDetectedGroup(${JSON.stringify(matches.map(m => m.student.regNo)).replace(/"/g, '&quot;')}, '${liveSnapshotUrl}')" class="w-full bg-rose-600 hover:bg-rose-500 text-white font-bold py-2 rounded-xl text-xs transition shadow-md flex items-center justify-center gap-2 active:scale-95 cursor-pointer">
              <i class="fa-solid fa-bullhorn"></i>
              <span>Alert HOD for All ${matches.length} Roaming Students</span>
            </button>
          `;
        }

        html += `
            </div>
          </div>
        `;
        resultArea.innerHTML = html;
      }

      showToast(`⚡ ${matches.length} student${matches.length > 1 ? 's' : ''} verified in ${scanResult.durationMs}ms from photo`);
    } else {
      const freezeIndicatorText = document.getElementById('snap-frozen-text');
      if (freezeIndicatorText) {
        freezeIndicatorText.innerText = '📸 Photo Analyzed · No match';
      }
      if (resultArea) {
        const scanProblem = scanResult.error || (scanResult.busy ? 'Scanner is busy. Please try again.' : '');
        const failureTitle = scanProblem ? 'Scanner Could Not Complete the Match' : (scanResult.reason === 'ambiguous' ? 'Similar Faces — Manual Verification Needed' : 'No Reliable Match');
        const reasonMessages = {
          ambiguous: 'Two or more enrolled face profiles are too similar to distinguish reliably (this can happen with twins). Do not guess. Verify using the student ID/QR or an authorized staff member.',
          inconsistent: 'The identity did not match consistently across camera frames. Ask the student to face the camera, move into good light, uncover the face where practical, and retry. Use student ID/staff verification if it still fails.',
          lowQuality: 'The face image or saved face profile is not usable. Use a clear, single-person photo and re-enroll with up to 3 current photos.',
          lowSimilarity: 'The face did not match an enrolled profile closely enough. Blur, face covering, angle, or changed appearance may contribute. Retry with a clear view or verify by student ID/staff.',
          unknown: `Checked up to ${scanFrames.length} frames in ${scanResult.durationMs || 0}ms, but no enrolled face passed the match checks. Ask the student to face the camera or re-enroll with 2–3 clear photos.`
        };
        const failureMessage = scanProblem || reasonMessages[scanResult.reason] || reasonMessages.unknown;
        resultArea.innerHTML = `
          <div class="space-y-2.5 w-full">
            <div class="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-800 w-full">
              <i class="fa-solid fa-triangle-exclamation text-amber-600 text-base shrink-0"></i>
              <div>
                <p class="font-bold text-slate-800">${failureTitle}</p>
                <p class="text-[11px] text-amber-700">${failureMessage}</p>
              </div>
            </div>
            <button type="button" onclick="unfreezeScannerView()" class="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2 rounded-xl text-xs transition border border-slate-300 flex items-center justify-center gap-1.5 cursor-pointer">
              <i class="fa-solid fa-camera-rotate"></i>
              <span>Retake Photo / Resume Camera</span>
            </button>
          </div>
        `;
      }
      showToast(scanResult.error || (scanResult.busy ? 'Scanner is busy. Please try again.' : 'No registered students recognized after retrying frames.'));
    }
  } catch (err) {
    console.error('Snap error:', err);
    showToast('Scan error: ' + (err.message || 'Error'));
  } finally {
    if (snapBtn) {
      snapBtn.disabled = false;
      snapBtn.classList.remove('opacity-80', 'cursor-not-allowed');
      snapBtn.innerHTML = `
        <i class="fa-solid fa-bolt-lightning text-amber-300 text-base"></i>
        <span>Snap &amp; Verify Student</span>
      `;
    }
  }
}

/**
 * Continuous Live Auto-Scan Loop with Adaptive Throttling.
 */
function startLiveAutoScanLoop() {
  if (liveScanAnimFrame) {
    cancelAnimationFrame(liveScanAnimFrame);
    liveScanAnimFrame = null;
  }

  const loop = async (timestamp) => {
    if (scanWorkflow !== 'live' || isDetectionPaused) {
      return;
    }

    // Adaptive throttle: Near=70ms (~14 FPS), Far=130ms (~8 FPS), Auto=90ms (~11 FPS)
    const throttleMs = scanDistanceMode === 'near' ? 70 : (scanDistanceMode === 'far' ? 130 : 90);

    if (timestamp - lastLiveFrameTime >= throttleMs && !detectionInProgress) {
      lastLiveFrameTime = timestamp;
      const res = await executeUltraFastScan(false);

      const now = Date.now();
      const seenThisPass = new Set((res && res.matches ? res.matches : []).map(m => String(m.regNo)));
      // Keep only recent evidence. A one-frame match is not enough to trigger an alert.
      for (const [regNo, evidence] of liveRecognitionEvidence.entries()) {
        evidence.times = evidence.times.filter(t => now - t <= 650);
        if (!evidence.times.length) liveRecognitionEvidence.delete(regNo);
      }
      for (const m of (res && res.matches ? res.matches : [])) {
        const regNo = String(m.regNo);
        const evidence = liveRecognitionEvidence.get(regNo) || { times: [], best: m };
        evidence.times.push(now);
        evidence.times = evidence.times.filter(t => now - t <= 650);
        if (!evidence.best || m.conf > evidence.best.conf) evidence.best = m;
        liveRecognitionEvidence.set(regNo, evidence);
      }
      const confirmedMatches = [];
      for (const regNo of seenThisPass) {
        const evidence = liveRecognitionEvidence.get(regNo);
        const lastSeen = recentAutoScanStudents.get(regNo) || 0;
        if (evidence && evidence.times.length >= 2 && now - lastSeen >= 12000) {
          confirmedMatches.push(evidence.best);
        }
      }
      if (confirmedMatches.length > 0) {
        const livePhoto = captureScannerFrame(0.80);
        confirmedMatches.forEach(m => {
          recentAutoScanStudents.set(String(m.regNo), now);
          liveRecognitionEvidence.delete(String(m.regNo));
          if (typeof triggerVerification === 'function') {
            triggerVerification(m.regNo, livePhoto, m.conf);
          }
        });
      }
    }

    liveScanAnimFrame = requestAnimationFrame(loop);
  };

  liveScanAnimFrame = requestAnimationFrame(loop);
}

function stopLiveAutoScanLoop() {
  if (liveScanAnimFrame) {
    cancelAnimationFrame(liveScanAnimFrame);
    liveScanAnimFrame = null;
  }
  const canvas = document.getElementById('overlay');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  const badge = document.getElementById('confidence-badge');
  if (badge) badge.classList.add('hidden');
}

/**
 * Helper to create facial embedding from an image source.
 */
async function createFaceDescriptor(imageSource) {
  if (!faceModelsReady) throw new Error('Face models are not ready. Wait for AI models to load.');
  const image = new Image();
  const imageLoaded = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('The selected photo could not be opened.'));
  });
  image.src = imageSource;
  await imageLoaded;

  // Enrollment is tolerant to detector confidence, but never enroll a group image:
  // with twins or classmates in frame, the largest face might belong to the wrong person.
  for (const config of [
    { inputSize: 320, scoreThreshold: 0.25 },
    { inputSize: 416, scoreThreshold: 0.18 },
    { inputSize: 608, scoreThreshold: 0.10 }
  ]) {
    const detections = await faceapi.detectAllFaces(
      image, new faceapi.TinyFaceDetectorOptions(config)
    ).withFaceLandmarks(useTinyLandmarks).withFaceDescriptors();
    const usable = (detections || []).filter(d => {
      const b = d.detection && d.detection.box;
      return b && b.width >= 60 && b.height >= 60 && isValidFaceDescriptor(Array.from(d.descriptor || []));
    });
    if (usable.length > 1) {
      throw new Error('This enrollment photo contains multiple visible faces. Use a photo of only this student.');
    }
    if (usable.length === 1) return Array.from(usable[0].descriptor);
  }
  return null;
}

/**
 * Quick Enroll: Snaps current camera frame and links to student roster.
 */
async function handleQuickEnrollCurrentFace() {
  const video = document.getElementById('webcam');
  if (!video || !videoStream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return showToast('Camera is not active. Please start camera first.');
  }
  if (!faceModelsReady) {
    return showToast('AI models are still initializing, please wait a moment...');
  }

  showToast('Extracting facial embedding from camera frame...');

  try {
    const hiddenCanvas = document.createElement('canvas');
    const width = Math.min(640, video.videoWidth || 640);
    const height = Math.round(width * (video.videoHeight / video.videoWidth || 0.75));
    hiddenCanvas.width = width;
    hiddenCanvas.height = height;
    hiddenCanvas.getContext('2d').drawImage(video, 0, 0, width, height);

    const detectorOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.35 });
    const detection = await faceapi.detectSingleFace(hiddenCanvas, detectorOptions)
      .withFaceLandmarks(useTinyLandmarks)
      .withFaceDescriptor();

    if (!detection) {
      return showToast('No face detected. Look directly into the camera and try again.');
    }

    const photoUrl = hiddenCanvas.toDataURL('image/jpeg', 0.85);
    window._lastCapturedFace = {
      descriptor: Array.from(detection.descriptor),
      photoUrl,
      scorePct: Math.round(detection.detection.score * 100)
    };

    enrollCapturedFaceAsDemoStudent('110324104105');
  } catch (err) {
    console.error('Quick enroll error:', err);
    showToast('Failed to enroll face: ' + err.message);
  }
}

function enrollCapturedFaceAsDemoStudent(regNo = '110324104105') {
  if (!window._lastCapturedFace || !window._lastCapturedFace.descriptor) {
    return showToast('Please snap a photo containing a face first');
  }

  const students = getStudents();
  const student = students.find(s => s.regNo === regNo);
  if (!student) {
    return showToast(`Student ${regNo} not found`);
  }

  student.faceDescriptor = window._lastCapturedFace.descriptor;
  student.photoUrl = window._lastCapturedFace.photoUrl;

  saveStudents(students);
  rebuildFaceMatcher();

  showToast(`Face enrolled successfully for ${student.name} (${student.regNo})!`);
  triggerVerification(student.regNo, student.photoUrl, 98);
}

// Explicit window bindings
window.initAI = initAI;
window.executeUltraFastScan = executeUltraFastScan;
window.handleSnapAndVerify = handleSnapAndVerify;
window.freezeScannerView = freezeScannerView;
window.unfreezeScannerView = unfreezeScannerView;
window.setDistanceMode = setDistanceMode;
window.setScanWorkflow = setScanWorkflow;
window.setZoomMultiplier = setZoomMultiplier;
window.handleZoomSlider = handleZoomSlider;
window.handleQuickEnrollCurrentFace = handleQuickEnrollCurrentFace;
window.enrollCapturedFaceAsDemoStudent = enrollCapturedFaceAsDemoStudent;

