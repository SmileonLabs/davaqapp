import { startShopDeliveryWorker } from './lib/shop/delivery';
import { startCollectorLoungeWorker } from './lib/collectorLounge/worker';
import {startCollectorDirectWorker} from './lib/collectorLounge/direct';
import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { attachRealtimeServer } from "./lib/realtime";
import { startOntologySyncWorker } from "./lib/ontologySync";
import { startCallLifecycleWorker } from "./routes/calls";

import { startChatOutboxWorker } from "./lib/chatOutboxWorker";
import { startTcgWorker } from "./lib/tcgWorker";

const rawPort = process.env["PORT"] ?? "8080";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);
attachRealtimeServer(server);

server.once("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});

// PostgreSQL migrations and Neo4j schema/seed writes run through one-shot jobs
// before replicas start. App startup only begins request-serving workers.
startOntologySyncWorker(logger);
startCallLifecycleWorker(logger);
startTcgWorker();
const stopShopDeliveryWorker=startShopDeliveryWorker();
server.once("close",stopShopDeliveryWorker);
const stopCollectorLoungeWorker = startCollectorLoungeWorker();
const stopCollectorDirectWorker = startCollectorDirectWorker();
server.once("close",()=>stopCollectorDirectWorker?.());
server.once("close", () => stopCollectorLoungeWorker?.());
const stopChatOutboxWorker = startChatOutboxWorker();
server.once("close", stopChatOutboxWorker);

server.listen({ port, host: process.env.HOST }, () => {
  logger.info({ port }, "Server listening");
});
