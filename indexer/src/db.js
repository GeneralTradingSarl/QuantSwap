import { DatabaseSync } from "node:sqlite";

/**
 * SQLite schema for the indexer.
 *
 * Two rules run through it:
 *   1. Every row that came from a log carries its block number, so a reorg can delete
 *      exactly the rows that are no longer true.
 *   2. Token amounts are stored as decimal TEXT, not as floats. A uint256 does not fit in
 *      a double, and silently losing the low bits of a balance is not an acceptable bug.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS blocks (
  number       INTEGER PRIMARY KEY,
  hash         TEXT NOT NULL,
  parent_hash  TEXT NOT NULL,
  timestamp    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
  address   TEXT PRIMARY KEY,
  symbol    TEXT NOT NULL,
  name      TEXT NOT NULL,
  decimals  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pairs (
  address       TEXT PRIMARY KEY,
  token0        TEXT NOT NULL,
  token1        TEXT NOT NULL,
  created_block INTEGER NOT NULL,
  reserve0      TEXT NOT NULL DEFAULT '0',
  reserve1      TEXT NOT NULL DEFAULT '0',
  reserve_block INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS swaps (
  id            TEXT PRIMARY KEY,
  pair          TEXT NOT NULL,
  block_number  INTEGER NOT NULL,
  log_index     INTEGER NOT NULL,
  tx_hash       TEXT NOT NULL,
  timestamp     INTEGER NOT NULL,
  sender        TEXT NOT NULL,
  recipient     TEXT NOT NULL,
  amount0_in    TEXT NOT NULL,
  amount1_in    TEXT NOT NULL,
  amount0_out   TEXT NOT NULL,
  amount1_out   TEXT NOT NULL,
  price         REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS swaps_pair_time ON swaps (pair, timestamp);
CREATE INDEX IF NOT EXISTS swaps_block ON swaps (block_number);

CREATE TABLE IF NOT EXISTS liquidity_events (
  id            TEXT PRIMARY KEY,
  pair          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('mint', 'burn')),
  block_number  INTEGER NOT NULL,
  log_index     INTEGER NOT NULL,
  tx_hash       TEXT NOT NULL,
  timestamp     INTEGER NOT NULL,
  account       TEXT NOT NULL,
  amount0       TEXT NOT NULL,
  amount1       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS liquidity_pair_time ON liquidity_events (pair, timestamp);
CREATE INDEX IF NOT EXISTS liquidity_block ON liquidity_events (block_number);

CREATE TABLE IF NOT EXISTS sync_events (
  id            TEXT PRIMARY KEY,
  pair          TEXT NOT NULL,
  block_number  INTEGER NOT NULL,
  log_index     INTEGER NOT NULL,
  timestamp     INTEGER NOT NULL,
  reserve0      TEXT NOT NULL,
  reserve1      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sync_pair_block ON sync_events (pair, block_number, log_index);
CREATE INDEX IF NOT EXISTS sync_block ON sync_events (block_number);

CREATE TABLE IF NOT EXISTS cursor (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  last_indexed_block INTEGER NOT NULL
);
`;

export function openDatabase(filePath) {
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export function getCursor(db, fallback) {
  const row = db.prepare("SELECT last_indexed_block FROM cursor WHERE id = 1").get();
  return row ? Number(row.last_indexed_block) : fallback;
}

export function setCursor(db, blockNumber) {
  db.prepare(
    "INSERT INTO cursor (id, last_indexed_block) VALUES (1, ?) " +
      "ON CONFLICT(id) DO UPDATE SET last_indexed_block = excluded.last_indexed_block"
  ).run(blockNumber);
}

/**
 * Drops everything at or above `blockNumber`, then rebuilds the reserve snapshot on each
 * affected pair from the most recent surviving Sync. Called when the chain reorganises.
 */
export function rollbackTo(db, blockNumber) {
  const affected = db
    .prepare("SELECT DISTINCT pair FROM sync_events WHERE block_number >= ?")
    .all(blockNumber)
    .map((row) => row.pair);

  db.prepare("DELETE FROM swaps WHERE block_number >= ?").run(blockNumber);
  db.prepare("DELETE FROM liquidity_events WHERE block_number >= ?").run(blockNumber);
  db.prepare("DELETE FROM sync_events WHERE block_number >= ?").run(blockNumber);
  db.prepare("DELETE FROM pairs WHERE created_block >= ?").run(blockNumber);
  db.prepare("DELETE FROM blocks WHERE number >= ?").run(blockNumber);

  const latestSync = db.prepare(
    "SELECT reserve0, reserve1, block_number FROM sync_events WHERE pair = ? " +
      "ORDER BY block_number DESC, log_index DESC LIMIT 1"
  );
  const updateReserves = db.prepare(
    "UPDATE pairs SET reserve0 = ?, reserve1 = ?, reserve_block = ? WHERE address = ?"
  );

  for (const pair of affected) {
    const row = latestSync.get(pair);
    if (row) {
      updateReserves.run(row.reserve0, row.reserve1, Number(row.block_number), pair);
    } else {
      updateReserves.run("0", "0", 0, pair);
    }
  }

  return affected.length;
}
