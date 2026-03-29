import jsQR from 'jsqr';

// Web Radio Player for R1 Device
// Supports streaming audio with dynamic playback controls

// Check if running as R1 plugin
if (typeof PluginMessageHandler !== 'undefined') {
  console.log('Running as R1 Creation');
} else {
  console.log('Running in browser mode');
}

// ===========================================
// Audio Player State
// ===========================================

const DEFAULT_STREAM_URL = 'https://radio.gotanno.love/;?type=http&nocache=2997';
const DEFAULT_MIME_TYPE = 'audio/mpeg';
const DEFAULT_VOLUME = 0.7;
const VOLUME_STEP = 0.05;
const VOLUME_BAR_HIDE_DELAY_MS = 3000;
const ROTATION_STEP_DEGREES = 10;

let audioElement = null;
let isPlaying = false;
let currentUrl = '';
let currentStationName = null;
let currentVolume = DEFAULT_VOLUME;

// ===========================================
// DOM Elements
// ===========================================

let urlInput;
let playStopBtn;
let statusDisplay;
let stationUrlDisplay;
let volumeMeter;
let volumeBarFill;
let scanQrBtn;
let clickwheel;
let wheelUpBtn;
let wheelLeftBtn;
let wheelRightBtn;
let scannerModal;
let qrVideo;
let qrCanvas;
let scannerMessage;
let closeScannerBtn;

let qrScanStream = null;
let qrScanFrameId = null;
let qrCanvasContext = null;
let scannerOpen = false;
let volumeBarHideTimeoutId = null;
const wheelRotationState = {
  active: false,
  pointerId: null,
  previousAngle: 0,
  accumulatedDelta: 0,
  suppressClick: false
};

// ===========================================
// Audio Player Functions
// ===========================================

function initAudioElement() {
  if (!audioElement) {
    audioElement = new Audio();
    audioElement.preload = 'none';
    audioElement.crossOrigin = 'anonymous';
    audioElement.volume = currentVolume;
    
    // Handle audio events
    audioElement.addEventListener('play', handleAudioPlay);
    audioElement.addEventListener('pause', handleAudioPause);
    audioElement.addEventListener('ended', handleAudioEnded);
    audioElement.addEventListener('error', handleAudioError);
    audioElement.addEventListener('loadstart', handleLoadStart);
    audioElement.addEventListener('canplay', handleCanPlay);
  }
}

function updateStatusDisplay() {
  if (!statusDisplay) {
    return;
  }

  statusDisplay.textContent = isPlaying ? 'Now Playing' : 'Paused';
}

function updateStationUrlDisplay(url = currentUrl || urlInput?.value?.trim() || '') {
  if (!stationUrlDisplay) {
    return;
  }

  stationUrlDisplay.textContent = currentStationName || url || 'No station selected';
}

function handleAudioPlay() {
  isPlaying = true;
  updateUI();
  console.log('Audio started playing');
}

function handleAudioPause() {
  isPlaying = false;
  updateUI();
  console.log('Audio paused');
}

function handleAudioEnded() {
  isPlaying = false;
  updateUI();
  console.log('Audio ended');
}

function handleAudioError(e) {
  console.error('Audio error:', e);
  isPlaying = false;
  updateUI();
}

function handleLoadStart() {
  updateUI();
}

function handleCanPlay() {
  updateUI();
}

async function playStream(url) {
  if (!url || url.trim() === '') {
    return;
  }
  
  initAudioElement();
  
  try {
    currentUrl = url.trim();
    urlInput.value = currentUrl;
    updateStationUrlDisplay();
    saveSettings(currentUrl, currentVolume);
    
    // Set the source with proper MIME type handling
    audioElement.src = currentUrl;
    audioElement.type = DEFAULT_MIME_TYPE;
    
    // Force load the audio
    audioElement.load();
    
    // Attempt to play
    const playPromise = audioElement.play();
    
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          console.log('Playback started successfully');
          isPlaying = true;
          updateUI();
        })
        .catch(error => {
          console.error('Playback failed:', error);
          isPlaying = false;
          updateUI();
        });
    }
  } catch (error) {
    console.error('Error playing stream:', error);
    isPlaying = false;
    updateUI();
  }
}

function stopStream() {
  if (audioElement) {
    audioElement.pause();
    isPlaying = false;
    updateUI();
  }
}

function resumeStream() {
  if (audioElement && currentUrl) {
    audioElement.play()
      .then(() => {
        isPlaying = true;
        updateUI();
      })
      .catch(error => {
        console.error('Resume failed:', error);
        isPlaying = false;
        updateUI();
      });
  }
}

function clampVolume(volume) {
  return Math.min(1, Math.max(0, volume));
}

function hideVolumeMeter() {
  if (volumeBarHideTimeoutId) {
    clearTimeout(volumeBarHideTimeoutId);
    volumeBarHideTimeoutId = null;
  }
}

function showVolumeMeterTemporarily() {
  return;
}

function updateVolumeDisplay() {
  if (volumeBarFill) {
    volumeBarFill.style.width = `${Math.round(currentVolume * 100)}%`;
  }
}

function setVolume(volume) {
  currentVolume = clampVolume(volume);

  if (audioElement) {
    audioElement.volume = currentVolume;
  }

  updateVolumeDisplay();
}

function changeVolume(delta) {
  const previousVolume = currentVolume;
  setVolume(currentVolume + delta);

  if (previousVolume !== currentVolume) {
    showVolumeMeterTemporarily();
    console.log(`Volume changed: ${Math.round(currentVolume * 100)}%`);
    const urlToSave = currentUrl || urlInput?.value?.trim() || DEFAULT_STREAM_URL;
    saveSettings(urlToSave, currentVolume);
  }
}

function parseQrText(payload) {
  const trimmedPayload = payload.trim();

  if (!trimmedPayload) {
    return { url: '', name: null };
  }

  try {
    const parsedPayload = JSON.parse(trimmedPayload);

    if (typeof parsedPayload === 'string' && parsedPayload.trim()) {
      return { url: parsedPayload.trim(), name: null };
    }

    const candidateKeys = ['url', 'streamUrl', 'streamURL', 'text', 'value', 'data'];
    for (const key of candidateKeys) {
      const candidate = parsedPayload?.[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        const name = typeof parsedPayload?.name === 'string' && parsedPayload.name.trim()
          ? parsedPayload.name.trim()
          : null;
        return { url: candidate.trim(), name };
      }
    }
  } catch (error) {}

  return { url: trimmedPayload, name: null };
}

function setScannerMessage(message, isError = false) {
  if (!scannerMessage) {
    return;
  }

  scannerMessage.textContent = message;
  scannerMessage.classList.toggle('error', isError);
}

function stopQrScanner() {
  if (qrScanFrameId) {
    cancelAnimationFrame(qrScanFrameId);
    qrScanFrameId = null;
  }

  if (qrVideo) {
    qrVideo.pause();
    qrVideo.srcObject = null;
  }

  if (qrScanStream) {
    qrScanStream.getTracks().forEach((track) => track.stop());
    qrScanStream = null;
  }
}

function closeQrScanner() {
  scannerOpen = false;
  stopQrScanner();

  if (scannerModal) {
    scannerModal.classList.add('hidden');
    scannerModal.setAttribute('aria-hidden', 'true');
  }

  if (scanQrBtn) {
    scanQrBtn.disabled = false;
  }

  setScannerMessage('Point the camera at a QR code');
}

async function handleQrScanSuccess(decodedText) {
  const { url, name } = parseQrText(decodedText);

  closeQrScanner();

  if (!url) {
    console.warn('QR scan did not contain a usable URL');
    return;
  }

  currentStationName = name;
  urlInput.value = url;
  currentUrl = url;
  updateStationUrlDisplay();
  await playStream(url);
}

function scanQrFrame() {
  if (!scannerOpen || !qrVideo || !qrCanvas) {
    return;
  }

  if (qrVideo.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
    const { videoWidth, videoHeight } = qrVideo;

    if (videoWidth > 0 && videoHeight > 0) {
      if (!qrCanvasContext) {
        qrCanvasContext = qrCanvas.getContext('2d', { willReadFrequently: true });
      }

      if (!qrCanvasContext) {
        qrScanFrameId = requestAnimationFrame(scanQrFrame);
        return;
      }

      if (qrCanvas.width !== videoWidth) {
        qrCanvas.width = videoWidth;
      }

      if (qrCanvas.height !== videoHeight) {
        qrCanvas.height = videoHeight;
      }

      qrCanvasContext.drawImage(qrVideo, 0, 0, videoWidth, videoHeight);
      const imageData = qrCanvasContext.getImageData(0, 0, videoWidth, videoHeight);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth'
      });

      if (code?.data) {
        handleQrScanSuccess(code.data);
        return;
      }
    }
  }

  qrScanFrameId = requestAnimationFrame(scanQrFrame);
}

async function openQrScanner() {
  if (scannerOpen) {
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    console.warn('Camera access is not available on this device');
    return;
  }

  scannerOpen = true;

  if (scannerModal) {
    scannerModal.classList.remove('hidden');
    scannerModal.setAttribute('aria-hidden', 'false');
  }

  if (scanQrBtn) {
    scanQrBtn.disabled = true;
  }

  setScannerMessage('Opening camera...');

  try {
    qrScanStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: {
          ideal: 'environment'
        }
      }
    });

    qrVideo.srcObject = qrScanStream;
    await qrVideo.play();

    setScannerMessage('Point the camera at a QR code');
    scanQrFrame();
  } catch (error) {
    console.error('Unable to start QR scanner:', error);
    setScannerMessage('Camera access failed. Check permissions and try again.', true);
  }
}

// ===========================================
// UI Update Functions
// ===========================================

function updateUI() {
  updateStatusDisplay();
  updateStationUrlDisplay();

  if (playStopBtn) {
    playStopBtn.setAttribute('aria-pressed', String(isPlaying));
  }

  updateVolumeDisplay();
}

function normalizeAngleDelta(delta) {
  if (delta > 180) {
    return delta - 360;
  }

  if (delta < -180) {
    return delta + 360;
  }

  return delta;
}

function getClickwheelMetrics(event) {
  if (!clickwheel) {
    return null;
  }

  const bounds = clickwheel.getBoundingClientRect();
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  const deltaX = event.clientX - centerX;
  const deltaY = event.clientY - centerY;

  return {
    angle: Math.atan2(deltaY, deltaX) * (180 / Math.PI),
    distance: Math.hypot(deltaX, deltaY),
    radius: bounds.width / 2
  };
}

function isInRotationRing(metrics) {
  if (!metrics) {
    return false;
  }

  return metrics.distance >= metrics.radius * 0.45 && metrics.distance <= metrics.radius * 0.98;
}

function endWheelRotation() {
  if (!wheelRotationState.active) {
    return;
  }

  if (clickwheel && wheelRotationState.pointerId !== null && clickwheel.hasPointerCapture(wheelRotationState.pointerId)) {
    clickwheel.releasePointerCapture(wheelRotationState.pointerId);
  }

  wheelRotationState.active = false;
  wheelRotationState.pointerId = null;
  wheelRotationState.accumulatedDelta = 0;
  clickwheel?.classList.remove('dragging');
}

function handleClickwheelPointerDown(event) {
  if (event.pointerType === 'mouse' && event.button !== 0) {
    return;
  }

  if (event.target.closest('.wheel-center')) {
    return;
  }

  const metrics = getClickwheelMetrics(event);
  if (!isInRotationRing(metrics)) {
    return;
  }

  wheelRotationState.active = true;
  wheelRotationState.pointerId = event.pointerId;
  wheelRotationState.previousAngle = metrics.angle;
  wheelRotationState.accumulatedDelta = 0;
  wheelRotationState.suppressClick = false;
  clickwheel?.setPointerCapture(event.pointerId);
  clickwheel?.classList.add('dragging');
  event.preventDefault();
}

function handleClickwheelPointerMove(event) {
  if (!wheelRotationState.active || event.pointerId !== wheelRotationState.pointerId) {
    return;
  }

  const metrics = getClickwheelMetrics(event);
  if (!metrics) {
    return;
  }

  const angleDelta = normalizeAngleDelta(metrics.angle - wheelRotationState.previousAngle);
  wheelRotationState.previousAngle = metrics.angle;
  wheelRotationState.accumulatedDelta += angleDelta;

  while (Math.abs(wheelRotationState.accumulatedDelta) >= ROTATION_STEP_DEGREES) {
    const volumeDelta = wheelRotationState.accumulatedDelta > 0 ? VOLUME_STEP : -VOLUME_STEP;
    changeVolume(volumeDelta);
    wheelRotationState.suppressClick = true;
    wheelRotationState.accumulatedDelta += wheelRotationState.accumulatedDelta > 0
      ? -ROTATION_STEP_DEGREES
      : ROTATION_STEP_DEGREES;
  }

  event.preventDefault();
}

function handleClickwheelClickCapture(event) {
  if (!wheelRotationState.suppressClick) {
    return;
  }

  if (event.target.closest('button')) {
    event.preventDefault();
    event.stopPropagation();
  }

  wheelRotationState.suppressClick = false;
}

function handleClickwheelScroll(event) {
  event.preventDefault();
  event.stopPropagation();
  changeVolume(event.deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP);
}

function logWheelDirection(direction) {
  console.log(`Click wheel ${direction} button pressed`);
}

// ===========================================
// Button Handler
// ===========================================

function handlePlayStopClick() {
  const url = urlInput.value.trim();
  
  if (isPlaying) {
    stopStream();
  } else {
    if (url && url !== currentUrl) {
      currentStationName = null;
      playStream(url);
    } else if (currentUrl && audioElement && audioElement.src) {
      resumeStream();
    } else if (url) {
      playStream(url);
    } else {
      console.warn('No stream URL available');
    }
  }
}

// ===========================================
// Persistent Storage
// ===========================================

async function saveSettings(url = currentUrl, volume = currentVolume, stationName = currentStationName) {
  const payload = {
    lastUrl: url,
    lastStationName: stationName || null,
    volume: clampVolume(volume)
  };

  if (window.creationStorage) {
    try {
      const encoded = btoa(JSON.stringify(payload));
      await window.creationStorage.plain.setItem('radio_data', encoded);
    } catch (e) {
      console.error('Error saving settings:', e);
    }
  } else {
    localStorage.setItem('radio_data', JSON.stringify(payload));
  }
}

async function loadSettings() {
  let settings = null;

  if (window.creationStorage) {
    try {
      const stored = await window.creationStorage.plain.getItem('radio_data');
      if (stored) {
        settings = JSON.parse(atob(stored));
      }
    } catch (e) {
      console.error('Error loading settings:', e);
    }
  } else {
    const stored = localStorage.getItem('radio_data');
    if (stored) {
      settings = JSON.parse(stored);
    }
  }

  return {
    lastUrl: typeof settings?.lastUrl === 'string' ? settings.lastUrl : null,
    lastStationName: typeof settings?.lastStationName === 'string' ? settings.lastStationName : null,
    volume: typeof settings?.volume === 'number' ? clampVolume(settings.volume) : DEFAULT_VOLUME
  };
}

// ===========================================
// Hardware Event Handlers
// ===========================================

window.addEventListener('sideClick', () => {
  console.log('Side button clicked');

  if (scannerOpen) {
    closeQrScanner();
    return;
  }

  handlePlayStopClick();
});

window.addEventListener('scrollUp', () => {
  console.log('Scroll up detected');
  changeVolume(VOLUME_STEP);
});

window.addEventListener('scrollDown', () => {
  console.log('Scroll down detected');
  changeVolume(-VOLUME_STEP);
});

// ===========================================
// Initialization
// ===========================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Web Radio Player initialized!');
  
  // Get DOM elements
  urlInput = document.getElementById('urlInput');
  playStopBtn = document.getElementById('playStopBtn');
  statusDisplay = document.getElementById('status');
  stationUrlDisplay = document.getElementById('stationUrlDisplay');
  volumeMeter = document.querySelector('.volume-meter');
  volumeBarFill = document.getElementById('volumeBarFill');
  scanQrBtn = document.getElementById('scanQrBtn');
  clickwheel = document.getElementById('clickwheel');
  wheelUpBtn = document.getElementById('wheelUpBtn');
  wheelLeftBtn = document.getElementById('wheelLeftBtn');
  wheelRightBtn = document.getElementById('wheelRightBtn');
  scannerModal = document.getElementById('scannerModal');
  qrVideo = document.getElementById('qrVideo');
  qrCanvas = document.getElementById('qrCanvas');
  scannerMessage = document.getElementById('scannerMessage');
  closeScannerBtn = document.getElementById('closeScannerBtn');
  
  // Load last used settings
  const { lastUrl, lastStationName, volume } = await loadSettings();
  setVolume(volume);

  // Load last used URL or set default
  if (lastUrl) {
    urlInput.value = lastUrl;
    currentUrl = lastUrl;
    currentStationName = lastStationName;
    updateStationUrlDisplay();
  } else {
    urlInput.value = DEFAULT_STREAM_URL;
    currentUrl = DEFAULT_STREAM_URL;
    await saveSettings(DEFAULT_STREAM_URL, currentVolume);
  }
  
  // Button click handler
  playStopBtn.addEventListener('click', handlePlayStopClick);
  scanQrBtn.addEventListener('click', openQrScanner);
  wheelUpBtn.addEventListener('click', () => logWheelDirection('up'));
  wheelLeftBtn.addEventListener('click', () => logWheelDirection('left'));
  wheelRightBtn.addEventListener('click', () => logWheelDirection('right'));
  closeScannerBtn.addEventListener('click', closeQrScanner);

  clickwheel.addEventListener('pointerdown', handleClickwheelPointerDown);
  clickwheel.addEventListener('pointermove', handleClickwheelPointerMove);
  clickwheel.addEventListener('pointerup', endWheelRotation);
  clickwheel.addEventListener('pointercancel', endWheelRotation);
  clickwheel.addEventListener('lostpointercapture', endWheelRotation);
  clickwheel.addEventListener('click', handleClickwheelClickCapture, true);
  clickwheel.addEventListener('wheel', handleClickwheelScroll, { passive: false });
  
  // Keyboard + wheel fallback for development
  if (typeof PluginMessageHandler === 'undefined') {
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Space') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('sideClick'));
      }

      if (event.code === 'Enter') {
        event.preventDefault();
        openQrScanner();
      }

      if (event.code === 'ArrowDown') {
        event.preventDefault();
        handlePlayStopClick();
      }

      if (event.code === 'ArrowUp') {
        event.preventDefault();
        logWheelDirection('up');
      }

      if (event.code === 'ArrowLeft') {
        event.preventDefault();
        logWheelDirection('left');
      }

      if (event.code === 'ArrowRight') {
        event.preventDefault();
        logWheelDirection('right');
      }

      if (event.code === 'Escape' && scannerOpen) {
        event.preventDefault();
        closeQrScanner();
      }
    });

    window.addEventListener('wheel', (event) => {
      event.preventDefault();
      changeVolume(event.deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP);
    }, { passive: false });
  }
  
  // Initialize UI
  updateUI();
  
  console.log('Web Radio Player ready!');
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  closeQrScanner();
  hideVolumeMeter();

  if (audioElement) {
    audioElement.pause();
    audioElement.src = '';
  }
});
