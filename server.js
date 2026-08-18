const app = require("./src/app");
const config = require("./src/config/env");

app.listen(config.port, () => {
  console.log(
    `Payment gateway API listening on port ${config.port} [${config.nodeEnv}]`
  );
});