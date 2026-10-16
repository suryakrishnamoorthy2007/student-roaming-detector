/* ==========================================================================
   CampusTrack AI Enterprise - Non-Blocking Firebase Cloud Sync
   ========================================================================== */

let cloudDb = null;
let cloudSyncReady = false;
let studentsListenerUnsubscribe = null;
let initialStudentSnapshotHandled = false;
let seedingInitialStudents = false;

/**
 * Handle the first cloud roster safely. An empty brand-new Firestore collection must
 * not erase an existing local roster; seed it once. Later empty snapshots are applied
 * normally, so a deliberate delete-all on another device can still synchronize.
 */
function applyCloudStudentRoster(cloudStudents) {
  const safeCloudStudents = Array.isArray(cloudStudents) ? cloudStudents : [];
  if (safeCloudStudents.length === 0 && seedingInitialStudents) {
    return getStudents();
  }

  if (!initialStudentSnapshotHandled) {
    initialStudentSnapshotHandled = true;
    if (safeCloudStudents.length === 0) {
      // Do not upload built-in sample/demo records on a clean browser. Only seed data
      // that had already been explicitly saved in this browser's local roster.
      const hasSavedLocalRoster = Boolean(localStorage.getItem(STORAGE_KEY_STUDENTS));
      const localStudents = hasSavedLocalRoster ? getStudents().slice() : [];
      if (localStudents.length > 0) {
        seedingInitialStudents = true;
        updateCloudStatus(`Uploading ${localStudents.length} saved local student record${localStudents.length === 1 ? '' : 's'} to the empty cloud roster...`);
        Promise.all(localStudents.map(student => saveStudentToCloud(student)))
          .catch(error => console.warn('[Firebase] Initial roster seed failed:', error))
          .finally(() => { seedingInitialStudents = false; });
        return localStudents;
      }
    }
  }

  // Never let a cloud copy that has no face profile erase a face profile this device
  // already holds (e.g. a failed upload, or another device saved the student without one).
  const localByReg = new Map();
  getStudents().forEach(s => { if (s && s.regNo) localByReg.set(String(s.regNo).trim(), s); });
  const hasProfile = s => {
    if (!s) return false;
    const list = Array.isArray(s.faceDescriptors) && s.faceDescriptors.length ? s.faceDescriptors : [s.faceDescriptor];
    return list.some(d => typeof isValidFaceDescriptor === 'function' ? isValidFaceDescriptor(d) : Boolean(d));
  };
  const restoredFromLocal = [];
  const mergedStudents = safeCloudStudents.map(cloudStudent => {
    const local = localByReg.get(String(cloudStudent.regNo).trim());
    if (!hasProfile(cloudStudent) && hasProfile(local)) {
      const restored = {
        ...cloudStudent,
        faceDescriptor: local.faceDescriptor || null,
        faceDescriptors: Array.isArray(local.faceDescriptors) && local.faceDescriptors.length
          ? local.faceDescriptors
          : [local.faceDescriptor]
      };
      restoredFromLocal.push(restored);
      return restored;
    }
    return cloudStudent;
  });

  saveStudents(mergedStudents);
  // Push the recovered face profiles back so every device converges again.
  if (restoredFromLocal.length && typeof saveStudentToCloud === 'function') {
    restoredFromLocal.forEach(s => { saveStudentToCloud(s); });
  }
  return mergedStudents;
}

function updateCloudStatus(message) {
  const status = document.getElementById('timetable-viewer-status');
  if (status) status.innerText = message;
}

/**
 * Attaches real-time cloud listeners so student additions, edits, and deletions
 * immediately sync across all active devices without requiring manual cache clearing.
 * Firebase Firestore serves as the single source of truth.
 */
function setupStudentRealtimeSync() {
  if (!cloudSyncReady || !cloudDb) return;
  if (studentsListenerUnsubscribe) {
    try { studentsListenerUnsubscribe(); } catch (e) {}
    studentsListenerUnsubscribe = null;
  }

  studentsListenerUnsubscribe = cloudDb.collection('students').onSnapshot((snapshot) => {
    const cloudStudents = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data && data.regNo) {
        cloudStudents.push(data);
      }
    });

    // First empty snapshot is handled specially so local records are not discarded
    // before this new Firebase project has been seeded.
    const appliedRoster = applyCloudStudentRoster(cloudStudents);
    updateCloudStatus(`Real-time synced (${appliedRoster.length} student${appliedRoster.length === 1 ? '' : 's'})`);
  }, (err) => {
    console.warn('Real-time student sync error:', err);
  });
}

/**
 * Explicit helper to refresh student states directly from Cloud Firestore
 */
async function refreshStudentsFromCloud() {
  if (!cloudSyncReady || !cloudDb) return [];
  try {
    const snapshot = await cloudDb.collection('students').get();
    const cloudStudents = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data && data.regNo) cloudStudents.push(data);
    });
    return applyCloudStudentRoster(cloudStudents);
  } catch (err) {
    console.warn('Error refreshing students from cloud:', err);
    return [];
  }
}
window.refreshStudentsFromCloud = refreshStudentsFromCloud;
window.setupStudentRealtimeSync = setupStudentRealtimeSync;

/**
 * Initializes Firebase asynchronously without blocking mobile UI rendering.
 * Runs in parallel using background tasks.
 */
async function initializeCloudSync() {
  if (!hasFirebaseConfig() || !window.firebase) {
    updateCloudStatus('Firebase config missing; local storage mode');
    return;
  }

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }

    const auth = firebase.auth();
    // Finish anonymous sign-in before attaching Firestore listeners/writes. Starting the
    // listener before auth completed could produce permission errors on stricter rules.
    if (!auth.currentUser) {
      await auth.signInAnonymously();
    }

    cloudDb = firebase.firestore();
    // Enable offline persistence if supported by browser
    try {
      await cloudDb.enablePersistence({ synchronizeTabs: true });
    } catch (persistErr) {
      // Persistence already enabled or unsupported on tab, continue gracefully
    }

    cloudSyncReady = true;
    updateCloudStatus('Cloud sync connected (Google Cloud Firestore)');

    // Start real-time cloud sync listener immediately
    setupStudentRealtimeSync();

    // Fetch cloud data in parallel in the background
    loadCloudData();
  } catch (err) {
    console.warn('Cloud sync initialization failed:', err);
    updateCloudStatus(`Local storage mode (${err.message || 'offline'})`);
  }
}

/**
 * Loads cloud data concurrently via Promise.allSettled to maximize mobile throughput.
 */
async function loadCloudData() {
  if (!cloudSyncReady || !cloudDb) return;

  try {
    const [studentsResult, ttResult, usersResult, auditResult] = await Promise.allSettled([
      cloudDb.collection('students').get(),
      cloudDb.collection('timetables').get(),
      cloudDb.collection('users').get(),
      cloudDb.collection('incidents').orderBy('createdAt', 'desc').limit(50).get()
    ]);

    // 1. Process Students (rely on Firebase as the single source of truth)
    if (studentsResult.status === 'fulfilled') {
      const cloudStudents = [];
      studentsResult.value.forEach(doc => {
        const data = doc.data();
        if (data && data.regNo) cloudStudents.push(data);
      });
      applyCloudStudentRoster(cloudStudents);
    }

    // 2. Process Timetables
    if (ttResult.status === 'fulfilled' && !ttResult.value.empty) {
      const cloudTT = {};
      ttResult.value.forEach(doc => { cloudTT[doc.id] = doc.data().periods || []; });
      saveTimetables(cloudTT);
    }

    // 3. Process Users
    if (usersResult.status === 'fulfilled' && !usersResult.value.empty) {
      const cloudUsers = [];
      usersResult.value.forEach(doc => cloudUsers.push(doc.data()));
      const usersById = new Map(getUsers().map(user => [String(user.userId).trim().toLowerCase(), user]));
      cloudUsers.forEach(user => usersById.set(String(user.userId).trim().toLowerCase(), user));
      const mergedUsers = Array.from(usersById.values());
      localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(mergedUsers));
    }

    // 4. Process Incident Audits safely (protect against localStorage 5MB quota exhaustion)
    if (auditResult.status === 'fulfilled' && !auditResult.value.empty) {
      const cloudAudits = [];
      auditResult.value.forEach(doc => {
        const item = doc.data();
        if (item.livePhoto && item.livePhoto.length > 50000) {
          item.livePhoto = '';
        }
        cloudAudits.push(item);
      });
      const safeAudits = cloudAudits.slice(-50);
      try {
        localStorage.setItem(STORAGE_KEY_AUDITS, JSON.stringify(safeAudits));
      } catch (quotaErr) {
        try {
          localStorage.setItem(STORAGE_KEY_AUDITS, JSON.stringify(safeAudits.slice(-15)));
        } catch (e) {
          console.warn('LocalStorage quota protected');
        }
      }
      const auditCountEl = document.getElementById('admin-audit-count');
      if (auditCountEl) auditCountEl.innerText = cloudAudits.length;
    }

    updateCloudStatus('Synced with Google Cloud Firestore');
  } catch (err) {
    console.warn('Error reading from Cloud Firestore:', err);
  }
}

async function compressStudentPhotoForCloud(dataUrl, maxDimension = 640) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return dataUrl;
  try {
    return await new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        try {
          const sourceWidth = image.naturalWidth || image.width;
          const sourceHeight = image.naturalHeight || image.height;
          if (!sourceWidth || !sourceHeight) return resolve(dataUrl);
          const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(sourceWidth * scale));
          canvas.height = Math.max(1, Math.round(sourceHeight * scale));
          const context = canvas.getContext('2d', { alpha: false });
          if (!context) return resolve(dataUrl);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.78));
        } catch (error) {
          console.warn('[Firebase] Photo compression failed; using original image data:', error);
          resolve(dataUrl);
        }
      };
      image.onerror = () => resolve(dataUrl);
      image.src = dataUrl;
    });
  } catch (error) {
    console.warn('[Firebase] Photo compression error:', error);
    return dataUrl;
  }
}

async function saveStudentToCloud(student) {
  if (!cloudSyncReady || !cloudDb || !student || !student.regNo) return false;
  try {
    let cloudPhotoUrl = student.photoUrl || '';
    if (typeof cloudPhotoUrl === 'string' && cloudPhotoUrl.startsWith('data:image/')) {
      // Compress large phone images so Firestore stays under its 1 MiB document limit.
      const compressedPhoto = await compressStudentPhotoForCloud(cloudPhotoUrl);
      let uploadedPhotoUrl = '';
      // Prefer Firebase Storage for image blobs; if Storage rules are not configured,
      // the compressed data URL remains a small Firestore-compatible fallback.
      try {
        if (firebase.storage) {
          const mimeType = /^data:(image\/[^;,]+)/i.exec(compressedPhoto)?.[1] || 'image/jpeg';
          const safeRegNo = encodeURIComponent(String(student.regNo).trim());
          const photoRef = firebase.storage().ref().child(`student-photos/${safeRegNo}/profile.jpg`);
          const uploadResult = await photoRef.putString(compressedPhoto, 'data_url', { contentType: mimeType });
          uploadedPhotoUrl = await uploadResult.ref.getDownloadURL();
        }
      } catch (storageError) {
        console.warn('[Firebase] Storage upload failed; using a compressed photo in the student document:', storageError);
      }
      cloudPhotoUrl = uploadedPhotoUrl || compressedPhoto;
    }

    const payload = {
      ...student,
      photoUrl: cloudPhotoUrl,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    // A save that carries no face data at all must not wipe the face profile already in the
    // cloud. An explicit empty array ([]) still clears it on purpose (photo changed).
    if ((payload.faceDescriptor === null || payload.faceDescriptor === undefined) &&
        (payload.faceDescriptors === null || payload.faceDescriptors === undefined)) {
      delete payload.faceDescriptor;
      delete payload.faceDescriptors;
    }
    Object.keys(payload).forEach(k => { if (payload[k] === undefined) delete payload[k]; });
    await cloudDb.collection('students').doc(String(student.regNo)).set(payload, { merge: true });
    return true;
  } catch (e) {
    console.error('Failed to sync student to cloud:', e);
    return false;
  }
}

async function saveUserToCloud(user) {
  if (!cloudSyncReady || !cloudDb || !user?.userId) return;
  try {
    await cloudDb.collection('users').doc(encodeURIComponent(String(user.userId).trim().toLowerCase())).set(user);
  } catch (error) {
    console.error('Failed to sync user to cloud:', error);
  }
}

async function deleteUserFromCloud(userId) {
  if (!cloudSyncReady || !cloudDb) return;
  try {
    await cloudDb.collection('users').doc(encodeURIComponent(String(userId).trim().toLowerCase())).delete();
  } catch (error) {
    console.error('Failed to delete user from cloud:', error);
  }
}

async function deleteStudentFromCloud(regNo) {
  if (!cloudSyncReady || !cloudDb) return false;
  try {
    await cloudDb.collection('students').doc(String(regNo)).delete();
    return true;
  } catch (error) {
    console.error('Failed to delete student from cloud:', error);
    return false;
  }
}

async function saveTimetableToCloud(classKey, periods) {
  if (!cloudSyncReady || !cloudDb) return;
  try {
    await cloudDb.collection('timetables').doc(classKey).set({
      classKey,
      periods,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.error('Failed to sync timetable to cloud:', e);
  }
}

async function deleteTimetableFromCloud(classKey) {
  if (!cloudSyncReady || !cloudDb) return;
  try {
    await cloudDb.collection('timetables').doc(classKey).delete();
  } catch (e) {
    console.error('Failed to delete timetable from cloud:', e);
  }
}

async function saveIncidentToCloud(incident) {
  if (!cloudSyncReady || !cloudDb) return;
  try {
    await cloudDb.collection('incidents').doc(incident.id).set({
      ...incident,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.error('Failed to sync incident to cloud:', e);
  }
}
