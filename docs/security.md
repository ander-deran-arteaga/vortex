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

### Phase 2 — Vortex Swap (ENFORCED — test/aqua/VortexSwap.t.sol, 17 tests +
###   VortexProgramEncoding.t.sol pin, all green through real settlement)
- quote() == swap() amounts for identical inputs (one pricing path serves
  both; the router staticcalls the same function in quote context).
- finalFee >= immutable safety floor + minCommercial for every reachable
  input; a 100% rebate cannot pierce it (test_rebateCannotRemoveSafetyFee).
- Post-trade base weight inside immutable hard bounds or revert.
- amountOut <= virtual balance AND <= min(wallet, allowance) or revert —
  phantom liquidity cannot settle (insufficient balance/allowance tests).
- Rounding always favors the maker: outputs floored, inputs ceiled, dust
  trades revert rather than round in the taker's favor.
- Trade size capped at maxTradeBps of portfolio value (fraction rounded UP).
- Recentring flow prices below worsening flow (inventory adjustment sign).
- Signed rebate: clamped, deadline-scoped, EIP-712-bound to
  taker/orderHash/tokens/amount/direction per shared typedData.ts, and
  nonce-protected — consumed on swap, verified-unused on static quote;
  extruction is ROUTER-gated so third parties cannot burn taker nonces.
- Program encoding pinned byte-for-byte to the official v1.0.1 opcode table
  (dispatch indices Deadline=13, Salt=20, Extruction=32).

### Phase 5 — Vortex PermAMM (ENFORCED — test/permamm/VortexHook.t.sol,
###   21 tests against a REAL v4 PoolManager, all green)
- Dynamic-fee pool only (`test_poolMustUseDynamicFee`); external liquidity
  forbidden, single managed position (`test_onlyLiquidityManagerCanAdd`).
- Fee override requires a valid EIP-712 authorization (domain
  `Vortex PermAMM`, typehash pinned to shared typedData.ts): pool, direction,
  amount, price limit, oracle snapshot, deadline and nonce all bound. Wrong
  pool / direction / amount / signer, expiry, and replay each revert with their
  own named error.
- **The signer cannot reach the floor.** The commercial component is clamped
  into `[minCommercial, maxCommercial]` and the immutable safety fee is added
  *after* the clamp, so a request of 0 still pays `safety + minCommercial`
  (`test_feeIsClampedIntoTheImmutableBand`).
- The fee override is per-swap: the pool's stored dynamic fee is never mutated
  (`test_poolFeeStateIsUnchangedByOverride`).
- Oracle staleness, future-dating, bid≤mid≤ask ordering, spread, and
  pool-vs-oracle deviation all enforced in `beforeSwap`; the authorization also
  commits to an oracle snapshot hash, so a signature cannot be reused across a
  price move.
- Hook callbacks reject any caller other than the PoolManager
  (`test_hookRejectsDirectCalls`) — otherwise a third party could burn a
  swapper's nonces.
- Quoting runs the identical hook path but settles nothing, so quotes equal
  execution and never consume an authorization
  (`test_quoteMatchesSwapAndDoesNotConsumeNonce`); a rejected swap surfaces its
  real reason rather than quoting zero (`test_quoteSurfacesHookRejections`).

### Phase 6 — Vortex Grow (ENFORCED — test/compound/VortexGrow.t.sol,
###   18 tests x 2 directions x 2 token orderings, all green)
- **Atomicity**: a failed cycle leaves the maker's wallet balance, Aqua virtual
  balance, and the compounder's asset AND bridge balances exactly as before —
  the Aqua pull unwinds with everything else, and no fee is paid
  (`test_failedExternalLegRevertsEverything`,
  `test_failedCycleLeavesAllBalancesUnchanged`).
- **Profit floor**: success requires
  `finalAsset >= max(minFinalAsset, principal + principal*minProfitBps)`.
  Zero profit reverts; one unit below the floor reverts
  (`test_zeroProfitReverts`, `test_oneUnitBelowMinimumReverts`).
- **Fee from profit only**: `fee == performanceFeeBps x grossProfit`, always
  strictly less than the profit it came from, so principal is never touched.
  Principal + net profit are pushed back to the maker BEFORE the fee transfer,
  so a failing fee leg cannot strand maker capital (`test_feeOnlyTakenFromProfit`).
- **External call is pre-authorized, not arbitrary**: the target is fixed by the
  immutable strategy (not chosen by the route), the calldata is committed to by
  hash, `externalValue` must be zero (no ETH may leave), and calldata length is
  bounded (`test_wrongExternalTargetReverts`, `test_wrongCalldataHashReverts`,
  `test_externalValueMustBeZero`).
- **Bridge dust must be exactly zero** — the intermediate asset may not
  accumulate in the app (`VortexBridgeDustRemains`), asserted in both directions.
- **Balances are measured as deltas** against pre-existing balances, so a stray
  donation cannot be counted as profit nor block execution.
- **Reentrancy fails**: a malicious external venue calling back into
  `executeCompound` mid-cycle — with a DIFFERENT valid route, so the nonce check
  is not what stops it — is rejected by Aqua's `nonReentrantStrategy` transient
  lock (`test_reentrantExternalCallReverts`,
  `test_swallowedReentrancyLeavesOneCleanCycle`). Mutation-verified: removing
  the modifier makes both fail.
- **Signer compromise** cannot bypass the profit floor, exceed the
  per-execution cap, retarget the external call, or replay a route — the final
  same-asset balance check is authoritative over any signature
  (`test_signerCompromiseCannotBreakInvariants`).

## Known accepted risks (MVP)

- MockReferenceOracle is owner-set (no Chainlink): acceptable on local fork;
  documented for judges; freshness + spread checks still enforced as if real.
- Quote/settlement race: a maker spending wallet funds between quote and
  swap shrinks executable balance; the trade reverts rather than
  under-delivers (availability risk, not solvency risk).
- No governance/upgradability anywhere by design — immutability is the
  security story.
- **Vortex Grow's external venue is simulated.** `MockExternalRouter` /
  `MockStalePool` are deliberately mispriced (95k vs the pool's 100k mark) and
  that gap is the entire source of compound profit. `deployments/31337.grow.json`
  records `externalVenueKind: "SIMULATED"` and both prices so the UI can label
  it honestly; a live venue is the Phase 7 objective. Presenting Grow profit as
  market-earned rather than simulated would be a §21 violation.
- **The demo scenario moves a real oracle.** `script/SetDemoScenario.s.sol`
  re-marks the maker so it genuinely prices worse (measured -2.9%), rather than
  faking a comparison. Because that oracle is shared with the PermAMM hook and
  Grow, the move is bounded well inside the hook's deviation cap and pinned by
  `test_demoScenarioOracleMoveIsWithinTolerance`.
