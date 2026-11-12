const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { User } = require('../models');
const { setIo } = require('./io');
const { corsOrigin } = require('../config/origins');

function initSocket(server) {
  const io = new Server(server, { cors: { origin: corsOrigin, credentials: true } });
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      if (payload.type !== 'access') return next(new Error('Unauthorized'));
      const user = await User.findOne({ _id: payload.sub, isActive: true, deletedAt: null });
      if (!user) return next(new Error('Unauthorized'));
      socket.user = user;
      return next();
    } catch (error) {
      return next(new Error('Unauthorized'));
    }
  });
  io.on('connection', (socket) => {
    socket.join(`user:${socket.user._id}`);
    socket.join(`role:${socket.user.role}`);
  });
  setIo(io);
  return io;
}

module.exports = { initSocket };
