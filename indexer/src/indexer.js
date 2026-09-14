import { createPublicClient, http, getAddress, formatUnits } from "viem";
import { factoryAbi, pairAbi, erc20Abi } from "./abi.js";
import { getCursor, setCursor, rollbackTo } from "./db.js";

/**
 * Log indexer for the QuantSwap contracts.
 *
 * The part that is easy to get wrong is not reading logs, it is what happens when the chain
 * changes its mind. Every indexed block header is stored, and before each poll the tip we
 * last wrote is compared against the chain. If the hash no longer matches we walk backwards
 * to the fork point and delete everything above it, rather than leaving rows that describe
 * a history that no longer exists.
 */
export class Indexer {
  constructor({ db, config, logger = console }) {
    this.db = db;
    this.config = config;
    this.logger = logger;
    this.client = createPublicClient({ transport: http(config.rpcUrl) });
    this.factoryAddress = getAddress(config.deployment.contracts.factory);
    this.running = false;
  }

  async bootstrap() {
    for (const token of Object.values(this.config.deployment.tokens ?? {})) {
      this.#upsertToken(token);
    }
    this.logger.info?.(`indexer ready on ${this.config.rpcUrl} (${this.config.networkName})`);
  }

  /** Indexes everything up to the current head, then returns. */
  async sync() {
    const head = Number(await this.client.getBlockNumber());
    let from = getCursor(this.db, this.config.deployment.startBlock ?? 0) + 1;

    const forkPoint = await this.#detectReorg();
    if (forkPoint !== null) {
      const affected = rollbackTo(this.db, forkPoint);
      setCursor(this.db, forkPoint - 1);
      this.logger.warn?.(`reorg detected: rolled back to block ${forkPoint} (${affected} pairs touched)`);
      from = forkPoint;
    }

    while (from <= head) {
      const to = Math.min(from + Number(this.config.logRange) - 1, head);
      await this.#indexRange(from, to);
      setCursor(this.db, to);
      from = to + 1;
    }
    return head;
  }

  async start() {
    this.running = true;
    while (this.running) {
      try {
        await this.sync();
      } catch (error) {
        // A dropped RPC connection is normal operation, not an incident. Log and retry.
        this.logger.error?.(`sync failed: ${error.shortMessage ?? error.message}`);
      }
      await sleep(this.config.pollIntervalMs);
    }
  }

  stop() {
    this.running = false;
  }

  /** Returns the first block number that is no longer valid, or null if the chain agrees. */
  async #detectReorg() {
    const stored = this.db
      .prepare("SELECT number, hash FROM blocks ORDER BY number DESC LIMIT 50")
      .all();
    if (stored.length === 0) return null;

    for (const row of stored) {
      const onChain = await this.client.getBlock({ blockNumber: BigInt(row.number) }).catch(() => null);
      if (onChain && onChain.hash === row.hash) {
        // This block still matches, so the fork point is immediately above it.
        return row.number === stored[0].number ? null : row.number + 1;
      }
    }
    // Nothing in our recent window matches: rewind past all of it.
    return stored[stored.length - 1].number;
  }

  async #indexRange(fromBlock, toBlock) {
    await this.#indexPairCreations(fromBlock, toBlock);

    const pairAddresses = this.db
      .prepare("SELECT address FROM pairs")
      .all()
      .map((row) => getAddress(row.address));
    if (pairAddresses.length === 0) return;

    const logs = await this.client.getLogs({
      address: pairAddresses,
      events: pairAbi.filter((item) => item.type === "event"),
      fromBlock: BigInt(fromBlock),
      toBlock: BigInt(toBlock),
    });
    if (logs.length === 0) return;

    const blocks = await this.#loadBlocks(logs);
    const insertSwap = this.db.prepare(
      "INSERT OR REPLACE INTO swaps (id, pair, block_number, log_index, tx_hash, timestamp, sender, recipient," +
        " amount0_in, amount1_in, amount0_out, amount1_out, price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
    );
    const insertLiquidity = this.db.prepare(
      "INSERT OR REPLACE INTO liquidity_events (id, pair, kind, block_number, log_index, tx_hash, timestamp," +
        " account, amount0, amount1) VALUES (?,?,?,?,?,?,?,?,?,?)"
    );
    const insertSync = this.db.prepare(
      "INSERT OR REPLACE INTO sync_events (id, pair, block_number, log_index, timestamp, reserve0, reserve1)" +
        " VALUES (?,?,?,?,?,?,?)"
    );
    const updateReserves = this.db.prepare(
      "UPDATE pairs SET reserve0 = ?, reserve1 = ?, reserve_block = ? WHERE address = ? AND reserve_block <= ?"
    );

    for (const log of logs) {
      const pair = getAddress(log.address);
      const id = `${log.transactionHash}-${log.logIndex}`;
      const blockNumber = Number(log.blockNumber);
      const timestamp = blocks.get(blockNumber);
      const args = log.args;

      switch (log.eventName) {
        case "Swap":
          insertSwap.run(
            id,
            pair,
            blockNumber,
            Number(log.logIndex),
            log.transactionHash,
            timestamp,
            getAddress(args.sender),
            getAddress(args.to),
            args.amount0In.toString(),
            args.amount1In.toString(),
            args.amount0Out.toString(),
            args.amount1Out.toString(),
            this.#executionPrice(pair, args)
          );
          break;
        case "Mint":
          insertLiquidity.run(
            id,
            pair,
            "mint",
            blockNumber,
            Number(log.logIndex),
            log.transactionHash,
            timestamp,
            getAddress(args.sender),
            args.amount0.toString(),
            args.amount1.toString()
          );
          break;
        case "Burn":
          insertLiquidity.run(
            id,
            pair,
            "burn",
            blockNumber,
            Number(log.logIndex),
            log.transactionHash,
            timestamp,
            getAddress(args.to),
            args.amount0.toString(),
            args.amount1.toString()
          );
          break;
        case "Sync":
          insertSync.run(
            id,
            pair,
            blockNumber,
            Number(log.logIndex),
            timestamp,
            args.reserve0.toString(),
            args.reserve1.toString()
          );
          updateReserves.run(
            args.reserve0.toString(),
            args.reserve1.toString(),
            blockNumber,
            pair,
            blockNumber
          );
          break;
        default:
          break;
      }
    }
  }

  async #indexPairCreations(fromBlock, toBlock) {
    const logs = await this.client.getLogs({
      address: this.factoryAddress,
      event: factoryAbi.find((item) => item.name === "PairCreated"),
      fromBlock: BigInt(fromBlock),
      toBlock: BigInt(toBlock),
    });

    for (const log of logs) {
      const pair = getAddress(log.args.pair);
      const token0 = getAddress(log.args.token0);
      const token1 = getAddress(log.args.token1);

      await this.#ensureTokenMetadata(token0);
      await this.#ensureTokenMetadata(token1);

      this.db
        .prepare(
          "INSERT OR IGNORE INTO pairs (address, token0, token1, created_block) VALUES (?,?,?,?)"
        )
        .run(pair, token0, token1, Number(log.blockNumber));
      this.logger.info?.(`indexed new pair ${pair}`);
    }
  }

  async #loadBlocks(logs) {
    const numbers = [...new Set(logs.map((log) => Number(log.blockNumber)))].sort((a, b) => a - b);
    const insertBlock = this.db.prepare(
      "INSERT OR REPLACE INTO blocks (number, hash, parent_hash, timestamp) VALUES (?,?,?,?)"
    );
    const timestamps = new Map();

    for (const number of numbers) {
      const block = await this.client.getBlock({ blockNumber: BigInt(number) });
      insertBlock.run(number, block.hash, block.parentHash, Number(block.timestamp));
      timestamps.set(number, Number(block.timestamp));
    }
    return timestamps;
  }

  async #ensureTokenMetadata(address) {
    const existing = this.db.prepare("SELECT address FROM tokens WHERE address = ?").get(address);
    if (existing) return;

    const [name, symbol, decimals] = await Promise.all([
      this.client.readContract({ address, abi: erc20Abi, functionName: "name" }).catch(() => "Unknown"),
      this.client.readContract({ address, abi: erc20Abi, functionName: "symbol" }).catch(() => "???"),
      this.client.readContract({ address, abi: erc20Abi, functionName: "decimals" }).catch(() => 18),
    ]);
    this.#upsertToken({ address, name, symbol, decimals: Number(decimals) });
  }

  #upsertToken(token) {
    this.db
      .prepare(
        "INSERT INTO tokens (address, symbol, name, decimals) VALUES (?,?,?,?) " +
          "ON CONFLICT(address) DO UPDATE SET symbol = excluded.symbol, name = excluded.name"
      )
      .run(getAddress(token.address), token.symbol, token.name, Number(token.decimals));
  }

  /** Executed price of the swap, as token1 per token0, decimals applied. */
  #executionPrice(pairAddress, args) {
    const pair = this.db.prepare("SELECT token0, token1 FROM pairs WHERE address = ?").get(pairAddress);
    if (!pair) return 0;

    const decimals0 = this.#decimalsOf(pair.token0);
    const decimals1 = this.#decimalsOf(pair.token1);

    const amount0 = args.amount0In > 0n ? args.amount0In : args.amount0Out;
    const amount1 = args.amount1In > 0n ? args.amount1In : args.amount1Out;
    if (amount0 === 0n || amount1 === 0n) return 0;

    return Number(formatUnits(amount1, decimals1)) / Number(formatUnits(amount0, decimals0));
  }

  #decimalsOf(address) {
    const row = this.db.prepare("SELECT decimals FROM tokens WHERE address = ?").get(address);
    return row ? Number(row.decimals) : 18;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
