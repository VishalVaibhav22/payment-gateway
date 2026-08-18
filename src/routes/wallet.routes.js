const express = require("express");

const walletController = require("../controllers/wallet.controller");
const authMiddleware = require("../middleware/auth.middleware");

const router = express.Router();

router.get("/", authMiddleware, walletController.getWallet);

module.exports = router;