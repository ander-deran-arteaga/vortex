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
    };
    return config;
  },
};

export default nextConfig;
