const authService = require("../services/auth.service");
const config = require("../config/env");

async function register(req, res, next) {
  try {
    const { name, email, password } = req.body;

    const result = await authService.register({
      name,
      email,
      password,
    });

    res.cookie("token", result.token, {
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 1000,
    });

    return res.status(201).json({
      message: "User registered successfully",
      user: result.user,
      walletId: result.walletId,
    });
  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    const result = await authService.login({
      email,
      password,
    });

    res.cookie("token", result.token, {
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 1000,
    });

    return res.status(200).json({
      message: "Login successful",
      user: result.user,
    });
  } catch (error) {
    next(error);
  }
}

function logout(req, res) {
  res.clearCookie("token", {
    httpOnly: true,
    // HTTPS-only in production; localhost uses HTTP during development.
    secure: config.nodeEnv === "production",
    sameSite: "lax",
  });

  return res.status(200).json({
    message: "Logout successful",
  });
}

function me(req, res) {
  return res.status(200).json({
    user: req.user,
  });
}

module.exports = {
  register,
  login,
  logout,
  me,
};