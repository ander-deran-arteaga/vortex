import { readFileSync } from "node:fs";

import type { DeploymentFile } from "@vortex/shared";

const DEFAULT_DEPLOYMENTS_DIR = new URL(
  "../../../../deployments/",
  import.meta.url,
);

/** Reads deployments/<chainId>.json from the repo root (blockend-published). */
export function loadDeployment(
  chainId: number,
  deploymentsDir: URL = DEFAULT_DEPLOYMENTS_DIR,
  variant: "default" | "fork" = "default",
): DeploymentFile {
  const suffix = variant === "fork" ? ".fork" : "";
  const url = new URL(`${chainId}${suffix}.json`, deploymentsDir);
  const parsed = JSON.parse(readFileSync(url, "utf8")) as DeploymentFile;
  if (parsed.chainId !== chainId) {
    throw new Error(
      `deployments/${chainId}${suffix}.json declares chainId ${parsed.chainId}`,
    );
  }
  return parsed;
}
