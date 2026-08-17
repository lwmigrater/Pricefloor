/**
 * Rule setup — five sections, each holding N scoped entries.
 *
 *   /app/pricefloor/rules
 *
 * The DB stores a rule set as a bag of typed rules (see rule-set.repository
 * + engine/types.ts). We surface that bag as five task-oriented sections
 * (margin floor, volume ladder, tier caps, exceptions, prepaid). Each section
 * can hold multiple entries — every entry becomes one DB rule row with an
 * optional scope (company tiers and/or product IDs). Engine composition is
 * unchanged: floor picks the max of matching floors, ladders pick the deepest
 * qualifying tier, etc. Priorities are hidden (0 → 4 by section order).
 *
 *   1. Minimum margin              → 1+ margin_floor rules (≥1 required)
 *   2. Volume discounts            → 0..N volume_ladder rules
 *   3. Tier discount caps          → 0..N tier_cap rules
 *   4. Products to always escalate → 0..N product_exception rules
 *   5. Prepaid counter-offer       → 0..N terms_swap rules
 *
 * Save writes a new version via replaceActiveRuleSet so decision history
 * stays explainable (plan §7).
 */

import { useCallback, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Select,
  TextField,
  Button,
  Banner,
  Divider,
  Box,
  Tag,
  Icon,
  Badge,
  InlineGrid,
} from "@shopify/polaris";
import {
  LockIcon,
  DiscountIcon,
  PersonSegmentIcon,
  AlertTriangleIcon,
  CashDollarIcon,
  ChevronRightIcon,
} from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";
import styles from "../styles/pricefloor-pages.module.css";

import { authenticate } from "@/adapters/shopify/shopify.server";
import { companyService } from "@/feature/bite/services/company.service";
import {
  getActiveRuleSet,
  replaceActiveRuleSet,
  type DraftRule,
} from "@/feature/pricefloor/adapters/supabase/rule-set.repository";

// ─────────────────────────── shared types ───────────────────────────

type ExceptionReason = "map" | "new_season" | "brand_protected";

interface Scope {
  companyTiers: string[];
  productIds: string[];
  /** Titles are UI-only (not persisted to DB) — for the picker's chip list. */
  productTitles: Record<string, string>;
}

function emptyScope(): Scope {
  return { companyTiers: [], productIds: [], productTitles: {} };
}

interface MarginFloorEntry {
  key: string;
  kind: "max_discount" | "absolute";
  maxDiscountPct?: number;
  minMarginAmount?: number;
  scope: Scope;
}

interface VolumeTier {
  key: string;
  minQty: number;
  discountPct: number;
}

interface VolumeLadderEntry {
  key: string;
  tiers: VolumeTier[];
  scope: Scope;
}

interface TierCapEntry {
  key: string;
  tier: string;
  maxDiscountPct: number;
  scope: Scope;
}

interface ExceptionEntry {
  key: string;
  reason: ExceptionReason;
  scope: Scope; // productIds required for exception to apply
}

interface PrepaidEntry {
  key: string;
  prepaidPct: number;
  scope: Scope;
}

interface RulesSettings {
  /** Must have ≥1 entry — engine relies on a floor. */
  marginFloor: MarginFloorEntry[];
  volume: VolumeLadderEntry[];
  tierCaps: TierCapEntry[];
  exceptions: ExceptionEntry[];
  prepaid: PrepaidEntry[];
}

// ─────────────────────────── defaults ───────────────────────────

function kid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultSettings(): RulesSettings {
  return {
    marginFloor: [
      {
        key: kid("mf"),
        kind: "max_discount",
        maxDiscountPct: 20,
        scope: emptyScope(),
      },
    ],
    volume: [
      {
        key: kid("vl"),
        tiers: [
          { key: kid("t"), minQty: 100, discountPct: 5 },
          { key: kid("t"), minQty: 500, discountPct: 10 },
          { key: kid("t"), minQty: 1000, discountPct: 15 },
        ],
        scope: emptyScope(),
      },
    ],
    tierCaps: [],
    exceptions: [],
    prepaid: [],
  };
}

// ─────────────────────────── fold DB → settings ───────────────────────────

interface DbLikeRule {
  type: string;
  params: Record<string, unknown>;
  scope: { productIds?: string[]; companyTiers?: string[] };
}

function foldScope(raw: DbLikeRule["scope"]): Scope {
  return {
    companyTiers: Array.isArray(raw.companyTiers) ? [...raw.companyTiers] : [],
    productIds: Array.isArray(raw.productIds) ? [...raw.productIds] : [],
    productTitles: Object.fromEntries(
      (raw.productIds ?? []).map((id) => [id, shortId(id)]),
    ),
  };
}

function foldToSettings(dbRules: DbLikeRule[]): RulesSettings {
  const floors = dbRules
    .filter((r) => r.type === "margin_floor")
    .map<MarginFloorEntry>((r) => {
      const kind = (r.params.kind as string) === "absolute" ? "absolute" : "max_discount";
      return {
        key: kid("mf"),
        kind,
        maxDiscountPct:
          kind === "max_discount" ? Number(r.params.maxDiscountPct ?? r.params.minMarginPct ?? 20) : undefined,
        minMarginAmount:
          kind === "absolute" ? Number(r.params.minMarginAmount ?? 5) : undefined,
        scope: foldScope(r.scope),
      };
    });

  const ladders = dbRules
    .filter((r) => r.type === "volume_ladder")
    .map<VolumeLadderEntry>((r) => {
      const raw = Array.isArray(r.params.tiers)
        ? (r.params.tiers as Array<{ minQty: number; discountPct: number }>)
        : [];
      return {
        key: kid("vl"),
        tiers: raw.map((t) => ({
          key: kid("t"),
          minQty: Number(t.minQty ?? 0),
          discountPct: Number(t.discountPct ?? 0),
        })),
        scope: foldScope(r.scope),
      };
    });

  const caps = dbRules
    .filter((r) => r.type === "tier_cap")
    .map<TierCapEntry>((r) => ({
      key: kid("tc"),
      tier: String(r.params.tier ?? ""),
      maxDiscountPct: Number(r.params.maxDiscountPct ?? 0),
      scope: foldScope(r.scope),
    }));

  const exceptions = dbRules
    .filter((r) => r.type === "product_exception")
    .map<ExceptionEntry>((r) => ({
      key: kid("ex"),
      reason: ((r.params.reason as ExceptionReason) ?? "map"),
      scope: foldScope(r.scope),
    }));

  const prepaid = dbRules
    .filter((r) => r.type === "terms_swap")
    .map<PrepaidEntry>((r) => ({
      key: kid("pp"),
      prepaidPct: Number(r.params.prepaid ?? 0),
      scope: foldScope(r.scope),
    }));

  // Guarantee at least one margin_floor — legacy sets without one would
  // otherwise leave the engine with no floor. Slot in the default.
  const finalFloors = floors.length > 0 ? floors : defaultSettings().marginFloor;

  return {
    marginFloor: finalFloors,
    volume: ladders,
    tierCaps: caps,
    exceptions: exceptions,
    prepaid: prepaid,
  };
}

function shortId(gid: string): string {
  return gid.replace(/^gid:\/\/shopify\/[^/]+\//, "#");
}

// ─────────────────────────── unfold settings → drafts ───────────────────────────

function scopeToDb(s: Scope): DraftRule["scope"] {
  const out: Record<string, unknown> = {};
  if (s.companyTiers.length) out.companyTiers = [...s.companyTiers];
  if (s.productIds.length) out.productIds = [...s.productIds];
  return out as DraftRule["scope"];
}

function settingsToDrafts(s: RulesSettings): DraftRule[] {
  const drafts: DraftRule[] = [];

  s.marginFloor.forEach((e) => {
    drafts.push({
      type: "margin_floor",
      priority: 0,
      scope: scopeToDb(e.scope),
      enabled: true,
      params:
        e.kind === "max_discount"
          ? { kind: "max_discount", maxDiscountPct: e.maxDiscountPct ?? 20 }
          : { kind: "absolute", minMarginAmount: e.minMarginAmount ?? 0 },
    });
  });

  s.volume.forEach((e) => {
    if (e.tiers.length === 0) return;
    drafts.push({
      type: "volume_ladder",
      priority: 1,
      scope: scopeToDb(e.scope),
      enabled: true,
      params: {
        tiers: e.tiers
          .map(({ minQty, discountPct }) => ({ minQty, discountPct }))
          .sort((a, b) => a.minQty - b.minQty),
      },
    });
  });

  s.tierCaps.forEach((e) => {
    if (!e.tier.trim()) return;
    drafts.push({
      type: "tier_cap",
      priority: 2,
      scope: scopeToDb(e.scope),
      enabled: true,
      params: { tier: e.tier.trim(), maxDiscountPct: e.maxDiscountPct },
    });
  });

  s.exceptions.forEach((e) => {
    if (e.scope.productIds.length === 0) return;
    drafts.push({
      type: "product_exception",
      priority: 3,
      scope: scopeToDb(e.scope),
      enabled: true,
      params: { reason: e.reason },
    });
  });

  s.prepaid.forEach((e) => {
    if (e.prepaidPct <= 0) return;
    drafts.push({
      type: "terms_swap",
      priority: 4,
      scope: scopeToDb(e.scope),
      enabled: true,
      params: { prepaid: e.prepaidPct },
    });
  });

  return drafts;
}

// ─────────────────────────── loader / action ───────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const company = await companyService.findByShop(session.shop);
  if (!company) return { version: null, settings: defaultSettings() };
  const active = await getActiveRuleSet(company.id);
  if (!active) return { version: null, settings: defaultSettings() };
  const asDbShape: DbLikeRule[] = active.ruleSet.rules.map((r) => ({
    type: r.type as string,
    params: r.params as unknown as Record<string, unknown>,
    scope: r.scope as { productIds?: string[]; companyTiers?: string[] },
  }));
  const settings = foldToSettings(asDbShape);
  const productIds = [...new Set([
    ...settings.marginFloor,
    ...settings.volume,
    ...settings.tierCaps,
    ...settings.exceptions,
    ...settings.prepaid,
  ].flatMap((entry) => entry.scope.productIds))];
  if (productIds.length) {
    const response = await admin.graphql(`#graphql
      query RuleProductTitles($ids: [ID!]!) {
        nodes(ids: $ids) { ... on Product { id title } }
      }
    `, { variables: { ids: productIds } });
    const json = await response.json() as { data?: { nodes?: Array<{ id?: string; title?: string } | null> } };
    const titles = Object.fromEntries((json.data?.nodes ?? []).filter((node): node is { id: string; title?: string } => Boolean(node?.id)).map((node) => [node.id, node.title ?? shortId(node.id)]));
    for (const entry of [...settings.marginFloor, ...settings.volume, ...settings.tierCaps, ...settings.exceptions, ...settings.prepaid]) {
      entry.scope.productTitles = Object.fromEntries(entry.scope.productIds.map((id) => [id, titles[id] ?? shortId(id)]));
    }
  }
  return {
    version: active.ruleSet.version,
    settings,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const company = await companyService.findByShop(session.shop);
  if (!company) return Response.json({ ok: false }, { status: 404 });
  const fd = await request.formData();
  const raw = fd.get("settings");
  if (typeof raw !== "string") {
    return Response.json({ ok: false, error: "missing_settings" }, { status: 400 });
  }
  let parsed: RulesSettings;
  try {
    parsed = JSON.parse(raw) as RulesSettings;
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (parsed.marginFloor.length === 0) {
    return Response.json(
      { ok: false, error: "at least one margin floor required" },
      { status: 400 },
    );
  }
  const drafts = settingsToDrafts(parsed);
  const result = await replaceActiveRuleSet(
    company.id,
    session.shop,
    drafts,
    `merchant:${session.shop}`,
    "Merchant-edited rule set",
  );
  return Response.json({ ok: true, version: result.version });
};

// ─────────────────────────── page ───────────────────────────

type SectionKey = "margin" | "volume" | "tierCaps" | "exceptions" | "prepaid";

interface SectionMeta {
  title: string;
  question: string;
  subtitle: string;
  icon: typeof LockIcon;
  count: (s: RulesSettings) => number;
}

const SECTION_META: Record<SectionKey, SectionMeta> = {
  margin: {
    title: "Maximum discount",
    question: "How far below list price should a request be flagged?",
    subtitle:
      "Every request goes to manual review. This limit helps you see whether the buyer is inside your normal approval range.",
    icon: LockIcon,
    count: (s) => s.marginFloor.length,
  },
  volume: {
    title: "Volume discounts",
    question: "How much off for bigger orders?",
    subtitle:
      "Ladders reward larger orders. The engine picks the deepest qualifying tier, always clamped by the margin floor.",
    icon: DiscountIcon,
    count: (s) => s.volume.length,
  },
  tierCaps: {
    title: "Tier discount caps",
    question: "What's the most a VIP tier can ever save?",
    subtitle:
      "Cap the total discount a customer tier can receive — even if the ladder would give more, the cap wins.",
    icon: PersonSegmentIcon,
    count: (s) => s.tierCaps.length,
  },
  exceptions: {
    title: "Products to always escalate",
    question: "Which products should always go to human review?",
    subtitle:
      "Selected products never auto-price. Every quote request opens an escalation (MAP, hero SKUs, brand-protected).",
    icon: AlertTriangleIcon,
    count: (s) => s.exceptions.length,
  },
  prepaid: {
    title: "Prepaid counter-offer",
    question: "Give extra discount when the buyer prepays?",
    subtitle:
      "On below-floor requests, surface a prepaid alternative — an extra discount if the buyer pays upfront instead of net-30.",
    icon: CashDollarIcon,
    count: (s) => s.prepaid.length,
  },
};

const SECTION_ORDER: SectionKey[] = [
  "margin",
  "volume",
  "tierCaps",
  "exceptions",
  "prepaid",
];

export default function RulesPage() {
  const { version, settings: initialSettings } = useLoaderData<typeof loader>();
  const [settings, setSettings] = useState<RulesSettings>(initialSettings);
  const [section, setSection] = useState<SectionKey | null>(null);
  const fetcher = useFetcher<{ ok: boolean; version?: number; error?: string }>();
  const saving = fetcher.state !== "idle";

  const initialSnapshot = useMemo(() => JSON.stringify(initialSettings), [initialSettings]);
  const dirty = useMemo(
    () => JSON.stringify(settings) !== initialSnapshot,
    [settings, initialSnapshot],
  );

  const save = useCallback(() => {
    const fd = new FormData();
    fd.append("settings", JSON.stringify(settings));
    fetcher.submit(fd, { method: "post" });
  }, [settings, fetcher]);

  const patch = <K extends keyof RulesSettings>(k: K, v: RulesSettings[K]) =>
    setSettings((s) => ({ ...s, [k]: v }));

  const versionSubtitle =
    version != null
      ? `Editing v${version}. Saving creates v${version + 1}.`
      : "Set your rules — Save creates v1.";

  const onIndex = section === null;
  const meta = section ? SECTION_META[section] : null;

  const pageBackAction = onIndex
    ? { content: "Dashboard", url: "/app" }
    : { content: "Rules", onAction: () => setSection(null) };
  const pageTitle = onIndex ? "Rules" : meta!.title;
  const pageSubtitle = onIndex ? versionSubtitle : meta!.subtitle;

  return (
    <Page
      backAction={pageBackAction}
      title={pageTitle}
      subtitle={pageSubtitle}
      primaryAction={{
        content: dirty ? "Save changes" : "Saved",
        onAction: save,
        loading: saving,
        disabled: !dirty || saving,
      }}
    >
      <Layout>
        {fetcher.data?.error && (
          <Layout.Section>
            <Banner tone="critical" title="Save failed">
              <p>{fetcher.data.error}</p>
            </Banner>
          </Layout.Section>
        )}
        {fetcher.data?.ok && !dirty && (
          <Layout.Section>
            <Banner tone="success" title={`Saved as v${fetcher.data.version}`} />
          </Layout.Section>
        )}

        <Layout.Section>
          {onIndex ? (
            <RulesIndex settings={settings} onOpen={setSection} />
          ) : (
            <>
              {section === "margin" && (
                <MarginFloorSection
                  hideHeader
                  entries={settings.marginFloor}
                  onChange={(next) => patch("marginFloor", next)}
                />
              )}
              {section === "volume" && (
                <VolumeSection
                  hideHeader
                  entries={settings.volume}
                  onChange={(next) => patch("volume", next)}
                />
              )}
              {section === "tierCaps" && (
                <TierCapsSection
                  hideHeader
                  entries={settings.tierCaps}
                  onChange={(next) => patch("tierCaps", next)}
                />
              )}
              {section === "exceptions" && (
                <ExceptionsSection
                  hideHeader
                  entries={settings.exceptions}
                  onChange={(next) => patch("exceptions", next)}
                />
              )}
              {section === "prepaid" && (
                <PrepaidSection
                  hideHeader
                  entries={settings.prepaid}
                  onChange={(next) => patch("prepaid", next)}
                />
              )}
            </>
          )}
        </Layout.Section>

      </Layout>
    </Page>
  );
}

// ─────────────────────────── index (card picker) ───────────────────────────

function RulesIndex({
  settings,
  onOpen,
}: {
  settings: RulesSettings;
  onOpen: (k: SectionKey) => void;
}) {
  return (
    <div className={styles.sectionGrid}>
      {SECTION_ORDER.map((key) => {
        const m = SECTION_META[key];
        const count = m.count(settings);
        return (
          <SectionCard
            key={key}
            icon={m.icon}
            title={m.title}
            question={m.question}
            count={count}
            onOpen={() => onOpen(key)}
          />
        );
      })}
    </div>
  );
}

function SectionCard({
  icon,
  title,
  question,
  count,
  onOpen,
}: {
  icon: typeof LockIcon;
  title: string;
  question: string;
  count: number;
  onOpen: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={styles.navCard}
    >
        <BlockStack gap="300">
          <div className={styles.navCardHeader}>
            <div className={styles.navCardIcon}>
              <Icon source={icon} tone="base" />
            </div>
            <Text as="h3" variant="headingMd">
              {title}
            </Text>
          </div>
          <Text as="p" tone="subdued" variant="bodyMd">
            {question}
          </Text>
          <div className={styles.navCardFooter}>
            {count > 0 ? (
              <Badge tone="success">
                {`${count} rule${count === 1 ? "" : "s"} set`}
              </Badge>
            ) : (
              <Badge tone="attention">Not configured</Badge>
            )}
            <Box>
              <Icon source={ChevronRightIcon} tone="subdued" />
            </Box>
          </div>
        </BlockStack>
    </div>
  );
}

// ─────────────────────────── section chrome ───────────────────────────

function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <InlineStack align="space-between" blockAlign="start" wrap={false}>
      <BlockStack gap="050">
        <Text as="h2" variant="headingMd">
          {title}
        </Text>
        <Text as="p" tone="subdued" variant="bodySm">
          {description}
        </Text>
      </BlockStack>
      {action && <Button onClick={action.onClick}>{action.label}</Button>}
    </InlineStack>
  );
}

function EntryFrame({
  title,
  onRemove,
  removeDisabled,
  children,
}: {
  title: string;
  onRemove: () => void;
  removeDisabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.entryFrame}>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <Text as="h3" variant="headingSm">
            {title}
          </Text>
          <Button
            variant="plain"
            tone="critical"
            onClick={onRemove}
            disabled={removeDisabled}
          >
            Remove
          </Button>
        </InlineStack>
        {children}
      </BlockStack>
    </div>
  );
}

// ─────────────────────────── scope editor (shared) ───────────────────────────

function ScopeEditor({
  scope,
  onChange,
}: {
  scope: Scope;
  onChange: (next: Scope) => void;
}) {
  const shopify = useAppBridge();
  const [tiersText, setTiersText] = useState(scope.companyTiers.join(", "));

  // Sync inbound scope updates (e.g. reset) back into the text field.
  useMemo(() => setTiersText(scope.companyTiers.join(", ")), [scope.companyTiers]);

  const commitTiers = (raw: string) => {
    setTiersText(raw);
    onChange({
      ...scope,
      companyTiers: raw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
  };

  const openPicker = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: scope.productIds.map((id) => ({ id })),
    });
    if (!selected) return;
    onChange({
      ...scope,
      productIds: selected.map((p) => p.id),
      productTitles: Object.fromEntries(
        selected.map((p) => [p.id, (p.title as string) ?? shortId(p.id)]),
      ),
    });
  };

  const removeProduct = (id: string) => {
    const { [id]: _drop, ...restTitles } = scope.productTitles;
    onChange({
      ...scope,
      productIds: scope.productIds.filter((x) => x !== id),
      productTitles: restTitles,
    });
  };

  const universal =
    scope.companyTiers.length === 0 && scope.productIds.length === 0;

  return (
    <div className={styles.scopeEditor}>
      <div className={styles.scopeSummary}>
        <Text as="p" variant="headingSm">Applies to</Text>
        <Text as="p" tone="subdued" variant="bodySm">
        {universal
          ? "All buyers, all products"
          : [
              scope.companyTiers.length
                ? `Tiers: ${scope.companyTiers.join(", ")}`
                : null,
              scope.productIds.length
                ? `${scope.productIds.length} product${scope.productIds.length === 1 ? "" : "s"}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
        </Text>
      </div>
      <InlineStack gap="200" wrap>
        <div style={{ minWidth: 240, flex: 1 }}>
          <TextField
            label="Customer tiers"
            autoComplete="off"
            placeholder="Gold, silver — leave empty for every buyer"
            value={tiersText}
            onChange={commitTiers}
          />
        </div>
        <div style={{ alignSelf: "end" }}>
          <Button onClick={openPicker}>
            {scope.productIds.length ? "Change products" : "Pick products"}
          </Button>
        </div>
      </InlineStack>
      {scope.productIds.length > 0 && (
        <InlineStack gap="100" wrap>
          {scope.productIds.map((id) => (
            <Tag key={id} onRemove={() => removeProduct(id)}>
              {scope.productTitles[id] ?? shortId(id)}
            </Tag>
          ))}
        </InlineStack>
      )}
    </div>
  );
}

// ─────────────────────────── section: margin floors ───────────────────────────

function MarginFloorSection({
  entries,
  onChange,
  hideHeader = false,
}: {
  entries: MarginFloorEntry[];
  onChange: (next: MarginFloorEntry[]) => void;
  hideHeader?: boolean;
}) {
  const addEntry = () => {
    onChange([
      ...entries,
      {
        key: kid("mf"),
        kind: "max_discount",
        maxDiscountPct: 20,
        scope: emptyScope(),
      },
    ]);
  };
  const update = (key: string, patch: Partial<MarginFloorEntry>) => {
    onChange(entries.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  };
  const remove = (key: string) => onChange(entries.filter((e) => e.key !== key));

  return (
    <div className={styles.ruleEditor}>
      <BlockStack gap="400">
        {hideHeader ? (
          <InlineStack align="end">
            <Button onClick={addEntry}>Add override</Button>
          </InlineStack>
        ) : (
          <SectionHeader
            title="Maximum discount"
            description="Every quote is reviewed by you. This limit marks the normal approval range from list price; Pricefloor never sends an offer automatically."
            action={{ label: "Add floor", onClick: addEntry }}
          />
        )}
        <BlockStack gap="300">
          {entries.map((e, idx) => (
            <EntryFrame
              key={e.key}
              title={idx === 0 ? "Default floor" : `Override ${idx}`}
              onRemove={() => remove(e.key)}
              removeDisabled={entries.length === 1}
            >
              <InlineStack gap="300" wrap>
                <div style={{ minWidth: 200 }}>
                  <Select
                    label="Kind"
                    options={[
                      { label: "Maximum discount from list", value: "max_discount" },
                      { label: "Minimum profit per unit", value: "absolute" },
                    ]}
                    value={e.kind}
                    onChange={(v) =>
                      update(e.key, {
                        kind: v as "max_discount" | "absolute",
                        maxDiscountPct: v === "max_discount" ? 20 : undefined,
                        minMarginAmount: v === "absolute" ? 5 : undefined,
                      })
                    }
                  />
                </div>
                <div style={{ minWidth: 200 }}>
                  {e.kind === "max_discount" ? (
                    <TextField
                      label="Maximum standard discount"
                      type="number"
                      suffix="%"
                      autoComplete="off"
                      value={String(e.maxDiscountPct ?? 20)}
                      onChange={(v) =>
                        update(e.key, { maxDiscountPct: Number(v) || 0 })
                      }
                    />
                  ) : (
                    <TextField
                      label="Minimum profit per unit"
                      type="number"
                      prefix="$"
                      autoComplete="off"
                      value={String(e.minMarginAmount ?? 0)}
                      onChange={(v) =>
                        update(e.key, { minMarginAmount: Number(v) || 0 })
                      }
                    />
                  )}
                </div>
              </InlineStack>
              <Divider />
              <ScopeEditor
                scope={e.scope}
                onChange={(next) => update(e.key, { scope: next })}
              />
            </EntryFrame>
          ))}
        </BlockStack>
      </BlockStack>
    </div>
  );
}

// ─────────────────────────── section: volume ladders ───────────────────────────

function VolumeSection({
  entries,
  onChange,
  hideHeader = false,
}: {
  entries: VolumeLadderEntry[];
  onChange: (next: VolumeLadderEntry[]) => void;
  hideHeader?: boolean;
}) {
  const addLadder = () => {
    onChange([
      ...entries,
      {
        key: kid("vl"),
        tiers: [
          { key: kid("t"), minQty: 100, discountPct: 5 },
          { key: kid("t"), minQty: 500, discountPct: 10 },
        ],
        scope: emptyScope(),
      },
    ]);
  };
  const update = (key: string, patch: Partial<VolumeLadderEntry>) => {
    onChange(entries.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  };
  const remove = (key: string) => onChange(entries.filter((e) => e.key !== key));

  return (
    <Card>
      <BlockStack gap="400">
        {hideHeader ? (
          <InlineStack align="end">
            <Button onClick={addLadder}>Add ladder</Button>
          </InlineStack>
        ) : (
          <SectionHeader
            title="Volume discounts"
            description="Bigger orders unlock deeper discounts. The engine picks the deepest tier that qualifies — always clamped by the margin floor."
            action={{ label: "Add ladder", onClick: addLadder }}
          />
        )}
        {entries.length === 0 ? (
          <EmptyHint text="No volume discounts yet. Click Add ladder to create one." />
        ) : (
          <BlockStack gap="300">
            {entries.map((e, idx) => (
              <EntryFrame
                key={e.key}
                title={`Ladder ${idx + 1}`}
                onRemove={() => remove(e.key)}
              >
                <TiersEditor
                  tiers={e.tiers}
                  onChange={(next) => update(e.key, { tiers: next })}
                />
                <Divider />
                <ScopeEditor
                  scope={e.scope}
                  onChange={(next) => update(e.key, { scope: next })}
                />
              </EntryFrame>
            ))}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

function TiersEditor({
  tiers,
  onChange,
}: {
  tiers: VolumeTier[];
  onChange: (next: VolumeTier[]) => void;
}) {
  const addTier = () => {
    const last = tiers[tiers.length - 1];
    onChange([
      ...tiers,
      {
        key: kid("t"),
        minQty: last ? last.minQty * 2 : 100,
        discountPct: last ? Math.min(last.discountPct + 5, 30) : 5,
      },
    ]);
  };
  const update = (key: string, patch: Partial<VolumeTier>) => {
    onChange(tiers.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  };
  const remove = (key: string) => onChange(tiers.filter((t) => t.key !== key));

  return (
    <BlockStack gap="200">
      {tiers.map((t, idx) => (
        <InlineStack key={t.key} gap="200" blockAlign="end" wrap={false}>
          <div style={{ minWidth: 120, flex: 1 }}>
            <TextField
              label={idx === 0 ? "Min quantity" : undefined}
              labelHidden={idx !== 0}
              type="number"
              autoComplete="off"
              value={String(t.minQty)}
              onChange={(v) => update(t.key, { minQty: Number(v) || 0 })}
            />
          </div>
          <div style={{ minWidth: 120, flex: 1 }}>
            <TextField
              label={idx === 0 ? "Discount" : undefined}
              labelHidden={idx !== 0}
              type="number"
              suffix="%"
              autoComplete="off"
              value={String(t.discountPct)}
              onChange={(v) => update(t.key, { discountPct: Number(v) || 0 })}
            />
          </div>
          <Button variant="plain" tone="critical" onClick={() => remove(t.key)}>
            Remove
          </Button>
        </InlineStack>
      ))}
      <InlineStack>
        <Button onClick={addTier}>Add tier</Button>
      </InlineStack>
    </BlockStack>
  );
}

// ─────────────────────────── section: tier caps ───────────────────────────

function TierCapsSection({
  entries,
  onChange,
  hideHeader = false,
}: {
  entries: TierCapEntry[];
  onChange: (next: TierCapEntry[]) => void;
  hideHeader?: boolean;
}) {
  const addEntry = () => {
    onChange([
      ...entries,
      { key: kid("tc"), tier: "", maxDiscountPct: 10, scope: emptyScope() },
    ]);
  };
  const update = (key: string, patch: Partial<TierCapEntry>) => {
    onChange(entries.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  };
  const remove = (key: string) => onChange(entries.filter((e) => e.key !== key));

  return (
    <Card>
      <BlockStack gap="400">
        {hideHeader ? (
          <InlineStack align="end">
            <Button onClick={addEntry}>Add tier cap</Button>
          </InlineStack>
        ) : (
          <SectionHeader
            title="Tier discount caps"
            description="Cap the total discount a company tier can ever receive. Even if the ladder would give more, the cap wins."
            action={{ label: "Add tier cap", onClick: addEntry }}
          />
        )}
        {entries.length === 0 ? (
          <EmptyHint text="No tier caps yet. Click Add tier cap to limit specific customer tiers." />
        ) : (
          <BlockStack gap="300">
            {entries.map((e, idx) => (
              <EntryFrame
                key={e.key}
                title={`Cap ${idx + 1}`}
                onRemove={() => remove(e.key)}
              >
                <InlineStack gap="300" wrap>
                  <div style={{ minWidth: 200, flex: 1 }}>
                    <TextField
                      label="Tier name"
                      autoComplete="off"
                      placeholder="e.g. gold"
                      value={e.tier}
                      onChange={(v) => update(e.key, { tier: v })}
                    />
                  </div>
                  <div style={{ minWidth: 200, flex: 1 }}>
                    <TextField
                      label="Max discount"
                      type="number"
                      suffix="%"
                      autoComplete="off"
                      value={String(e.maxDiscountPct)}
                      onChange={(v) =>
                        update(e.key, { maxDiscountPct: Number(v) || 0 })
                      }
                    />
                  </div>
                </InlineStack>
                <Divider />
                <ScopeEditor
                  scope={e.scope}
                  onChange={(next) => update(e.key, { scope: next })}
                />
              </EntryFrame>
            ))}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

// ─────────────────────────── section: exceptions ───────────────────────────

function ExceptionsSection({
  entries,
  onChange,
  hideHeader = false,
}: {
  entries: ExceptionEntry[];
  onChange: (next: ExceptionEntry[]) => void;
  hideHeader?: boolean;
}) {
  const addEntry = () => {
    onChange([
      ...entries,
      { key: kid("ex"), reason: "map", scope: emptyScope() },
    ]);
  };
  const update = (key: string, patch: Partial<ExceptionEntry>) => {
    onChange(entries.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  };
  const remove = (key: string) => onChange(entries.filter((e) => e.key !== key));

  return (
    <Card>
      <BlockStack gap="400">
        {hideHeader ? (
          <InlineStack align="end">
            <Button onClick={addEntry}>Add exception</Button>
          </InlineStack>
        ) : (
          <SectionHeader
            title="Products to always escalate"
            description="Selected products never auto-price — every quote request opens an escalation for human review (MAP, hero SKUs, brand-protected)."
            action={{ label: "Add exception", onClick: addEntry }}
          />
        )}
        {entries.length === 0 ? (
          <EmptyHint text="No exceptions yet. Click Add exception to pick products that always route to human review." />
        ) : (
          <BlockStack gap="300">
            {entries.map((e, idx) => (
              <EntryFrame
                key={e.key}
                title={`Exception ${idx + 1}`}
                onRemove={() => remove(e.key)}
              >
                <div style={{ maxWidth: 320 }}>
                  <Select
                    label="Reason"
                    options={[
                      { label: "MAP (minimum advertised price)", value: "map" },
                      { label: "New season", value: "new_season" },
                      { label: "Brand-protected", value: "brand_protected" },
                    ]}
                    value={e.reason}
                    onChange={(v) =>
                      update(e.key, { reason: v as ExceptionReason })
                    }
                  />
                </div>
                <Divider />
                <ScopeEditor
                  scope={e.scope}
                  onChange={(next) => update(e.key, { scope: next })}
                />
                {e.scope.productIds.length === 0 && (
                  <Text as="p" tone="subdued" variant="bodySm">
                    Pick at least one product for this exception to take effect.
                  </Text>
                )}
              </EntryFrame>
            ))}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

// ─────────────────────────── section: prepaid ───────────────────────────

function PrepaidSection({
  entries,
  onChange,
  hideHeader = false,
}: {
  entries: PrepaidEntry[];
  onChange: (next: PrepaidEntry[]) => void;
  hideHeader?: boolean;
}) {
  const addEntry = () => {
    onChange([
      ...entries,
      { key: kid("pp"), prepaidPct: 4, scope: emptyScope() },
    ]);
  };
  const update = (key: string, patch: Partial<PrepaidEntry>) => {
    onChange(entries.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  };
  const remove = (key: string) => onChange(entries.filter((e) => e.key !== key));

  return (
    <Card>
      <BlockStack gap="400">
        {hideHeader ? (
          <InlineStack align="end">
            <Button onClick={addEntry}>Add offer</Button>
          </InlineStack>
        ) : (
          <SectionHeader
            title="Prepaid counter-offer"
            description="On below-floor requests, offer an extra discount if the buyer prepays instead of net-30. Used only as an alternative counter, never the mainline decision."
            action={{ label: "Add offer", onClick: addEntry }}
          />
        )}
        {entries.length === 0 ? (
          <EmptyHint text="No prepaid offers yet. Add one to surface a prepaid alternative on below-floor requests." />
        ) : (
          <BlockStack gap="300">
            {entries.map((e, idx) => (
              <EntryFrame
                key={e.key}
                title={`Offer ${idx + 1}`}
                onRemove={() => remove(e.key)}
              >
                <div style={{ maxWidth: 240 }}>
                  <TextField
                    label="Extra discount for prepaid"
                    type="number"
                    suffix="%"
                    autoComplete="off"
                    value={String(e.prepaidPct)}
                    onChange={(v) =>
                      update(e.key, { prepaidPct: Number(v) || 0 })
                    }
                  />
                </div>
                <Divider />
                <ScopeEditor
                  scope={e.scope}
                  onChange={(next) => update(e.key, { scope: next })}
                />
              </EntryFrame>
            ))}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

// ─────────────────────────── shared bits ───────────────────────────

function EmptyHint({ text }: { text: string }) {
  return (
    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
      <Text as="p" tone="subdued" variant="bodySm">
        {text}
      </Text>
    </Box>
  );
}
