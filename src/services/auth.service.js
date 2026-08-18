const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const prisma = require("../config/prisma");
const config = require("../config/env");

async function register({ name, email, password }) {
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

  const passwordHash = await bcrypt.hash(password, 10);

  const result = await prisma.$transaction(async (tx) => {
     // User and wallet must be created atomically.
    const user = await tx.user.create({
      data: {
        name,
        email,
        passwordHash,
      },
    });

    const wallet = await tx.wallet.create({
      data: {
        userId: user.id,
      },
    });

    return { user, wallet };
  });

  const token = jwt.sign(
    {
      userId: result.user.id,
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
    },
    walletId: result.wallet.id,
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
    },
    token,
  };
}


module.exports = {
  register,
  login,
};