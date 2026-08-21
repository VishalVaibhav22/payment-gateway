const http = require("http");

const app = require("./src/app");
const config = require("./src/config/env");
const redisClient = require("./src/config/redis");

const {
  initializeSocket,
} = require("./src/config/socket");

const server = http.createServer(app);

initializeSocket(server);

async function startServer() {
  try {
    await redisClient.connect();
    server.listen(config.port, () => {
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