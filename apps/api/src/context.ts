import type { DeploymentFile } from "@vortex/shared";

import { loadDeployment } from "./config/contracts";
import { loadEnv, type Env, type EnvOverrides } from "./config/env";

export interface AppContext {
  env: Env;
  deployment: DeploymentFile;
  startedAt: number;
}

export function buildContext(
  overrides: EnvOverrides = {},
  envSource?: NodeJS.ProcessEnv,
): AppContext {
  const env = loadEnv(overrides, envSource);
  return {
    env,
    deployment: loadDeployment(env.CHAIN_ID),
    startedAt: Date.now(),
  };
}
