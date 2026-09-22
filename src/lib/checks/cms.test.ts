import { describe, expect, it } from "vitest";

import { __cmsSignaturesForTests } from "./cms";

function match(html: string): string[] {
  return __cmsSignaturesForTests
    .filter((signature) => signature.test(html, new Headers()))
    .map((signature) => signature.name);
}

describe("platform signatures", () => {
  it("does not report WooCommerce on plain WordPress", () => {
    // Modern WordPress core ships the string "WooCommerceBlocksEnabled" whether or not the plugin
    // is installed — verified live against wordpress.org and techcrunch.com, neither of which runs
    // it. A bare /woocommerce/i match told a buyer the target inherits a payment surface it does
    // not have, and listing every matched signature in the note turned that into a printed claim.
    const plainWordPress = `<html><head><meta name="generator" content="WordPress 6.9.8">
      <script>window.WooCommerceBlocksEnabled = false;</script>
      <link href="/wp-content/themes/x/style.css"></head><body></body></html>`;
    expect(match(plainWordPress)).toContain("WordPress");
    expect(match(plainWordPress)).not.toContain("WooCommerce");
  });

  it("still reports WooCommerce where it is genuinely installed", () => {
    // Each of these is a form seen on a real storefront; missing a live payment surface is the
    // costlier error of the two.
    for (const html of [
      `<link rel="stylesheet" href="/wp-content/plugins/woocommerce/assets/css/woocommerce.css">`,
      `<script src="/assets/woocommerce.min.js"></script>`,
      `<body class="archive post-type-archive-product woocommerce-page">`,
    ]) {
      expect(match(html), html.slice(0, 40)).toContain("WooCommerce");
    }
  });

  it("identifies the other platforms it claims to", () => {
    expect(match(`<script src="https://cdn.shopify.com/s/files/x.js">`)).toContain("Shopify");
    expect(match(`<div>powered by <a href="https://squarespace.com">Squarespace</a></div>`)).toContain(
      "Squarespace",
    );
    expect(match(`<img src="https://static.wixstatic.com/media/x.png">`)).toContain("Wix");
  });

  it("reports nothing for a site matching no signature", () => {
    expect(match("<html><body><h1>A hand-built site</h1></body></html>")).toEqual([]);
  });
});
