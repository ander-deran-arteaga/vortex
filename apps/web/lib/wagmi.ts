import { createConfig, http } from "wagmi";
import { arbitrum, foundry } from "wagmi/chains";

// Two chains: Arbitrum One (42161) and the local Arbitrum One fork served by
// anvil/foundry on 31337. Token addresses are identical on both because the
// local chain is a fork.
//
// No `connectors` array on purpose. wagmi discovers installed wallets over
// EIP-6963 by itself, and RainbowKit lists exactly what that discovery finds.
// Declaring `injected()` here announced the same wallet a second time, which
// is why Rabby appeared twice in the connect modal.
export const wagmiConfig = createConfig({
  chains: [arbitrum, foundry],
  transports: {
    [arbitrum.id]: http(),
    [foundry.id]: http("http://127.0.0.1:8545"),
  },
  ssr: true,
});
