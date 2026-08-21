const { Server } = require("socket.io");

let io;

function initializeSocket(server) {
  io = new Server(server, {
    cors: {
      origin: "*",
    },
  });

  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    socket.on("join-payment", (paymentIntentId) => {
      const room = `payment:${paymentIntentId}`;

      socket.join(room);

      console.log(
        `Socket ${socket.id} joined room ${room}`,
      );

      socket.emit("PAYMENT_ROOM_JOINED", {
        paymentIntentId,
      });
    });

    socket.on("leave-payment", (paymentIntentId) => {
      const room = `payment:${paymentIntentId}`;

      socket.leave(room);

      console.log(
        `Socket ${socket.id} left room ${room}`,
      );
    });

    socket.on("disconnect", () => {
      console.log("Socket disconnected:", socket.id);
    });
  });

  return io;
}

function getSocketIO() {
  if (!io) {
    throw new Error("Socket.io has not been initialized");
  }

  return io;
}

module.exports = {
  initializeSocket,
  getSocketIO,
};