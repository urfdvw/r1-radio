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

let audioElement = null;
let isPlaying = false;
let currentUrl = '';
let currentVolume = DEFAULT_VOLUME;

// ===========================================
// DOM Elements
// ===========================================

let urlInput;
let playStopBtn;
let statusDisplay;
let trackInfoDisplay;
let volumeDisplay;
let scanQrBtn;
let scannerModal;
let qrVideo;
let qrCanvas;
let scannerMessage;
let closeScannerBtn;

let qrScanStream = null;
let qrScanFrameId = null;
let qrCanvasContext = null;
let scannerOpen = false;

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
    
    // Try to extract metadata
    audioElement.addEventListener('loadedmetadata', handleMetadata);
  }
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
  statusDisplay.textContent = 'Error';
  trackInfoDisplay.textContent = 'Failed to load stream. Check URL and try again.';
  playStopBtn.textContent = 'Play';
  playStopBtn.classList.remove('playing');
  playStopBtn.classList.add('stopped');
}

function handleLoadStart() {
  statusDisplay.textContent = 'Loading...';
  trackInfoDisplay.textContent = 'Connecting to stream...';
}

function handleCanPlay() {
  if (isPlaying) {
    statusDisplay.textContent = 'Playing';
    trackInfoDisplay.textContent = currentUrl;
  }
}

function handleMetadata() {
  console.log('Metadata loaded');
  // Basic metadata from audio element (limited for streams)
  if (audioElement.duration && !isNaN(audioElement.duration) && audioElement.duration !== Infinity) {
    trackInfoDisplay.textContent = `Duration: ${Math.floor(audioElement.duration)}s`;
  }
}

async function playStream(url) {
  if (!url || url.trim() === '') {
    trackInfoDisplay.textContent = 'Please enter a valid URL';
    return;
  }
  
  initAudioElement();
  
  try {
    currentUrl = url;
    saveSettings(currentUrl, currentVolume);
    
    // Set the source with proper MIME type handling
    audioElement.src = url;
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
          statusDisplay.textContent = 'Error';
          trackInfoDisplay.textContent = 'Playback failed. Check URL format.';
        });
    }
  } catch (error) {
    console.error('Error playing stream:', error);
    statusDisplay.textContent = 'Error';
    trackInfoDisplay.textContent = 'Failed to play stream';
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
        statusDisplay.textContent = 'Error';
        trackInfoDisplay.textContent = 'Failed to resume playback';
      });
  }
}

function clampVolume(volume) {
  return Math.min(1, Math.max(0, volume));
}

function updateVolumeDisplay() {
  if (volumeDisplay) {
    volumeDisplay.textContent = `Volume: ${Math.round(currentVolume * 100)}%`;
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
    console.log(`Volume changed: ${Math.round(currentVolume * 100)}%`);
    const urlToSave = currentUrl || urlInput?.value?.trim() || DEFAULT_STREAM_URL;
    saveSettings(urlToSave, currentVolume);
  }
}

function parseQrText(payload) {
  const trimmedPayload = payload.trim();

  if (!trimmedPayload) {
    return '';
  }

  try {
    const parsedPayload = JSON.parse(trimmedPayload);

    if (typeof parsedPayload === 'string' && parsedPayload.trim()) {
      return parsedPayload.trim();
    }

    const candidateKeys = ['url', 'streamUrl', 'streamURL', 'text', 'value', 'data'];
    for (const key of candidateKeys) {
      const candidate = parsedPayload?.[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
  } catch (error) {}

  return trimmedPayload;
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
  const parsedText = parseQrText(decodedText);

  closeQrScanner();

  if (!parsedText) {
    trackInfoDisplay.textContent = 'QR code was empty.';
    return;
  }

  urlInput.value = parsedText;
  await saveSettings(parsedText, currentVolume);

  trackInfoDisplay.textContent = isPlaying
    ? 'Scanned URL loaded into the input.'
    : 'QR code scanned. Ready to play.';

  urlInput.focus({ preventScroll: true });
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
    trackInfoDisplay.textContent = 'Camera scanning is not supported on this device.';
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
    trackInfoDisplay.textContent = 'Camera access failed. Check permissions and try again.';
  }
}

// ===========================================
// UI Update Functions
// ===========================================

function updateUI() {
  if (isPlaying) {
    playStopBtn.textContent = 'Stop';
    playStopBtn.classList.add('playing');
    playStopBtn.classList.remove('stopped');
    statusDisplay.textContent = 'Playing';
    if (!trackInfoDisplay.textContent || trackInfoDisplay.textContent === 'Stopped') {
      trackInfoDisplay.textContent = currentUrl;
    }
  } else {
    if (currentUrl) {
      playStopBtn.textContent = 'Resume';
    } else {
      playStopBtn.textContent = 'Play';
    }
    playStopBtn.classList.remove('playing');
    playStopBtn.classList.add('stopped');
    statusDisplay.textContent = 'Stopped';
  }

  updateVolumeDisplay();
}

// ===========================================
// Button Handler
// ===========================================

function handlePlayStopClick() {
  const url = urlInput.value.trim();
  
  if (isPlaying) {
    // Stop playback
    stopStream();
  } else {
    if (url && url !== currentUrl) {
      playStream(url);
    } else if (currentUrl && audioElement && audioElement.src) {
      // Resume existing stream
      resumeStream();
    } else if (url) {
      // Start new stream
      playStream(url);
    } else {
      // No URL entered
      statusDisplay.textContent = 'Error';
      trackInfoDisplay.textContent = 'Please enter a stream URL';
    }
  }
}

// ===========================================
// Persistent Storage
// ===========================================

async function saveSettings(url = currentUrl, volume = currentVolume) {
  const payload = {
    lastUrl: url,
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
  trackInfoDisplay = document.getElementById('trackInfo');
  volumeDisplay = document.getElementById('volume');
  scanQrBtn = document.getElementById('scanQrBtn');
  scannerModal = document.getElementById('scannerModal');
  qrVideo = document.getElementById('qrVideo');
  qrCanvas = document.getElementById('qrCanvas');
  scannerMessage = document.getElementById('scannerMessage');
  closeScannerBtn = document.getElementById('closeScannerBtn');
  
  // Load last used settings
  const { lastUrl, volume } = await loadSettings();
  setVolume(volume);

  // Load last used URL or set default
  if (lastUrl) {
    urlInput.value = lastUrl;
    currentUrl = lastUrl;
  } else {
    // Set default stream URL
    urlInput.value = DEFAULT_STREAM_URL;
    currentUrl = DEFAULT_STREAM_URL;
    await saveSettings(DEFAULT_STREAM_URL, currentVolume);
  }
  
  // Button click handler
  playStopBtn.addEventListener('click', handlePlayStopClick);
  scanQrBtn.addEventListener('click', openQrScanner);
  closeScannerBtn.addEventListener('click', closeQrScanner);
  
  // Save URL when it changes
  urlInput.addEventListener('change', () => {
    const url = urlInput.value.trim();
    if (url) {
      saveSettings(url, currentVolume);
    }
  });
  
  // Keyboard + wheel fallback for development
  if (typeof PluginMessageHandler === 'undefined') {
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Space') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('sideClick'));
      }

      if (event.code === 'ArrowUp') {
        event.preventDefault();
        changeVolume(VOLUME_STEP);
      }

      if (event.code === 'ArrowDown') {
        event.preventDefault();
        changeVolume(-VOLUME_STEP);
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

  if (audioElement) {
    audioElement.pause();
    audioElement.src = '';
  }
});
