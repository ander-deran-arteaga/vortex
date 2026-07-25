/**
 * Exports the ABIs the api and web workspaces need out of the Foundry build
 * into `deployments/abis/`, so neither has to reach into `packages/contracts/out`
 * (which is gitignored and only exists after a local `forge build`).
 *
 *   pnpm --filter @vortex/api exec tsx ../../scripts/export-contracts.ts
 *   # or, from the repo root, any tsx: `tsx scripts/export-contracts.ts`
 *
 * Writes one `<Name>.json` per contract containing just `{ abi }`, plus an
 * `index.json` listing what was exported and the source commit. Fails loudly
 * if a required contract is missing from the build rather than silently
 * exporting a partial set.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactsDir = join(repoRoot, "packages/contracts/out");
const outDir = join(repoRoot, "deployments/abis");

/** Contracts consumed offchain. Vortex names follow MASTER R-002. */
const EXPORTS = [
  // Sponsor protocol (official, pinned)
  "Aqua",
  "AquaSwapVMRouter",
  // Vortex Swap (phase 2)
  "VortexAquaPricing",
  "VortexAquaOrderBuilder",
  "VortexAquaLens",
  "MockReferenceOracle",
  // Vortex PermAMM (phase 5)
  "VortexHook",
  "VortexRouter",
  "VortexQuoter",
  "VortexLiquidityManager",
  // Tokens
  "MockERC20",
  "MockWBTC",
  "MockUSDC",
] as const;

function readAbi(name: string): unknown[] {
  const path = join(artifactsDir, `${name}.sol`, `${name}.json`);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `missing artifact for ${name} at ${path} — run \`forge build\` in packages/contracts first`,
    );
  }
  const artifact = JSON.parse(raw) as { abi?: unknown[] };
  if (!Array.isArray(artifact.abi)) {
    throw new Error(`artifact for ${name} has no abi array`);
  }
  return artifact.abi;
}

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

mkdirSync(outDir, { recursive: true });

const exported: Record<string, number> = {};
for (const name of EXPORTS) {
  const abi = readAbi(name);
  writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify({ abi }, null, 2)}\n`);
  exported[name] = abi.length;
}

writeFileSync(
  join(outDir, "index.json"),
  `${JSON.stringify({ commit: gitCommit(), contracts: exported }, null, 2)}\n`,
);

console.log(`exported ${EXPORTS.length} ABIs to deployments/abis (commit ${gitCommit()})`);
for (const [name, entries] of Object.entries(exported)) {
  console.log(`  ${name}: ${entries} abi entries`);
}
