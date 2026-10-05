/* ==========================================================================
   CampusTrack AI Enterprise - Non-Blocking Firebase Cloud Sync
   ========================================================================== */

let cloudDb = null;
let cloudSyncReady = false;

function updateCloudStatus(message) {
  const status = document.getElementById('timetable-viewer-status');
  if (status) status.innerText = message;
}

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
    // Non-blocking anonymous authentication
    if (!auth.currentUser) {
      auth.signInAnonymously().catch(authErr => {
        console.warn('Anonymous auth note:', authErr.message);
      });
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

    // 1. Process Students
    if (studentsResult.status === 'fulfilled' && !studentsResult.value.empty) {
      const cloudStudents = [];
      studentsResult.value.forEach(doc => cloudStudents.push(doc.data()));
      if (cloudStudents.length > 0) {
        saveStudents(cloudStudents);
      }
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

async function saveStudentToCloud(student) {
  if (!cloudSyncReady || !cloudDb) return;
  try {
    await cloudDb.collection('students').doc(student.regNo).set({
      ...student,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.error('Failed to sync student to cloud:', e);
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
