const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const prisma = require("../config/prisma");
const config = require("../config/env");

async function register({
  name,
  email,
  password,
  role,
  businessName,
}) {
  const existingUser = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (existingUser) {
    const error = new Error("User already exists with this email");
    error.statusCode = 409;
    throw error;
  }

  if (role === "MERCHANT" && !businessName) {
    const error = new Error(
      "Business name is required for merchants"
    );
    error.statusCode = 400;
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const result = await prisma.$transaction(async (tx) => {
    // User, wallet, and merchant profile must be created atomically
    const user = await tx.user.create({
      data: {
        name,
        email,
        passwordHash,
        role,
      },
    });

    const wallet = await tx.wallet.create({
      data: {
        userId: user.id,
      },
    });

    let merchantProfile = null;
    // Only merchants require merchant specific profile data
    if (role === "MERCHANT") {
      merchantProfile = await tx.merchantProfile.create({
        data: {
          userId: user.id,
          businessName,
        },
      });
    }

    return {
      user,
      wallet,
      merchantProfile,
    };
  });

  const token = jwt.sign(
    {
      userId: result.user.id,
      role: result.user.role,
    },
    config.jwtSecret,
    {
      expiresIn: "1h",
    }
  );

  return {
    user: {
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
      role: result.user.role,
    },
    walletId: result.wallet.id,
    merchantProfileId: result.merchantProfile
      ? result.merchantProfile.id
      : null,
    token,
  };
}

async function login({ email, password }) {
  const user = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (!user) {
    const error = new Error("Invalid email or password");
    error.statusCode = 401;
    throw error;
  }

  const isPasswordValid = await bcrypt.compare(
    password,
    user.passwordHash
  );

  if (!isPasswordValid) {
    const error = new Error("Invalid email or password");
    error.statusCode = 401;
    throw error;
  }

  const token = jwt.sign(
    {
      userId: user.id,
      role: user.role,
    },
    config.jwtSecret,
    {
      expiresIn: "1h",
    }
  );

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    token,
  };
}

module.exports = {
  register,
  login,
};