import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Where the build lands. Defaults to Next's `.next`; NEXT_DIST_DIR lets a production build for the
  // E2E suite (`NEXT_DIST_DIR=.next-e2e npm run build`) coexist with a running `next dev`, which owns
  // `.next` and is corrupted by a build written underneath it (docs/deployment.md). CI and the
  // Dockerfile never set it, so nothing about a real deploy changes.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Bundles only the production dependencies actually reachable from the app into .next/standalone,
  // instead of shipping the full node_modules — needed to keep the production Docker image (which
  // also carries a full Chromium install for src/lib/reports/pdf.ts) a reasonable size.
  output: "standalone",
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
