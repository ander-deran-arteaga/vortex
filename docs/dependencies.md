# Contract dependencies

All contract dependencies are consumed through pnpm (`packages/contracts/node_modules`),
mirroring how 1inch's own repos consume Aqua/SwapVM/OZ. No git submodules, no
floating branches — every pin below is an exact tag or version resolved to a commit.

| Package | Pin | Commit | License | Why | Modifications |
|---|---|---|---|---|---|
| `@1inch/aqua` | `github:1inch/aqua#v1.0.0` | `81c26e4619ce21556ab02b3284ee2685de21fb18` | Degensoft Aqua Source 1.1 | Official shared-liquidity layer: `ship`/`dock`/`pull`/`push`, `AquaApp` base for the compounder | none — used as-is |
| `@1inch/swap-vm` | `github:1inch/swap-vm#v1.0.1` | `b6e4f97139e89437772881208bbc8538b0567748` | Degensoft SwapVM 1.1 | `AquaSwapVMRouter` executes the Best Execution strategy; `Extruction` instruction hosts `VortexAquaPricing` | none for MVP; custom opcode fork is a stretch goal |
| `@1inch/solidity-utils` | `6.9.10` | (npm) | MIT | Transitive requirement of aqua + swap-vm (SafeERC20, TransientLock, EIP712, Simulator) | none |
| `@openzeppelin/contracts` | `5.4.0` | (npm) | MIT | ERC20 mocks, SafeERC20, ECDSA/EIP-712 helpers, Math | none |
| `@uniswap/v4-core` | `1.0.2` (npm) | (npm) | BUSL-1.1 / GPL | Real v4 PoolManager + hook interfaces for the Vortex AMM dynamic-fee pool | none |
| `@uniswap/v4-periphery` | `1.0.3` (npm) | (npm) | GPL-2.0 | Quoter / position management / hook test utilities | none |
| `forge-std` | `github:foundry-rs/forge-std#v1.11.0` | `8e40513d678f392f398620b3ef2b418648b33e89` | MIT/Apache-2.0 | Test framework | none |

Toolchain: Foundry `1.5.1` (CI-pinned), solc `0.8.30` (exact — required by aqua
and swap-vm sources), evm `cancun` (transient storage used by `AquaApp`
reentrancy locks).

## Version-skew acknowledgments

- **swap-vm ↔ aqua/solidity-utils**: swap-vm v1.0.1 declares
  `@1inch/aqua#v1.0.0` (matches our pin) but `@1inch/solidity-utils@6.9.10`,
  while aqua v1.0.0 declares `6.9.7`. We compile everything against a single
  copy, `6.9.10` (the stricter requirement); the 6.9.7→6.9.10 delta does not
  touch the APIs aqua consumes (SafeERC20, TransientLock).
- **swap-vm v1.0.1 ≠ swap-vm main**: the ISwapVM API differs between our pin
  and current main (v1.0.1 `swap(order, tokenIn, tokenOut, amount, takerData)`
  vs main's 3-arg form; opcode dispatch table vs enum). All Vortex code and
  docs target the PINNED v1.0.1 API only — never consult main when editing.
- **v4-core PoolManager is `pragma solidity 0.8.26` (exact)** and cannot be
  compiled inside our 0.8.30 build. Phase 5 imports v4-core
  interfaces/libraries only; a live PoolManager comes from an Arbitrum fork
  (`scripts/bootstrap-fork.sh` with `FORK_RPC_URL`) or `vm.etch`ed prebuilt
  bytecode in tests.
