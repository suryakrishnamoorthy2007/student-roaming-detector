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

  // Mobile and enterprise HD camera constraints (prioritizes 1080p for long-range corridor clarity)
  const constraintsList = [
    { video: { facingMode: currentCameraFacing, width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 30, max: 60 } }, audio: false },
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
        attachSnapButtonListener();
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
  // Keep camera running smoothly for continuous immediate scanning
  isDetectionPaused = false;
}

function resumeScanner(resetSelection = false) {
  isDetectionPaused = false;
  const video = document.getElementById('webcam');
  if (video && video.paused) video.play().catch(() => { });
  const badge = document.getElementById('confidence-badge');
  if (badge) badge.classList.add('hidden');
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
  showToast(scanMode === 'auto' ? 'Automatic scanning enabled' : 'Snap mode enabled');
}

function configureCameraZoom() {
  const zoomControl = document.getElementById('camera-zoom');
  const track = videoStream?.getVideoTracks()[0];
  if (!zoomControl) return;

  const capabilities = track?.getCapabilities ? track.getCapabilities() : {};
  if (capabilities.zoom) {
    zoomControl.min = capabilities.zoom.min || 1;
    zoomControl.max = Math.min(5, capabilities.zoom.max || 3);
    zoomControl.step = capabilities.zoom.step || 0.1;
  } else {
    // Optical & digital zoom assist
    zoomControl.min = 1;
    zoomControl.max = 3;
    zoomControl.step = 0.1;
  }

  zoomControl.disabled = false;
  zoomControl.value = typeof currentZoomLevel === 'number' ? currentZoomLevel : 1;
  const zoomVal = document.getElementById('camera-zoom-value');
  if (zoomVal) zoomVal.innerText = `${(typeof currentZoomLevel === 'number' ? currentZoomLevel : 1).toFixed(1)}x`;

  zoomControl.oninput = (e) => {
    if (typeof handleZoomSlider === 'function') {
      handleZoomSlider(e.target.value);
    }
  };
}

function stopCameraStream() {
  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
  }
  const video = document.getElementById('webcam');
  if (video) {
    video.srcObject = null;
  }
}
window.stopCameraStream = stopCameraStream;

function captureScannerFrame(quality = 0.82) {
  if (window._lastCapturedSnapshotUrl) {
    return window._lastCapturedSnapshotUrl;
  }
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
 * Links a specific detected face descriptor to an enrolled student.
 */
function enrollFaceDescriptorForStudent(regNo, descriptor, photoUrl) {
  const students = getStudents();
  const student = students.find(s => s.regNo === regNo);
  if (!student) return showToast('Student record not found');

  student.faceDescriptor = descriptor;
  if (photoUrl) student.photoUrl = photoUrl;

  saveStudents(students);
  rebuildFaceMatcher();

  showToast(`Face linked to ${student.name}! Tap Snap to re-verify.`);
  if (typeof triggerVerification === 'function') {
    triggerVerification(regNo, photoUrl || student.photoUrl, 98);
  }
}

/**
 * Dispatches a combined group alert for multiple students detected together.
 */
function dispatchMultiDetectedGroup(regNos, livePhoto) {
  const students = getStudents().filter(s => regNos.includes(s.regNo));
  if (students.length === 0) return;

  if (typeof automaticallyDispatchGroup === 'function') {
    const matches = students.map(s => ({ regNo: s.regNo, conf: 96 }));
    automaticallyDispatchGroup(matches, livePhoto);
  } else {
    showToast(`Alert dispatched for ${students.length} students`);
  }
}

/**
 * Attaches click event listener to "snap-btn".
 */
function attachSnapButtonListener() {
  const snapBtn = document.getElementById('snap-btn');
  if (snapBtn && (!snapBtn.dataset || !snapBtn.dataset.bound)) {
    if (!snapBtn.dataset) snapBtn.dataset = {};
    snapBtn.dataset.bound = 'true';
    snapBtn.addEventListener('click', () => {
      if (typeof window.handleSnapAndVerify === 'function') {
        window.handleSnapAndVerify();
      } else if (typeof handleSnapAndVerify === 'function') {
        handleSnapAndVerify();
      }
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', attachSnapButtonListener);
} else {
  attachSnapButtonListener();
}

/**
 * Quick enrollment helper for real-world testing from the scanner view
 */
function openQuickNewStudentModal() {
  const regNo = prompt('Enter Student Register Number (e.g. 110324104199):');
  if (!regNo || !regNo.trim()) return;
  const name = prompt('Enter Student Full Name:');
  if (!name || !name.trim()) return;

  if (window._lastCapturedFace && window._lastCapturedFace.descriptor) {
    const students = getStudents();
    const cleanReg = regNo.trim();
    const cleanName = name.trim();
    const newStudent = {
      regNo: cleanReg,
      name: cleanName,
      department: 'CSE',
      year: 3,
      section: 'B',
      advisorName: 'Class Advisor',
      hodName: 'Dr. Kamal N',
      hodEmail: 'hod.cse@college.edu',
      hodPhone: '+919876543210',
      photoUrl: window._lastCapturedFace.photoUrl,
      faceDescriptor: window._lastCapturedFace.descriptor
    };
    const existingIdx = students.findIndex(s => s.regNo === cleanReg);
    if (existingIdx >= 0) students[existingIdx] = newStudent;
    else students.push(newStudent);

    saveStudents(students);
    rebuildFaceMatcher();
    showToast(`Enrolled ${cleanName} (${cleanReg})!`);
    triggerVerification(cleanReg, window._lastCapturedFace.photoUrl, 98);
  } else {
    showToast('Please snap a photo first before enrolling');
  }
}
