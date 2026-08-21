const { getSocketIO } = require("../config/socket");

function emitPaymentUpdate({
  paymentIntentId,
  status,
}) {
  const io = getSocketIO();

  const room = `payment:${paymentIntentId}`;

  io.to(room).emit("PAYMENT_UPDATE", {
    paymentIntentId,
    status,
  });
}

module.exports = {
  emitPaymentUpdate,
};