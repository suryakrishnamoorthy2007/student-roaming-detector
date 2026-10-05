/* ==========================================================================
   CampusTrack AI Enterprise - Configuration & Initial Data
   ========================================================================== */

const STORAGE_KEY_STUDENTS = 'CAMPUSTRACK_STUDENTS_V4';
const DEFAULT_BACKGROUND_IMAGE = ''; 
const STORAGE_KEY_TIMETABLES = 'CAMPUSTRACK_TIMETABLES_V4';
const STORAGE_KEY_AUDITS = 'CAMPUSTRACK_AUDITS_V4';
const STORAGE_KEY_SCAN_HISTORY = 'CAMPUSTRACK_SCAN_HISTORY_V1';
const STORAGE_KEY_USERS = 'CAMPUSTRACK_USERS_V1';
const STORAGE_KEY_SETTINGS = 'CAMPUSTRACK_SETTINGS_V1';
const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAF3j0pAUEh_VKoOe27vZbmV1n4IFozKPQ',
  authDomain: 'campus-scanner.firebaseapp.com',
  projectId: 'campus-scanner',
  storageBucket: 'campus-scanner.firebasestorage.app',
  messagingSenderId: '213090728559',
  appId: '1:213090728559:web:801bd4c5aa330b8fb8ab9a',
  measurementId: 'G-0590Z7YYT1'
};

function generateSynthetic128DDescriptor(seed) {
  const vec = new Float32Array(128);
  for (let i = 0; i < 128; i++) {
    vec[i] = Math.sin(seed * (i + 1) * 0.45) * 0.2;
  }
  return Array.from(vec);
}

function hasFirebaseConfig() {
  return Object.values(FIREBASE_CONFIG).every(value => Boolean(value));
}

const DEFAULT_STUDENTS = [
  {
    regNo: "110324104105",
    name: "Arun Kumar",
    department: "CSE",
    year: 3,
    section: "B",
    advisorName: "Ms. Shanmugavalli H",
    hodName: "Dr. Kamal N",
    hodEmail: "hod.cse@college.edu",
    hodPhone: "+919876543210",
    photoUrl: "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=350&h=350&fit=crop&crop=faces",
    faceDescriptor: generateSynthetic128DDescriptor(1.42)
  },
  {
    regNo: "110324104116",
    name: "Praveen Raj",
    department: "CSE",
    year: 3,
    section: "B",
    advisorName: "Ms. Shanmugavalli H",
    hodName: "Dr. Kamal N",
    hodEmail: "hod.cse@college.edu",
    hodPhone: "+919876543210",
    photoUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=350&h=350&fit=crop&crop=faces",
    faceDescriptor: generateSynthetic128DDescriptor(2.98)
  }
];

const DEFAULT_TIMETABLES_MAP = {
  "CSE-3-B": [
    { day: "Monday", periodNumber: 1, startTime: "08:30", endTime: "09:20", subjectName: "Professional Ethics & Human Values (GE24501)", facultyName: "Mr. Praveenrajan R", roomNo: "Hall 301" },
    { day: "Monday", periodNumber: 2, startTime: "09:20", endTime: "10:10", subjectName: "Exploratory Data Analysis (CS24P01)", facultyName: "Ms. Edith Esther E", roomNo: "Hall 301" },
    { day: "Monday", periodNumber: "Break", startTime: "10:10", endTime: "10:30", subjectName: "Morning Refreshment Break", facultyName: "Campus Grounds/Cafeteria", roomNo: "Canteen" },
    { day: "Monday", periodNumber: 3, startTime: "10:30", endTime: "11:20", subjectName: "Cloud Computing (CS24502)", facultyName: "Ms. Kalaivani S", roomNo: "Hall 301" },
    { day: "Monday", periodNumber: 4, startTime: "11:20", endTime: "12:10", subjectName: "OOSE Lab (CS24504) / MAD Lab (CS24505)", facultyName: "Dr. Kamal N / Ms. Shanmugavalli H", roomNo: "Lab 2" },
    { day: "Monday", periodNumber: "Lunch", startTime: "12:10", endTime: "13:00", subjectName: "Lunch Interval", facultyName: "Cafeteria / Student Mess", roomNo: "Cafeteria" },
    { day: "Monday", periodNumber: 5, startTime: "13:00", endTime: "13:50", subjectName: "OOSE Lab (CS24504) / MAD Lab (CS24505)", facultyName: "Dr. Kamal N / Ms. Shanmugavalli H", roomNo: "Lab 2" },
    { day: "Monday", periodNumber: 6, startTime: "13:50", endTime: "14:40", subjectName: "OOSE Lab (CS24504) / MAD Lab (CS24505)", facultyName: "Dr. Kamal N / Ms. Shanmugavalli H", roomNo: "Lab 2" },
    { day: "Monday", periodNumber: 7, startTime: "14:40", endTime: "15:30", subjectName: "OOSE Lab (CS24504) / MAD Lab (CS24505)", facultyName: "Dr. Kamal N / Ms. Shanmugavalli H", roomNo: "Lab 2" }
  ],
  "CSE-2-B": [
    { day: "Monday", periodNumber: 1, startTime: "08:30", endTime: "09:20", subjectName: "Data Structures & Algorithms (CS23301)", facultyName: "Dr. Anitha K", roomNo: "Hall 204" },
    { day: "Monday", periodNumber: 2, startTime: "09:20", endTime: "10:10", subjectName: "Discrete Mathematics (MA23302)", facultyName: "Prof. Narayanan V", roomNo: "Hall 204" },
    { day: "Monday", periodNumber: "Break", startTime: "10:10", endTime: "10:30", subjectName: "Morning Refreshment Break", facultyName: "Campus Grounds/Cafeteria", roomNo: "Canteen" },
    { day: "Monday", periodNumber: 3, startTime: "10:30", endTime: "11:20", subjectName: "Digital Logic Design (CS23303)", facultyName: "Mr. Balaji S", roomNo: "Hall 204" },
    { day: "Monday", periodNumber: 4, startTime: "11:20", endTime: "12:10", subjectName: "DSA Laboratory (CS23304)", facultyName: "Dr. Anitha K", roomNo: "Lab 1" }
  ]
};

const DEFAULT_USERS = [
  { userId: 'scanner', name: 'Main Scanner', password: 'scanner123', approved: true, createdAt: 'System default' }
];

/* Storage helpers with memory cache for high-speed mobile performance */
let _cachedStudents = null;
let _cachedTimetables = null;

function getStudents() {
  if (_cachedStudents) return _cachedStudents;
  const data = localStorage.getItem(STORAGE_KEY_STUDENTS);
  if (!data) {
    localStorage.setItem(STORAGE_KEY_STUDENTS, JSON.stringify(DEFAULT_STUDENTS));
    _cachedStudents = DEFAULT_STUDENTS;
    return DEFAULT_STUDENTS;
  }
  try {
    _cachedStudents = JSON.parse(data);
    return _cachedStudents;
  } catch (e) {
    _cachedStudents = DEFAULT_STUDENTS;
    return DEFAULT_STUDENTS;
  }
}

function saveStudents(list) {
  _cachedStudents = list;
  localStorage.setItem(STORAGE_KEY_STUDENTS, JSON.stringify(list));
  if (typeof rebuildFaceMatcher === 'function') rebuildFaceMatcher();
  if (typeof updateAdminTimetableTargetOptions === 'function') updateAdminTimetableTargetOptions();
}

function getScanHistory() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_SCAN_HISTORY) || '[]'); } catch (e) { return []; }
}

function saveScanHistory(entry) {
  const history = getScanHistory();
  history.unshift(entry);
  localStorage.setItem(STORAGE_KEY_SCAN_HISTORY, JSON.stringify(history.slice(0, 200)));
}

function getTimetables() {
  if (_cachedTimetables) return _cachedTimetables;
  const data = localStorage.getItem(STORAGE_KEY_TIMETABLES);
  if (!data) {
    localStorage.setItem(STORAGE_KEY_TIMETABLES, JSON.stringify(DEFAULT_TIMETABLES_MAP));
    _cachedTimetables = DEFAULT_TIMETABLES_MAP;
    return DEFAULT_TIMETABLES_MAP;
  }
  try { 
    _cachedTimetables = JSON.parse(data); 
    return _cachedTimetables; 
  } catch (e) { 
    _cachedTimetables = {}; 
    return {}; 
  }
}

function saveTimetables(map) {
  _cachedTimetables = map;
  localStorage.setItem(STORAGE_KEY_TIMETABLES, JSON.stringify(map));
  if (typeof updateTimetableClassesUI === 'function') updateTimetableClassesUI();
  if (typeof updateTimetableViewerOptions === 'function') updateTimetableViewerOptions();
}

function getAuditLogs() {
  const data = localStorage.getItem(STORAGE_KEY_AUDITS);
  return data ? JSON.parse(data) : [];
}

function saveAuditLog(entry) {
  const list = getAuditLogs();
  list.unshift(entry);
  localStorage.setItem(STORAGE_KEY_AUDITS, JSON.stringify(list));
  const countEl = document.getElementById('admin-audit-count');
  if (countEl) countEl.innerText = list.length;
}

function getUsers() {
  const data = localStorage.getItem(STORAGE_KEY_USERS);
  if (!data) {
    localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(DEFAULT_USERS));
    return DEFAULT_USERS;
  }
  try { return JSON.parse(data); } catch (e) { return []; }
}

function saveUsers(list) {
  localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(list));
  if (cloudSyncReady && typeof saveUserToCloud === 'function') {
    Promise.all(list.map(saveUserToCloud)).catch(error => console.warn('User sync failed:', error));
  }
}

function getAppSettings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_SETTINGS) || '{}'); } catch (e) { return {}; }
}
