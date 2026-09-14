import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, getCursor, setCursor, rollbackTo } from "../src/db.js";

function seed(db) {
  db.prepare("INSERT INTO tokens VALUES (?,?,?,?)").run("0xA", "AAA", "Token A", 18);
  db.prepare("INSERT INTO tokens VALUES (?,?,?,?)").run("0xB", "BBB", "Token B", 18);
  db.prepare("INSERT INTO pairs (address, token0, token1, created_block) VALUES (?,?,?,?)").run(
    "0xPAIR",
    "0xA",
    "0xB",
    10
  );

  const insertSync = db.prepare(
    "INSERT INTO sync_events (id, pair, block_number, log_index, timestamp, reserve0, reserve1) VALUES (?,?,?,?,?,?,?)"
  );
  const insertSwap = db.prepare(
    "INSERT INTO swaps (id, pair, block_number, log_index, tx_hash, timestamp, sender, recipient," +
      " amount0_in, amount1_in, amount0_out, amount1_out, price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
  );

  for (const block of [11, 12, 13]) {
    db.prepare("INSERT INTO blocks VALUES (?,?,?,?)").run(block, `0xhash${block}`, `0xhash${block - 1}`, block * 10);
    insertSync.run(`s${block}`, "0xPAIR", block, 0, block * 10, String(block * 100), String(block * 200));
    insertSwap.run(
      `w${block}`,
      "0xPAIR",
      block,
      1,
      `0xtx${block}`,
      block * 10,
      "0xsender",
      "0xrecipient",
      "100",
      "0",
      "0",
      "200",
      2
    );
  }
  db.prepare("UPDATE pairs SET reserve0 = ?, reserve1 = ?, reserve_block = ? WHERE address = ?").run(
    "1300",
    "2600",
    13,
    "0xPAIR"
  );
  setCursor(db, 13);
}

test("rollbackTo removes rows above the fork point", () => {
  const db = openDatabase(":memory:");
  seed(db);

  rollbackTo(db, 12);

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM swaps").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sync_events").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM blocks").get().n, 1);
});

test("rollbackTo restores the reserve snapshot from the surviving Sync", () => {
  const db = openDatabase(":memory:");
  seed(db);

  rollbackTo(db, 12);

  const pair = db.prepare("SELECT * FROM pairs WHERE address = ?").get("0xPAIR");
  assert.equal(pair.reserve0, "1100");
  assert.equal(pair.reserve1, "2200");
  assert.equal(Number(pair.reserve_block), 11);
});

test("rollbackTo zeroes reserves when no Sync survives", () => {
  const db = openDatabase(":memory:");
  seed(db);

  rollbackTo(db, 11);

  const pair = db.prepare("SELECT * FROM pairs WHERE address = ?").get("0xPAIR");
  assert.equal(pair.reserve0, "0");
  assert.equal(Number(pair.reserve_block), 0);
});

test("a pair created above the fork point is removed entirely", () => {
  const db = openDatabase(":memory:");
  seed(db);
  db.prepare("INSERT INTO pairs (address, token0, token1, created_block) VALUES (?,?,?,?)").run(
    "0xNEW",
    "0xA",
    "0xB",
    12
  );

  rollbackTo(db, 12);

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pairs WHERE address = ?").get("0xNEW").n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pairs WHERE address = ?").get("0xPAIR").n, 1);
});

test("the cursor round-trips and falls back when unset", () => {
  const db = openDatabase(":memory:");
  assert.equal(getCursor(db, 99), 99);
  setCursor(db, 250);
  assert.equal(getCursor(db, 99), 250);
});
