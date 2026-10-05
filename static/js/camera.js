/* ==========================================================================
   CampusTrack AI Enterprise - Hardware Camera, Torch, Zoom & Python Streamer
   ========================================================================== */

let videoStream = null;
let isTorchOn = false;
let currentCameraFacing = 'environment';
let isSendingBackendFrame = false;

async function requestCameraStart() {
  const fallback = document.getElementById('cam-fallback');
  const video = document.getElementById('webcam');
  const canvas = document.getElementById('overlay');
  if (fallback) fallback.classList.add('hidden');

  if (!navigator.mediaDevices?.getUserMedia) {
    if (fallback) {
      fallback.classList.remove('hidden');
      fallback.querySelector('h3').innerText = 'Secure Connection Required';
      fallback.querySelector('p').innerText = 'Open CampusTrack using HTTPS and allow camera access in your browser settings.';
    }
    showToast('Camera requires HTTPS on mobile browsers');
    return;
  }

  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
  }

  // Mobile-optimized constraints
  const constraintsList = [
    { video: { facingMode: currentCameraFacing, width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, frameRate: { ideal: 24, max: 30 } }, audio: false },
    { video: { facingMode: 'user', width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, frameRate: { ideal: 24, max: 30 } }, audio: false },
    { video: true, audio: false }
  ];

  for (const constraints of constraintsList) {
    try {
      videoStream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoStream) break;
    } catch (e) {
      console.warn('Retrying camera constraint:', e.message);
    }
  }

  if (!videoStream) {
    if (fallback) fallback.classList.remove('hidden');
    showToast('Camera blocked or not found. Simulator active.');
    return;
  }

  if (video) {
    video.srcObject = videoStream;
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');
    video.muted = true;

    video.onloadedmetadata = () => {
      video.play().then(() => {
        if (canvas) {
          canvas.width = video.videoWidth || 1280;
          canvas.height = video.videoHeight || 720;
        }
        configureCameraZoom();
<<<<<<< HEAD
        attachSnapButtonListener();
=======
        if (typeof startContinuousDetectionLoop === 'function') {
          startContinuousDetectionLoop();
        }
>>>>>>> 10bcec3ce5ac1e390fc7495d9f0972c707464dce
      }).catch(err => console.error("Video play error:", err));
    };
  }
}

async function toggleTorch() {
  if (!videoStream) return showToast('Camera stream is not active');
  const track = videoStream.getVideoTracks()[0];
  if (!track) return showToast('No active video track');

  const capabilities = track.getCapabilities ? track.getCapabilities() : {};
  if (!capabilities.torch) return showToast('Flashlight not supported on this device/camera');

  try {
    isTorchOn = !isTorchOn;
    await track.applyConstraints({ advanced: [{ torch: isTorchOn }] });
    const btn = document.getElementById('btn-torch');
    if (btn) {
      btn.className = isTorchOn
        ? "w-8 h-8 sm:w-9 sm:h-9 bg-amber-500 text-white rounded-xl flex items-center justify-center transition active:scale-95 shadow-md shadow-amber-500/50"
        : "w-8 h-8 sm:w-9 sm:h-9 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl flex items-center justify-center transition border border-slate-200";
    }
    showToast(isTorchOn ? 'Torch ON' : 'Torch OFF');
  } catch (err) {
    showToast('Could not toggle flashlight');
  }
}

function toggleScanner() {
  const button = document.getElementById('btn-scanner-toggle');
  const video = document.getElementById('webcam');
  if (isDetectionPaused) {
    isDetectionPaused = false;
    video?.play().catch(() => { });
    if (button) {
      button.className = 'bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 shadow-md shadow-rose-600/20 active:scale-95';
      button.innerHTML = '<i class="fa-solid fa-stop text-[11px]"></i><span>Stop</span>';
    }
    showToast('Scanner resumed');
  } else {
    isDetectionPaused = true;
    video?.pause();
    if (button) {
      button.className = 'bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 shadow-md shadow-emerald-600/20 active:scale-95';
      button.innerHTML = '<i class="fa-solid fa-play text-[11px]"></i><span>Resume</span>';
    }
    showToast('Scanner stopped');
  }
}

function pauseScannerInternal() {
  isDetectionPaused = true;
  const video = document.getElementById('webcam');
  if (video) video.pause();
}

function resumeScanner(resetSelection = false) {
  isDetectionPaused = false;
  const video = document.getElementById('webcam');
  if (video) video.play().catch(() => { });
  const badge = document.getElementById('confidence-badge');
  if (badge) badge.classList.add('hidden');
  const scannerButton = document.getElementById('btn-scanner-toggle');
  if (scannerButton) {
    scannerButton.className = 'bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 shadow-md shadow-rose-600/20 active:scale-95';
    scannerButton.innerHTML = '<i class="fa-solid fa-stop text-[11px]"></i><span>Stop</span>';
  }
}

function toggleCameraFacing() {
  currentCameraFacing = currentCameraFacing === 'environment' ? 'user' : 'environment';
  requestCameraStart();
  showToast(`Switched to ${currentCameraFacing === 'user' ? 'Front' : 'Rear'} Camera`);
}

function setScanMode(mode) {
  scanMode = mode === 'snap' ? 'snap' : 'auto';
  clearTimeout(autoScanFlushTimer);
  autoScanFlushTimer = null;
  autoScanCandidates.clear();
<<<<<<< HEAD
  const autoBtn = document.getElementById('btn-scan-auto');
  if (autoBtn) {
    autoBtn.className = scanMode === 'auto'
      ? 'px-3 py-1.5 rounded-lg bg-cyan-700 text-white text-xs font-semibold'
      : 'px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold';
  }
  const snapBtn = document.getElementById('btn-scan-snap');
  if (snapBtn) {
    snapBtn.className = scanMode === 'snap'
      ? 'px-3 py-1.5 rounded-lg bg-cyan-700 text-white text-xs font-semibold'
      : 'px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold';
  }
  const snapScanBtn = document.getElementById('btn-snap-scan');
  if (snapScanBtn) snapScanBtn.classList.toggle('hidden', scanMode !== 'snap');
  const statusEl = document.getElementById('scan-capture-status');
  if (statusEl) {
    statusEl.innerText = scanMode === 'auto'
      ? 'Automatic mode continuously scans the camera preview; Snap captures a still photo only when pressed.'
      : 'Snap mode does not capture until you press Snap & Scan.';
  }
=======
  document.getElementById('btn-scan-auto').className = scanMode === 'auto'
    ? 'px-3 py-1.5 rounded-lg bg-cyan-700 text-white text-xs font-semibold'
    : 'px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold';
  document.getElementById('btn-scan-snap').className = scanMode === 'snap'
    ? 'px-3 py-1.5 rounded-lg bg-cyan-700 text-white text-xs font-semibold'
    : 'px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold';
  document.getElementById('btn-snap-scan').classList.toggle('hidden', scanMode !== 'snap');
  document.getElementById('scan-capture-status').innerText = scanMode === 'auto'
    ? 'Automatic mode continuously scans the camera preview; Snap captures a still photo only when pressed.'
    : 'Snap mode does not capture until you press Snap & Scan.';
>>>>>>> 10bcec3ce5ac1e390fc7495d9f0972c707464dce
  showToast(scanMode === 'auto' ? 'Automatic scanning enabled' : 'Snap mode enabled');
}

function configureCameraZoom() {
  const zoomControl = document.getElementById('camera-zoom');
  const track = videoStream?.getVideoTracks()[0];
  if (!zoomControl || !track) return;

  const capabilities = track.getCapabilities ? track.getCapabilities() : {};
  if (!capabilities.zoom) {
    zoomControl.disabled = true;
    return;
  }

  zoomControl.disabled = false;
  zoomControl.min = capabilities.zoom.min;
  zoomControl.max = capabilities.zoom.max;
  zoomControl.step = capabilities.zoom.step || 0.1;
  zoomControl.value = 1;
  zoomControl.oninput = async (e) => {
    try {
      await track.applyConstraints({ advanced: [{ zoom: parseFloat(e.target.value) }] });
    } catch (err) {
      console.warn('Zoom failed:', err);
    }
  };
}

function captureScannerFrame(quality = 0.78) {
  const video = document.getElementById('webcam');
  if (!video) return '';
  const snapshot = document.createElement('canvas');
  snapshot.width = video.videoWidth || 1280;
  snapshot.height = video.videoHeight || 720;
  const ctx = snapshot.getContext('2d');
  ctx.drawImage(video, 0, 0);
  return snapshot.toDataURL('image/jpeg', quality);
}

function simulateStudentSelection(regNo) {
  if (!regNo) return resumeScanner(true);
  const student = getStudents().find(s => s.regNo === regNo);
  if (!student) return;
  triggerVerification(student.regNo, student.photoUrl, 98);
}

/**
<<<<<<< HEAD
 * Manual "Snap & Verify Face" workflow.
 * Captures the current frame from the camera video stream onto a hidden canvas,
 * converts it to a JPEG blob (quality 0.85), sends via POST FormData to /verify-face,
 * displays a loading state ("Verifying..."), and safely handles success and error responses.
 */
async function handleSnapAndVerify() {
  const video = document.getElementById('webcam');
  const snapBtn = document.getElementById('snap-btn');
  const resultArea = document.getElementById('verify-result');
  const overlayCanvas = document.getElementById('overlay');

  if (!video || !videoStream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    if (resultArea) {
      resultArea.innerHTML = `
        <div class="flex items-center gap-2.5 text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs w-full">
          <i class="fa-solid fa-triangle-exclamation text-amber-500 text-sm"></i>
          <span>Camera stream is inactive or initializing. Please ensure camera access is granted.</span>
        </div>
      `;
    }
    showToast('Camera is not active or ready');
    return;
  }

  // 1. Show UI loading state ("Verifying...")
  const originalBtnHtml = snapBtn ? snapBtn.innerHTML : '';
  if (snapBtn) {
    snapBtn.disabled = true;
    snapBtn.classList.add('opacity-75', 'cursor-not-allowed');
    snapBtn.innerHTML = `
      <i class="fa-solid fa-circle-notch fa-spin text-base"></i>
      <span>Verifying...</span>
    `;
  }

  if (resultArea) {
    resultArea.innerHTML = `
      <div class="flex items-center gap-3 text-cyan-800 bg-cyan-50 border border-cyan-200 rounded-xl p-3.5 text-xs font-medium w-full">
        <i class="fa-solid fa-circle-notch fa-spin text-cyan-600 text-base"></i>
        <div>
          <p class="font-bold text-slate-800">Verifying...</p>
          <p class="text-[11px] text-slate-500">Extracting frame and running neural face verification via backend...</p>
        </div>
      </div>
    `;
  }

  try {
    // 2. Capture current frame from video onto hidden canvas
    const hiddenCanvas = document.createElement('canvas');
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    hiddenCanvas.width = width;
    hiddenCanvas.height = height;

    const ctx = hiddenCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0, width, height);

    // 3. Convert to JPEG blob with quality ~0.85
    const blob = await new Promise((resolve) => {
      hiddenCanvas.toBlob(resolve, 'image/jpeg', 0.85);
    });

    if (!blob) {
      throw new Error('Failed to create snapshot blob from camera');
    }

    // 4. Send via POST FormData to backend endpoint /verify-face
    const formData = new FormData();
    formData.append('file', blob, 'snapshot.jpg');

    let endpoint = '/verify-face';
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        body: formData
      });
      if (response.status === 404) {
        throw new Error('Local route 404; redirecting to fallback backend');
      }
    } catch (netErr) {
      // Fallback for standalone preview environments where backend runs on port 8000 or Render
      const isLocal = !window.location.hostname || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const fallbackUrl = isLocal
        ? 'http://localhost:8000/verify-face'
        : 'https://roaming-detector-backend.onrender.com/verify-face';
      response = await fetch(fallbackUrl, {
        method: 'POST',
        body: formData
      });
    }

    if (!response.ok) {
      let errDetail = `Server error HTTP ${response.status}`;
      try {
        const errJson = await response.json();
        if (errJson.detail) errDetail = errJson.detail;
      } catch (e) { }
      throw new Error(errDetail);
    }

    const data = await response.json();

    // 5. Draw bounding box on overlay canvas if available
    if (overlayCanvas) {
      overlayCanvas.width = width;
      overlayCanvas.height = height;
      const overlayCtx = overlayCanvas.getContext('2d');
      overlayCtx.clearRect(0, 0, width, height);

      if (data.status === 'success' && Array.isArray(data.faces)) {
        data.faces.forEach((face) => {
          if (Array.isArray(face.bbox) && face.bbox.length === 4) {
            const [x1, y1, x2, y2] = face.bbox;
            overlayCtx.strokeStyle = '#06b6d4';
            overlayCtx.lineWidth = 3;
            overlayCtx.strokeRect(x1, y1, x2 - x1, y2 - y1);

            overlayCtx.fillStyle = 'rgba(6, 182, 212, 0.9)';
            const scoreLabel = `Score: ${(face.det_score * 100).toFixed(1)}%`;
            overlayCtx.font = 'bold 12px monospace';
            const textWidth = overlayCtx.measureText(scoreLabel).width;
            overlayCtx.fillRect(x1, Math.max(0, y1 - 20), textWidth + 8, 20);

            overlayCtx.fillStyle = '#ffffff';
            overlayCtx.fillText(scoreLabel, x1 + 4, Math.max(14, y1 - 5));
          }
        });
      }
    }

    // 6. Safely handle success or error results
    if (data.status === 'success' && Array.isArray(data.faces) && data.faces.length > 0) {
      const faceCount = data.faces.length;
      const bestScore = Math.max(...data.faces.map(f => f.det_score || 0));
      const scorePct = (bestScore * 100).toFixed(1);

      if (resultArea) {
        resultArea.innerHTML = `
          <div class="space-y-2 w-full">
            <div class="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs">
              <div class="flex items-center gap-2 text-emerald-800 font-semibold">
                <i class="fa-solid fa-circle-check text-emerald-600 text-base"></i>
                <div>
                  <p class="font-bold text-slate-800">Face Verified</p>
                  <p class="text-[11px] text-emerald-700">${faceCount} face${faceCount > 1 ? 's' : ''} detected successfully</p>
                </div>
              </div>
              <span class="bg-emerald-600 text-white font-mono text-[11px] font-bold px-2.5 py-1 rounded-full shadow-sm">
                ${scorePct}% Det. Score
              </span>
            </div>
            <div class="flex items-center justify-between text-[11px] text-slate-500 font-mono px-1">
              <span>Verified at ${new Date().toLocaleTimeString()}</span>
              <span class="text-emerald-700 font-semibold"><i class="fa-solid fa-check mr-1"></i>Backend processed</span>
            </div>
          </div>
        `;
      }
      showToast(`Face verified (${scorePct}% score)`);

      // If client face recognition is loaded, also check if enrolled student matches
      if (typeof detectAndProcessFrame === 'function' && typeof faceModelsReady !== 'undefined' && faceModelsReady) {
        const snapDataUrl = hiddenCanvas.toDataURL('image/jpeg', 0.85);
        const img = new Image();
        img.src = snapDataUrl;
        img.onload = () => {
          detectAndProcessFrame(true, null, img, snapDataUrl);
        };
      }

    } else if (data.status === 'no_face_detected' || (data.status === 'success' && (!data.faces || data.faces.length === 0))) {
      if (resultArea) {
        resultArea.innerHTML = `
          <div class="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-800 w-full">
            <i class="fa-solid fa-triangle-exclamation text-amber-600 text-base shrink-0"></i>
            <div>
              <p class="font-bold text-slate-800">No Face Detected</p>
              <p class="text-[11px] text-amber-700">Please align face inside camera viewfinder reticle and try again.</p>
            </div>
          </div>
        `;
      }
      showToast('No face detected in snapshot');
    } else {
      throw new Error(data.detail || 'Unexpected response status from verification service');
    }

  } catch (error) {
    console.error('Face verification error:', error);
    if (resultArea) {
      resultArea.innerHTML = `
        <div class="flex items-start gap-3 bg-rose-50 border border-rose-200 rounded-xl p-3.5 text-xs text-rose-800 w-full">
          <i class="fa-solid fa-circle-exclamation text-rose-600 text-base shrink-0 mt-0.5"></i>
          <div class="space-y-1 flex-1">
            <p class="font-bold text-slate-800">Verification Error</p>
            <p class="text-[11px] text-rose-700">${error.message || 'Unable to connect to verification backend.'}</p>
            <p class="text-[10px] text-slate-500">Please ensure the backend server is running and try again.</p>
          </div>
        </div>
      `;
    }
    showToast('Verification failed: ' + (error.message || 'Error'));
  } finally {
    if (snapBtn) {
      snapBtn.disabled = false;
      snapBtn.classList.remove('opacity-75', 'cursor-not-allowed');
      snapBtn.innerHTML = originalBtnHtml || `
        <i class="fa-solid fa-camera text-base"></i>
        <span>Snap &amp; Verify Face</span>
      `;
    }
  }
}

/**
 * Attaches click event listener to "snap-btn".
 */
function attachSnapButtonListener() {
  const snapBtn = document.getElementById('snap-btn');
  if (snapBtn && !snapBtn.dataset.bound) {
    snapBtn.dataset.bound = 'true';
    snapBtn.addEventListener('click', handleSnapAndVerify);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', attachSnapButtonListener);
} else {
  attachSnapButtonListener();
}
=======
 * High-performance, non-blocking Python backend streaming.
 * Checks for valid camera frames, handles concurrency lock, and reports face bounding boxes.
 */
async function sendFrameToPythonBackend() {
  const videoElement = document.getElementById('webcam');
  if (!videoElement || videoElement.paused || videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  if (isSendingBackendFrame) return; // Prevent network bottleneck

  isSendingBackendFrame = true;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(640, videoElement.videoWidth || 640);
    canvas.height = Math.min(480, videoElement.videoHeight || 480);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.7));
    if (!blob) return;

    const formData = new FormData();
    formData.append('file', blob, 'frame.jpg');

    const BACKEND_VERIFY_URL = 'https://roaming-detector-backend.onrender.com/verify-face';
    const response = await fetch(BACKEND_VERIFY_URL, {
      method: 'POST',
      body: formData
    });

    if (response.ok) {
      const result = await response.json();
      // Optional logging for debugging backend status
      if (result.status === 'success' && result.faces?.length) {
        console.debug("Backend detected faces:", result.faces.length);
      }
    }
  } catch (error) {
    // Backend offline or unreachable; silently continue
  } finally {
    isSendingBackendFrame = false;
  }
}

// Automatically stream backend snapshot every 3 seconds if active
setInterval(sendFrameToPythonBackend, 3000);
>>>>>>> 10bcec3ce5ac1e390fc7495d9f0972c707464dce
