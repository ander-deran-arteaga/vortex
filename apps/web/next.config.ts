import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@vortex/shared"],
  webpack: (config) => {
    // @coinbase/cdp-sdk (transitive via wagmi/connectors -> @base-org/account)
    // imports optional "@x402/*" peer packages that are not installed. The web
    // app only uses the injected connector, so that code path never runs —
    // stub the modules out so webpack does not fail resolving them.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/core": false,
      "@x402/evm": false,
      "@x402/svm": false,
      // @metamask/sdk (transitive via RainbowKit) imports React Native's
      // async-storage to persist a session on mobile. It is an optional peer
      // that is not installed and never reached in a browser, but webpack
      // still logs "Module not found" for it on every compile — noise in the
      // console during a judged demo. Stub it for the same reason as above.
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};

export default nextConfig;
