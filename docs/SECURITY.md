# Security notes

This is unaudited software. What follows is the threat model it was written against, what is
mitigated, and what is explicitly not.

## Mitigated in the contracts

**Reentrancy.** The pair holds a lock across `mint`, `burn`, `swap`, `skim` and `sync`. Flash
swaps call out to arbitrary code before the invariant is checked, which is exactly the window
reentrancy needs, so the lock is load bearing rather than decorative. Covered by
`ReentrancyAttacker`, which re-enters `swap` from inside the callback and is rejected.

**Under-repaid flash swaps.** Repayment is not checked by trusting a returned value; it falls
out of the invariant test on post-callback balances. A callback that repays 99.9% of what is
owed reverts.

**Stale prices at signature time.** Every value-moving router function takes a deadline. A
transaction that sits in the mempool cannot execute an hour later at a price the user never
agreed to.

**Slippage.** Exact-input swaps carry a minimum output, exact-output swaps a maximum input,
and liquidity operations carry both bounds. The interface defaults to 0.50% and requires an
explicit acknowledgement above 10% price impact.

**Non-standard ERC20s.** `TransferHelper` accepts tokens that return nothing (USDT) and
rejects tokens that return false. Fee-on-transfer tokens have dedicated router paths that
read balances after the transfer; the strict paths revert on them rather than executing at a
wrong price.

**Init code hash drift.** The library resolves pairs through the factory registry instead of
a hardcoded CREATE2 hash. Forks that copy a periphery contract and forget to update the
constant have repeatedly sent funds to addresses with no code; that failure mode is not
available here.

**Signature replay across chains.** The LP token's EIP-712 domain separator is rebuilt when
`block.chainid` differs from the cached one, so a permit signed on one chain is not valid on
a fork of it.

**Share price manipulation on an empty pool.** The first `MINIMUM_LIQUIDITY` shares are burned
to a dead address, so total supply can never return to zero.

**Oracle manipulation.** The TWAP oracle averages over a sliding window and reverts rather
than answering from a stale or too-short window. See the caveat below.

## Not mitigated, by design or by omission

**Sandwiching and general MEV.** A swap is a public intent. The user's slippage bound caps
the damage; nothing here routes transactions privately. Private relay submission is the
correct next step and is not implemented.

**TWAP manipulation on a thin pool.** A TWAP raises the cost of manipulation, it does not
remove it. On a pool with little liquidity, holding a skewed price for a window may still be
cheaper than the payoff. Anything reading this oracle for liquidations or collateral must
size the pool against the value it secures, and the window against how fast it must react.

**Impermanent loss.** Inherent to the constant product model, not a bug. Liquidity providers
are exposed to divergence between the two assets.

**Admin keys.** The factory's `feeToSetter` can redirect the protocol fee. It cannot touch
user funds, pause the pools or alter existing balances, but it is a privileged role and on a
real deployment it belongs behind a multisig with a timelock.

**Token risk.** Anyone can create a pair for any token. A malicious token can do anything a
token can do: rebase, blocklist, break on transfer. The pool contains the damage to its own
pair, and the interface only lists tokens from the deployment file.

**Front-end supply chain.** A DEX interface is as safe as the code served to the browser.
This repository pins dependencies and keeps the bundle small on purpose, but a production
deployment needs a locked build pipeline, subresource integrity, and ideally IPFS-pinned
releases.

## Reporting

This is a portfolio and reference project rather than a deployed protocol. If you find
something wrong, open an issue. Do not put real funds anywhere near it.
