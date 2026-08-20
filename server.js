const app = require("./src/app");
const config = require("./src/config/env");
const redisClient = require("./src/config/redis");

async function startServer() {
  try {
    await redisClient.connect();
    app.listen(config.port, () => {
      console.log(
        `Payment gateway API listening on port ${config.port} [${config.nodeEnv}]`,
      );
    });
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
}



startServer();