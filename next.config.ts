import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Next's default (1 MB) is well under what a real Tier B document looks like — scanned
      // contracts, POS/payment-processor statements — so every evidence upload over 1 MB
      // (attachEvidence, src/lib/actions/evidence.ts) crashed with an unhandled "Body exceeded 1 MB
      // limit" error before this. 20 MB comfortably covers a multi-page scanned PDF; still bounded
      // so a single upload can't exhaust the local-dev filesystem stand-in (src/lib/storage/local.ts)
      // or, later, real object storage costs.
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
