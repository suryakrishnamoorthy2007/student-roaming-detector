/* ==========================================================================
   CampusTrack AI Enterprise - Admin Dashboard, Roster Management & Importer
   ========================================================================== */

let editingStudentRegNo = null;
let tempSnapEnrollUrl = null;

function openAdminAuthModal() {
  document.getElementById('admin-auth-status').innerText = '';
  document.getElementById('auth-user').value = '';
  document.getElementById('auth-pass').value = '';
  document.getElementById('admin-auth-modal').classList.remove('hidden');
  document.getElementById('auth-user').focus();
}

function closeAdminAuthModal() {
  document.getElementById('admin-auth-modal').classList.add('hidden');
}

function handleAdminAuth(event) {
  event.preventDefault();
  const username = document.getElementById('auth-user').value.trim();
  const password = document.getElementById('auth-pass').value;
  if (username !== 'admin' || password !== 'admin123') {
    document.getElementById('admin-auth-status').innerText = 'Invalid admin username or password.';
    return;
  }
  closeAdminAuthModal();
  openAdminDashboard();
}

async function openAdminDashboard() {
  closeUserLoginModal();
  document.getElementById('admin-dashboard-modal').classList.remove('hidden');
  renderAdminStudentData();
  if (typeof loadCloudData === 'function') await loadCloudData();
  if (typeof rebuildFaceMatcher === 'function') rebuildFaceMatcher();
  renderAuditLogs();
  updateTimetableClassesUI();
  renderAdminStudentData();
  renderAdminTimetableData();
  renderAdminUsers();
  renderScanHistory();
}

async function refreshScannerData() {
  if (cloudSyncReady && typeof loadCloudData === 'function') await loadCloudData();
  if (typeof rebuildFaceMatcher === 'function') rebuildFaceMatcher();
  showToast(cloudSyncReady ? 'Scanner data refreshed from cloud' : 'Scanner data refreshed from local cache');
}

async function refreshAdminView() {
  if (cloudSyncReady && typeof loadCloudData === 'function') await loadCloudData();
  if (typeof rebuildFaceMatcher === 'function') rebuildFaceMatcher();
  const activeTab = document.querySelector('.tab-content:not(.hidden)')?.id;
  if (activeTab === 'tab-single' || activeTab === 'tab-bulk') renderAdminStudentData();
  if (activeTab === 'tab-tt') {
    updateTimetableClassesUI();
    renderAdminTimetableData();
  }
  if (activeTab === 'tab-audit') renderAuditLogs();
  if (activeTab === 'tab-users') renderAdminUsers();
  if (activeTab === 'tab-history') renderScanHistory();
  showToast(cloudSyncReady ? 'Current page refreshed from cloud' : 'Current page refreshed from local cache');
}

function closeAdminDashboard() {
  document.getElementById('admin-dashboard-modal').classList.add('hidden');
  isUserAuthenticated = false;
  activeUserId = '';
  openUserLoginModal();
}

function handleAdminLogout() {
  document.getElementById('admin-dashboard-modal')?.classList.add('hidden');
  isUserAuthenticated = false;
  activeUserId = '';
  localStorage.removeItem('CAMPUSTRACK_ACTIVE_SESSION');
  const authUser = document.getElementById('auth-user');
  const authPass = document.getElementById('auth-pass');
  const authStatus = document.getElementById('admin-auth-status');
  if (authUser) authUser.value = '';
  if (authPass) authPass.value = '';
  if (authStatus) authStatus.innerText = '';
  openUserLoginModal();
  showToast('Admin logged out successfully');
}
window.handleAdminLogout = handleAdminLogout;

function switchAdminTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.className = 'tab-btn py-2 rounded-xl text-slate-600 hover:text-slate-900 transition font-semibold';
  });

  const targetTab = document.getElementById(tabId);
  const targetBtn = document.getElementById(`btn-${tabId}`);
  if (targetTab) targetTab.classList.remove('hidden');
  if (targetBtn) targetBtn.className = 'tab-btn py-2 rounded-xl bg-indigo-600 text-white shadow font-semibold transition';

  if (tabId === 'tab-audit') renderAuditLogs();
  if (tabId === 'tab-users') renderAdminUsers();
  if (tabId === 'tab-history') renderScanHistory();
}

function snapCurrentCameraForEnrollment() {
  const video = document.getElementById('webcam');
  if (!video || video.paused) return showToast('Camera is paused or unavailable');
  const c = document.createElement('canvas');
  c.width = video.videoWidth || 1280;
  c.height = video.videoHeight || 720;
  c.getContext('2d').drawImage(video, 0, 0);
  tempSnapEnrollUrl = c.toDataURL('image/jpeg', 0.9);

  const img = document.getElementById('s-preview-img');
  img.src = tempSnapEnrollUrl;
  img.classList.remove('hidden');
  document.getElementById('s-preview-icon').classList.add('hidden');
  showToast('Live frame snapped for enrollment');
}

function editStudentDetails(regNo) {
  const student = getStudents().find(item => item.regNo === regNo);
  if (!student) return showToast('Student details were not found');

  editingStudentRegNo = student.regNo;
  document.getElementById('s-reg').value = student.regNo || '';
  document.getElementById('s-name').value = student.name || '';
  document.getElementById('s-dept').value = student.department || 'CSE';
  document.getElementById('s-year').value = String(student.year || 1);
  document.getElementById('s-sec').value = student.section || 'A';
  document.getElementById('s-advisor').value = student.advisorName || '';
  document.getElementById('s-hod').value = student.hodName || '';
  document.getElementById('s-hod-email').value = student.hodEmail || '';
  document.getElementById('s-hod-phone').value = student.hodPhone || '';

  tempSnapEnrollUrl = student.photoUrl || null;
  const preview = document.getElementById('s-preview-img');
  preview.src = tempSnapEnrollUrl || '';
  preview.classList.toggle('hidden', !tempSnapEnrollUrl);
  document.getElementById('s-preview-icon').classList.toggle('hidden', Boolean(tempSnapEnrollUrl));
  document.getElementById('btn-save-single').innerText = 'Update Student Details & Sync';
  document.getElementById('btn-cancel-edit').classList.remove('hidden');
  switchAdminTab('tab-single');
  document.getElementById('s-name').focus();
  showToast(`Editing ${student.name}`);
}

async function deleteStudent(regNo) {
  const students = getStudents();
  const student = students.find(item => item.regNo === regNo);
  if (!student) return showToast('Student details were not found');
  if (!window.confirm(`Delete ${student.name} (${student.regNo}) and their face recognition data?`)) return;

  if (editingStudentRegNo === regNo) cancelStudentEdit();
  saveStudents(students.filter(item => item.regNo !== regNo));
  renderAdminStudentData();
  const deletedFromCloud = await deleteStudentFromCloud(regNo);
  if (deletedFromCloud) showToast(`Deleted ${student.name} from student records`);
  else if (cloudSyncReady) showToast('Deleted locally, but cloud deletion failed');
  else showToast('Deleted from this device; cloud was unavailable');
}

function cancelStudentEdit() {
  editingStudentRegNo = null;
  tempSnapEnrollUrl = null;
  document.getElementById('form-single').reset();
  const preview = document.getElementById('s-preview-img');
  preview.src = '';
  preview.classList.add('hidden');
  document.getElementById('s-preview-icon').classList.remove('hidden');
  document.getElementById('btn-save-single').innerText = 'Enroll Student & Sync Recognition Model';
  document.getElementById('btn-cancel-edit').classList.add('hidden');
}

async function handleSingleStudentEnroll(e) {
  e.preventDefault();
  if (!tempSnapEnrollUrl) return showToast('Please select or snap a student photo');

  const loader = document.getElementById('single-loader');
  const btn = document.getElementById('btn-save-single');
  loader.classList.remove('hidden');
  btn.disabled = true;

  const regNo = document.getElementById('s-reg').value.trim();
  const name = document.getElementById('s-name').value.trim();
  const department = document.getElementById('s-dept').value;
  const year = parseInt(document.getElementById('s-year').value);
  const section = document.getElementById('s-sec').value;
  const advisorName = document.getElementById('s-advisor').value.trim();
  const hodName = document.getElementById('s-hod').value.trim();
  const hodEmail = document.getElementById('s-hod-email').value.trim();
  const hodPhone = document.getElementById('s-hod-phone').value.trim();
  const currentList = getStudents();
  const previousStudent = currentList.find(student => student.regNo === editingStudentRegNo);

  try {
    const samePhoto = previousStudent?.photoUrl === tempSnapEnrollUrl;
    const descriptor = samePhoto && previousStudent.faceDescriptor?.length === 128
      ? previousStudent.faceDescriptor
      : await createFaceDescriptor(tempSnapEnrollUrl);
    if (!descriptor || descriptor.length !== 128) {
      showToast('No clear face found. Choose a front-facing photo and try again.');
      return;
    }

    const newStudent = {
      regNo, name, department, year, section, advisorName, hodName, hodEmail, hodPhone,
      photoUrl: tempSnapEnrollUrl,
      faceDescriptor: descriptor
    };

    const existingIdx = currentList.findIndex(s => s.regNo === regNo);
    if (existingIdx >= 0) currentList[existingIdx] = newStudent;
    else currentList.push(newStudent);

    saveStudents(currentList);
    await saveStudentToCloud(newStudent);
    renderAdminStudentData();

    showToast(`Enrolled & synced ${name} (${regNo})`);
    cancelStudentEdit();
  } catch (err) {
    console.error('Student enrollment failed:', err);
    showToast(err.message || 'Error during enrollment processing');
  } finally {
    loader.classList.add('hidden');
    btn.disabled = false;
  }
}

function getUploadField(row, ...fieldNames) {
  const normalizedNames = fieldNames.map(name => name.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const key = Object.keys(row).find(name => normalizedNames.includes(name.toLowerCase().replace(/[^a-z0-9]/g, '')));
  return key ? row[key] : '';
}

async function processBulkExcel() {
  const file = document.getElementById('bulk-excel-input').files[0];
  if (!file) return showToast('Select an Excel file first');
  const status = document.getElementById('excel-status');
  status.innerText = 'Reading student records...';

  try {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheetName = workbook.SheetNames.find(name => /student|master|database|import/i.test(name)) || workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    const students = getStudents();
    const studentIndexes = new Map(students.map((student, index) => [String(student.regNo).trim(), index]));
    const changedStudents = new Map();
    let skipped = 0;

    rows.forEach(row => {
      const regNo = String(getUploadField(row, 'regNo', 'registerNumber', 'registrationNumber', 'rollNumber') || '').trim();
      const name = String(getUploadField(row, 'name', 'studentName', 'fullName') || '').trim();
      if (!regNo || !name) {
        skipped++;
        return;
      }

      const previousIndex = studentIndexes.get(regNo);
      const previousStudent = previousIndex === undefined ? null : students[previousIndex];
      const rawYear = getUploadField(row, 'year', 'classYear');
      const parsedYear = rawYear === '' ? (previousStudent?.year || 1) : Number.parseInt(String(rawYear), 10);
      if (!Number.isInteger(parsedYear) || parsedYear < 1 || parsedYear > 4) {
        skipped++;
        return;
      }

      const importedPhoto = String(getUploadField(row, 'photoUrl', 'photo', 'imageUrl') || '').trim();
      const photoUrl = importedPhoto || previousStudent?.photoUrl || '';
      const student = {
        ...previousStudent,
        regNo,
        name,
        department: String(getUploadField(row, 'department', 'dept') || previousStudent?.department || 'CSE').trim().toUpperCase(),
        year: parsedYear,
        section: String(getUploadField(row, 'section', 'classSection') || previousStudent?.section || 'A').trim().toUpperCase(),
        advisorName: String(getUploadField(row, 'advisorName', 'advisor') || previousStudent?.advisorName || '').trim(),
        hodName: String(getUploadField(row, 'hodName', 'hod') || previousStudent?.hodName || '').trim(),
        hodEmail: String(getUploadField(row, 'hodEmail', 'hodMail') || previousStudent?.hodEmail || '').trim(),
        hodPhone: String(getUploadField(row, 'hodPhone', 'hodMobile') || previousStudent?.hodPhone || '').trim(),
        photoUrl,
        faceDescriptor: previousStudent?.photoUrl === photoUrl ? previousStudent?.faceDescriptor || null : null
      };

      if (previousIndex === undefined) {
        studentIndexes.set(regNo, students.length);
        students.push(student);
      } else {
        students[previousIndex] = student;
      }
      changedStudents.set(regNo, student);
    });

    if (!changedStudents.size) {
      status.innerText = 'No valid rows found. Include register number and student name columns.';
      return;
    }

    saveStudents(students);
    renderAdminStudentData();
    status.innerText = `Imported ${changedStudents.size} student records locally; syncing...`;
    document.getElementById('bulk-excel-input').value = '';
    await Promise.all(Array.from(changedStudents.values(), saveStudentToCloud));
    status.innerText = `Imported ${changedStudents.size} student records${skipped ? `; skipped ${skipped} invalid rows` : ''}${cloudSyncReady ? ' and synced to cloud' : ' locally'}.`;
    showToast(`Imported ${changedStudents.size} student records${skipped ? `; skipped ${skipped}` : ''}`);
  } catch (err) {
    console.error('Student spreadsheet upload failed:', err);
    status.innerText = `Upload failed: ${err.message || 'check the file and column headers'}`;
    showToast('Failed to parse student file');
  }
}

async function processBulkZip() {
  const file = document.getElementById('bulk-zip-input').files[0];
  if (!file) return showToast('Select a ZIP archive first');

  const status = document.getElementById('zip-status');
  status.innerText = 'Extracting and parsing portrait photos...';

  try {
    if (!faceModelsReady) throw new Error('Face AI is not ready. Wait for the AI status to finish loading, then retry.');
    const zip = await JSZip.loadAsync(file);
    const students = getStudents();
    const studentsByRegNo = new Map(students.map(student => [String(student.regNo).trim(), student]));
    const changedStudents = [];
    let noFace = 0;
    let unmatched = 0;

    for (const [filename, fileObj] of Object.entries(zip.files)) {
      if (fileObj.dir) continue;
      const basename = filename.split('/').pop();
      if (!/\.(jpe?g|png|webp|bmp)$/i.test(basename)) continue;
      const regNo = basename.replace(/\.[^.]+$/, '').trim();
      const targetStudent = studentsByRegNo.get(regNo);
      if (!targetStudent) {
        unmatched++;
        continue;
      }

      status.innerText = `Processing photo ${changedStudents.length + noFace + 1}: ${regNo}...`;
      const blob = await fileObj.async('blob');
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error(`Could not read photo ${basename}.`));
        reader.readAsDataURL(blob);
      });
      const descriptor = await createFaceDescriptor(dataUrl);
      if (!descriptor) {
        noFace++;
        continue;
      }
      targetStudent.photoUrl = dataUrl;
      targetStudent.faceDescriptor = descriptor;
      changedStudents.push(targetStudent);
    }

    if (changedStudents.length) {
      saveStudents(students);
      renderAdminStudentData();
      await Promise.all(changedStudents.map(saveStudentToCloud));
    }
    status.innerText = `Updated ${changedStudents.length} student photos and face profiles${noFace ? `; no face found in ${noFace}` : ''}${unmatched ? `; no matching student for ${unmatched}` : ''}${cloudSyncReady ? ' (cloud synced)' : ' locally'}.`;
    document.getElementById('bulk-zip-input').value = '';
    showToast(`Updated ${changedStudents.length} student photo${changedStudents.length === 1 ? '' : 's'}${noFace ? `; ${noFace} without a detected face` : ''}`);
  } catch (err) {
    console.error('Student photo ZIP upload failed:', err);
    status.innerText = `Upload failed: ${err.message || 'check the ZIP file and photo names'}`;
    showToast('ZIP upload failed');
  }
}

async function processBulkTimetable() {
  const file = document.getElementById('bulk-tt-input').files[0];
  if (!file) return showToast('Select an Excel or CSV file first');
  const targetClass = document.getElementById('tt-target-class').value;
  if (!targetClass) return showToast('Select a class before uploading its timetable');

  try {
    const workbook = XLSX.read(await file.arrayBuffer());
    const sheetName = workbook.SheetNames.find(name => /database|import/i.test(name)) || workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    if (!rows.length) return showToast('No rows found in uploaded sheet');

    const [targetDepartment, targetYear, targetSection] = targetClass.split('-');
    let currentDepartment = targetDepartment;
    let currentYear = targetYear;
    let currentSection = targetSection;
    const timetables = new Map();
    let skippedRows = 0;

    rows.forEach(row => {
      currentDepartment = String(getUploadField(row, 'department', 'dept') || currentDepartment || '').trim();
      currentYear = String(getUploadField(row, 'year', 'classYear') || currentYear || '').trim();
      currentSection = String(getUploadField(row, 'section', 'classSection') || currentSection || '').trim();
      const classKey = normalizeClassKey(currentDepartment, currentYear, currentSection);
      const day = String(getUploadField(row, 'day') || '').trim();
      const startTime = normalizeTimetableTime(getUploadField(row, 'startTime', 'start'));
      const endTime = normalizeTimetableTime(getUploadField(row, 'endTime', 'end'));
      const subjectName = String(getUploadField(row, 'subjectName', 'subject') || '').trim();
      if (!day || !startTime || !endTime || !subjectName) {
        skippedRows++;
        return;
      }

      if (!timetables.has(classKey)) timetables.set(classKey, []);
      timetables.get(classKey).push({
        day,
        periodNumber: getUploadField(row, 'periodNumber', 'period') || 1,
        startTime,
        endTime,
        subjectName,
        facultyName: String(getUploadField(row, 'facultyName', 'faculty') || 'Faculty').trim(),
        roomNo: String(getUploadField(row, 'roomNo', 'room') || 'Hall').trim()
      });
    });

    if (!timetables.size) return showToast('No valid timetable rows found. Check day, times, and subject columns.');

    const store = getTimetables();
    timetables.forEach((periods, classKey) => { store[classKey] = periods; });
    saveTimetables(store);
    renderAdminTimetableData();
    const savedClasses = Array.from(timetables.keys());
    selectAdminTimetableClass(savedClasses.includes(targetClass) ? targetClass : savedClasses[0]);
    document.getElementById('bulk-tt-input').value = '';
    showToast(`Loaded ${savedClasses.length} class timetable${savedClasses.length === 1 ? '' : 's'} locally`);
    await Promise.all(savedClasses.map(classKey => saveTimetableToCloud(classKey, timetables.get(classKey))));
    showToast(`Timetable upload synced${skippedRows ? `; skipped ${skippedRows} incomplete row${skippedRows === 1 ? '' : 's'}` : ''}`);
  } catch (err) {
    console.error('Timetable upload failed:', err);
    showToast(`Timetable upload failed: ${err.message || 'check the file format'}`);
  }
}

function renderAdminStudentData() {
  const container = document.getElementById('admin-student-list');
  const count = document.getElementById('admin-student-count');
  if (!container || !count) return;
  const students = getStudents().slice().sort((a, b) => a.name.localeCompare(b.name));
  count.innerText = `${students.length} Student${students.length === 1 ? '' : 's'}`;
  container.innerHTML = students.length ? students.map(student => `
    <div class="p-3 border-b border-slate-200 flex items-center gap-3">
      <img src="${student.photoUrl}" class="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0">
      <div class="min-w-0 flex-1">
        <p class="font-bold text-slate-800 truncate">${student.name}</p>
        <p class="text-[10px] font-mono text-indigo-600">${student.regNo} • ${student.department} ${student.year}-${student.section}</p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span class="text-[10px] text-slate-500 text-right hidden sm:block">HOD<br>${student.hodEmail || '--'}</span>
        <button type="button" onclick="editStudentDetails('${student.regNo}')" title="Edit student details" class="w-8 h-8 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 flex items-center justify-center transition">
          <i class="fa-solid fa-pen-to-square text-xs"></i>
        </button>
        <button type="button" onclick="deleteStudent('${student.regNo}')" title="Delete student" aria-label="Delete ${student.name}" class="w-8 h-8 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 flex items-center justify-center transition">
          <i class="fa-solid fa-trash-can text-xs"></i>
        </button>
      </div>
    </div>`).join('') : '<p class="p-4 text-slate-400 text-center">No student data uploaded.</p>';
}

function renderAdminTimetableData() {
  const container = document.getElementById('admin-timetable-list');
  if (!container) return;
  const entries = Object.entries(getTimetables()).flatMap(([classKey, periods]) => periods.map(period => ({ classKey, ...period })));
  entries.sort((a, b) => `${a.classKey}${a.day}${a.startTime}`.localeCompare(`${b.classKey}${b.day}${b.startTime}`));
  container.innerHTML = entries.length ? entries.map(entry => `
    <div data-class-key="${entry.classKey}" class="p-3 border-b border-slate-200 grid grid-cols-[92px_1fr] gap-3">
      <div><p class="font-mono text-[10px] text-indigo-600 font-bold">${entry.classKey}</p><p class="text-[10px] text-slate-500">${entry.day}</p><p class="font-mono text-[10px] text-slate-500">${entry.startTime} - ${entry.endTime}</p></div>
      <div><p class="font-semibold text-slate-800">${entry.subjectName}</p><p class="text-[10px] text-slate-500">${entry.facultyName} • ${entry.roomNo}</p></div>
    </div>`).join('') : '<p class="p-4 text-slate-400 text-center">No timetable data uploaded.</p>';
  selectAdminTimetableClass(document.getElementById('tt-target-class')?.value);
}

function addApprovedUser(event) {
  event.preventDefault();
  const userId = document.getElementById('new-user-id').value.trim();
  const users = getUsers();
  if (users.some(user => user.userId === userId)) return showToast('That user ID already exists');
  users.push({
    userId,
    name: document.getElementById('new-user-name').value.trim(),
    password: document.getElementById('new-user-pass').value,
    approved: false,
    createdAt: new Date().toLocaleString()
  });
  saveUsers(users);
  document.querySelector('#tab-users form').reset();
  renderAdminUsers();
  showToast(`User ${userId} added; approve access below`);
}

function setUserApproval(userId, approved) {
  const users = getUsers();
  const user = users.find(item => item.userId === userId);
  if (!user) return;
  user.approved = approved;
  saveUsers(users);
  renderAdminUsers();
  showToast(`${userId} ${approved ? 'approved' : 'blocked'}`);
}

function deleteUser(userId) {
  if (userId === 'scanner') return showToast('The default scanner user cannot be deleted');
  saveUsers(getUsers().filter(user => user.userId !== userId));
  deleteUserFromCloud(userId);
  renderAdminUsers();
  showToast(`Deleted user ${userId}`);
}

function renderAdminUsers() {
  const container = document.getElementById('admin-users-list');
  if (!container) return;
  const users = getUsers();
  container.innerHTML = users.map(user => `
    <div class="p-3 border-b border-slate-200 flex items-center gap-3">
      <div class="w-9 h-9 rounded-xl ${user.approved ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'} flex items-center justify-center"><i class="fa-solid ${user.approved ? 'fa-user-check' : 'fa-user-clock'}"></i></div>
      <div class="min-w-0 flex-1"><p class="font-bold text-slate-800">${user.name}</p><p class="text-[10px] text-slate-500 font-mono">${user.userId} • ${user.approved ? 'Approved' : 'Waiting for approval'}</p></div>
      <div class="flex gap-2">${user.approved ? `<button onclick="setUserApproval('${user.userId}', false)" class="text-amber-600 hover:underline">Block</button>` : `<button onclick="setUserApproval('${user.userId}', true)" class="text-emerald-600 hover:underline">Approve</button>`}<button onclick="deleteUser('${user.userId}')" class="text-rose-600 hover:underline">Delete</button></div>
    </div>`).join('');
}

function renderScanHistory() {
  const container = document.getElementById('scan-history-list');
  if (!container) return;
  const logs = getScanHistory();
  container.innerHTML = logs.length ? logs.map(log => `
    <div class="p-3 bg-slate-50 border border-slate-200 rounded-2xl">
      <div class="flex justify-between gap-3"><span class="font-mono text-[10px] text-indigo-600">${log.timestamp}</span><span class="text-[10px] text-rose-600">${log.location || 'Campus'}</span></div>
      <div class="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px]"><span class="font-semibold text-slate-800">${log.studentName}</span><span>${log.regNo}</span><span>${log.classKey}</span><span>${log.subject}</span><span>${log.timeRange}</span></div>
      <p class="text-[10px] text-slate-500 mt-1">Scanned by: ${log.userId}</p>
    </div>`).join('') : '<p class="p-6 text-center text-slate-400">No scanned history available.</p>';
}

function renderAuditLogs() {
  const logs = getAuditLogs();
  const container = document.getElementById('audit-logs-list');
  if (!container) return;

  if (logs.length === 0) {
    container.innerHTML = '<p class="text-slate-400 py-6 text-center text-xs">No roaming incidents recorded yet.</p>';
    return;
  }

  container.innerHTML = logs.map(l => `
    <div class="p-3 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
      <div class="flex justify-between items-center text-[11px]">
        <span class="text-slate-500 font-mono">${l.timestamp} • ${l.location || 'Campus'}</span>
        <span class="bg-rose-100 text-rose-800 border border-rose-300 font-mono font-bold px-2 py-0.5 rounded text-[10px]">
          ${l.students.length} Student${l.students.length > 1 ? 's' : ''} Verified
        </span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
        ${l.students.map(st => `
          <div class="bg-white p-2 rounded-xl border border-slate-200 flex items-center gap-2.5 shadow-sm">
            <img src="${st.capturedLivePhoto}" class="w-11 h-11 rounded-lg object-cover border border-rose-500 shrink-0">
            <div class="min-w-0 flex-1">
              <p class="font-bold text-slate-800 text-xs truncate">${st.name}</p>
              <p class="text-[10px] font-mono text-indigo-600">${st.regNo} • ${st.department}</p>
              <p class="text-[9px] text-slate-500 truncate">Skipped: ${st.scheduledPeriod.subject || 'Lecture'}</p>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function exportAuditsToCSV() {
  const logs = getAuditLogs();
  if (logs.length === 0) return showToast('No audit logs available to export');

  let csvContent = "Incident_ID,Timestamp,Location,RegNo,Name,Department,Class,Skipped_Subject,Period_Time\n";
  logs.forEach(l => {
    l.students.forEach(s => {
      csvContent += `"${l.id}","${l.timestamp}","${l.location || 'Campus'}","${s.regNo}","${s.name}","${s.department}","${s.year}-${s.section}","${s.scheduledPeriod ? s.scheduledPeriod.subject : 'Lecture'}","${s.scheduledPeriod ? s.scheduledPeriod.timeRange : '--'}"\n`;
    });
  });

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `CampusTrack_Infractions_${Date.now()}.csv`;
  a.click();
  showToast('Disciplinary audit log exported to CSV');
}

function clearAllAuditLogs() {
  localStorage.removeItem(STORAGE_KEY_AUDITS);
  const countEl = document.getElementById('admin-audit-count');
  if (countEl) countEl.innerText = '0';
  renderAuditLogs();
  showToast('Incident audit logs cleared locally');
}

function downloadSampleStudentCSV() {
  const csv = "regNo,name,department,year,section,advisorName,hodName,hodEmail,hodPhone\n110324104105,Arun Kumar,CSE,3,B,Ms. Shanmugavalli H,Dr. Kamal N,hod.cse@college.edu,+919876543210\n110324104116,Praveen Raj,CSE,3,B,Ms. Shanmugavalli H,Dr. Kamal N,hod.cse@college.edu,+919876543210";
  downloadFile(csv, "students_sample.csv", "text/csv");
}

function downloadSampleTimetableCSV() {
  const csv = "department,year,section,day,periodNumber,startTime,endTime,subjectName,facultyName,roomNo\nCSE,3,B,Monday,1,08:30,09:20,Professional Ethics (GE24501),Mr. Praveenrajan R,Hall 301\nCSE,2,B,Monday,1,08:30,09:20,Data Structures (CS23301),Dr. Anitha K,Hall 204\nCSE,3,A,Monday,1,08:30,09:20,Compiler Design (CS24503),Prof. Suresh P,Hall 302";
  downloadFile(csv, "multi_class_timetable_sample.csv", "text/csv");
}

function downloadFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
}
