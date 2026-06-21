import closeWithGrace from "close-with-grace";
import { buildApp } from "./app";
import { config } from "./config/env";

async function main() {
  const app = await buildApp();

  // Drain in-flight requests on SIGINT/SIGTERM / unhandled rejections.
  closeWithGrace({ delay: 10_000 }, async ({ signal, err }) => {
    if (err) app.log.error({ err }, "Shutting down due to error");
    else app.log.info({ signal }, "Graceful shutdown");
    await app.close();
  });

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (err) {
    app.log.error({ err }, "Failed to start server");
    process.exit(1);
  }
}

void main();
