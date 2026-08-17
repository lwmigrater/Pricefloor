/**
 * Verifies Shopify webhook HMAC signature using Web Crypto API.
 * Compatible with Edge runtimes (Cloudflare Workers, Vercel Edge).
 */
export async function verifyShopifyWebhook(request: Request, secret: string) {
  const hmac = request.headers.get("X-Shopify-Hmac-Sha256");
  const topic = request.headers.get("X-Shopify-Topic");
  const shop = request.headers.get("X-Shopify-Shop-Domain");

  if (!hmac || !topic || !shop) {
    return { valid: false, topic: null, shop: null };
  }

  const body = await request.clone().text();

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const data = encoder.encode(body);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  // Shopify sends base64 encoded signature
  const signature = Uint8Array.from(atob(hmac), c => c.charCodeAt(0));

  const valid = await crypto.subtle.verify(
    "HMAC",
    cryptoKey,
    signature,
    data
  );

  return { valid, topic, shop, payload: JSON.parse(body) };
}
