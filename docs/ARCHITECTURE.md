# Architecture

## Data flow

```
        ┌──────────────┐        addLiquidity / swap        ┌──────────────────┐
        │   Browser    │ ────────────────────────────────► │ QuantSwapRouter  │
        │  (Next.js)   │                                   └────────┬─────────┘
        │   wagmi +    │                                            │ swap / mint / burn
        │    viem      │ ◄──── reserves, balances, allowance ───────┤
        └──────┬───────┘            (JSON-RPC reads)       ┌────────▼─────────┐
               │                                           │  QuantSwapPair   │
               │ candles, pools, trades                    │  (one per token  │
               │ (HTTP, never RPC)                         │      couple)     │
               │                                           └────────┬─────────┘
        ┌──────▼───────┐                                            │ events
        │   Indexer    │ ◄──────────── getLogs ──────────────────────┘
        │  viem + API  │
        │   SQLite     │
        └──────────────┘
```

Two rules keep the layers honest:

1. **The browser never aggregates history.** Anything spanning more than the current block
   comes from the indexer over HTTP. A front end that walks a day of logs on page load is a
   front end that breaks the moment the pool gets busy.
2. **Anything that moves value is read from the chain at execution time.** The interface
   shows a quote computed locally, but the transaction carries a minimum output and a
   deadline, and the pool re-derives the price from its own balances.

## Contracts

| Contract | Responsibility |
|---|---|
| `QuantSwapFactory` | Deploys one pair per unordered token couple at a deterministic CREATE2 address, holds the protocol fee switch |
| `QuantSwapPair` | Holds reserves, enforces the constant product invariant, mints and burns LP shares, accumulates prices for TWAP consumers, serves flash swaps |
| `QuantSwapERC20` | LP share token with EIP-2612 permit |
| `QuantSwapRouter` | Multi-hop routing, ETH wrapping, slippage bounds, deadlines, fee-on-transfer variants |
| `QuantSwapLibrary` | Pure pricing math and pair lookup |
| `QuantSwapOracle` | Sliding window TWAP over the pair accumulators |

### Why the pair is deliberately dumb

The pair does not know what a trade is. It observes that its balances changed, checks that
the invariant still holds with the fee applied, and updates its reserves. Everything about
user intent, routing, slippage and deadlines lives in the router, which holds no funds
between transactions. A bug in the router cannot break the pool's accounting; the worst it
can do is give its own caller a bad price, which the caller's minimum-output bound rejects.

### Price accumulators

Each `_update` advances `price0CumulativeLast` and `price1CumulativeLast` by the elapsed
time multiplied by the reserve ratio, in UQ112x112 fixed point. Both the accumulators and the
32-bit timestamp are allowed to overflow: consumers take differences in unchecked arithmetic,
which stays correct across a single wrap. This is the one place in the codebase where
overflow is intentional, and it is commented as such at the site.

## Indexer

Single process, two jobs: follow the chain, and answer HTTP.

**Following the chain.** Poll for the head, read logs in bounded ranges (public RPCs cap
`eth_getLogs` spans), decode, write. Every block containing an event is stored with its hash
and parent hash.

**Reorg handling.** Before each poll, the most recent stored blocks are compared against the
chain. The first block whose hash still matches is the fork point; everything above it is
deleted, and each affected pool's reserve snapshot is rebuilt from the most recent surviving
`Sync` event. The cursor rewinds so the range is re-indexed from the fork.

**Schema.** Six tables: `blocks`, `tokens`, `pairs`, `swaps`, `liquidity_events`,
`sync_events`, plus a single-row `cursor`. Every event row carries its block number, which is
what makes the rollback a `DELETE ... WHERE block_number >= ?` instead of a rebuild.

**API.** `/health`, `/stats`, `/pools`, `/pools/:address`, `/pools/:address/candles`,
`/pools/:address/swaps`. Candles are grouped in SQL; empty buckets are omitted rather than
forward-filled, because an hour with no trades is information and inventing a bar hides it.

## Web

Next.js App Router. The wagmi config only offers chains that have a deployment, so
"connected to the wrong network" is an explicit state with a switch button rather than a
transaction that reverts.

The swap card holds the flow: quote → approval (exact amount) → signature → pending →
confirmed, with balance, liquidity, price impact and network checks gating the button. Price
impact is computed excluding the fee, so the number shown is the cost of the trade's own
size rather than the fee the user pays regardless.

## Generated configuration

`scripts/deploy.js` writes `deployments/<network>.json`. `scripts/export-frontend.js` copies
that file and the ABIs into `web/generated`. The indexer reads the deployment file directly.
No address is written by hand in more than one place.
