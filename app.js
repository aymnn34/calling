// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  // WebSocket URL - automatically detects correct URL
  wsUrl: (() => {
    // If running on localhost/127.0.0.1, use ws://localhost:3000
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'ws://localhost:3000';
    }
    // For deployed sites, use the same host with appropriate protocol
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  })(),
  
  // ICE servers for NAT traversal
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ],
  
  // Media constraints
  mediaConstraints: {
    video: {
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 },
      frameRate: { ideal: 30, max: 60 }
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  }
};

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

const state = {
  ws: null,
  pc: null,
  localStream: null,
  remoteStream: null,
  room: null,
  clientId: null,
  userName: null,
  isVideoEnabled: true,
  isAudioEnabled: true,
  isConnecting: false,
  isConnected: false
};

// =============================================================================
// DOM ELEMENTS
// =============================================================================

const elements = {
  // Screens
  joinScreen: document.getElementById('join-screen'),
  callScreen: document.getElementById('call-screen'),
  
  // Join form
  joinForm: document.getElementById('join-form'),
  roomInput: document.getElementById('room-input'),
  nameInput: document.getElementById('name-input'),
  joinBtn: document.getElementById('join-btn'),
  joinError: document.getElementById('join-error'),
  
  // Call screen
  localVideo: document.getElementById('local-video'),
  remoteVideo: document.getElementById('remote-video'),
  roomName: document.getElementById('room-name'),
  waitingRoomName: document.getElementById('waiting-room-name'),
  localName: document.getElementById('local-name'),
  remoteName: document.getElementById('remote-name'),
  connectionStatus: document.getElementById('connection-status'),
  waitingOverlay: document.getElementById('waiting-overlay'),
  
  // Controls
  leaveBtn: document.getElementById('leave-btn'),
  toggleVideoBtn: document.getElementById('toggle-video-btn'),
  toggleAudioBtn: document.getElementById('toggle-audio-btn')
};

// =============================================================================
// INITIALIZATION
// =============================================================================

function init() {
  console.log('🚀 Initializing WebRTC Video Call App');
  
  // Event listeners
  elements.joinForm.addEventListener('submit', handleJoinSubmit);
  elements.leaveBtn.addEventListener('click', handleLeave);
  elements.toggleVideoBtn.addEventListener('click', toggleVideo);
  elements.toggleAudioBtn.addEventListener('click', toggleAudio);
  
  // Cleanup on page unload
  window.addEventListener('beforeunload', cleanup);
  
  console.log('✅ App initialized');
}

// =============================================================================
// MEDIA HANDLING
// =============================================================================

async function initializeMedia() {
  console.log('🎥 Requesting media permissions...');
  
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia(CONFIG.mediaConstraints);
    
    // Attach to video element
    elements.localVideo.srcObject = state.localStream;
    
    // Ensure video plays
    try {
      await elements.localVideo.play();
    } catch (playError) {
      console.warn('Autoplay prevented, will play on user interaction');
    }
    
    console.log('✅ Media initialized:', {
      video: state.localStream.getVideoTracks().length,
      audio: state.localStream.getAudioTracks().length
    });
    
    // Log track details
    state.localStream.getTracks().forEach(track => {
      console.log(`  - ${track.kind}: ${track.label} (${track.readyState})`);
    });
    
    return true;
  } catch (error) {
    console.error('❌ Media error:', error);
    
    let errorMessage = 'Could not access camera/microphone. ';
    
    if (error.name === 'NotAllowedError') {
      errorMessage += 'Please allow camera and microphone access.';
    } else if (error.name === 'NotFoundError') {
      errorMessage += 'No camera or microphone found.';
    } else if (error.name === 'NotReadableError') {
      errorMessage += 'Camera/microphone is already in use by another application.';
    } else {
      errorMessage += error.message;
    }
    
    throw new Error(errorMessage);
  }
}

function stopLocalStream() {
  if (state.localStream) {
    state.localStream.getTracks().forEach(track => {
      track.stop();
      console.log(`Stopped ${track.kind} track`);
    });
    state.localStream = null;
    elements.localVideo.srcObject = null;
  }
}

function toggleVideo() {
  if (!state.localStream) return;
  
  const videoTrack = state.localStream.getVideoTracks()[0];
  if (videoTrack) {
    state.isVideoEnabled = !state.isVideoEnabled;
    videoTrack.enabled = state.isVideoEnabled;
    
    elements.toggleVideoBtn.classList.toggle('off', !state.isVideoEnabled);
    elements.toggleVideoBtn.querySelector('.icon-video-on').classList.toggle('hidden', !state.isVideoEnabled);
    elements.toggleVideoBtn.querySelector('.icon-video-off').classList.toggle('hidden', state.isVideoEnabled);
    
    console.log(`📹 Video ${state.isVideoEnabled ? 'enabled' : 'disabled'}`);
  }
}

function toggleAudio() {
  if (!state.localStream) return;
  
  const audioTrack = state.localStream.getAudioTracks()[0];
  if (audioTrack) {
    state.isAudioEnabled = !state.isAudioEnabled;
    audioTrack.enabled = state.isAudioEnabled;
    
    elements.toggleAudioBtn.classList.toggle('off', !state.isAudioEnabled);
    elements.toggleAudioBtn.querySelector('.icon-audio-on').classList.toggle('hidden', !state.isAudioEnabled);
    elements.toggleAudioBtn.querySelector('.icon-audio-off').classList.toggle('hidden', state.isAudioEnabled);
    
    console.log(`🎤 Audio ${state.isAudioEnabled ? 'enabled' : 'disabled'}`);
  }
}

// =============================================================================
// WEBSOCKET HANDLING
// =============================================================================

function connectWebSocket() {
  return new Promise((resolve, reject) => {
    console.log('🔌 Connecting to WebSocket:', CONFIG.wsUrl);
    
    state.ws = new WebSocket(CONFIG.wsUrl);
    
    state.ws.onopen = () => {
      console.log('✅ WebSocket connected');
      updateStatus('connected', 'Connected to server');
      resolve();
    };
    
    state.ws.onerror = (error) => {
      console.error('❌ WebSocket error:', error);
      reject(new Error('Failed to connect to signaling server'));
    };
    
    state.ws.onclose = () => {
      console.log('🔌 WebSocket disconnected');
      updateStatus('disconnected', 'Disconnected');
      
      if (state.isConnected) {
        showError('Connection lost. Please rejoin the room.');
        setTimeout(() => handleLeave(), 2000);
      }
    };
    
    state.ws.onmessage = handleSignalingMessage;
  });
}

async function handleSignalingMessage(event) {
  try {
    const message = JSON.parse(event.data);
    console.log('📨 Received:', message.type);
    
    switch (message.type) {
      case 'joined':
        handleJoined(message);
        break;
      case 'peer-joined':
        await handlePeerJoined(message);
        break;
      case 'offer':
        await handleOffer(message);
        break;
      case 'answer':
        await handleAnswer(message);
        break;
      case 'ice-candidate':
        await handleIceCandidate(message);
        break;
      case 'peer-left':
        handlePeerLeft(message);
        break;
      case 'error':
        handleServerError(message);
        break;
      default:
        console.warn('Unknown message type:', message.type);
    }
  } catch (error) {
    console.error('Error handling signaling message:', error);
  }
}

function sendMessage(message) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(message));
    console.log('📤 Sent:', message.type);
  } else {
    console.error('Cannot send message: WebSocket not connected');
  }
}

// =============================================================================
// WEBRTC PEER CONNECTION
// =============================================================================

function createPeerConnection() {
  console.log('🔗 Creating peer connection');
  
  // Close existing connection
  if (state.pc) {
    state.pc.close();
    state.pc = null;
  }
  
  // Create new peer connection
  state.pc = new RTCPeerConnection({ iceServers: CONFIG.iceServers });
  
  // Add local tracks
  state.localStream.getTracks().forEach(track => {
    const sender = state.pc.addTrack(track, state.localStream);
    console.log(`➕ Added local ${track.kind} track`);
  });
  
  // Handle ICE candidates
  state.pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendMessage({
        type: 'ice-candidate',
        room: state.room,
        candidate: event.candidate
      });
    }
  };
  
  // Handle remote track
  state.pc.ontrack = (event) => {
    console.log('📥 Received remote track:', event.track.kind);
    
    // Create or get remote stream
    if (!state.remoteStream) {
      state.remoteStream = new MediaStream();
      elements.remoteVideo.srcObject = state.remoteStream;
    }
    
    // Add track to remote stream
    state.remoteStream.addTrack(event.track);
    
    // Hide waiting overlay when we have video
    if (event.track.kind === 'video') {
      elements.waitingOverlay.classList.add('hidden');
      updateStatus('connected', 'Connected');
      
      // Ensure remote video plays
      elements.remoteVideo.play().catch(err => {
        console.warn('Remote video autoplay prevented:', err);
      });
    }
    
    // Handle track end
    event.track.onended = () => {
      console.log(`Remote ${event.track.kind} track ended`);
    };
  };
  
  // Connection state changes
  state.pc.onconnectionstatechange = () => {
    console.log('Connection state:', state.pc.connectionState);
    
    switch (state.pc.connectionState) {
      case 'connected':
        state.isConnected = true;
        updateStatus('connected', 'Connected');
        break;
      case 'disconnected':
        updateStatus('disconnected', 'Disconnected');
        break;
      case 'failed':
        updateStatus('disconnected', 'Connection failed');
        console.error('Peer connection failed');
        break;
      case 'closed':
        updateStatus('disconnected', 'Connection closed');
        break;
    }
  };
  
  // ICE connection state
  state.pc.oniceconnectionstatechange = () => {
    console.log('ICE connection state:', state.pc.iceConnectionState);
  };
  
  // ICE gathering state
  state.pc.onicegatheringstatechange = () => {
    console.log('ICE gathering state:', state.pc.iceGatheringState);
  };
  
  console.log('✅ Peer connection created');
}

async function createOffer() {
  if (!state.pc) {
    console.error('No peer connection');
    return;
  }
  
  try {
    console.log('📝 Creating offer...');
    const offer = await state.pc.createOffer();
    await state.pc.setLocalDescription(offer);
    
    sendMessage({
      type: 'offer',
      room: state.room,
      offer: offer
    });
    
    console.log('✅ Offer sent');
  } catch (error) {
    console.error('Error creating offer:', error);
  }
}

async function createAnswer() {
  if (!state.pc) {
    console.error('No peer connection');
    return;
  }
  
  try {
    console.log('📝 Creating answer...');
    const answer = await state.pc.createAnswer();
    await state.pc.setLocalDescription(answer);
    
    sendMessage({
      type: 'answer',
      room: state.room,
      answer: answer
    });
    
    console.log('✅ Answer sent');
  } catch (error) {
    console.error('Error creating answer:', error);
  }
}

// =============================================================================
// SIGNALING MESSAGE HANDLERS
// =============================================================================

function handleJoined(message) {
  console.log('✅ Joined room:', message.room, `(${message.participants}/2)`);
  
  state.room = message.room;
  state.isConnected = true;
  
  // Update UI
  elements.roomName.textContent = message.room;
  elements.waitingRoomName.textContent = message.room;
  elements.localName.textContent = state.userName;
  
  // Switch screens
  elements.joinScreen.classList.remove('active');
  elements.callScreen.classList.add('active');
  
  // Show waiting overlay if alone
  if (message.participants === 1) {
    elements.waitingOverlay.classList.remove('hidden');
    updateStatus('connecting', 'Waiting for participant');
  }
}

async function handlePeerJoined(message) {
  console.log('👤 Peer joined:', message.peerId);
  
  updateStatus('connecting', 'Connecting to peer...');
  
  // Create peer connection
  createPeerConnection();
  
  // If we should create offer (we're the first participant)
  if (message.shouldCreateOffer) {
    console.log('Creating offer as first participant');
    await createOffer();
  } else {
    console.log('Waiting for offer as second participant');
  }
}

async function handleOffer(message) {
  console.log('📥 Received offer from:', message.from);
  
  // Create peer connection if needed
  if (!state.pc) {
    createPeerConnection();
  }
  
  try {
    await state.pc.setRemoteDescription(new RTCSessionDescription(message.offer));
    console.log('✅ Remote description set (offer)');
    
    // Create answer
    await createAnswer();
  } catch (error) {
    console.error('Error handling offer:', error);
  }
}

async function handleAnswer(message) {
  console.log('📥 Received answer from:', message.from);
  
  if (!state.pc) {
    console.error('No peer connection for answer');
    return;
  }
  
  try {
    await state.pc.setRemoteDescription(new RTCSessionDescription(message.answer));
    console.log('✅ Remote description set (answer)');
  } catch (error) {
    console.error('Error handling answer:', error);
  }
}

async function handleIceCandidate(message) {
  if (!state.pc) {
    console.warn('Received ICE candidate but no peer connection');
    return;
  }
  
  try {
    await state.pc.addIceCandidate(new RTCIceCandidate(message.candidate));
    console.log('✅ ICE candidate added');
  } catch (error) {
    console.error('Error adding ICE candidate:', error);
  }
}

function handlePeerLeft(message) {
  console.log('👋 Peer left:', message.peerId);
  
  // Close peer connection
  if (state.pc) {
    state.pc.close();
    state.pc = null;
  }
  
  // Clear remote stream
  if (state.remoteStream) {
    state.remoteStream.getTracks().forEach(track => track.stop());
    state.remoteStream = null;
    elements.remoteVideo.srcObject = null;
  }
  
  // Show waiting overlay
  elements.waitingOverlay.classList.remove('hidden');
  updateStatus('connecting', 'Waiting for participant');
}

function handleServerError(message) {
  console.error('Server error:', message.message);
  showError(message.message);
  
  // Auto leave after error
  setTimeout(() => handleLeave(), 3000);
}

// =============================================================================
// UI HANDLERS
// =============================================================================

async function handleJoinSubmit(e) {
  e.preventDefault();
  
  if (state.isConnecting) return;
  
  const room = elements.roomInput.value.trim();
  const name = elements.nameInput.value.trim();
  
  if (!room || !name) {
    showError('Please enter both room name and your name');
    return;
  }
  
  try {
    state.isConnecting = true;
    elements.joinBtn.disabled = true;
    elements.joinBtn.querySelector('.btn-text').style.display = 'none';
    elements.joinBtn.querySelector('.btn-loading').classList.remove('hidden');
    hideError();
    
    // Initialize media
    await initializeMedia();
    
    // Connect to WebSocket
    await connectWebSocket();
    
    // Generate client ID
    state.clientId = `${name.replace(/\s+/g, '-')}-${Date.now()}`;
    state.userName = name;
    
    // Join room
    sendMessage({
      type: 'join',
      room: room,
      id: state.clientId
    });
    
  } catch (error) {
    console.error('Join error:', error);
    showError(error.message);
    
    // Cleanup
    stopLocalStream();
    if (state.ws) {
      state.ws.close();
      state.ws = null;
    }
    
    // Reset button
    state.isConnecting = false;
    elements.joinBtn.disabled = false;
    elements.joinBtn.querySelector('.btn-text').style.display = 'inline';
    elements.joinBtn.querySelector('.btn-loading').classList.add('hidden');
  }
}

function handleLeave() {
  console.log('👋 Leaving room');
  
  // Send leave message
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    sendMessage({
      type: 'leave',
      room: state.room
    });
  }
  
  cleanup();
  
  // Reset UI
  elements.callScreen.classList.remove('active');
  elements.joinScreen.classList.add('active');
  elements.roomInput.value = '';
  elements.nameInput.value = '';
  elements.joinBtn.disabled = false;
  elements.joinBtn.querySelector('.btn-text').style.display = 'inline';
  elements.joinBtn.querySelector('.btn-loading').classList.add('hidden');
  hideError();
  
  // Reset state
  state.room = null;
  state.clientId = null;
  state.userName = null;
  state.isConnecting = false;
  state.isConnected = false;
  state.isVideoEnabled = true;
  state.isAudioEnabled = true;
  
  // Reset controls
  elements.toggleVideoBtn.classList.remove('off');
  elements.toggleAudioBtn.classList.remove('off');
  elements.toggleVideoBtn.querySelector('.icon-video-on').classList.remove('hidden');
  elements.toggleVideoBtn.querySelector('.icon-video-off').classList.add('hidden');
  elements.toggleAudioBtn.querySelector('.icon-audio-on').classList.remove('hidden');
  elements.toggleAudioBtn.querySelector('.icon-audio-off').classList.add('hidden');
}

function cleanup() {
  // Close WebSocket
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }
  
  // Close peer connection
  if (state.pc) {
    state.pc.close();
    state.pc = null;
  }
  
  // Stop streams
  stopLocalStream();
  
  if (state.remoteStream) {
    state.remoteStream.getTracks().forEach(track => track.stop());
    state.remoteStream = null;
    elements.remoteVideo.srcObject = null;
  }
}

function updateStatus(status, text) {
  elements.connectionStatus.className = `status-indicator ${status}`;
  elements.connectionStatus.querySelector('.status-text').textContent = text;
}

function showError(message) {
  elements.joinError.textContent = message;
  elements.joinError.classList.remove('hidden');
}

function hideError() {
  elements.joinError.textContent = '';
  elements.joinError.classList.add('hidden');
}

// =============================================================================
// START APP
