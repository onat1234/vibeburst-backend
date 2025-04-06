require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const admin = require('firebase-admin');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

// Firebase Admin SDK başlatma
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Store active users and their matching preferences
const activeUsers = new Map();
const activeMatches = new Map();
const activeChatRooms = new Map();

// Chat duration in milliseconds (5 minutes)
const CHAT_DURATION = 5 * 60 * 1000;

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('New client connected');

  // Handle user registration
  socket.on('register', async (data) => {
    const { userId, name, photo, isAnonymous, anonymityLevel } = data;
    
    // Kullanıcıyı aktif kullanıcılar listesine ekle
    activeUsers.set(userId, {
      socketId: socket.id,
      userId,
      name,
      photo,
      isAnonymous,
      anonymityLevel,
      matched: false,
      matchId: null,
    });

    // Socket'e kullanıcı ID'sini kaydet
    socket.userId = userId;

    console.log(`User registered: ${userId}`);
  });

  // Handle match request
  socket.on('requestMatch', async () => {
    const user = activeUsers.get(socket.userId);
    if (!user || user.matched) return;

    // Eşleşme için uygun kullanıcı ara
    const availableUsers = [...activeUsers.values()].filter(
      u => u.userId !== socket.userId && !u.matched
    );

    if (availableUsers.length === 0) {
      socket.emit('matchError', { message: 'No available users found.' });
      return;
    }

    // Rastgele bir kullanıcı seç
    const randomIndex = Math.floor(Math.random() * availableUsers.length);
    const match = availableUsers[randomIndex];

    // Eşleşmeyi kaydet
    user.matched = true;
    user.matchId = match.userId;
    match.matched = true;
    match.matchId = user.userId;

    // Eşleşme bilgisini sakla
    const matchId = `${user.userId}_${match.userId}`;
    activeMatches.set(matchId, {
      users: [user.userId, match.userId],
      status: 'pending',
    });

    // Kullanıcılara eşleşme önerisini bildir
    socket.emit('matchProposed', {
      matchId: match.userId,
      isAnonymous: match.isAnonymous,
      anonymityLevel: match.anonymityLevel,
    });

    const matchSocket = [...io.sockets.sockets.values()].find(
      s => s.userId === match.userId
    );
    if (matchSocket) {
      matchSocket.emit('matchProposed', {
        matchId: user.userId,
        isAnonymous: user.isAnonymous,
        anonymityLevel: user.anonymityLevel,
      });
    }
  });

  // Handle match response
  socket.on('matchResponse', (data) => {
    const { matchId, accepted } = data;
    const user = activeUsers.get(socket.userId);
    if (!user || !user.matched || user.matchId !== matchId) return;

    const match = activeUsers.get(matchId);
    if (!match) return;

    const matchSocket = [...io.sockets.sockets.values()].find(
      s => s.userId === matchId
    );

    if (accepted) {
      // Eşleşmeyi onayla
      const roomId = `${user.userId}_${matchId}`;
      activeMatches.set(roomId, {
        users: [user.userId, matchId],
        status: 'active',
      });

      // Kullanıcıları odaya ekle
      socket.join(roomId);
      if (matchSocket) {
        matchSocket.join(roomId);
      }

      // Eşleşme başarılı bildirimi gönder
      socket.emit('matchSuccess', { roomId });
      if (matchSocket) {
        matchSocket.emit('matchSuccess', { roomId });
      }

      // Sohbet zamanlayıcısını başlat
      startChatTimer(roomId, [user.userId, matchId]);
    } else {
      // Eşleşmeyi reddet
      user.matched = false;
      user.matchId = null;
      match.matched = false;
      match.matchId = null;

      socket.emit('matchRejected');
      if (matchSocket) {
        matchSocket.emit('matchRejected');
      }
    }
  });

  // Handle joining a chat room
  socket.on('joinRoom', (data) => {
    const { roomId } = data;
    socket.join(roomId);
    console.log(`User ${socket.userId} joined room ${roomId}`);
  });

  // Handle chat messages
  socket.on('message', (data) => {
    const { roomId, message } = data;
    const user = activeUsers.get(socket.userId);
    
    if (!user || !activeMatches.has(roomId)) return;

    // Mesaja kullanıcı bilgilerini ekle
    const messageWithUser = {
      ...message,
      userId: socket.userId,
      userName: user.name,
      userPhoto: user.photo,
      isAnonymous: user.isAnonymous,
      anonymityLevel: user.anonymityLevel,
    };

    // Mesajı odaya gönder
    io.to(roomId).emit('message', messageWithUser);
  });

  // Handle user report
  socket.on('reportUser', async (data) => {
    const { reportedUserId, reason } = data;
    const user = activeUsers.get(socket.userId);
    
    if (!user) return;

    try {
      // Raporu Firestore'a kaydet
      await admin.firestore().collection('reports').add({
        reportedUserId,
        reportedBy: socket.userId,
        reason,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`User ${reportedUserId} reported by ${socket.userId} for ${reason}`);
    } catch (error) {
      console.error('Error saving report:', error);
    }
  });

  // Handle chat rating
  socket.on('rateChat', async (data) => {
    const { ratedUserId, tag } = data;
    const user = activeUsers.get(socket.userId);
    
    if (!user) return;

    try {
      // Değerlendirmeyi Firestore'a kaydet
      await admin.firestore().collection('userRatings').add({
        ratedUserId,
        ratedBy: socket.userId,
        tag,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`User ${ratedUserId} rated by ${socket.userId} as ${tag}`);
    } catch (error) {
      console.error('Error saving rating:', error);
    }
  });

  // WebRTC Call Handling
  socket.on('callUser', (data) => {
    const { to, from, roomId, type } = data;
    const targetUser = activeUsers.get(to);
    
    if (targetUser) {
      // Send call request to target user
      io.to(targetUser.socketId).emit('incomingCall', {
        from,
        roomId,
        type,
      });
      
      console.log(`Call initiated from ${from} to ${to} (${type})`);
    } else {
      // User not found or offline
      socket.emit('callRejected', {
        from: to,
        reason: 'User is offline',
      });
    }
  });

  socket.on('answerCall', (data) => {
    const { to, from, roomId, answer } = data;
    const targetUser = activeUsers.get(to);
    
    if (targetUser) {
      // Send answer to caller
      io.to(targetUser.socketId).emit('callAnswered', {
        from,
        roomId,
        answer,
      });
      
      console.log(`Call answered by ${from} to ${to}`);
    }
  });

  socket.on('rejectCall', (data) => {
    const { to, from } = data;
    const targetUser = activeUsers.get(to);
    
    if (targetUser) {
      // Send rejection to caller
      io.to(targetUser.socketId).emit('callRejected', {
        from,
        reason: 'Call rejected',
      });
      
      console.log(`Call rejected by ${from} to ${to}`);
    }
  });

  socket.on('endCall', (data) => {
    const { to, from, roomId } = data;
    const targetUser = activeUsers.get(to);
    
    if (targetUser) {
      // Notify the other user that call has ended
      io.to(targetUser.socketId).emit('callEnded', {
        from,
        roomId,
      });
      
      console.log(`Call ended between ${from} and ${to}`);
    }
  });

  socket.on('offer', (data) => {
    const { to, from, roomId, offer } = data;
    const targetUser = activeUsers.get(to);
    
    if (targetUser) {
      // Forward the offer to the target user
      io.to(targetUser.socketId).emit('offer', {
        from,
        roomId,
        offer,
      });
    }
  });

  socket.on('answer', (data) => {
    const { to, from, roomId, answer } = data;
    const targetUser = activeUsers.get(to);
    
    if (targetUser) {
      // Forward the answer to the caller
      io.to(targetUser.socketId).emit('answer', {
        from,
        roomId,
        answer,
      });
    }
  });

  socket.on('iceCandidate', (data) => {
    const { to, from, roomId, candidate } = data;
    const targetUser = activeUsers.get(to);
    
    if (targetUser) {
      // Forward the ICE candidate to the other peer
      io.to(targetUser.socketId).emit('iceCandidate', {
        from,
        roomId,
        candidate,
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const user = activeUsers.get(socket.userId);
    if (user) {
      // Kullanıcının eşleşmesini temizle
      if (user.matched && user.matchId) {
        const match = activeUsers.get(user.matchId);
        if (match) {
          match.matched = false;
          match.matchId = null;
        }

        // Eşleşmeyi temizle
        const matchId = `${user.userId}_${user.matchId}`;
        activeMatches.delete(matchId);

        // Sohbet odasını kapat
        const roomId = matchId;
        if (activeChatRooms.has(roomId)) {
          closeChatRoom(roomId, [user.userId, user.matchId]);
        }
      }

      // Kullanıcıyı aktif kullanıcılar listesinden çıkar
      activeUsers.delete(socket.userId);
    }

    console.log('Client disconnected');
  });
});

// Function to start a timer for a chat room
function startChatTimer(roomId, userIds) {
  // Clear any existing timer for this room
  if (activeChatRooms.has(roomId)) {
    clearTimeout(activeChatRooms.get(roomId).timer);
  }

  // Set a new timer
  const timer = setTimeout(() => {
    // Time's up, close the room
    closeChatRoom(roomId, userIds);
  }, CHAT_DURATION);

  // Store the timer
  activeChatRooms.set(roomId, {
    timer,
    userIds,
    startTime: Date.now()
  });

  // Notify users about the time limit
  userIds.forEach(userId => {
    const socket = [...io.sockets.sockets.values()].find(
      s => s.userId === userId
    );
    if (socket) {
      socket.emit('chatTimerStarted', {
        duration: CHAT_DURATION,
        endTime: Date.now() + CHAT_DURATION
      });
    }
  });
}

// Function to close a chat room
function closeChatRoom(roomId, userIds) {
  // Remove the room from active rooms
  activeChatRooms.delete(roomId);

  // Notify users that the chat has ended
  userIds.forEach(userId => {
    const socket = [...io.sockets.sockets.values()].find(
      s => s.userId === userId
    );
    if (socket) {
      socket.emit('chatEnded', {
        message: "Süreniz doldu. Yeni bir eşleşme için eşleşme isteyebilirsiniz."
      });
      socket.emit('matchEnded');
    }
  });

  // Reset matched status for all users in the room
  userIds.forEach(userId => {
    const user = Array.from(activeUsers.values()).find(u => u.userId === userId);
    if (user) {
      user.matched = false;
      user.matchId = null;
      user.socket.emit('matchEnded');
    }
  });

  // Disconnect all users from the room
  io.in(roomId).socketsLeave(roomId);
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 