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
      // 0.52 distance threshold for robust lighting & angles
      faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.52);
    } else {
      faceMatcher = null;
    }
  } catch (e) {
    console.error("FaceMatcher init error:", e);
  }
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
    if (liveBanner) liveBanner.classList.remove('hidden');
    if (snapContainer) snapContainer.classList.add('hidden');
    startLiveAutoScanLoop();
    showToast('Live Auto-Scan Active: Tracking corridor in real-time');
  } else {
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
async function executeUltraFastScan(manualSnap = false) {
  const video = document.getElementById('webcam');
  const canvas = document.getElementById('overlay');
  const badge = document.getElementById('confidence-badge');

  if (!video || !videoStream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return { matches: [], error: 'Camera stream inactive' };
  }
  if (!faceModelsReady || !faceMatcher) {
    return { matches: [], error: 'AI models initializing' };
  }
  if (detectionInProgress) {
    return { matches: [], busy: true };
  }

  detectionInProgress = true;
  const startTime = performance.now();

  try {
    const origW = video.videoWidth || 1280;
    const origH = video.videoHeight || 720;

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
      rawDetections = await faceapi.detectAllFaces(video, detectorOpts)
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
      cropCtx.drawImage(video, cropOffsetX, cropOffsetY, cropW, cropH, 0, 0, cropW, cropH);

      const detectorOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.16 });
      rawDetections = await faceapi.detectAllFaces(cropCanvas, detectorOpts)
        .withFaceLandmarks(useTinyLandmarks)
        .withFaceDescriptors();

      detectedFromCrop = true;

    } else {
      // 3. AUTO RANGE (SMART PROGRESSIVE HIERARCHICAL):
      // Pass 1: Fast Near/Mid pass (320px)
      const fastOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.25 });
      const pass1Detections = await faceapi.detectAllFaces(video, fastOpts)
        .withFaceLandmarks(useTinyLandmarks)
        .withFaceDescriptors();

      // Check if Pass 1 detected any enrolled student
      let foundEnrolled = false;
      if (pass1Detections && pass1Detections.length > 0) {
        for (const det of pass1Detections) {
          const best = faceMatcher.findBestMatch(det.descriptor);
          if (best && best.label !== 'unknown' && (1 - best.distance) >= 0.48) {
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
        cropCtx.drawImage(video, cropOffsetX, cropOffsetY, cropW, cropH, 0, 0, cropW, cropH);

        const farOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.16 });
        const pass2Detections = await faceapi.detectAllFaces(cropCanvas, farOpts)
          .withFaceLandmarks(useTinyLandmarks)
          .withFaceDescriptors();

        if (pass2Detections && pass2Detections.length > 0) {
          rawDetections = pass2Detections;
          detectedFromCrop = true;
        } else {
          rawDetections = pass1Detections || [];
        }
      }
    }

    // Measure and report speed in HUD
    const durationMs = Math.max(12, Math.round(performance.now() - startTime));
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

        const best = faceMatcher.findBestMatch(det.descriptor);
        const matchConf = Math.min(99, Math.max(15, Math.round((1 - best.distance) * 100)));

        if (best.label !== 'unknown' && matchConf >= 48) {
          const student = students.find(s => s.regNo === best.label);
          if (student) {
            const distance = estimateDistanceMeters(box, origW, origH);
            const sched = typeof evaluateStudentTimetable === 'function' ? evaluateStudentTimetable(student) : null;
            const isViolation = sched && sched.type === 'VIOLATION';

            recognizedMatches.push({
              student,
              regNo: student.regNo,
              conf: matchConf,
              box,
              distance,
              isViolation,
              sched,
              descriptor: Array.from(det.descriptor)
            });
          }
        }
      }
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

        // Auto-clear overlay timer for Snap mode
        if (manualSnap) {
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
 * Instant Snap & Verify Handler attached to the main camera button.
 */
async function handleSnapAndVerify() {
  const snapBtn = document.getElementById('snap-btn');
  const resultArea = document.getElementById('verify-result');
  const video = document.getElementById('webcam');

  if (!video || !videoStream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    showToast('Camera is not active or ready');
    return;
  }

  // 1. Show immediate UI response
  if (snapBtn) {
    snapBtn.disabled = true;
    snapBtn.classList.add('opacity-80', 'cursor-not-allowed');
    snapBtn.innerHTML = `
      <i class="fa-solid fa-circle-notch fa-spin text-base"></i>
      <span>Scanning Faces (Ultra-Fast)...</span>
    `;
  }

  if (resultArea) {
    resultArea.innerHTML = `
      <div class="flex items-center gap-3 text-cyan-800 bg-cyan-50 border border-cyan-200 rounded-xl p-3.5 text-xs font-medium w-full">
        <i class="fa-solid fa-circle-notch fa-spin text-cyan-600 text-base shrink-0"></i>
        <div>
          <p class="font-bold text-slate-800">Processing Viewfinder...</p>
          <p class="text-[11px] text-slate-500">Checking corridor &amp; short range face signatures...</p>
        </div>
      </div>
    `;
  }

  try {
    const scanResult = await executeUltraFastScan(true);
    const matches = scanResult.matches || [];

    if (matches.length > 0) {
      // Capture live snapshot for student record
      const liveSnapshotUrl = captureScannerFrame(0.82);

      // Play audio chime
      if (typeof playCue === 'function') {
        playCue('match');
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
              <span class="text-[10px] font-mono text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                Ready for Next Scan
              </span>
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
                <button onclick="triggerVerification('${s.regNo}', '${liveSnapshotUrl}', ${m.conf})" class="mt-1 block text-[11px] font-bold ${isViolation ? 'text-rose-700 hover:text-rose-900' : 'text-emerald-700 hover:text-emerald-900'} underline">
                  Details &rarr;
                </button>
              </div>
            </div>
          `;
        });

        if (matches.length >= 2) {
          html += `
            <button onclick="dispatchMultiDetectedGroup(${JSON.stringify(matches.map(m => m.student.regNo)).replace(/"/g, '&quot;')}, '${liveSnapshotUrl}')" class="w-full bg-rose-600 hover:bg-rose-500 text-white font-bold py-2 rounded-xl text-xs transition shadow-md flex items-center justify-center gap-2 active:scale-95">
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

      showToast(`⚡ ${matches.length} student${matches.length > 1 ? 's' : ''} verified in ${scanResult.durationMs}ms`);
    } else {
      if (resultArea) {
        resultArea.innerHTML = `
          <div class="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-800 w-full">
            <i class="fa-solid fa-triangle-exclamation text-amber-600 text-base shrink-0"></i>
            <div>
              <p class="font-bold text-slate-800">No Enrolled Students Recognized</p>
              <p class="text-[11px] text-amber-700">Scanned in ${scanResult.durationMs || 30}ms. No registered students matched. Point camera at student and tap Snap.</p>
            </div>
          </div>
        `;
      }
      showToast('No registered students recognized');
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
        <span>Snap &amp; Verify Student (Ultra-Fast)</span>
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

      if (res && res.matches && res.matches.length > 0) {
        const now = Date.now();
        const unseenMatches = res.matches.filter(m => {
          const lastSeen = recentAutoScanStudents.get(m.regNo) || 0;
          return now - lastSeen >= 12000;
        });

        if (unseenMatches.length > 0) {
          const livePhoto = captureScannerFrame(0.80);
          unseenMatches.forEach(m => {
            recentAutoScanStudents.set(m.regNo, now);
            if (typeof triggerVerification === 'function') {
              triggerVerification(m.regNo, livePhoto, m.conf);
            }
          });
        }
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

  const detection = await faceapi.detectSingleFace(
    image,
    new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.35 })
  ).withFaceLandmarks(useTinyLandmarks).withFaceDescriptor();

  return detection ? Array.from(detection.descriptor) : null;
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
window.setDistanceMode = setDistanceMode;
window.setScanWorkflow = setScanWorkflow;
window.setZoomMultiplier = setZoomMultiplier;
window.handleZoomSlider = handleZoomSlider;
window.handleQuickEnrollCurrentFace = handleQuickEnrollCurrentFace;
window.enrollCapturedFaceAsDemoStudent = enrollCapturedFaceAsDemoStudent;

