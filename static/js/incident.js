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
  document.getElementById('modal-enrolled-photo').src = student.photoUrl;
  document.getElementById('modal-live-photo').src = livePhoto;

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
    alertBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Save & Alert HOD`;
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

function dispatchIncidentReport(studentList) {
  playCue('alert');

  const logEntry = {
    id: 'INC-' + Date.now().toString().slice(-6),
    timestamp: new Date().toLocaleString(),
    location: studentList[0].location || 'Campus Grounds / Canteen',
    students: studentList,
    status: 'Alert prepared for HOD'
  };
  saveAuditLog(logEntry);
  if (typeof saveIncidentToCloud === 'function') saveIncidentToCloud(logEntry);

  const firstStudent = studentList[0];
  pendingIncidentReport = studentList;
  const recipientEmails = Array.from(new Set(studentList.map(s => String(s.hodEmail || '').trim()).filter(Boolean))).join(', ');
  document.getElementById('mail-recipients').innerText = recipientEmails || 'No HOD email saved';
  document.getElementById('mail-subject').innerText = `URGENT: Campus Roaming Violation (${studentList.length} Student${studentList.length > 1 ? 's' : ''})`;

  const targetPhone = String(firstStudent.hodPhone || '').replace(/\D/g, '');
  const whatsappText = encodeURIComponent(
    `🚨 *CAMPUS ROAMING ALERT - DISCIPLINARY NOTICE*\n\n` +
    `Respected HOD,\n` +
    `The following student was detected roaming during lecture hours:\n\n` +
    `👤 *Name:* ${firstStudent.name}\n` +
    `🆔 *Reg No:* ${firstStudent.regNo}\n` +
    `📚 *Class:* ${firstStudent.department} ${firstStudent.year}-${firstStudent.section}\n` +
    `📍 *Location Caught:* ${firstStudent.location}\n` +
    `⏰ *Skipped Session:* ${firstStudent.scheduledPeriod.subject} (${firstStudent.scheduledPeriod.timeRange})\n` +
    `👨‍🏫 *Faculty:* ${firstStudent.scheduledPeriod.faculty}\n\n` +
    `*CampusTrack Incident ID:* #${logEntry.id}\n` +
    `Dual evidence photo recorded in institution portal.`
  );
  const whatsappLink = document.getElementById('link-direct-whatsapp');
  whatsappLink.dataset.url = targetPhone ? `https://wa.me/${targetPhone}?text=${whatsappText}` : '';
  whatsappLink.dataset.message = decodeURIComponent(whatsappText);
  if (targetPhone) {
    showToast(`Alert ready for HOD mobile ${firstStudent.hodPhone}`);
  } else {
    showToast(`No HOD mobile number saved for ${firstStudent.name}`);
  }

  const emailSubject = `URGENT: Campus Roaming Violation (${studentList.length} Student${studentList.length > 1 ? 's' : ''})`;
  const emailText = studentList.map(student => [
    'CampusTrack Incident Alert',
    `Student: ${student.name} (${student.regNo})`,
    `Class: ${student.department} ${student.year}-${student.section}`,
    `Date and time: ${student.timestamp}`,
    `Location: ${student.location}`,
    `Skipped session: ${student.scheduledPeriod.subject} (${student.scheduledPeriod.timeRange})`,
    `Faculty: ${student.scheduledPeriod.faculty}`,
    `Incident ID: ${logEntry.id}`
  ].join('\n')).join('\n\n');
  const emailLink = document.getElementById('link-direct-email');
  emailLink.dataset.url = recipientEmails
    ? `mailto:${recipientEmails}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailText)}`
    : '';
  emailLink.dataset.recipients = recipientEmails;
  emailLink.dataset.message = emailText;

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; color: #0f172a;">
      <h2 style="color: #dc2626; border-bottom: 2px solid #fee2e2; padding-bottom: 8px; margin-top: 0;">
        Unauthorized Campus Roaming Alert
      </h2>
      <p style="font-size: 13px; color: #475569;">
        The following student(s) were verified roaming outside class hours at <b>${logEntry.location}</b>:
      </p>
      ${studentList.map(s => `
        <div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; margin-bottom: 14px; background: #ffffff;">
          <h3 style="margin: 0 0 6px 0; color: #1e293b;">${s.name} (<span style="color: #4f46e5;">${s.regNo}</span>)</h3>
          <p style="margin: 2px 0 8px 0; font-size: 12px; color: #64748b;">
            Class: <b>${s.department}</b> Yr${s.year}-${s.section} | Advisor: ${s.advisorName}
          </p>
          <div style="background: #fee2e2; border-left: 4px solid #ef4444; padding: 8px 10px; border-radius: 4px; font-size: 12px; color: #991b1b; margin-bottom: 10px;">
            <b>Active Period Skipped:</b> ${s.scheduledPeriod.subject} (${s.scheduledPeriod.timeRange})<br>
            <b>Faculty:</b> ${s.scheduledPeriod.faculty}
          </div>
          <table style="width: 100%; text-align: center;">
            <tr>
              <td style="width: 50%;">
                <span style="font-size: 11px; color: #64748b; display: block; margin-bottom: 4px;">Master Photo</span>
                <img src="${s.photoUrl}" style="width: 120px; height: 120px; object-fit: cover; border-radius: 8px; border: 1px solid #cbd5e1;" />
              </td>
              <td style="width: 50%;">
                <span style="font-size: 11px; color: #dc2626; font-weight: bold; display: block; margin-bottom: 4px;">Live Snapshot</span>
                <img src="${s.capturedLivePhoto}" style="width: 120px; height: 120px; object-fit: cover; border-radius: 8px; border: 2px solid #ef4444;" />
              </td>
            </tr>
          </table>
        </div>
      `).join('')}
      <p style="font-size: 11px; color: #94a3b8; margin-top: 14px;">
        Dispatched via CampusTrack AI Enterprise System at ${new Date().toLocaleString()}.
      </p>
    </div>
  `;

  document.getElementById('mail-body-preview').innerHTML = htmlBody;
  document.getElementById('email-preview-modal').classList.remove('hidden');
  const whatsappButton = document.getElementById('link-direct-whatsapp');
  const emailButton = document.getElementById('link-direct-email');
  pendingIncidentEvidenceFiles = null;
  whatsappButton.disabled = true;
  emailButton.disabled = true;
  showToast('Preparing master photo and live snapshot for HOD');
  createIncidentEvidenceFiles().then(files => {
    pendingIncidentEvidenceFiles = files;
    whatsappButton.disabled = !whatsappLink.dataset.url;
    emailButton.disabled = !emailLink.dataset.url;
    if (files.length) showToast('Both evidence photos are ready to share');
  }).catch(error => {
    console.error('Could not prepare HOD evidence photos:', error);
    showToast('Could not prepare both evidence photos; alert not sent');
  });
}

async function createIncidentEvidenceFiles() {
  const files = [];
  for (const student of pendingIncidentReport) {
    const studentName = String(student.name || student.regNo || 'student').replace(/[^a-z0-9_-]+/gi, '_');
    for (const [label, imageUrl] of [['master-photo', student.photoUrl], ['live-snapshot', student.capturedLivePhoto]]) {
      if (!imageUrl) throw new Error(`Missing ${label} for ${studentName}`);
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`Could not load ${label} for ${studentName}`);
      const imageBlob = await response.blob();
      if (!imageBlob.type.startsWith('image/')) throw new Error(`Invalid ${label} for ${studentName}`);
      const extension = imageBlob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
      files.push(new File([imageBlob], `campustrack-${studentName}-${label}.${extension}`, { type: imageBlob.type }));
    }
  }
  return files;
}

function downloadIncidentEvidence(files) {
  files.forEach(file => {
    const downloadUrl = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 60000);
  });
}

function sendWhatsAppAlert() {
  const whatsappLink = document.getElementById('link-direct-whatsapp');
  const message = whatsappLink.dataset.message || '';
  const imageFiles = pendingIncidentEvidenceFiles;
  if (!imageFiles?.length) return showToast('Evidence photos are not ready');
  if (navigator.share && navigator.canShare?.({ files: imageFiles })) {
    navigator.share({ title: 'CampusTrack Incident Alert', text: message, files: imageFiles }).catch(error => {
      if (error.name !== 'AbortError') showToast('Could not open the share sheet; use email or try again');
    });
    return;
  }

  if (!whatsappLink.dataset.url) return showToast('No HOD mobile number saved');
  downloadIncidentEvidence(imageFiles);
  window.open(whatsappLink.dataset.url, '_blank', 'noopener,noreferrer');
  showToast('Evidence photos downloaded; attach them in WhatsApp before sending');
}

function sendEmailAlert() {
  const emailLink = document.getElementById('link-direct-email');
  if (!emailLink.dataset.url) return showToast('Email alert is not ready');
  const evidenceFiles = pendingIncidentEvidenceFiles;
  if (!evidenceFiles?.length) return showToast('Evidence photos are not ready');
  const shareText = `To: ${emailLink.dataset.recipients}\n\n${emailLink.dataset.message}`;
  if (navigator.share && navigator.canShare?.({ files: evidenceFiles })) {
    navigator.share({ title: 'CampusTrack Incident Alert', text: shareText, files: evidenceFiles }).then(() => {
      showToast('Choose your email app to send the alert with both photos');
    }).catch(error => {
      if (error.name !== 'AbortError') showToast('Could not open the share sheet; try the email draft instead');
    });
    return;
  }
  downloadIncidentEvidence(evidenceFiles);
  window.location.href = emailLink.dataset.url;
  showToast('Evidence photos downloaded; attach them to the email draft before sending');
}

function closeEmailPreviewModal() {
  document.getElementById('email-preview-modal').classList.add('hidden');
  if (typeof resumeScanner === 'function') resumeScanner(true);
}
