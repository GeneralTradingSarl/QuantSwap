import http from "node:http";
import { formatUnits } from "viem";

const DAY = 86_400;
const FEE_BPS = 30n; // 0.30%

/**
 * Read-only JSON API over the indexed data. Deliberately small: the web app should not talk
 * to an RPC node for history, and the browser should never be the thing aggregating a day of
 * swap logs.
 */
export function createApi({ db, config, logger = console }) {
  const routes = [
    { method: "GET", pattern: /^\/health$/, handler: health },
    { method: "GET", pattern: /^\/stats$/, handler: stats },
    { method: "GET", pattern: /^\/pools$/, handler: listPools },
    { method: "GET", pattern: /^\/pools\/(0x[a-fA-F0-9]{40})$/, handler: getPool },
    { method: "GET", pattern: /^\/pools\/(0x[a-fA-F0-9]{40})\/candles$/, handler: getCandles },
    { method: "GET", pattern: /^\/pools\/(0x[a-fA-F0-9]{40})\/swaps$/, handler: getSwaps },
  ];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    if (req.method === "OPTIONS") return send(res, 204, null);

    for (const route of routes) {
      const match = url.pathname.match(route.pattern);
      if (match && route.method === req.method) {
        try {
          return send(res, 200, route.handler({ db, config, params: match.slice(1), query: url.searchParams }));
        } catch (error) {
          logger.error?.(error);
          return send(res, 500, { error: error.message });
        }
      }
    }
    return send(res, 404, { error: "not found" });
  });

  return server;
}

function health({ db, config }) {
  const cursor = db.prepare("SELECT last_indexed_block FROM cursor WHERE id = 1").get();
  return {
    status: "ok",
    network: config.networkName,
    chainId: config.deployment.chainId,
    lastIndexedBlock: cursor ? Number(cursor.last_indexed_block) : null,
    contracts: config.deployment.contracts,
  };
}

function stats({ db }) {
  const since = nowSeconds() - DAY;
  const pools = db.prepare("SELECT COUNT(*) AS count FROM pairs").get().count;
  const swaps24h = db.prepare("SELECT COUNT(*) AS count FROM swaps WHERE timestamp >= ?").get(since).count;
  const swapsTotal = db.prepare("SELECT COUNT(*) AS count FROM swaps").get().count;
  const uniqueTraders = db
    .prepare("SELECT COUNT(DISTINCT recipient) AS count FROM swaps WHERE timestamp >= ?")
    .get(since).count;

  return { pools, swaps24h, swapsTotal, uniqueTraders24h: uniqueTraders };
}

function listPools({ db }) {
  const pairs = db.prepare("SELECT * FROM pairs ORDER BY created_block ASC").all();
  return { pools: pairs.map((pair) => decoratePool(db, pair)) };
}

function getPool({ db, params }) {
  const pair = db.prepare("SELECT * FROM pairs WHERE address = ? COLLATE NOCASE").get(params[0]);
  if (!pair) throw new Error("pool not found");
  return decoratePool(db, pair);
}

/**
 * OHLC candles built from executed swap prices. Buckets with no trade are omitted rather
 * than forward-filled: an empty bucket is information, and inventing a bar hides it.
 */
function getCandles({ db, params, query }) {
  const interval = clamp(Number(query.get("interval") ?? 300), 60, 86_400);
  const limit = clamp(Number(query.get("limit") ?? 200), 1, 1000);

  const rows = db
    .prepare(
      "SELECT CAST(timestamp / ? AS INTEGER) * ? AS bucket," +
        " MIN(price) AS low, MAX(price) AS high, COUNT(*) AS trades," +
        " MIN(timestamp) AS first_ts, MAX(timestamp) AS last_ts" +
        " FROM swaps WHERE pair = ? COLLATE NOCASE AND price > 0" +
        " GROUP BY bucket ORDER BY bucket DESC LIMIT ?"
    )
    .all(interval, interval, params[0], limit)
    .reverse();

  const priceAt = db.prepare(
    "SELECT price FROM swaps WHERE pair = ? COLLATE NOCASE AND timestamp = ? AND price > 0" +
      " ORDER BY block_number ASC, log_index ASC LIMIT 1"
  );
  const priceAtEnd = db.prepare(
    "SELECT price FROM swaps WHERE pair = ? COLLATE NOCASE AND timestamp = ? AND price > 0" +
      " ORDER BY block_number DESC, log_index DESC LIMIT 1"
  );

  return {
    interval,
    candles: rows.map((row) => ({
      time: Number(row.bucket),
      open: priceAt.get(params[0], Number(row.first_ts))?.price ?? row.low,
      high: row.high,
      low: row.low,
      close: priceAtEnd.get(params[0], Number(row.last_ts))?.price ?? row.high,
      trades: Number(row.trades),
    })),
  };
}

function getSwaps({ db, params, query }) {
  const limit = clamp(Number(query.get("limit") ?? 50), 1, 500);
  const pair = db.prepare("SELECT * FROM pairs WHERE address = ? COLLATE NOCASE").get(params[0]);
  if (!pair) throw new Error("pool not found");

  const token0 = tokenOf(db, pair.token0);
  const token1 = tokenOf(db, pair.token1);
  const rows = db
    .prepare(
      "SELECT * FROM swaps WHERE pair = ? COLLATE NOCASE ORDER BY block_number DESC, log_index DESC LIMIT ?"
    )
    .all(params[0], limit);

  return {
    swaps: rows.map((row) => {
      const zeroForOne = BigInt(row.amount0_in) > 0n;
      return {
        txHash: row.tx_hash,
        blockNumber: Number(row.block_number),
        timestamp: Number(row.timestamp),
        recipient: row.recipient,
        side: zeroForOne ? "sell" : "buy",
        amountIn: zeroForOne
          ? formatUnits(BigInt(row.amount0_in), token0.decimals)
          : formatUnits(BigInt(row.amount1_in), token1.decimals),
        amountOut: zeroForOne
          ? formatUnits(BigInt(row.amount1_out), token1.decimals)
          : formatUnits(BigInt(row.amount0_out), token0.decimals),
        tokenIn: zeroForOne ? token0.symbol : token1.symbol,
        tokenOut: zeroForOne ? token1.symbol : token0.symbol,
        price: row.price,
      };
    }),
  };
}

function decoratePool(db, pair) {
  const token0 = tokenOf(db, pair.token0);
  const token1 = tokenOf(db, pair.token1);
  const since = nowSeconds() - DAY;

  const window = db
    .prepare(
      "SELECT COALESCE(SUM(CAST(amount0_in AS REAL) + CAST(amount0_out AS REAL)), 0) AS volume0_raw," +
        " COALESCE(SUM(CAST(amount1_in AS REAL) + CAST(amount1_out AS REAL)), 0) AS volume1_raw," +
        " COUNT(*) AS trades FROM swaps WHERE pair = ? AND timestamp >= ?"
    )
    .get(pair.address, since);

  const last = db
    .prepare(
      "SELECT price FROM swaps WHERE pair = ? AND price > 0 ORDER BY block_number DESC, log_index DESC LIMIT 1"
    )
    .get(pair.address);
  const opening = db
    .prepare(
      "SELECT price FROM swaps WHERE pair = ? AND price > 0 AND timestamp >= ?" +
        " ORDER BY block_number ASC, log_index ASC LIMIT 1"
    )
    .get(pair.address, since);

  const reserve0 = BigInt(pair.reserve0);
  const reserve1 = BigInt(pair.reserve1);
  const spotPrice = reserve0 === 0n
    ? 0
    : Number(formatUnits(reserve1, token1.decimals)) / Number(formatUnits(reserve0, token0.decimals));

  const volume0 = window.volume0_raw / 10 ** token0.decimals;
  const volume1 = window.volume1_raw / 10 ** token1.decimals;

  return {
    address: pair.address,
    label: `${token0.symbol}/${token1.symbol}`,
    token0,
    token1,
    reserve0: formatUnits(reserve0, token0.decimals),
    reserve1: formatUnits(reserve1, token1.decimals),
    spotPrice,
    lastTradePrice: last?.price ?? spotPrice,
    priceChange24h: opening?.price && last?.price ? (last.price - opening.price) / opening.price : 0,
    volume24h: { token0: volume0, token1: volume1 },
    // The fee is taken on the input side, which for a round trip is both sides of the book.
    fees24h: { token0: (volume0 * Number(FEE_BPS)) / 10_000, token1: (volume1 * Number(FEE_BPS)) / 10_000 },
    trades24h: Number(window.trades),
  };
}

function tokenOf(db, address) {
  const row = db.prepare("SELECT * FROM tokens WHERE address = ? COLLATE NOCASE").get(address);
  return row
    ? { address: row.address, symbol: row.symbol, name: row.name, decimals: Number(row.decimals) }
    : { address, symbol: "???", name: "Unknown", decimals: 18 };
}

function send(res, status, body) {
  if (body === null) {
    res.writeHead(status);
    return res.end();
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
