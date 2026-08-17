#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# create-app.sh — scaffold a new Vayes-style Shopify app from the boilerplate.
#
# Usage:
#   ./scripts/create-app.sh <app-name> <app-key>
#
# Args:
#   app-name  kebab-case identifier used as folder + package name (e.g. "vloyalty")
#   app-key   snake_case identifier used as APP_KEY in Supabase   (e.g. "vloyalty")
# ---------------------------------------------------------------------------

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <app-name> <app-key>" >&2
  exit 1
fi

APP_NAME="$1"
APP_KEY="$2"

if ! [[ "$APP_NAME" =~ ^[a-z][a-z0-9-]*$ ]]; then
  echo "Error: app-name must be kebab-case (lowercase, digits, hyphens)." >&2
  exit 1
fi

if ! [[ "$APP_KEY" =~ ^[a-z][a-z0-9_]*$ ]]; then
  echo "Error: app-key must be snake_case (lowercase, digits, underscores)." >&2
  exit 1
fi

# Reserved keys — enforce uniqueness across the shared Vayes Supabase namespace.
RESERVED=("suite360" "vreviews" "post_purchase" "vayes" "review" "wishlist" "announcement" "back_in_stock")
for r in "${RESERVED[@]}"; do
  if [[ "$APP_KEY" == "$r" ]]; then
    echo "Error: APP_KEY '$APP_KEY' is already in use by another Vayes app." >&2
    echo "Reserved keys: ${RESERVED[*]}" >&2
    exit 1
  fi
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOILERPLATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PARENT_DIR="$(cd "$BOILERPLATE_DIR/.." && pwd)"
TARGET_DIR="$PARENT_DIR/$APP_NAME"

if [[ -e "$TARGET_DIR" ]]; then
  echo "Error: $TARGET_DIR already exists." >&2
  exit 1
fi

echo "-> Copying boilerplate to $TARGET_DIR"
rsync -a \
  --exclude 'node_modules' \
  --exclude '.shopify' \
  --exclude 'build' \
  --exclude '.react-router' \
  --exclude '.git' \
  --exclude '.env' \
  "$BOILERPLATE_DIR/" "$TARGET_DIR/"

cd "$TARGET_DIR"

echo "-> Renaming shopify.app.template.toml -> shopify.app.${APP_NAME}.toml"
mv shopify.app.template.toml "shopify.app.${APP_NAME}.toml"

# Detect sed flavor (BSD on macOS vs GNU on Linux) for in-place edits.
if sed --version >/dev/null 2>&1; then
  SED_INPLACE=(-i)
else
  SED_INPLACE=(-i '')
fi

echo "-> Substituting placeholders"
FILES_TO_SUB=(
  "package.json"
  "shopify.app.${APP_NAME}.toml"
  "README.md"
  "src/app/routes/_index/route.tsx"
  "src/app/routes/auth.login/route.tsx"
  "src/app/routes/terms.tsx"
  "src/app/routes/privacy.tsx"
)
for f in "${FILES_TO_SUB[@]}"; do
  if [[ -f "$f" ]]; then
    sed "${SED_INPLACE[@]}" \
      -e "s|TEMPLATE_APP_NAME|${APP_NAME}|g" \
      -e "s|TEMPLATE_APP_KEY|${APP_KEY}|g" \
      "$f"
  fi
done

echo "-> Creating .env from .env.example"
cp .env.example .env
sed "${SED_INPLACE[@]}" -e "s|^APP_KEY=.*|APP_KEY=${APP_KEY}|" .env

echo "-> Initializing git repo"
git init -q
git add .
git commit -q -m "init from boilerplate (${APP_NAME}, APP_KEY=${APP_KEY})"

cat <<EOF

Success. Next steps:

  cd $TARGET_DIR
  npm install
  npx shopify app config link --config $APP_NAME     # fills SHOPIFY_API_KEY/SECRET/URL
  # then edit .env: paste your SUPABASE_URL + SUPABASE_SERVICE_KEY
  npm run dev

If this is the first Vayes app on a fresh Supabase project, run the migrations
under supabase/migrations/ once via 'supabase db push' or psql. They are
already applied on the shared Vayes Supabase project - skip them there.

EOF
