const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// MIME types for static file serving
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

// Create HTTP server for static files
const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);
  
  // Determine file path
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  
  // Get file extension
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  
  // Read and serve file
  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 - Page Not Found</h1>', 'utf-8');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

// Create WebSocket server
const wss = new WebSocket.Server({ 
  server,
  clientTracking: true
});

// Room management
const rooms = new Map();

// Utility: Get room participants count
function getRoomSize(roomName) {
  return rooms.has(roomName) ? rooms.get(roomName).size : 0;
}

// Utility: Broadcast to room
function broadcastToRoom(roomName, message, excludeId = null) {
  if (!rooms.has(roomName)) return;
  
  const participants = rooms.get(roomName);
  participants.forEach((ws, id) => {
    if (id !== excludeId && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  });
}

// Utility: Send to specific client in room
function sendToClient(roomName, clientId, message) {
  if (!rooms.has(roomName)) return;
  
  const participants = rooms.get(roomName);
  const ws = participants.get(clientId);
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection from', req.socket.remoteAddress);
  
  let currentRoom = null;
  let clientId = null;
  let isAuthenticated = false;

  // Heartbeat for connection health
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      console.log(`[${clientId || 'UNKNOWN'}] Received: ${message.type}`);
      
      switch (message.type) {
        case 'join':
          handleJoin(message);
          break;
          
        case 'offer':
          handleOffer(message);
          break;
          
        case 'answer':
          handleAnswer(message);
          break;
          
        case 'ice-candidate':
          handleIceCandidate(message);
          break;
          
        case 'leave':
          handleLeave();
          break;
          
        default:
          console.warn(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('Error handling message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
    }
  });

  ws.on('close', () => {
    console.log(`[${clientId}] Connection closed`);
    handleLeave();
  });

  ws.on('error', (error) => {
    console.error(`[${clientId}] WebSocket error:`, error);
    handleLeave();
  });

  // Handler: Join room
  function handleJoin(message) {
    const { room, id } = message;
    
    if (!room || !id) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Room name and ID are required'
      }));
      return;
    }

    // Clean up if already in a room
    if (currentRoom && currentRoom !== room) {
      handleLeave();
    }

    // Create room if doesn't exist
    if (!rooms.has(room)) {
      rooms.set(room, new Map());
      console.log(`[ROOM] Created room: ${room}`);
    }

    const participants = rooms.get(room);

    // Check room capacity (max 2 participants)
    if (participants.size >= 2 && !participants.has(id)) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Room is full. Maximum 2 participants allowed.'
      }));
      return;
    }

    // Handle reconnection
    if (participants.has(id)) {
      console.log(`[${id}] Reconnecting to room: ${room}`);
      participants.set(id, ws);
    } else {
      // New participant
      participants.set(id, ws);
      console.log(`[${id}] Joined room: ${room} (${participants.size}/2)`);
    }

    currentRoom = room;
    clientId = id;
    isAuthenticated = true;

    // Notify client they joined successfully
    ws.send(JSON.stringify({
      type: 'joined',
      room: room,
      id: id,
      participants: participants.size
    }));

    // If 2 participants, notify both to initiate connection
    if (participants.size === 2) {
      const otherParticipant = Array.from(participants.keys()).find(otherId => otherId !== id);
      
      if (otherParticipant) {
        // Notify both participants about each other
        console.log(`[ROOM] ${room} is full. Initiating peer connection.`);
        
        // Tell the existing participant about new joiner (they should create offer)
        sendToClient(room, otherParticipant, {
          type: 'peer-joined',
          peerId: id,
          shouldCreateOffer: true
        });

        // Tell the new joiner about existing participant (they should wait for offer)
        ws.send(JSON.stringify({
          type: 'peer-joined',
          peerId: otherParticipant,
          shouldCreateOffer: false
        }));
      }
    }
  }

  // Handler: WebRTC Offer
  function handleOffer(message) {
    if (!isAuthenticated || !currentRoom) {
      console.warn('Received offer from unauthenticated client');
      return;
    }

    const { offer, targetId } = message;
    
    if (!offer) {
      console.warn('Received offer without SDP');
      return;
    }

    console.log(`[${clientId}] Forwarding offer to room: ${currentRoom}`);
    
    // Forward offer to other participant(s)
    broadcastToRoom(currentRoom, {
      type: 'offer',
      offer: offer,
      from: clientId
    }, clientId);
  }

  // Handler: WebRTC Answer
  function handleAnswer(message) {
    if (!isAuthenticated || !currentRoom) {
      console.warn('Received answer from unauthenticated client');
      return;
    }

    const { answer } = message;
    
    if (!answer) {
      console.warn('Received answer without SDP');
      return;
    }

    console.log(`[${clientId}] Forwarding answer to room: ${currentRoom}`);
    
    // Forward answer to other participant(s)
    broadcastToRoom(currentRoom, {
      type: 'answer',
      answer: answer,
      from: clientId
    }, clientId);
  }

  // Handler: ICE Candidate
  function handleIceCandidate(message) {
    if (!isAuthenticated || !currentRoom) {
      console.warn('Received ICE candidate from unauthenticated client');
      return;
    }

    const { candidate } = message;
    
    if (!candidate) {
      console.warn('Received empty ICE candidate');
      return;
    }

    // Forward ICE candidate to other participant(s)
    broadcastToRoom(currentRoom, {
      type: 'ice-candidate',
      candidate: candidate,
      from: clientId
    }, clientId);
  }

  // Handler: Leave room
  function handleLeave() {
    if (!currentRoom || !clientId) return;

    console.log(`[${clientId}] Leaving room: ${currentRoom}`);

    const participants = rooms.get(currentRoom);
    
    if (participants) {
      // Notify other participants
      broadcastToRoom(currentRoom, {
        type: 'peer-left',
        peerId: clientId
      }, clientId);

      // Remove participant
      participants.delete(clientId);

      // Clean up empty room
      if (participants.size === 0) {
        rooms.delete(currentRoom);
        console.log(`[ROOM] Deleted empty room: ${currentRoom}`);
      } else {
        console.log(`[ROOM] ${currentRoom} now has ${participants.size} participant(s)`);
      }
    }

    currentRoom = null;
    clientId = null;
    isAuthenticated = false;
  }
});

// Heartbeat interval to detect dead connections
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('Terminating dead connection');
      return ws.terminate();
    }
    
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log(`🚀 WebRTC Signaling Server Started`);
  console.log(`📡 HTTP Server: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket Server: ws://localhost:${PORT}`);
  console.log(`📁 Serving static files from: ./public`);
  console.log('='.repeat(50));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
