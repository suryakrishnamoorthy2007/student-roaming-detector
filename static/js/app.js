/* ==========================================================================
   CampusTrack AI Enterprise - Asynchronous Application Bootstrap & Navigation
   ========================================================================== */

let isUserAuthenticated = false;
let activeUserId = '';

function showToast(msg) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-msg');
  if (!toast || !toastMsg) return;
  toastMsg.innerText = msg;
  toast.classList.remove('translate-y-24', 'opacity-0');
  setTimeout(() => toast.classList.add('translate-y-24', 'opacity-0'), 3000);
}

function startLiveHUDClock() {
  const clockEl = document.getElementById('live-hud-clock');
  if (!clockEl) return;
  const updateClock = () => {
    const now = new Date();
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    clockEl.innerText = `${days[now.getDay()]} • ${now.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  };
  updateClock();
  setInterval(updateClock, 1000);
}

function setupMobileAppInstall() {
  const installButton = document.getElementById('btn-install-app');
  let deferredPrompt = null;
  if (!installButton) return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    installButton.classList.remove('hidden');
  });

  installButton.addEventListener('click', async () => {
    if (!deferredPrompt) {
      showToast('Use the browser menu to add CampusTrack to your home screen');
      return;
    }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installButton.classList.add('hidden');
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((error) => {
      console.warn('Service worker registration note:', error);
    });
  }
}

function openSettingsModal() {
  const settings = getAppSettings();
  const themeInput = document.getElementById('setting-theme');
  const fontInput = document.getElementById('setting-font');
  const instanceInput = document.getElementById('setting-ultramsg-instance');
  const tokenInput = document.getElementById('setting-ultramsg-token');
  const defaultPhoneInput = document.getElementById('setting-default-hod-phone');
  if (themeInput) themeInput.value = settings.theme || 'light';
  if (fontInput) fontInput.value = settings.font || 'dm';
  if (instanceInput) instanceInput.value = settings.ultramsgInstance || '';
  if (tokenInput) tokenInput.value = settings.ultramsgToken || '';
  if (defaultPhoneInput) defaultPhoneInput.value = settings.defaultHodPhone || '';
  const signedInUser = getUsers().find(item => item.userId === activeUserId);
  const welcomeEl = document.getElementById('settings-welcome');
  if (welcomeEl) {
    welcomeEl.innerText = signedInUser ? `Welcome, ${signedInUser.name}` : 'Welcome, operator';
  }
  document.getElementById('settings-modal')?.classList.remove('hidden');
}

function saveWhatsAppGatewaySettings() {
  const settings = getAppSettings();
  const instance = document.getElementById('setting-ultramsg-instance')?.value.trim() || '';
  const token = document.getElementById('setting-ultramsg-token')?.value.trim() || '';
  const defaultPhone = document.getElementById('setting-default-hod-phone')?.value.trim() || '';
  settings.ultramsgInstance = instance;
  settings.ultramsgToken = token;
  settings.defaultHodPhone = defaultPhone;
  localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
  showToast('✅ WhatsApp Gateway & HOD settings saved');
}

function closeSettingsModal() { 
  document.getElementById('settings-modal')?.classList.add('hidden'); 
}

function openUserLoginModal() { 
  const savedSession = localStorage.getItem('CAMPUSTRACK_ACTIVE_SESSION');
  if (savedSession) {
    try {
      const data = JSON.parse(savedSession);
      const user = getUsers().find(u => u.userId === data.userId && u.approved);
      if (user) {
        isUserAuthenticated = true;
        activeUserId = user.userId;
        closeUserLoginModal();
        requestCameraStart();
        return;
      }
    } catch (e) {}
  }
  // Ensure inputs are clean and no credentials are shown on entering
  const userIn = document.getElementById('user-login-id');
  const passIn = document.getElementById('user-login-pass');
  if (userIn) userIn.value = '';
  if (passIn) passIn.value = '';
  document.getElementById('user-login-modal')?.classList.remove('hidden'); 
}

function closeUserLoginModal() { 
  document.getElementById('user-login-modal')?.classList.add('hidden'); 
}

function toggleLoginHelp(forceOpen) {
  const panel = document.getElementById('login-help-panel');
  const button = document.getElementById('login-help-button');
  if (!panel || !button) return;
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !shouldOpen);
  button.setAttribute('aria-expanded', String(shouldOpen));
}

function rejectUserLogin(message) {
  const loginPanel = document.getElementById('user-login-panel');
  const userIn = document.getElementById('user-login-id');
  const passIn = document.getElementById('user-login-pass');
  const status = document.getElementById('user-login-status');
  if (passIn) passIn.value = '';
  if (status) status.innerText = message;
  if (loginPanel) {
    loginPanel.classList.remove('login-panel-error');
    void loginPanel.offsetWidth;
    loginPanel.classList.add('login-panel-error');
  }
  if (userIn && !userIn.value) userIn.focus();
  else if (passIn) passIn.focus();
}

function handleUserLogin(event) {
  event?.preventDefault();
  const userId = (document.getElementById('user-login-id')?.value || '').trim();
  const password = document.getElementById('user-login-pass')?.value || '';
  if (!userId || !password) {
    rejectUserLogin('Please enter both User ID and password.');
    return;
  }
  const user = getUsers().find(item => String(item.userId).trim().toLowerCase() === userId.toLowerCase());
  const status = document.getElementById('user-login-status');
  if (!user) { rejectUserLogin('User ID is not approved.'); return; }
  if (!user.approved) { rejectUserLogin('This user ID is waiting for admin approval.'); return; }
  if (user.password !== password) { rejectUserLogin('Incorrect password.'); return; }
  isUserAuthenticated = true;
  activeUserId = user.userId;
  localStorage.setItem('CAMPUSTRACK_ACTIVE_SESSION', JSON.stringify({ userId: user.userId, timestamp: Date.now() }));
  closeUserLoginModal();
  if (status) status.innerText = '';
  showToast(`Welcome, ${user.name}`);
  requestCameraStart();
}

function handleUserLogout() {
  localStorage.removeItem('CAMPUSTRACK_ACTIVE_SESSION');
  isUserAuthenticated = false;
  activeUserId = '';
  if (typeof stopCameraStream === 'function') {
    stopCameraStream();
  }
  if (typeof unfreezeScannerView === 'function') {
    unfreezeScannerView();
  }
  const userIn = document.getElementById('user-login-id');
  const passIn = document.getElementById('user-login-pass');
  const status = document.getElementById('user-login-status');
  if (userIn) userIn.value = '';
  if (passIn) passIn.value = '';
  if (status) status.innerText = '';
  
  openUserLoginModal();
  showToast('Logged out of Scanner');
}
window.handleUserLogout = handleUserLogout;

function applyAppSettings() {
  const theme = document.getElementById('setting-theme')?.value || 'light';
  const font = document.getElementById('setting-font')?.value || 'dm';
  const backgroundImage = DEFAULT_BACKGROUND_IMAGE.trim();
  document.body.dataset.theme = theme;
  document.body.dataset.font = font;
  if (backgroundImage) {
    document.body.dataset.backgroundImage = 'true';
    document.body.style.setProperty('--custom-background-image', `url("${backgroundImage.replace(/"/g, '')}")`);
  } else {
    delete document.body.dataset.backgroundImage;
    document.body.style.removeProperty('--custom-background-image');
  }
  localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify({ theme, font }));
}

/**
 * Immediate startup: Apply cached styles to prevent flash of unstyled content
 */
(function applyImmediatePreferences() {
  try {
    const settings = JSON.parse(localStorage.getItem(STORAGE_KEY_SETTINGS) || '{}');
    if (settings.theme) document.body.dataset.theme = settings.theme;
    if (settings.font) document.body.dataset.font = settings.font;
  } catch (e) {}
})();

/**
 * Non-blocking, phased initialization on DOM ready
 */
window.addEventListener('DOMContentLoaded', () => {
  // 1. Dismiss splash screen smoothly
  window.setTimeout(() => {
    document.getElementById('app-splash')?.classList.add('is-leaving');
  }, 1800);

  // 2. Set initial UI state from local storage (Zero-latency paint)
  const auditLogs = getAuditLogs();
  const auditCountEl = document.getElementById('admin-audit-count');
  if (auditCountEl) auditCountEl.innerText = auditLogs.length;

  if (typeof updateTimetableClassesUI === 'function') updateTimetableClassesUI();
  if (typeof updateTimetableViewerOptions === 'function') updateTimetableViewerOptions();
  if (typeof rebuildFaceMatcher === 'function') rebuildFaceMatcher();

  openUserLoginModal();
  setupMobileAppInstall();
  startLiveHUDClock();

  // Photo file upload change listener for single enrollment
  const photoInput = document.getElementById('s-photo');
  if (photoInput) {
    photoInput.addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(evt) {
        tempSnapEnrollUrl = evt.target.result;
        const img = document.getElementById('s-preview-img');
        if (img) {
          img.src = tempSnapEnrollUrl;
          img.classList.remove('hidden');
        }
        document.getElementById('s-preview-icon')?.classList.add('hidden');
      };
      reader.readAsDataURL(file);
    });
  }

  // 3. Defer heavy network tasks (AI Models + Cloud Sync) to browser idle time
  const deferTask = window.requestIdleCallback || ((cb) => setTimeout(cb, 100));

  deferTask(() => {
    // Initialize cloud sync in background
    if (typeof initializeCloudSync === 'function') {
      initializeCloudSync();
    }
    // Initialize Face-API in background
    if (typeof initAI === 'function') {
      initAI();
    }
  });
});
