import http from "http";
import fs from "fs/promises";

import { config } from "./config";
import { createApp } from "./app";
import { setupWebSocket } from "./websocket";

async function main() {
  await fs.mkdir(config.uploads.screenshotsDir, { recursive: true });

  const app = createApp();
  const server = http.createServer(app);

  setupWebSocket(server);

  server.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
    console.log(`Environment: ${config.nodeEnv}`);
    console.log(`WebSocket ready`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
