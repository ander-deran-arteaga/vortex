import { createConfig, http } from "wagmi";
import { arbitrum, foundry } from "wagmi/chains";
import { injected } from "wagmi/connectors";

// Two chains: Arbitrum One (42161) and the local Arbitrum One fork served by
// anvil/foundry on 31337. Token addresses are identical on both because the
// local chain is a fork.
export const wagmiConfig = createConfig({
  chains: [arbitrum, foundry],
  connectors: [injected()],
  transports: {
    [arbitrum.id]: http(),
    [foundry.id]: http("http://127.0.0.1:8545"),
  },
  ssr: true,
});
