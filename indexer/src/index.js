import { loadConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { Indexer } from "./indexer.js";
import { createApi } from "./api.js";

const config = loadConfig();
const db = openDatabase(config.databasePath);
const indexer = new Indexer({ db, config });

await indexer.bootstrap();

if (process.argv.includes("--backfill-only")) {
  const head = await indexer.sync();
  console.log(`backfilled to block ${head}`);
  process.exit(0);
}

const server = createApi({ db, config });
server.listen(config.apiPort, () => {
  console.log(`api listening on http://127.0.0.1:${config.apiPort}`);
});

indexer.start();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    indexer.stop();
    server.close(() => process.exit(0));
  });
}
