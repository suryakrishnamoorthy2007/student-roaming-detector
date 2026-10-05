/* ==========================================================================
   CampusTrack AI Enterprise - Multi-Class Timetable Routing & Evaluation
   ========================================================================== */

function normalizeClassKey(department, year, section) {
  const d = String(department || '').trim().toUpperCase();
  const y = String(year || '').replace(/\D/g, '') || '1';
  const s = String(section || '').trim().toUpperCase();
  return `${d}-${y}-${s}`;
}

function normalizeTimetableTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const minutesInDay = Math.round((value % 1) * 24 * 60);
    return `${String(Math.floor(minutesInDay / 60)).padStart(2, '0')}:${String(minutesInDay % 60).padStart(2, '0')}`;
  }

  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return text;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (minutes > 59 || hours > 23 || (meridiem && (hours < 1 || hours > 12))) return text;
  if (meridiem) hours = (hours % 12) + (meridiem === 'PM' ? 12 : 0);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function evaluateStudentTimetable(student) {
  const now = new Date();
  const currentHours = String(now.getHours()).padStart(2, '0');
  const currentMins = String(now.getMinutes()).padStart(2, '0');
  const currentTime = `${currentHours}:${currentMins}`;
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const currentDay = days[now.getDay()];

  if (currentDay === 'Sunday') {
    return {
      type: 'FREE',
      badge: 'SUNDAY HOLIDAY',
      subject: 'Sunday Campus Recess',
      faculty: 'General Campus Access',
      timeRange: 'All Day',
      notice: 'No scheduled academic lectures on Sunday.'
    };
  }

  if (currentTime >= '10:10' && currentTime < '10:30') {
    return {
      type: 'BREAK',
      badge: 'PERMITTED MORNING BREAK',
      subject: 'Morning Refreshment Break',
      faculty: 'Campus Grounds / Canteen',
      timeRange: '10:10 AM - 10:30 AM',
      notice: 'Authorized student movement in canteen and grounds. No violation.'
    };
  }

  if (currentTime >= '12:10' && currentTime < '13:00') {
    return {
      type: 'BREAK',
      badge: 'PERMITTED LUNCH INTERVAL',
      subject: 'Lunch Break in Progress',
      faculty: 'Mess / Cafeteria / Common Hall',
      timeRange: '12:10 PM - 01:00 PM',
      notice: 'Authorized movement in cafeteria and mess areas.'
    };
  }

  const classKey = normalizeClassKey(student.department, student.year, student.section);
  const allTimetables = getTimetables();
  const classSchedule = allTimetables[classKey] || [];

  if (classSchedule.length === 0) {
    return {
      type: 'UNAVAILABLE',
      badge: `${classKey} TIMETABLE NOT LOADED`,
      subject: 'No timetable assigned to this class',
      faculty: 'Upload the class timetable in Administration Central',
      timeRange: 'Schedule unavailable',
      notice: `No timetable found for ${classKey}. Upload the schedule in Admin Portal.`
    };
  }

  const activeSlot = classSchedule.find(slot => 
    slot.day.toLowerCase() === currentDay.toLowerCase() &&
    currentTime >= slot.startTime && currentTime < slot.endTime
  );

  if (activeSlot) {
    const subUpper = activeSlot.subjectName.toUpperCase();
    const roomUpper = (activeSlot.roomNo || '').toUpperCase();

    const isSports = subUpper.includes('SPORTS') || subUpper.includes('PHYSICAL EDUCATION') || 
                     subUpper.includes('GAMES') || subUpper.includes('COUNSELING') || 
                     roomUpper.includes('GROUND') || roomUpper.includes('STADIUM');

    if (isSports) {
      return {
        type: 'SPORTS',
        badge: `PERIOD ${activeSlot.periodNumber}: SPORTS / ACTIVITY`,
        subject: activeSlot.subjectName,
        faculty: `${activeSlot.facultyName} • Venue: ${activeSlot.roomNo}`,
        timeRange: `${activeSlot.startTime} - ${activeSlot.endTime}`,
        notice: 'Authorized outdoor presence during sports & physical activity.'
      };
    }

    const isBreak = subUpper.includes('BREAK') || subUpper.includes('LUNCH') || subUpper.includes('RECESS');
    if (isBreak) {
      return {
        type: 'BREAK',
        badge: 'PERMITTED RECESS',
        subject: activeSlot.subjectName,
        faculty: `${activeSlot.facultyName} • Venue: ${activeSlot.roomNo}`,
        timeRange: `${activeSlot.startTime} - ${activeSlot.endTime}`,
        notice: 'Authorized student recess.'
      };
    }

    return {
      type: 'VIOLATION',
      badge: `PERIOD ${activeSlot.periodNumber} IN SESSION`,
      subject: activeSlot.subjectName,
      faculty: `${activeSlot.facultyName} • Room: ${activeSlot.roomNo}`,
      timeRange: `${activeSlot.startTime} - ${activeSlot.endTime}`,
      notice: 'UNAUTHORIZED ROAMING: Student is absent from ongoing lecture!'
    };
  }

  if (currentTime < '08:30' || currentTime >= '15:30') {
    return {
      type: 'FREE',
      badge: 'AFTER COLLEGE HOURS',
      subject: 'No Scheduled Classes',
      faculty: 'Campus Free Movement',
      timeRange: 'Before 08:30 AM / After 03:30 PM',
      notice: 'Instructional periods concluded for today.'
    };
  }

  return {
    type: 'FREE',
    badge: 'FREE PERIOD',
    subject: 'No Class Assigned',
    faculty: 'Self-Study / Common Area',
    timeRange: currentTime,
    notice: 'No active lecture assigned in master schedule.'
  };
}

function openTimetableViewer() {
  document.getElementById('timetable-viewer-modal').classList.remove('hidden');
  updateTimetableViewerOptions();
  renderTimetableViewer();
}

function closeTimetableViewer() {
  document.getElementById('timetable-viewer-modal').classList.add('hidden');
}

function updateTimetableViewerOptions() {
  const studentSelect = document.getElementById('viewer-student');
  const classSelect = document.getElementById('viewer-class');
  const daySelect = document.getElementById('viewer-day');
  const dateInput = document.getElementById('viewer-date');
  if (!studentSelect || !classSelect || !daySelect || !dateInput) return;

  const previousStudent = studentSelect.value;
  const previousClass = classSelect.value;
  const previousDay = daySelect.value;
  const previousDate = dateInput.value;
  const classes = Object.keys(getTimetables());
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const students = getStudents().slice().sort((a, b) => a.name.localeCompare(b.name));

  studentSelect.innerHTML = `<option value="">All students / choose class</option>` + students.map(student =>
    `<option value="${student.regNo}">${student.name} - ${student.department} ${student.year}-${student.section}</option>`
  ).join('');
  classSelect.innerHTML = classes.map(key => `<option value="${key}">${key.replaceAll('-', ' ')}</option>`).join('');
  daySelect.innerHTML = days.map(day => `<option value="${day}">${day}</option>`).join('');

  if (students.some(student => student.regNo === previousStudent)) studentSelect.value = previousStudent;
  if (classes.includes(previousClass)) classSelect.value = previousClass;
  const today = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];
  daySelect.value = days.includes(previousDay) ? previousDay : (days.includes(today) ? today : 'Monday');
  dateInput.value = previousDate || new Date().toISOString().slice(0, 10);
}

function updateAdminTimetableTargetOptions() {
  const select = document.getElementById('tt-target-class');
  if (!select) return;
  const classes = new Set([...Object.keys(getTimetables()), ...getStudents().map(student => normalizeClassKey(student.department, student.year, student.section))]);
  const previous = select.value;
  select.innerHTML = [...classes].sort().map(key => `<option value="${key}">${key.replaceAll('-', ' ')}</option>`).join('');
  if (classes.has(previous)) select.value = previous;
  else if (select.options.length) select.selectedIndex = 0;
  selectAdminTimetableClass(select.value);
}

function selectAdminTimetableClass(classKey) {
  const select = document.getElementById('tt-target-class');
  if (select && classKey) select.value = classKey;
  const rows = document.querySelectorAll('#admin-timetable-list > div');
  rows.forEach(row => { row.classList.toggle('hidden', !classKey || row.dataset.classKey !== classKey); });
  const count = [...rows].filter(row => !row.classList.contains('hidden')).length;
  const label = document.getElementById('tt-selected-count');
  if (label) label.innerText = `${count} slots for ${classKey || 'selected class'}`;
}

function selectStudentTimetable(regNo) {
  const student = getStudents().find(item => item.regNo === regNo);
  if (!student) return renderTimetableViewer();

  const classKey = normalizeClassKey(student.department, student.year, student.section);
  const classSelect = document.getElementById('viewer-class');
  if (Object.prototype.hasOwnProperty.call(getTimetables(), classKey)) {
    classSelect.value = classKey;
  } else {
    classSelect.value = '';
  }
  renderTimetableViewer();
}

function handleViewerDateChange() {
  const dateValue = document.getElementById('viewer-date').value;
  if (dateValue) {
    const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${dateValue}T00:00:00`).getDay()];
    const daySelect = document.getElementById('viewer-day');
    if ([...daySelect.options].some(option => option.value === day)) daySelect.value = day;
  }
  renderTimetableViewer();
}

function handleViewerDayChange() {
  document.getElementById('viewer-date').value = '';
  renderTimetableViewer();
}

function renderTimetableViewer() {
  const classKey = document.getElementById('viewer-class')?.value;
  const dateValue = document.getElementById('viewer-date')?.value;
  const day = dateValue
    ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${dateValue}T00:00:00`).getDay()]
    : document.getElementById('viewer-day')?.value;
  const list = document.getElementById('timetable-viewer-list');
  if (!list || !classKey || !day) return;

  const selectedStudent = getStudents().find(student => student.regNo === document.getElementById('viewer-student')?.value);
  if (selectedStudent && normalizeClassKey(selectedStudent.department, selectedStudent.year, selectedStudent.section) !== classKey) {
    list.innerHTML = '<p class="text-amber-600 text-center py-8">This student belongs to a different class timetable.</p>';
    return;
  }

  const periods = (getTimetables()[classKey] || [])
    .filter(slot => slot.day.toLowerCase() === day.toLowerCase())
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));

  if (periods.length === 0) {
    list.innerHTML = '<p class="text-slate-400 text-center py-8">No timetable entries for this day.</p>';
    return;
  }

  const now = new Date();
  const currentDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const isToday = !dateValue || dateValue === now.toISOString().slice(0, 10);
  list.innerHTML = periods.map(slot => {
    const isCurrent = isToday && day === currentDay && currentTime >= slot.startTime && currentTime < slot.endTime;
    const status = isCurrent ? 'NOW' : (isToday && currentTime >= slot.endTime && day === currentDay ? 'DONE' : 'UPCOMING');
    const tone = isCurrent ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-slate-50';
    const statusTone = isCurrent ? 'text-emerald-700' : 'text-slate-400';
    return `
      <div class="${tone} border rounded-2xl p-3 flex items-start gap-3">
        <div class="w-20 shrink-0 text-center">
          <p class="font-mono text-[11px] text-indigo-600 font-bold">${slot.startTime}</p>
          <p class="font-mono text-[10px] text-slate-500">${slot.endTime}</p>
          <p class="font-mono text-[9px] ${statusTone} font-bold mt-1">${status}</p>
        </div>
        <div class="border-l border-slate-200 pl-3 min-w-0">
          <p class="font-bold text-slate-900 text-sm">${slot.subjectName}</p>
          <p class="text-xs text-slate-600 mt-1"><i class="fa-solid fa-user-tie text-indigo-600 mr-1"></i>${slot.facultyName}</p>
          <p class="text-[11px] text-slate-500 mt-1"><i class="fa-solid fa-location-dot text-rose-500 mr-1"></i>${slot.roomNo}</p>
        </div>
      </div>`;
  }).join('');
}

async function refreshCloudData() {
  if (!cloudSyncReady) {
    showToast('Firestore not connected; viewing local cache');
    renderTimetableViewer();
    return;
  }
  await loadCloudData();
  if (typeof rebuildFaceMatcher === 'function') rebuildFaceMatcher();
  updateTimetableClassesUI();
  updateTimetableViewerOptions();
  renderTimetableViewer();
  showToast('Timetable refreshed from cloud');
}

function updateTimetableClassesUI() {
  const container = document.getElementById('tt-classes-list');
  const countLabel = document.getElementById('tt-classes-count');
  if (!container) return;

  const store = getTimetables();
  const keys = Object.keys(store);
  if (countLabel) countLabel.innerText = `${keys.length} Class Matrices Loaded`;
  updateAdminTimetableTargetOptions();
  container.innerHTML = '';

  if (keys.length === 0) {
    container.innerHTML = '<p class="text-slate-400 text-xs">No class timetables loaded.</p>';
    return;
  }

  keys.forEach(k => {
    const item = document.createElement('div');
    item.className = "flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs";
    item.innerHTML = `
      <div>
        <span class="font-bold text-amber-700 font-mono">${k}</span>
        <span class="text-slate-500 ml-2">(${store[k].length} slots registered)</span>
      </div>
      <div class="flex items-center gap-2">
        <button onclick="selectAdminTimetableClass('${k}')" class="text-indigo-600 hover:underline font-semibold">Open</button>
        <button onclick="removeTimetableClass('${k}')" class="text-slate-400 hover:text-rose-600 transition" title="Delete Schedule"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    `;
    container.appendChild(item);
  });
}

async function removeTimetableClass(classKey) {
  const store = getTimetables();
  delete store[classKey];
  saveTimetables(store);
  await deleteTimetableFromCloud(classKey);
  if (typeof renderAdminTimetableData === 'function') renderAdminTimetableData();
  showToast(`Removed schedule for ${classKey}`);
}
