import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { Page, Layout, Card, InlineStack, Text, TextField, Button, Banner, EmptyState, Thumbnail, Badge } from "@shopify/polaris";
import { authenticate } from "@/adapters/shopify/shopify.server";
import { companyService } from "@/feature/bite/services/company.service";
import { getCostsForVariants, upsertCosts } from "@/feature/pricefloor/adapters/supabase/cost-cache.repository";
import { getActiveRuleSet } from "@/feature/pricefloor/adapters/supabase/rule-set.repository";
import styles from "../styles/pricefloor-pages.module.css";

type Item = { variantId: string; inventoryItemId: string; title: string; sku: string | null; price: number | null; image: string | null; cost: number | null; currency: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const company = await companyService.findByShop(session.shop);
  if (!company) return { items: [] as Item[] };
  const active = await getActiveRuleSet(company.id);
  const selectedProducts = [...new Set((active?.ruleSet.rules ?? []).flatMap((r) => r.scope.productIds ?? []))];
  const selectedVariants = [...new Set((active?.ruleSet.rules ?? []).flatMap((r) => r.scope.variantIds ?? []))];
  const productVariants = await Promise.all(selectedProducts.map(async (id) => {
    const response = await admin.graphql(`#graphql
      query CostProduct($id: ID!) {
        product(id: $id) {
          variants(first: 100) { nodes { id } }
        }
      }
    `, { variables: { id } });
    const json = await response.json();
    return (json.data?.product?.variants?.nodes ?? []).map((v: { id: string }) => v.id);
  }));
  const variantIds = [...new Set([...selectedVariants, ...productVariants.flat()])];
  const cached = await getCostsForVariants(company.id, variantIds);
  const cachedById = new Map(cached.map((row) => [row.variantId, row]));
  const costRows = variantIds.map((variantId) => cachedById.get(variantId) ?? { companyId: company.id, variantId, shop: session.shop, unitCost: null, currency: "USD", inventoryQuantity: null, fetchedAt: Date.now() });
  const items = await Promise.all(costRows.map(async (row) => {
    const response = await admin.graphql(`#graphql
      query CostVariant($id: ID!) { productVariant(id: $id) { id title sku price product { title featuredImage { url altText } } inventoryItem { id unitCost { amount currencyCode } } } }
    `, { variables: { id: row.variantId } });
    const json = await response.json();
    const v = json.data?.productVariant;
    return { variantId: row.variantId, inventoryItemId: v?.inventoryItem?.id ?? "", title: `${v?.product?.title ?? "Product"} / ${v?.title ?? "Default"}`, sku: v?.sku ?? null, price: v?.price != null ? Number(v.price) : null, image: v?.product?.featuredImage?.url ?? null, cost: v?.inventoryItem?.unitCost?.amount ? Number(v.inventoryItem.unitCost.amount) : null, currency: v?.inventoryItem?.unitCost?.currencyCode ?? "USD" };
  }));
  return { items: items.filter((item) => item.inventoryItemId) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const company = await companyService.findByShop(session.shop);
  const fd = await request.formData();
  const inventoryItemId = String(fd.get("inventoryItemId") ?? "");
  const variantId = String(fd.get("variantId") ?? "");
  const rawCost = String(fd.get("cost") ?? "").trim();
  const cost = Number(rawCost);
  console.info("[pricefloor-costs] save requested", { shop: session.shop, companyId: company?.id ?? null, variantId, inventoryItemId, rawCost, cost });
  if (!company || !inventoryItemId || !variantId || rawCost === "" || !Number.isFinite(cost) || cost < 0) {
    console.warn("[pricefloor-costs] validation failed", { hasCompany: Boolean(company), inventoryItemId, variantId, cost });
    return Response.json({ ok: false, error: "Enter a valid non-negative cost." }, { status: 400 });
  }
  try {
  const response = await admin.graphql(`#graphql
    mutation UpdateCost($id: ID!, $input: InventoryItemInput!) { inventoryItemUpdate(id: $id, input: $input) { inventoryItem { id unitCost { amount currencyCode } } userErrors { message } } }
  `, { variables: { id: inventoryItemId, input: { cost } } });
  const json = await response.json() as any;
  console.info("[pricefloor-costs] Shopify response", { variantId, inventoryItemId, graphqlErrors: json.errors ?? [], payload: json.data?.inventoryItemUpdate ?? null });
  const result = json.data?.inventoryItemUpdate;
  if (json.errors?.length || !result) {
    const error = json.errors?.map((e: { message: string }) => e.message).join(", ") || "Shopify returned no update result.";
    console.error("[pricefloor-costs] Shopify GraphQL failed", { variantId, inventoryItemId, error });
    return Response.json({ ok: false, error }, { status: 400 });
  }
  if (result.userErrors?.length) {
    const error = result.userErrors.map((e: { message: string }) => e.message).join(", ");
    console.error("[pricefloor-costs] Shopify userErrors", { variantId, inventoryItemId, error, userErrors: result.userErrors });
    return Response.json({ ok: false, error }, { status: 400 });
  }
  const saved = result?.inventoryItem?.unitCost;
  console.info("[pricefloor-costs] Shopify cost updated", { variantId, inventoryItemId, saved });
  await upsertCosts([{ companyId: company.id, shop: session.shop, variantId, unitCost: Number(saved?.amount ?? cost), currency: saved?.currencyCode ?? "USD", inventoryQuantity: null }]);
  console.info("[pricefloor-costs] cache updated", { variantId, unitCost: Number(saved?.amount ?? cost) });
  return Response.json({ ok: true, savedCost: Number(saved?.amount ?? cost), currency: saved?.currencyCode ?? "USD" });
  } catch (error) {
    console.error("[pricefloor-costs] save failed", { shop: session.shop, companyId: company?.id, variantId, inventoryItemId, cost, error });
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Cost could not be saved." }, { status: 500 });
  }
};

export default function CostsPage() {
  const { items } = useLoaderData<typeof loader>();
  const missing = items.filter((item) => item.cost == null).length;
  const coverage = items.length ? Math.round(((items.length - missing) / items.length) * 100) : 0;
  return <Page backAction={{ content: "Dashboard", url: "/app" }} title="Product costs" subtitle="Keep unit costs complete so every quote can protect your margin.">
    <Layout>
      {items.length > 0 && <Layout.Section><div className={styles.metrics}>
        <Metric label="Products in rules" value={String(items.length)} />
        <Metric label="Cost coverage" value={`${coverage}%`} tone={coverage === 100 ? "success" : "warning"} />
        <Metric label="Missing costs" value={String(missing)} tone={missing ? "critical" : "success"} />
      </div></Layout.Section>}
      {missing > 0 && <Layout.Section><Banner title={`${missing} ${missing === 1 ? "product needs" : "products need"} a cost`} tone="warning"><p>Quotes for these products require manual review. Add the supplier or production cost below to enable automatic pricing.</p></Banner></Layout.Section>}
      <Layout.Section>{items.length === 0 ? <Card><EmptyState heading="No products selected in rules" image="" action={{ content: "Select products", url: "/app/pricefloor/rules" }}><p>Add product scopes to your pricing rules. Those products will then appear here.</p></EmptyState></Card> :
        <div className={styles.dataCard}><div className={styles.cardTitle}><div><Text as="h2" variant="headingMd">Cost catalog</Text><Text as="p" tone="subdued" variant="bodySm">Changes are also saved to Shopify’s Cost per item field.</Text></div><Badge tone={missing ? "warning" : "success"}>{missing ? `${missing} incomplete` : "All complete"}</Badge></div>
          <div className={styles.tableScroll}><div className={styles.costTable}><div className={`${styles.costGrid} ${styles.tableHeader}`}><span>Product</span><span>SKU</span><span>List price</span><span>Unit cost</span><span>Update cost</span></div>{items.map((item) => <div key={item.variantId} className={`${styles.costGrid} ${styles.tableRow}`}><InlineStack gap="200" blockAlign="center" wrap={false}><Thumbnail source={item.image || "placeholder"} alt={item.title} size="small" /><div className={styles.productName}><Text as="span" variant="bodyMd" fontWeight="semibold">{item.title}</Text><Text as="span" tone="subdued" variant="bodySm">Variant {item.variantId.split("/").pop()}</Text></div></InlineStack><span>{item.sku || "—"}</span><span>{formatMoney(item.price, item.currency)}</span><span>{item.cost != null ? <strong>{formatMoney(item.cost, item.currency)}</strong> : <Badge tone="critical">Missing</Badge>}</span><CostEditor item={item} /></div>)}</div></div>
        </div>}</Layout.Section>
    </Layout>
  </Page>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" | "critical" }) { return <div className={styles.metric}><Text as="span" tone="subdued" variant="bodySm">{label}</Text><div className={styles.metricValue}><span className={`${styles.metricDot} ${tone ? styles[`dot_${tone}`] : ""}`} /><Text as="strong" variant="headingLg">{value}</Text></div></div>; }
function formatMoney(value: number | null, currency: string) { return value == null ? "—" : new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value); }

function CostEditor({ item }: { item: Item }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string; savedCost?: number }>();
  const [cost, setCost] = useState("");
  const [editing, setEditing] = useState(false);
  const savedCost = fetcher.data?.savedCost;
  const saved = fetcher.data?.ok;
  return saved && !editing ? <InlineStack gap="200" blockAlign="center"><Text as="span" tone="success">Saved: {item.currency} {savedCost?.toFixed(2)}</Text><Button variant="plain" onClick={() => setEditing(true)}>Edit</Button></InlineStack> : <fetcher.Form method="post"><input type="hidden" name="variantId" value={item.variantId} /><input type="hidden" name="inventoryItemId" value={item.inventoryItemId} /><InlineStack gap="200" blockAlign="end" wrap={false}><div style={{ width: 120 }}><TextField label="Cost" labelHidden name="cost" type="number" min={0} step={0.01} value={cost} onChange={setCost} autoComplete="off" placeholder={item.cost != null ? item.cost.toFixed(2) : "Enter cost"} /></div><Button submit loading={fetcher.state !== "idle"} disabled={cost.trim() === ""}>Save</Button></InlineStack></fetcher.Form>;
}
