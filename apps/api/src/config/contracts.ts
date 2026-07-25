import { readFileSync } from "node:fs";

import type { DeploymentFile } from "@vortex/shared";

/** Reads deployments/<chainId>.json from the repo root (blockend-published). */
export function loadDeployment(chainId: number): DeploymentFile {
  const url = new URL(
    `../../../../deployments/${chainId}.json`,
    import.meta.url,
  );
  const parsed = JSON.parse(readFileSync(url, "utf8")) as DeploymentFile;
  if (parsed.chainId !== chainId) {
    throw new Error(
      `deployments/${chainId}.json declares chainId ${parsed.chainId}`,
    );
  }
  return parsed;
}
