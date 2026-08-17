import { createRequire } from "module";
import { readFileSync, mkdirSync } from "fs";
import { resolve, basename, extname } from "path";

const ROOT = resolve(process.cwd());
const { chromium } = createRequire(resolve(ROOT, "../wishlist/shopify-review/package.json"))("playwright");
const INPUT = resolve(ROOT, "screenshot");
const OUTPUT = resolve(INPUT, "review");
mkdirSync(OUTPUT, { recursive: true });

const screens = [
  ["dashboard.png", "Pricing decisions, at a glance.", "See automation, margin health and quote activity in one clear dashboard.", ["Automation rate", "Margin protection", "Quote visibility"]],
  ["rules.png", "Rules that protect margin.", "Define the pricing guardrails your team can trust — by product, tier and quantity.", ["Margin floors", "Volume pricing", "Product exceptions"]],
  ["costs.png", "Know your real floor.", "Keep production costs current and make every automated offer commercially safe.", ["Cost per item", "Shopify sync", "Margin-aware pricing"]],
  ["quote.png", "Every quote, explained.", "Review the complete pricing decision with the rules, cost and margin behind it.", ["Clear decisions", "Applied rules", "Line-level detail"]],
  ["request bulk quoute.png", "Handle every request faster.", "Turn buyer requests into consistent, reviewable pricing decisions without spreadsheet work.", ["Bulk quoting", "Consistent offers", "Human review when needed"]],
  ["simulator.png", "Test before you publish.", "Simulate a quote, understand the result and refine your pricing rules with confidence.", ["What-if pricing", "Instant feedback", "Safer changes"]],
];

function uri(path) {
  return `data:image/png;base64,${readFileSync(path).toString("base64")}`;
}

const html = readFileSync(resolve(ROOT, "scripts/review-template.html"), "utf8");
const logo = uri(resolve(ROOT, "public/pricefloor-logo-square.png"));
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();

for (const [file, title, description, pills] of screens) {
  const shot = uri(resolve(INPUT, file));
  await page.setContent(html);
  await page.evaluate(({ shot, logo, title, description, pills }) => {
    document.querySelector(".title").textContent = title;
    document.querySelector(".desc").textContent = description;
    document.querySelector(".pills").innerHTML = pills.map((p) => `<span class="pill"><span class="dot"></span>${p}</span>`).join("");
    document.querySelector("#brand-logo").src = logo;
    document.querySelector("#shot-main").src = shot;
  }, { shot, logo, title, description, pills });
  await page.evaluate(() => document.fonts.ready);
  const output = resolve(OUTPUT, `${basename(file, extname(file))}-review.png`);
  await page.screenshot({ path: output, clip: { x: 0, y: 0, width: 1600, height: 900 } });
  console.log("wrote", output);
}

await browser.close();
