import { z } from "zod";

const zEnv = z.object({
  CHAIN_ID: z.coerce
    .number()
    .int()
    .default(42161)
    .pipe(z.union([z.literal(42161), z.literal(31337)])),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  RPC_URL: z.string().url().default("https://arb1.arbitrum.io/rpc"),
  FORK_RPC_URL: z.string().url().default("http://127.0.0.1:8545"),
  UNISWAP_API_BASE: z
    .string()
    .url()
    .default("https://trade-api.gateway.uniswap.org/v1"),
  // Required from Phase 3 (venue comparison); optional in the skeleton so the
  // server boots without secrets.
  UNISWAP_API_KEY: z.string().optional(),
  // Phase 5+ signers; dev-only keys on the fork.
  FEE_SIGNER_PRIVATE_KEY: z.string().optional(),
  ROUTE_SIGNER_PRIVATE_KEY: z.string().optional(),
  SOLVER_PRIVATE_KEY: z.string().optional(),
  STORE_DIR: z.string().default("./data"),
  DEMO_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.output<typeof zEnv>;
export type EnvOverrides = Partial<Record<keyof z.input<typeof zEnv>, string>>;

export function loadEnv(overrides: EnvOverrides = {}): Env {
  return zEnv.parse({ ...process.env, ...overrides });
}
