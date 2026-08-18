const prisma = require("../config/prisma");

async function getWallet(userId) {
  const wallet = await prisma.wallet.findUnique({
    where: {
      userId,
    },
    select: {
      id: true,
      balance: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!wallet) {
    const error = new Error("Wallet not found");
    error.statusCode = 404;
    throw error;
  }

  return wallet;
}

module.exports = {
  getWallet,
};