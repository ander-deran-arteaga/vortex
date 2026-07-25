# Vortex security model

Scope: `packages/contracts`. Status: living document; each phase's exit adds
its enforced invariants here. Names follow MASTER R-002.

## Trust model

| Actor | Trusted with | Explicitly NOT trusted with |
|---|---|---|
| Maker | Own funds, strategy parameters at ship time | Changing a shipped strategy (Aqua strategies are immutable — dock and re-ship) |
| Offchain quote signer (Vortex Swap) | Granting bounded commercial rebates | Touching the immutable safety-fee floor, exceeding rebate bounds, exceeding max trade size, breaking hard inventory bounds |
| Offchain fee signer (Vortex PermAMM) | Choosing a commercial fee within [min,max] | Disabling the immutable safety fee, reusing authorizations (nonce), authorizing other pools/directions/amounts |
| Offchain route signer (Vortex Grow) | Selecting routes/venues/amounts within strategy caps | Escaping the external-target allowlist, skipping the final same-asset profit check, exceeding per-execution caps, replaying routes |
| Taker/solver | Paying quoted input | Anything else — settlement checks are onchain |
| External venue calldata (Uniswap API) | Nothing a priori | Bound by exact calldata hash + target allowlist + value cap + post-call balance invariants |

Design rule: every signer is a *commercial* optimizer, never a *safety*
authority. A fully compromised signer can worsen a price within pre-agreed
bounds — never move funds out, never make the maker end below the enforced
floors.

## Aqua-specific hazards (verified against pinned aqua v1.0.0 source)

1. **Virtual balances are not collateral.** `ship()` moves no tokens; `pull()`
   does `transferFrom(maker → to)` at execution time. A maker can spend or
   de-approve after shipping. Mitigation: executable balance =
   `min(virtual, actual ERC20 balance, ERC20 allowance to Aqua)` computed by
   VortexAquaLens and re-checked in pricing before quoting output
   (phantom-liquidity guard, Phase 2).
2. **Any address can be an `app`.** Aqua scopes balances by
   `(maker, app=msg.sender, strategyHash, token)`; a foreign app pulling from
   our strategy underflows (tested: `test_pullByOtherAppReverts`).
3. **Push requires an ACTIVE strategy.** Compound push-back reverts if the
   maker docked mid-flight — the whole compound reverts atomically with it
   (no stranded funds; tested at Phase 6).
4. **Reentrancy.** `AquaApp.nonReentrantStrategy(maker, strategyHash)`
   transient locks guard every state-changing app entrypoint (Phase 6
   compounder); `_safeCheckAquaPush` is only meaningful inside that lock.

## Enforced invariants (tests are the authority)

### Phase 1 — Aqua baseline (test/aqua/AquaBaseline.t.sol, 11 tests green)
- Ship books virtual balances only; ERC20 balances unchanged; Aqua holds nothing.
- Pull moves real tokens maker→recipient and debits virtual exactly.
- Push moves real tokens pusher→maker and credits virtual exactly.
- Shipped strategies are immutable; docked strategies refuse read/push/pull.
- Pull beyond virtual balance reverts even with unlimited ERC20 approval.

### Phase 2 — Vortex Swap (planned, §8.2)
- quote() == swap() amounts for identical inputs (single view pricing path).
- finalFee >= immutable safety floor for every reachable input.
- Post-trade inventory inside hard bounds or revert.
- amountOut <= executable balance or revert.
- Rounding always favors the maker (VortexTokenMath floor/ceil discipline).
- Signed rebate: bound-clamped, deadline-scoped, bound to
  taker/orderHash/amount/quoteId (see channel note on nonce strategy).

### Phase 5 — Vortex PermAMM (planned, §8.3)
- Dynamic-fee pool only; external liquidity forbidden (single managed position).
- Fee override requires valid EIP-712 auth (domain `Vortex PermAMM`):
  pool, direction, amount, swapper, price limit, oracle snapshot, deadline,
  nonce all bound. Replay reverts.
- Oracle staleness / bid≤mid≤ask ordering / pool-vs-oracle deviation enforced
  in beforeSwap.

### Phase 6 — Vortex Grow (planned, §8.4-8.5)
- Atomicity: failed cycle ⇒ maker actual + virtual balances unchanged.
- Success requires finalAsset >= max(minFinalAsset, principal + minProfit).
- Fee taken only from realized profit; principal + net profit pushed back
  before fee transfer.
- External call: allowlisted immutable target, exact calldata-hash match,
  value cap, calldata length cap, no ETH/token residue above dust bound.
- Signer compromise cannot: bypass profit floor, exceed caps, retarget
  recipient, call arbitrary contracts, replay routes.

## Known accepted risks (MVP)

- MockReferenceOracle is owner-set (no Chainlink): acceptable on local fork;
  documented for judges; freshness + spread checks still enforced as if real.
- Quote/settlement race: a maker spending wallet funds between quote and
  swap shrinks executable balance; the trade reverts rather than
  under-delivers (availability risk, not solvency risk).
- No governance/upgradability anywhere by design — immutability is the
  security story.
