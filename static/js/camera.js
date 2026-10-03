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
        if (typeof startContinuousDetectionLoop === 'function') {
          startContinuousDetectionLoop();
        }
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
    video?.play().catch(() => {});
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
  if (video) video.play().catch(() => {});
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
