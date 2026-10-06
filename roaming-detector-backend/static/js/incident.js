/* ==========================================================================
   CampusTrack AI Enterprise - Incident Reporting, Alerts & Audio Synthesizer
   ========================================================================== */

let synth = null;
let currentIncidentStudent = null;
let pendingIncidentReport = [];
let pendingIncidentEvidenceFiles = null;
let roamingGroup = [];
let lastAutomaticGroupAlert = { signature: '', timestamp: 0 };

function speakVoiceAlert(text) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  }
}

function playCue(type) {
  try {
    if (!synth && window.Tone) {
      synth = new Tone.PolySynth(Tone.Synth).toDestination();
      synth.volume.value = -10;
    }
    if (window.Tone && Tone.context.state !== 'running') {
      Tone.start();
    }
    if (synth) {
      if (type === 'match') synth.triggerAttackRelease(["F#5", "A#5", "C#6"], "16n");
      else if (type === 'alert') synth.triggerAttackRelease(["D4", "G3"], "8n");
      else if (type === 'snap') synth.triggerAttackRelease(["C5", "E5"], "32n");
    }
  } catch (e) {}
}

function createIncidentStudent(student, livePhoto, confidence) {
  const schedule = evaluateStudentTimetable(student);
  const locationSelect = document.getElementById('sel-location');
  const selectedLocation = locationSelect ? locationSelect.value : 'Campus Grounds';
  const incidentStudent = {
    ...student,
    capturedLivePhoto: livePhoto,
    scheduledPeriod: schedule,
    timestamp: new Date().toLocaleString(),
    location: selectedLocation,
    confidence
  };

  saveScanHistory({
    timestamp: incidentStudent.timestamp,
    userId: activeUserId || 'unknown',
    studentName: student.name,
    regNo: student.regNo,
    classKey: normalizeClassKey(student.department, student.year, student.section),
    location: selectedLocation,
    subject: schedule.subject,
    timeRange: schedule.timeRange
  });
  return incidentStudent;
}

function automaticallyDispatchGroup(matches, livePhoto) {
  const students = matches
    .map(match => getStudents().find(student => student.regNo === match.regNo))
    .filter(Boolean);
  const uniqueStudents = Array.from(new Map(students.map(student => [student.regNo, student])).values());
  if (uniqueStudents.length < 2) return;

  const signature = uniqueStudents.map(student => student.regNo).sort().join('|');
  const now = Date.now();
  if (signature === lastAutomaticGroupAlert.signature && now - lastAutomaticGroupAlert.timestamp < 15000) return;

  lastAutomaticGroupAlert = { signature, timestamp: now };
  const incidentStudents = uniqueStudents.map(student => {
    const match = matches.find(item => item.regNo === student.regNo);
    return createIncidentStudent(student, livePhoto, match?.conf || 0);
  });
  roamingGroup = incidentStudents;
  updateGroupTrayUI();
  showToast(`${incidentStudents.length} students detected. Alert ready to send.`);
  dispatchIncidentReport(incidentStudents);
  clearIncidentGroup();
}

function triggerVerification(regNo, livePhoto, confidence) {
  if (typeof pauseScannerInternal === 'function') {
    pauseScannerInternal();
  }

  const student = getStudents().find(s => s.regNo === regNo);
  if (!student) {
    if (typeof resumeScanner === 'function') resumeScanner();
    return;
  }

  const currentIncident = createIncidentStudent(student, livePhoto, confidence);
  const schedule = currentIncident.scheduledPeriod;
  currentIncidentStudent = currentIncident;

  document.getElementById('modal-stu-name').innerText = student.name;
  document.getElementById('modal-stu-reg').innerText = student.regNo;
  document.getElementById('modal-stu-class').innerText = `${student.department} • Yr ${student.year}-${student.section}`;
  document.getElementById('modal-stu-advisor').innerText = student.advisorName || 'Not assigned';
  document.getElementById('modal-stu-hod').innerText = student.hodName || 'Not assigned';
  const hodPhoneEl = document.getElementById('modal-stu-hod-phone');
  if (hodPhoneEl) hodPhoneEl.innerText = student.hodPhone || 'Not assigned';
  document.getElementById('modal-enrolled-photo').src = student.photoUrl;
  document.getElementById('modal-live-photo').src = livePhoto;

  // Pre-cache evidence photos in memory immediately so dispatch is instantaneous
  if (typeof preCacheEvidenceFiles === 'function') {
    preCacheEvidenceFiles(student, livePhoto);
  }

  document.getElementById('modal-period-num').innerText = schedule.badge;
  document.getElementById('modal-period-time').innerText = schedule.timeRange;
  document.getElementById('modal-subject-name').innerText = schedule.subject;
  document.getElementById('modal-faculty-name').innerText = schedule.faculty;
  document.getElementById('modal-notice').innerText = schedule.notice;

  const card = document.getElementById('modal-card-container');
  const banner = document.getElementById('modal-timetable-banner');
  const badge = document.getElementById('modal-status-badge');
  const icon = document.getElementById('modal-timetable-icon');
  const alertBtn = document.getElementById('btn-modal-alert');

  if (schedule.type === 'UNAVAILABLE') {
    card.className = "bg-white border-2 border-amber-400 rounded-3xl max-w-md w-full p-4 sm:p-5 space-y-3.5 shadow-2xl my-auto transition-all duration-300";
    banner.className = "p-3.5 rounded-2xl border-2 flex items-start gap-3 bg-amber-50 border-amber-300 text-amber-900";
    badge.className = "text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300";
    badge.innerHTML = `<i class="fa-solid fa-calendar-xmark mr-1"></i> TIMETABLE REQUIRED`;
    icon.className = "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-amber-100 text-amber-700 text-lg";
    icon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
    alertBtn.className = "bg-slate-100 text-slate-400 font-semibold py-2.5 rounded-xl text-xs border border-slate-200 flex items-center justify-center gap-1.5 cursor-not-allowed opacity-60";
    alertBtn.innerHTML = `<i class="fa-solid fa-ban"></i> No Alert - Schedule Missing`;
    alertBtn.disabled = true;
  } else if (schedule.type === 'BREAK') {
    playCue('match');
    speakVoiceAlert(`Authorized. ${student.name} is on break.`);

    card.className = "bg-white border-2 border-emerald-500 rounded-3xl max-w-md w-full p-4 sm:p-5 space-y-3.5 shadow-2xl my-auto transition-all duration-300";
    banner.className = "p-3.5 rounded-2xl border-2 flex items-start gap-3 bg-emerald-50 border-emerald-300 text-emerald-900";
    badge.className = "text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300";
    badge.innerHTML = `<i class="fa-solid fa-mug-hot mr-1"></i> PERMITTED BREAK`;
    icon.className = "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-emerald-100 text-emerald-700 text-lg";
    icon.innerHTML = '<i class="fa-solid fa-circle-check"></i>';

    alertBtn.className = "bg-slate-100 text-slate-400 font-semibold py-2.5 rounded-xl text-xs border border-slate-200 flex items-center justify-center gap-1.5 cursor-not-allowed opacity-60";
    alertBtn.innerHTML = `<i class="fa-solid fa-check"></i> Break Time (No Alert)`;
    alertBtn.disabled = true;
  } else if (schedule.type === 'SPORTS') {
    playCue('match');
    speakVoiceAlert(`Authorized. ${student.name} is scheduled for sports activity.`);

    card.className = "bg-white border-2 border-cyan-500 rounded-3xl max-w-md w-full p-4 sm:p-5 space-y-3.5 shadow-2xl my-auto transition-all duration-300";
    banner.className = "p-3.5 rounded-2xl border-2 flex items-start gap-3 bg-cyan-50 border-cyan-300 text-cyan-900";
    badge.className = "text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-cyan-100 text-cyan-800 border border-cyan-300";
    badge.innerHTML = `<i class="fa-solid fa-volleyball mr-1"></i> SPORTS / ACTIVITY PERIOD`;
    icon.className = "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-cyan-100 text-cyan-700 text-lg";
    icon.innerHTML = '<i class="fa-solid fa-person-running"></i>';

    alertBtn.className = "bg-slate-100 text-slate-400 font-semibold py-2.5 rounded-xl text-xs border border-slate-200 flex items-center justify-center gap-1.5 cursor-not-allowed opacity-60";
    alertBtn.innerHTML = `<i class="fa-solid fa-check"></i> Sports Hour (Permitted)`;
    alertBtn.disabled = true;
  } else if (schedule.type === 'VIOLATION') {
    playCue('alert');
    speakVoiceAlert(`Warning: ${student.name}, Class in session!`);

    card.className = "bg-white border-2 border-rose-500 rounded-3xl max-w-md w-full p-4 sm:p-5 space-y-3.5 shadow-2xl my-auto transition-all duration-300 animate-pulse";
    banner.className = "p-3.5 rounded-2xl border-2 flex items-start gap-3 bg-rose-50 border-rose-300 text-rose-900";
    badge.className = "text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300";
    badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1"></i> CLASS IN SESSION - VIOLATION`;
    icon.className = "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-rose-100 text-rose-700 text-lg";
    icon.innerHTML = '<i class="fa-solid fa-bell"></i>';

    alertBtn.className = "bg-rose-600 hover:bg-rose-500 text-white font-semibold py-2.5 rounded-xl text-xs shadow-lg shadow-rose-600/30 flex items-center justify-center gap-1.5 active:scale-95 transition cursor-pointer";
    alertBtn.innerHTML = `<i class="fa-solid fa-paper-plane mr-1"></i> Send Alert Message to HOD`;
    alertBtn.disabled = false;
  } else {
    card.className = "bg-white border-2 border-slate-300 rounded-3xl max-w-md w-full p-4 sm:p-5 space-y-3.5 shadow-2xl my-auto transition-all duration-300";
    banner.className = "p-3.5 rounded-2xl border flex items-start gap-3 bg-slate-50 border-slate-200 text-slate-700";
    badge.className = "text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200";
    badge.innerText = schedule.badge;
    icon.className = "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-slate-100 text-slate-600 text-lg";
    icon.innerHTML = '<i class="fa-solid fa-door-open"></i>';

    alertBtn.className = "bg-slate-100 text-slate-400 font-semibold py-2.5 rounded-xl text-xs border border-slate-200 flex items-center justify-center gap-1.5 cursor-not-allowed opacity-60";
    alertBtn.innerHTML = `<i class="fa-solid fa-check"></i> Free Period`;
    alertBtn.disabled = true;
  }

  document.getElementById('verify-modal').classList.remove('hidden');
}

function dismissVerificationModal() {
  document.getElementById('verify-modal').classList.add('hidden');
  currentIncidentStudent = null;
  if (typeof resumeScanner === 'function') resumeScanner();
}

function addToIncidentGroup() {
  if (!currentIncidentStudent) return;
  if (!roamingGroup.find(s => s.regNo === currentIncidentStudent.regNo)) {
    roamingGroup.push(currentIncidentStudent);
    updateGroupTrayUI();
    showToast(`Added ${currentIncidentStudent.name} to Roaming Queue`);
  }
  document.getElementById('verify-modal').classList.add('hidden');
  if (typeof resumeScanner === 'function') resumeScanner(true);
}

function updateGroupTrayUI() {
  const tray = document.getElementById('group-tray');
  const thumbs = document.getElementById('group-thumbnails');
  const count = document.getElementById('group-count');
  if (!tray || !thumbs || !count) return;

  if (roamingGroup.length === 0) {
    tray.classList.add('hidden');
    return;
  }

  tray.classList.remove('hidden');
  count.innerText = roamingGroup.length;
  thumbs.innerHTML = roamingGroup.map(s => `
    <div class="relative shrink-0 text-center">
      <img src="${s.capturedLivePhoto}" class="w-12 h-12 rounded-xl object-cover border-2 border-rose-500 shadow-sm">
      <p class="text-[9px] font-mono text-slate-700 truncate w-12 mt-0.5">${s.name.split(' ')[0]}</p>
    </div>
  `).join('');
}

function clearIncidentGroup() {
  roamingGroup = [];
  updateGroupTrayUI();
  showToast('Roaming queue cleared');
}

function dispatchSingleAlert() {
  if (!currentIncidentStudent) return;
  const group = [currentIncidentStudent];
  document.getElementById('verify-modal').classList.add('hidden');
  dispatchIncidentReport(group);
}

function dispatchGroupAlert() {
  if (roamingGroup.length === 0) return;
  dispatchIncidentReport([...roamingGroup]);
  clearIncidentGroup();
}

// --- DUAL EVIDENCE COMPOSITE FRAME GENERATOR (MASTER + LIVE IN SAME FRAME) ---

async function loadImageSafe(src) {
  if (!src) return null;
  return new Promise(async (resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = async () => {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error('Fetch failed');
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        const retryImg = new Image();
        retryImg.onload = () => {
          URL.revokeObjectURL(objUrl);
          resolve(retryImg);
        };
        retryImg.onerror = () => resolve(null);
        retryImg.src = objUrl;
      } catch (e) {
        console.warn('Could not load image for canvas frame:', e);
        resolve(null);
      }
    };
    img.src = src;
  });
}

function drawCoverImage(ctx, img, x, y, w, h) {
  if (!img) {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Photo Not Available', x + w / 2, y + h / 2);
    ctx.textAlign = 'left';
    return;
  }
  const imgRatio = img.width / img.height;
  const targetRatio = w / h;
  let sx, sy, sw, sh;
  if (imgRatio > targetRatio) {
    sh = img.height;
    sw = sh * targetRatio;
    sy = 0;
    sx = (img.width - sw) / 2;
  } else {
    sw = img.width;
    sh = sw / targetRatio;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function drawPhotoBox(ctx, x, y, width, height, img, label, headerColor, headerBg) {
  // Box Background
  ctx.fillStyle = '#020617';
  ctx.fillRect(x, y, width, height);

  // Border
  ctx.lineWidth = 2;
  ctx.strokeStyle = headerColor;
  ctx.strokeRect(x, y, width, height);

  // Top Badge Header
  ctx.fillStyle = headerBg;
  ctx.fillRect(x, y, width, 34);
  ctx.fillStyle = headerColor;
  ctx.font = 'bold 12px monospace';
  ctx.fillText(label, x + 12, y + 22);

  // Draw Photo
  const photoY = y + 34;
  const photoHeight = height - 34;
  drawCoverImage(ctx, img, x + 2, photoY + 2, width - 4, photoHeight - 4);
}

async function createCompositeEvidenceFrame(student, masterPhotoUrl, livePhotoUrl, incidentId) {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 680;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Outer border
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#e11d48';
  ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

  // Top Header Banner
  const headerGrad = ctx.createLinearGradient(0, 0, canvas.width, 0);
  headerGrad.addColorStop(0, '#be123c');
  headerGrad.addColorStop(1, '#881337');
  ctx.fillStyle = headerGrad;
  ctx.fillRect(8, 8, canvas.width - 16, 75);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px Arial, sans-serif';
  ctx.fillText('🚨 STUDENT ROAMING DETECTOR - DISCIPLINARY EVIDENCE', 28, 42);

  ctx.fillStyle = '#fecdd3';
  ctx.font = '13px monospace';
  const timestamp = student.timestamp || new Date().toLocaleString();
  const location = student.location || 'Campus Grounds';
  ctx.fillText(`INCIDENT ID: #${incidentId}  |  TIME: ${timestamp}  |  LOCATION: ${location}`, 28, 66);

  // Load photos concurrently
  const [masterImg, liveImg] = await Promise.all([
    loadImageSafe(masterPhotoUrl),
    loadImageSafe(livePhotoUrl)
  ]);

  // Photo coordinates in the same frame
  const boxY = 100;
  const boxWidth = 460;
  const boxHeight = 360;

  // 1. Left Box: Master Photo
  drawPhotoBox(ctx, 28, boxY, boxWidth, boxHeight, masterImg, '📌 ENROLLED MASTER PHOTO (Database)', '#38bdf8', '#0c4a6e');

  // 2. Right Box: Live Camera Snapshot
  drawPhotoBox(ctx, 512, boxY, boxWidth, boxHeight, liveImg, '📸 LIVE CAMERA SNAPSHOT (Caught in Field)', '#f87171', '#450a0a');

  // Bottom Info Card in Same Frame
  const infoY = 480;
  const infoHeight = 175;
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(28, infoY, canvas.width - 56, infoHeight);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#334155';
  ctx.strokeRect(28, infoY, canvas.width - 56, infoHeight);

  // Student Details
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px Arial, sans-serif';
  ctx.fillText(`${student.name} (${student.regNo})`, 48, infoY + 34);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '14px Arial, sans-serif';
  ctx.fillText(`Class: ${student.department} - Year ${student.year} (${student.section})   |   Advisor: ${student.advisorName || 'Not assigned'}`, 48, infoY + 62);

  // HOD Details
  const hodName = student.hodName || 'HOD';
  const hodPhone = student.hodPhone || 'Not assigned';
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 14px Arial, sans-serif';
  ctx.fillText(`Recipient HOD: ${hodName}   |   HOD Mobile: ${hodPhone}`, 48, infoY + 90);

  // Violation box
  const violBoxY = infoY + 104;
  ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
  ctx.fillRect(44, violBoxY, canvas.width - 88, 54);
  ctx.strokeStyle = '#ef4444';
  ctx.strokeRect(44, violBoxY, canvas.width - 88, 54);

  const sched = student.scheduledPeriod || {};
  ctx.fillStyle = '#fca5a5';
  ctx.font = 'bold 14px Arial, sans-serif';
  ctx.fillText(`VIOLATION: Skipped "${sched.subject || 'Class'}" (${sched.timeRange || '--:--'})`, 58, violBoxY + 24);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '12px Arial, sans-serif';
  ctx.fillText(`Faculty: ${sched.faculty || 'Faculty in charge'}   |   Tamper-Evident Dual Evidence Frame`, 58, violBoxY + 44);

  return canvas;
}

let _preRenderedCanvas = null;
async function preCacheEvidenceFiles(student, livePhoto) {
  if (!student) return;
  try {
    _preRenderedCanvas = await createCompositeEvidenceFrame(student, student.photoUrl, livePhoto, 'PREVIEW');
  } catch (err) {
    console.warn('Pre-render frame error:', err);
  }
}

async function sendAlertToBackend(studentList, logEntry, alertMessage, compositeFrameDataUrl) {
  try {
    const firstStudent = studentList[0];
    const payload = {
      hodPhone: firstStudent.hodPhone || '',
      hodName: firstStudent.hodName || '',
      hodEmail: firstStudent.hodEmail || '',
      studentName: firstStudent.name || '',
      regNo: firstStudent.regNo || '',
      department: firstStudent.department || '',
      year: Number(firstStudent.year) || 0,
      section: firstStudent.section || '',
      location: firstStudent.location || 'Campus Grounds',
      period: firstStudent.scheduledPeriod?.subject || '',
      timeRange: firstStudent.scheduledPeriod?.timeRange || '',
      faculty: firstStudent.scheduledPeriod?.faculty || '',
      incidentId: logEntry.id,
      message: alertMessage,
      masterPhoto: firstStudent.photoUrl || '',
      livePhoto: firstStudent.capturedLivePhoto || '',
      compositeFrame: compositeFrameDataUrl || ''
    };

    const resp = await fetch('/api/send-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (resp.ok) {
      const data = await resp.json();
      console.log('[Backend Alert Direct Dispatch]', data);
    }
  } catch (err) {
    // Expected note if running static server (python -m http.server)
  }
}

async function sendUltraMsgDirect(phone, message, imageBase64, settings) {
  try {
    const instance = settings.ultramsgInstance;
    const token = settings.ultramsgToken;
    if (!instance || !token) return;

    showToast(`📡 Sending dual evidence frame directly to HOD via UltraMsg API...`);

    const url = `https://api.ultramsg.com/${instance}/messages/image`;
    const params = new URLSearchParams();
    params.append('token', token);
    params.append('to', phone);
    params.append('image', imageBase64);
    params.append('caption', message);

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const resData = await resp.json();
    if (resData.sent === 'true' || resData.id) {
      showToast(`✅ Evidence frame & alert delivered directly to HOD (${phone}) via WhatsApp API!`);
    } else {
      console.warn('UltraMsg note:', resData);
    }
  } catch (err) {
    console.warn('UltraMsg direct send error:', err);
  }
}

async function uploadEvidenceFrameOnline(blob, incidentId, regNo) {
  if (!blob) return null;

  // 1. Try Firebase Storage if initialized
  if (window.firebase && firebase.storage) {
    try {
      const storageRef = firebase.storage().ref(`incidents/${incidentId}_${regNo}.jpg`);
      const uploadTask = await storageRef.put(blob, { contentType: 'image/jpeg' });
      const downloadUrl = await uploadTask.ref.getDownloadURL();
      if (downloadUrl) {
        console.log('[Firebase Storage Upload OK]', downloadUrl);
        return downloadUrl;
      }
    } catch (fbErr) {
      console.warn('Firebase Storage upload note:', fbErr);
    }
  }

  // 2. Try Freeimage.host API for direct public photo link
  try {
    const formData = new FormData();
    formData.append('key', '6d207e02198a847a53d0a894f8342e34');
    formData.append('action', 'upload');
    formData.append('source', blob, `evidence_${incidentId}.jpg`);
    formData.append('format', 'json');

    const response = await fetch('https://freeimage.host/api/1/upload', {
      method: 'POST',
      body: formData
    });
    const data = await response.json();
    if (data && data.image && data.image.url) {
      console.log('[Freeimage Upload OK]', data.image.url);
      return data.image.url;
    }
  } catch (apiErr) {
    console.warn('Freeimage upload note:', apiErr);
  }

  return null;
}

async function dispatchIncidentReport(studentList) {
  if (!studentList || studentList.length === 0) return;
  playCue('alert');

  // Immediately close verification modal so user workflow is uninterrupted
  const verifyModal = document.getElementById('verify-modal');
  if (verifyModal) verifyModal.classList.add('hidden');
  currentIncidentStudent = null;

  const firstStudent = studentList[0];
  const rawHodPhone = firstStudent.hodPhone || '';
  let cleanPhone = String(rawHodPhone).replace(/\D/g, '');
  if (cleanPhone.length === 10) {
    cleanPhone = '91' + cleanPhone;
  }
  const hodName = firstStudent.hodName || 'HOD';

  const logEntry = {
    id: 'INC-' + Date.now().toString().slice(-6),
    timestamp: new Date().toLocaleString(),
    location: firstStudent.location || 'Campus Grounds / Canteen',
    students: studentList,
    status: `Alert sent to HOD (${cleanPhone || 'No Phone'})`
  };
  saveAuditLog(logEntry);
  if (typeof saveIncidentToCloud === 'function') saveIncidentToCloud(logEntry);

  if (!cleanPhone) {
    showToast(`⚠️ No HOD phone number in database for ${firstStudent.name} (${firstStudent.regNo})`);
    if (typeof resumeScanner === 'function') resumeScanner(true);
    return;
  }

  showToast(`🎨 Generating dual evidence photo frame for HOD (${cleanPhone})...`);

  // 1. Generate the single composite evidence canvas with Master + Live Photo in same frame
  let frameDataUrl = '';
  let frameBlob = null;
  let framePngBlob = null;
  let onlinePhotoUrl = null;
  try {
    const canvas = await createCompositeEvidenceFrame(
      firstStudent,
      firstStudent.photoUrl,
      firstStudent.capturedLivePhoto,
      logEntry.id
    );
    frameDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    frameBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));
    framePngBlob = await new Promise(res => canvas.toBlob(res, 'image/png'));

    // Upload frame online so it displays directly as an image in WhatsApp!
    if (frameBlob) {
      showToast('☁️ Uploading dual evidence photo for WhatsApp preview...');
      onlinePhotoUrl = await uploadEvidenceFrameOnline(frameBlob, logEntry.id, cleanPhone);
    }
  } catch (canvasErr) {
    console.warn('Canvas frame creation note:', canvasErr);
  }

  // Construct official HOD alert message (including the direct photo link)
  let photoSection = '';
  if (onlinePhotoUrl) {
    photoSection = `\n\n🖼️ *DUAL EVIDENCE PHOTO (Master + Live in same frame):*\n👉 ${onlinePhotoUrl}`;
  } else {
    photoSection = `\n\n📸 *DUAL EVIDENCE PHOTO:* Generated & attached (Dual Master + Live photo frame).`;
  }

  let alertMessage = '';
  if (studentList.length === 1) {
    alertMessage =
      `🚨 *CAMPUS ROAMING ALERT - DISCIPLINARY NOTICE*\n\n` +
      `Respected ${hodName},\n` +
      `The following student was detected roaming during lecture hours:\n\n` +
      `👤 *Name:* ${firstStudent.name}\n` +
      `🆔 *Reg No:* ${firstStudent.regNo}\n` +
      `📚 *Class:* ${firstStudent.department} Year ${firstStudent.year}-${firstStudent.section}\n` +
      `👨‍🏫 *Class Advisor:* ${firstStudent.advisorName || 'Not assigned'}\n` +
      `📍 *Location Caught:* ${firstStudent.location}\n` +
      `⏰ *Skipped Session:* ${firstStudent.scheduledPeriod?.subject} (${firstStudent.scheduledPeriod?.timeRange})\n` +
      `👨‍🏫 *Faculty:* ${firstStudent.scheduledPeriod?.faculty}\n\n` +
      `📋 *Incident ID:* #${logEntry.id}\n` +
      `📅 *Date & Time:* ${firstStudent.timestamp}` +
      photoSection + `\n\n` +
      `Dispatched automatically by Student Roaming Detector AI.`;
  } else {
    alertMessage =
      `🚨 *CAMPUS ROAMING ALERT - GROUP VIOLATION*\n\n` +
      `Respected ${hodName},\n` +
      `${studentList.length} students were detected roaming during lecture hours at *${firstStudent.location}*:\n\n` +
      studentList.map((s, idx) =>
        `${idx + 1}. *${s.name}* (${s.regNo}) - ${s.department} Year ${s.year}-${s.section}\n` +
        `   Skipped: ${s.scheduledPeriod?.subject} (${s.scheduledPeriod?.timeRange})`
      ).join('\n\n') +
      `\n\n📋 *Incident ID:* #${logEntry.id}\n` +
      `📅 *Date & Time:* ${new Date().toLocaleString()}` +
      photoSection + `\n\n` +
      `Dispatched automatically by Student Roaming Detector AI.`;
  }

  // 2. Automatically copy the dual-photo frame to clipboard
  if (framePngBlob && navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': framePngBlob })
      ]);
    } catch (clipErr) {
      console.warn('Clipboard write note:', clipErr);
    }
  }

  // 3. Automatically download the dual-photo frame file so it is saved locally
  if (frameDataUrl) {
    try {
      const cleanReg = String(firstStudent.regNo).replace(/[^a-z0-9_-]+/gi, '_');
      const downloadLink = document.createElement('a');
      downloadLink.href = frameDataUrl;
      downloadLink.download = `campustrack-evidence-${cleanReg}-${logEntry.id}.jpg`;
      downloadLink.click();
    } catch (dlErr) {
      console.warn('Download note:', dlErr);
    }
  }

  // 4. Send to backend in background (saves evidence to disk & dispatches if backend running)
  sendAlertToBackend(studentList, logEntry, alertMessage, frameDataUrl).catch(e => console.warn(e));

  // 5. Send via UltraMsg WhatsApp API if configured in Settings
  const settings = (typeof getAppSettings === 'function') ? getAppSettings() : {};
  if (settings.ultramsgInstance && settings.ultramsgToken && frameDataUrl) {
    sendUltraMsgDirect(cleanPhone, alertMessage, frameDataUrl, settings);
  }

  // 6. Automatically open WhatsApp chat directly for that exact HOD phone number!
  // Takes the number from database directly - never asks to select or search a number
  const encodedText = encodeURIComponent(alertMessage);
  const waUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedText}`;
  const win = window.open(waUrl, '_blank');
  if (!win) {
    window.location.href = waUrl;
  }

  showToast(`✅ Dispatched to HOD (${cleanPhone})! Photo link included in message & copied to clipboard.`);
  if (typeof resumeScanner === 'function') resumeScanner(true);
}

function sendWhatsAppAlert() {
  if (pendingIncidentReport?.length) {
    dispatchIncidentReport(pendingIncidentReport);
  }
}

function sendEmailAlert() {
  if (!pendingIncidentReport?.length) return;
  const firstStudent = pendingIncidentReport[0];
  const email = firstStudent.hodEmail || '';
  if (!email) return showToast('No HOD email in database');
  const subject = encodeURIComponent(`URGENT: Campus Roaming Violation - ${firstStudent.name}`);
  const body = encodeURIComponent(`Student: ${firstStudent.name} (${firstStudent.regNo})\nClass: ${firstStudent.department} ${firstStudent.year}-${firstStudent.section}\nLocation: ${firstStudent.location}`);
  window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
}

function closeEmailPreviewModal() {
  document.getElementById('email-preview-modal')?.classList.add('hidden');
  if (typeof resumeScanner === 'function') resumeScanner(true);
}
