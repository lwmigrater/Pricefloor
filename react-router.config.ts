import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "src/app",

  // React Router v7 rejects any mutation (POST/PUT/DELETE) whose Origin header
  // doesn't match request.url.host. Two of our surfaces legitimately trip this
  // by design:
  //   1. App proxy (/apps/pricefloor/*): buyer browser posts from the store's
  //      myshopify.com origin; Shopify forwards to our tunnel/prod URL. Real
  //      security is the HMAC signature that authenticate.public.appProxy
  //      verifies inside the action — Origin is redundant.
  //   2. Embedded admin (app._index etc.): iframe origin is admin.shopify.com;
  //      protected by App Bridge session tokens, not Origin.
  //
  // Patterns use micromatch. `**.myshopify.com` covers all subdomain depths so
  // dev stores like `pf-dev.dev.myshopify.com` also pass. Custom storefront
  // domains (e.g. brand.com) are NOT covered here — merchants with those will
  // need the header stripped at a middleware layer (follow-up).
  allowedActionOrigins: [
    "**.myshopify.com",
    "admin.shopify.com",
    "**.shopify.com",
  ],
} satisfies Config;
