const walletService = require("../services/wallet.service");

async function getWallet(req, res, next) {
  try {
    const wallet = await walletService.getWallet(req.user.id);

    return res.status(200).json({
      wallet,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getWallet,
};