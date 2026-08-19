const crypto = require("crypto");

const prisma = require("../config/prisma");

async function configureWebhook({ userId, webhookUrl }) {
  const merchantProfile = await prisma.merchantProfile.findUnique({
    where: {
      userId,
    },
  });

  if (!merchantProfile) {
    const error = new Error("Merchant profile not found");
    error.statusCode = 404;
    throw error;
  }

  const webhookSecret = crypto.randomBytes(32).toString("hex");

  const updatedProfile = await prisma.merchantProfile.update({
    where: {
      userId,
    },
    data: {
      webhookUrl,
      webhookSecret,
    },
    select: {
      id: true,
      businessName: true,
      webhookUrl: true,
      createdAt: true,
    },
  });

  return {
    merchantProfile: updatedProfile,
    webhookSecret,
  };
}

module.exports = {
  configureWebhook,
};