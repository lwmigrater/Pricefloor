# TEMPLATE_APP_NAME — Vayes Shopify App Boilerplate

Bare-bones React Router 7 + Shopify + Supabase skeleton. Every Vayes app is
scaffolded from this template — they share one Supabase project and are
isolated from each other via the `app_key` column.

## What's inside

- **Auth**: Shopify OAuth via `@shopify/shopify-app-react-router`, sessions
  persisted in Supabase (`sessions` table, scoped by `app_key`).
- **DB adapter**: Supabase service-role client at
  `src/feature/bite/adapters/supabase/supabase.server.ts`.
- **Generic KV store**: `app_entries` table with automatic versioning — see
  `src/feature/bite/services/entries.service.ts`.
- **Billing**: Shopify Managed Pricing integration + webhook sync
  (`webhooks.app-subscriptions-update.tsx`, `webhooks.app-subscriptions-cancelled.tsx`).
- **Module registry**: Add features by registering them in
  `src/feature/bite/modules/registry.ts` — the Dashboard nav, Onboarding
  wizard, and Settings tab pick them up automatically.
- **Onboarding / Settings / Subscriptions** pages, all registry-driven.
- **GDPR webhooks**: `customers/data_request`, `customers/redact`,
  `shop/redact` — implemented and app-key-scoped.
- **Polaris component kit** re-exported under
  `src/feature/bite/components/` (atoms, molecules, templates including
  OnboardingWizard, PricingCard, SortableList, RichTextEditor, charts).
- **i18n** scaffolding for 13 languages under `src/i18n/`.

Extensions folder is intentionally empty — each app runs
`shopify app generate extension` to add what it needs.

## Scaffold a new app

```
./scripts/create-app.sh <app-name> <app-key>
```

Example:

```
./scripts/create-app.sh vloyalty vloyalty
```

This creates `../vloyalty/` alongside `boilerplate/`, replaces placeholders,
initializes a git repo, and prints next steps.

### After scaffolding

```
cd ../vloyalty
npm install
npx shopify app config link --config vloyalty    # fills SHOPIFY_API_KEY/SECRET/URL
# Edit .env: paste SUPABASE_URL and SUPABASE_SERVICE_KEY
npm run dev
```

## Supabase — shared across all Vayes apps

All Vayes apps live in one Supabase project. Data is isolated per app via the
`app_key` column on every row (`company.app_key`, `app_entries.app_key`,
`sessions.app_key`).

**Taken APP_KEYs (do not reuse):**

- `suite360` — vpost-purchase (Suite360 Conversion Suite)
- `vreviews` — legacy reviews app
- `post_purchase` — legacy post-purchase app
- `vayes` — legacy unified key
- `review` — legacy
- `wishlist` — wishlist app
- `announcement` — announcement-bar app
- `back_in_stock` — back-in-stock notifier app

`create-app.sh` blocks these keys. When adding a new app, invent a new
snake_case key and add it to the list above.

### Migrations

Files in `supabase/migrations/` (`001_app_entries.sql`,
`003_plans_and_limits.sql`, `004_fix_subscriptions_plan_id.sql`) are already
applied on the shared Vayes Supabase project — **do not run them again**.
If you spin up a new Supabase project just for a single app, run them in
numerical order via `supabase db push` or `psql`.

## Adding a module

1. Extend `ModuleId` in `src/feature/bite/modules/types.ts`:

   ```ts
   export type ModuleId = "loyalty" | "wishlist";
   ```

2. Register it in `src/feature/bite/modules/registry.ts`:

   ```ts
   loyalty: {
     id: "loyalty",
     i18nKey: "modules.loyalty.label",
     fallbackLabel: "Loyalty",
     description: "Points, tiers, rewards.",
     navItems: [{ to: "/app/loyalty", i18nKey: "nav.loyalty", fallbackLabel: "Loyalty" }],
     metaKeys: ["loyalty_settings"],
     entryTypes: ["loyalty_point", "loyalty_reward"],
   }
   ```

3. Add its entry types to `src/feature/bite/services/entries.service.ts`:

   ```ts
   export const ENTRY_TYPES = {
     ...,
     LOYALTY_POINT: "loyalty_point",
     LOYALTY_REWARD: "loyalty_reward",
   } as const;
   ```

4. Add its routes under `src/app/routes/app.loyalty*.tsx`.

The Dashboard nav, Onboarding wizard, and Settings modules tab pick it up
automatically because they iterate over `MODULE_REGISTRY`.

## Adding a Shopify Extension

```
npx shopify app generate extension
```

The `extensions/` folder is empty by default so each app owns its own set.

## Layout

```
boilerplate/
  src/
    app/
      routes/                # React Router file routes (auth, webhooks, app.*)
    feature/bite/            # Adapters, services, modules, components, hooks
    i18n/                    # 13 locales
    type/                    # Shared types
    utils/                   # Generic helpers
  supabase/
    migrations/              # Reference — already applied on shared DB
    functions/send-email/    # Shared Mailgun email edge function
  scripts/
    create-app.sh
  shopify.app.template.toml
  .env.example
```
