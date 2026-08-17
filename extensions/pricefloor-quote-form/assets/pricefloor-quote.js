/**
 * Pricefloor buyer widget.
 *
 * Runs on every storefront page when the merchant has enabled the app embed.
 * Responsibilities:
 *   1. Watch quantity inputs; auto-open the quote modal on threshold (if enabled).
 *   2. Expose window.PricefloorQuote.open() so the inline quote-button app block
 *      (merchant-placed on the product template, e.g. next to Add to cart) can
 *      trigger the modal on click.
 *   3. Collect buyer contact + variant + qty and POST /apps/pricefloor/quote.
 *   4. Confirm that the request was sent for merchant review.
 *
 * The floating button of earlier versions has been removed — the button now
 * belongs to the merchant-placed inline block, so it only appears on the
 * pages (typically the product template) where the merchant added it.
 */
(function () {
  // The button block loads this file too (so click-to-open works without the
  // app embed). If both blocks are enabled the browser executes this IIFE
  // twice — bail on the second run so we don't double-bind listeners.
  if (window.PricefloorQuote && window.PricefloorQuote.__pfInit) return;

  const CFG = window.PRICEFLOOR_CFG || {};
  const THRESHOLD = Number(CFG.threshold) > 0 ? Number(CFG.threshold) : 10;
  // Auto-open is an app-embed feature — only fire when the embed set hasEmbed.
  // Button-only installs shouldn't surprise buyers with an unconfigured modal.
  const AUTO_OPEN = CFG.hasEmbed === true && CFG.autoOpen !== false;
  const PROXY = CFG.proxyUrl || "/apps/pricefloor/quote";
  const ACCENT = CFG.accentColor || "#111827";

  // ---------- theme (merchant-controlled cosmetics) ----------
  // These flow into CSS variables on .pf-modal. Any subset can be missing.
  const THEME = {
    accent: ACCENT,
    accentInk: readableInk(ACCENT),
    radius: numOr(CFG.modalRadius, 14),
    surface: CFG.modalSurface || "#ffffff",
    fg: CFG.modalFg || "#101828",
    muted: CFG.modalMuted || "#667085",
    border: CFG.modalBorder || "#ececef",
    fieldBg: CFG.modalFieldBg || "#ffffff",
  };

  function numOr(v, fb) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fb;
  }

  // Pick black or white text based on background luminance so accent buttons
  // stay legible whether the merchant picks a neon color or something dark.
  function readableInk(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return "#ffffff";
    const int = parseInt(m[1], 16);
    const r = (int >> 16) & 0xff;
    const g = (int >> 8) & 0xff;
    const b = int & 0xff;
    // WCAG-ish relative luminance approximation
    const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return L > 0.6 ? "#101828" : "#ffffff";
  }

  let autoOpened = false; // fire the auto-modal at most once per page load
  let currentContext = null; // { variantId, quantity, basePrice }
  let currentProduct = null; // { title, image, price } — set by button click

  // ---------- variant + qty extraction ----------

  function toGid(idLike) {
    if (!idLike) return null;
    const s = String(idLike);
    if (s.startsWith("gid://")) return s;
    if (/^\d+$/.test(s)) return `gid://shopify/ProductVariant/${s}`;
    return null;
  }

  function priceFromForm(form) {
    // Best-effort — Shopify themes vary. Look for price data attrs / meta.
    const attr = form.querySelector("[data-product-price], [data-variant-price]");
    if (attr) {
      const raw = attr.getAttribute("data-product-price") || attr.getAttribute("data-variant-price") || attr.textContent || "";
      const n = parseFloat(raw.replace(/[^\d.]/g, ""));
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  }

  function extractContextFromInput(input) {
    // Product form: qty input lives in a <form action="/cart/add"> alongside <input name="id">.
    const form = input.closest('form[action*="/cart/add"]');
    if (form) {
      const idInput = form.querySelector('input[name="id"], select[name="id"]');
      const variantId = toGid(idInput && idInput.value);
      if (variantId) {
        return {
          variantId,
          quantity: parseInt(input.value || "0", 10) || 0,
          basePrice: priceFromForm(form),
        };
      }
    }
    // Cart page: qty input has name="updates[<variantId>]" or data-variant-id.
    const nameMatch = (input.name || "").match(/updates\[(\d+)\]/);
    if (nameMatch) {
      return {
        variantId: toGid(nameMatch[1]),
        quantity: parseInt(input.value || "0", 10) || 0,
        basePrice: null,
      };
    }
    const dv = input.getAttribute("data-variant-id") || (input.closest("[data-variant-id]") && input.closest("[data-variant-id]").getAttribute("data-variant-id"));
    if (dv) {
      return {
        variantId: toGid(dv),
        quantity: parseInt(input.value || "0", 10) || 0,
        basePrice: null,
      };
    }
    return null;
  }

  function scanQuantities() {
    if (autoOpened || !AUTO_OPEN) return;
    const inputs = document.querySelectorAll(
      'input[name="quantity"], input[name^="updates["], input[data-quantity-input]'
    );
    for (const input of inputs) {
      // Ignore the modal's own quantity input — otherwise stepping up inside
      // an already-open button-triggered modal would re-fire the auto path.
      if (input.closest(".pf-modal-root")) continue;
      const ctx = extractContextFromInput(input);
      if (ctx && ctx.variantId && ctx.quantity >= THRESHOLD) {
        currentContext = ctx;
        openModal({ auto: true });
        autoOpened = true;
        return;
      }
    }
  }

  function pickCurrentContext() {
    const inputs = document.querySelectorAll(
      'input[name="quantity"], input[name^="updates["], input[data-quantity-input]'
    );
    let best = null;
    for (const inp of inputs) {
      const ctx = extractContextFromInput(inp);
      if (ctx && ctx.variantId) {
        best = ctx;
        if (ctx.quantity > 0) break;
      }
    }
    return best;
  }

  // ---------- modal ----------

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "style") Object.assign(el.style, v);
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, "");
        else if (v != null && v !== false) el.setAttribute(k, v);
      }
    }
    for (const c of children) {
      if (c == null || c === false) continue;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return el;
  }

  let modalRoot = null;

  function closeModal() {
    if (modalRoot) modalRoot.remove();
    modalRoot = null;
  }

  // Build a "$1,234.00" for a raw money string like "$79.00" the merchant
  // passed from Liquid. If it doesn't parse we just show whatever we got.
  function parseMoney(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    const n = parseFloat(s.replace(/[^\d.,-]/g, "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function openModal(opts) {
    closeModal();
    const auto = !!(opts && opts.auto);
    const overrideTitle = opts && opts.title;
    const prefillEmail = CFG.customerEmail || "";
    const ctx = currentContext || { variantId: null, quantity: THRESHOLD, basePrice: null };

    // Copy in a fresh product snapshot on every open, since a merchant might
    // have multiple button blocks (variant-specific) on one page.
    const product = (opts && opts.product) || currentProduct || null;

    // Title/subtitle priority: opts (button label) → merchant CFG → sensible default.
    const title =
      overrideTitle ||
      (auto ? (CFG.autoTitle || "Ordering in bulk?") : (CFG.modalTitle || "Request a bulk quote"));
    const body =
      auto
        ? (CFG.autoBody || "Name your quantity and price. The store will review your request before sending an offer.")
        : (CFG.modalSubtitle || "Choose your quantity and preferred price. The store will review every request.");

    // -------- product context header --------
    let productHeader = null;
    if (CFG.showProduct !== false && product && (product.title || product.image)) {
      const priceNum = parseMoney(product.price);
      const meta = priceNum != null
        ? `List ${fmtMoney(priceNum, CFG.currency)} · per unit`
        : (product.price ? `List ${product.price} · per unit` : "");
      productHeader = h("div", { class: "pf-product" },
        product.image
          ? h("img", { class: "pf-product__img", src: product.image, alt: product.title || "" })
          : h("span", { class: "pf-product__img pf-product__img--placeholder", "aria-hidden": "true" }, "◫"),
        h("div", { class: "pf-product__body" },
          h("p", { class: "pf-product__title" }, product.title || "Selected product"),
          meta && h("p", { class: "pf-product__meta" }, meta)
        )
      );
    }

    // -------- form --------
    const form = h("form", {
      class: "pf-form",
      onsubmit: (e) => {
        e.preventDefault();
        submitQuote(form);
      },
    });

    const emailField = h("div", { class: "pf-field" },
      h("label", { class: "pf-field__label", for: "pf-email" }, "Your email"),
      h("input", {
        type: "email",
        id: "pf-email",
        name: "email",
        required: true,
        value: prefillEmail,
        placeholder: "you@company.com",
        class: "pf-input",
        autocomplete: "email",
      }),
      h("span", { class: "pf-field__help" }, "We'll send the approved price or counter offer here.")
    );

    // Quantity + target price side by side.
    const qtyId = "pf-qty";
    const qtyStepper = h("div", { class: "pf-qty" },
      h("button", {
        type: "button",
        class: "pf-qty__btn",
        "aria-label": "Decrease quantity",
        onclick: () => {
          const input = form.querySelector('input[name="quantity"]');
          if (!input) return;
          input.value = String(Math.max(1, (parseInt(input.value || "0", 10) || 0) - 1));
        },
      }, "−"),
      h("input", {
        type: "number",
        id: qtyId,
        name: "quantity",
        min: "1",
        required: true,
        value: String(ctx.quantity && ctx.quantity > 0 ? ctx.quantity : THRESHOLD),
        class: "pf-qty__input",
        inputmode: "numeric",
      }),
      h("button", {
        type: "button",
        class: "pf-qty__btn",
        "aria-label": "Increase quantity",
        onclick: () => {
          const input = form.querySelector('input[name="quantity"]');
          if (!input) return;
          input.value = String((parseInt(input.value || "0", 10) || 0) + 1);
        },
      }, "+")
    );

    const currencySymbol = fmtMoney(0, CFG.currency).replace(/[\d.,\s]/g, "") || "";
    // basePrice is the list price passed in by the button block (Liquid reads
    // it from product.selected_or_first_available_variant.price). When present,
    // we prefill the target with list, cap the max so buyers can't ask for MORE
    // than list.
    const hasBasePrice = Number.isFinite(ctx.basePrice) && ctx.basePrice > 0;
    const targetInput = h("input", {
      type: "number",
      id: "pf-target",
      name: "targetPrice",
      min: "0.01",
      step: "0.01",
      class: "pf-input",
      inputmode: "decimal",
      ...(hasBasePrice
        ? {
            value: ctx.basePrice.toFixed(2),
            max: String(ctx.basePrice),
            placeholder: ctx.basePrice.toFixed(2),
          }
        : { placeholder: "12.50" }),
    });

    const targetWrap = h("div", { class: "pf-input-wrap" },
      currencySymbol && h("span", { class: "pf-input-wrap__prefix" }, currencySymbol),
      targetInput,
    );

    const pricingRow = h("div", { class: "pf-row" },
      h("div", { class: "pf-field" },
        h("label", { class: "pf-field__label", for: qtyId }, "Quantity"),
        qtyStepper
      ),
      h("div", { class: "pf-field" },
        h("label", { class: "pf-field__label pf-field__label--muted", for: "pf-target" }, "Target unit price · optional"),
        targetWrap
      )
    );
    const priceSummary = h("div", { class: "pf-price-summary" });
    const updateSummary = () => {
      const qty = Math.max(1, parseInt(qtyStepper.querySelector("input").value || "1", 10));
      const target = parseFloat(targetInput.value || "");
      const requested = Number.isFinite(target) && target > 0 ? target : (hasBasePrice ? ctx.basePrice : null);
      priceSummary.replaceChildren(
        h("div", { class: "pf-price-summary__item" }, h("span", {}, "List total"), h("strong", {}, hasBasePrice ? fmtMoney(ctx.basePrice * qty, CFG.currency) : "—")),
        h("span", { class: "pf-price-summary__arrow", "aria-hidden": "true" }, "→"),
        h("div", { class: "pf-price-summary__item pf-price-summary__item--accent" }, h("span", {}, "Estimated request total"), h("strong", {}, requested != null ? fmtMoney(requested * qty, CFG.currency) : "—"))
      );
    };
    qtyStepper.querySelector("input").addEventListener("input", updateSummary);
    targetInput.addEventListener("input", updateSummary);
    qtyStepper.querySelectorAll("button").forEach((button) => button.addEventListener("click", updateSummary));
    updateSummary();
    form.appendChild(h("section", { class: "pf-form-section" },
      h("div", { class: "pf-form-section__head" }, h("span", { class: "pf-step" }, "1"), h("div", {}, h("strong", {}, "Your request"), h("p", {}, "Set the quantity and the unit price you'd like to pay."))),
      pricingRow,
      priceSummary
    ));
    form.appendChild(h("section", { class: "pf-form-section" },
      h("div", { class: "pf-form-section__head" }, h("span", { class: "pf-step" }, "2"), h("div", {}, h("strong", {}, "Where should we reply?"), h("p", {}, "The store reviews every request before an offer is sent."))),
      emailField
    ));

    // "More options" is only rendered if there's something in it — currently
    // just payment terms. Keeps the base form to two fields when possible.
    if (CFG.showTerms) {
      const details = h("details", { class: "pf-more" },
        h("summary", { class: "pf-more__summary" },
          h("span", { class: "pf-more__caret" }, "▸"),
          "More options"
        ),
        h("div", { class: "pf-more__body" },
          h("div", { class: "pf-field" },
            h("label", { class: "pf-field__label", for: "pf-terms" }, "Payment terms"),
            (function () {
              const sel = h("select", { id: "pf-terms", name: "terms", class: "pf-select" });
              sel.appendChild(h("option", { value: "" }, "No preference"));
              sel.appendChild(h("option", { value: "prepaid" }, "Prepaid"));
              sel.appendChild(h("option", { value: "net30" }, "Net 30"));
              return sel;
            })()
          )
        )
      );
      form.appendChild(details);
    }

    if (!ctx.variantId) {
      form.appendChild(h("div", { class: "pf-hint pf-hint--warn" },
        "Open a product page (or the cart) before requesting a quote — we couldn't detect which product you're viewing."
      ));
    }

    form.appendChild(h("button", {
      type: "submit",
      class: "pf-btn pf-btn--primary",
      disabled: !ctx.variantId,
    }, "Send quote request", h("span", { "aria-hidden": "true" }, "→")));

    // Trust strip is merchant-toggleable; default on with a sensible tagline.
    const trustText = CFG.trustText || "No payment now · The store reviews every request";
    const showTrust = CFG.showTrust !== false && !!trustText;

    // Merchant-controlled CSS variables are set inline so schema changes take
    // effect without a stylesheet redeploy.
    const modalStyle = {
      "--pf-accent": THEME.accent,
      "--pf-accent-ink": THEME.accentInk,
      "--pf-modal-radius": THEME.radius + "px",
      "--pf-modal-bg": THEME.surface,
      "--pf-modal-fg": THEME.fg,
      "--pf-modal-muted": THEME.muted,
      "--pf-modal-border": THEME.border,
      "--pf-modal-field-bg": THEME.fieldBg,
    };

    modalRoot = h("div", { class: "pf-modal-root", role: "dialog", "aria-modal": "true", "aria-labelledby": "pf-title" },
      h("div", { class: "pf-backdrop", onclick: closeModal }),
      h("div", { class: "pf-modal", style: modalStyle },
        h("button", { type: "button", class: "pf-close", "aria-label": "Close", onclick: closeModal }, "×"),
        productHeader,
        h("h2", { class: "pf-title", id: "pf-title" }, title),
        h("p", { class: "pf-body" }, body),
        form,
        h("div", { class: "pf-result", id: "pf-result" }),
        showTrust && h("p", { class: "pf-trust" }, trustText)
      )
    );

    document.body.appendChild(modalRoot);
    // Focus email first so the buyer can start typing immediately (better
    // than focusing the qty stepper which they usually don't need to touch).
    const firstInput = form.querySelector('input[name="quantity"]') || form.querySelector("input,select,button");
    if (firstInput) firstInput.focus();
  }

  // ---------- submit ----------

  async function submitQuote(form) {
    const resultEl = modalRoot && modalRoot.querySelector("#pf-result");
    const btn = form.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = "Sending request…"; }
    if (resultEl) resultEl.textContent = "";

    const ctx = currentContext || {};
    const data = new FormData(form);
    const targetPrice = parseFloat(data.get("targetPrice") || "");
    const qty = parseInt(data.get("quantity") || "0", 10);
    // When we prefill the target with list price and the buyer doesn't touch
    // it, sending it as a "requested" price would just be noise for the engine
    // (target === list ⇒ no discount ask). Drop it unless it's strictly below
    // the list price. Also clamp: even if the max attribute is bypassed, we
    // never forward a target above list.
    const askedBelowList =
      Number.isFinite(targetPrice) &&
      targetPrice > 0 &&
      (!Number.isFinite(ctx.basePrice) || targetPrice < ctx.basePrice);

    const body = {
      customerEmail: String(data.get("email") || ""),
      shopifyCustomerId: CFG.customerId || undefined,
      shopifyCompanyId: CFG.companyId || undefined,
      companyTier: CFG.companyTier || undefined,
      currency: CFG.currency || "USD",
      lines: [
        {
          variantId: ctx.variantId,
          quantity: qty,
          ...(askedBelowList ? { requestedUnitPrice: targetPrice } : {}),
          ...(ctx.basePrice ? { basePrice: ctx.basePrice } : {}),
        },
      ],
      ...(data.get("terms") ? { terms: { payment: String(data.get("terms")) } } : {}),
    };

    try {
      const res = await fetch(PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      renderResult(resultEl, res.status, json);
    } catch (err) {
      renderResult(resultEl, 0, { error: "network_error" });
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Send quote request"; }
    }
  }

  function fmtMoney(amount, currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(amount);
    } catch {
      return `${amount} ${currency || ""}`.trim();
    }
  }

  // On a successful submission we swap the whole modal body for a compact
  // thanks state — form + inline result feels cluttered when the buyer's
  // job is basically done. Errors still render inline over the form so the
  // buyer can retry without losing their input.
  function showThanks(invoiceUrl) {
    if (!modalRoot) return;
    const modal = modalRoot.querySelector(".pf-modal");
    if (!modal) return;
    const close = modal.querySelector(".pf-close");
    // Remove everything except the close button, then paint the thanks card.
    Array.from(modal.children).forEach((child) => {
      if (child !== close) child.remove();
    });
    modal.appendChild(
      h("div", { class: "pf-thanks" },
        h("div", { class: "pf-thanks__check", "aria-hidden": "true" }, "✓"),
        h("h2", { class: "pf-thanks__title" }, "Thanks!"),
        h("p", { class: "pf-thanks__body" }, "Your request is now with the store. You'll receive the approved price or a counter offer by email."),
        invoiceUrl
          ? h("a", {
              href: invoiceUrl,
              class: "pf-btn pf-btn--primary pf-thanks__cta",
              target: "_blank",
              rel: "noopener",
            }, "Complete purchase")
          : h("button", {
              type: "button",
              class: "pf-btn pf-btn--primary pf-thanks__cta",
              onclick: closeModal,
            }, "Close")
      )
    );
  }

  function renderResult(el, status, json) {
    if (!el) return;
    el.innerHTML = "";
    if (status === 0) {
      el.appendChild(h("div", { class: "pf-alert pf-alert--err" }, "Couldn't reach the server. Please try again."));
      return;
    }
    if (status === 402) {
      el.appendChild(h("div", { class: "pf-alert pf-alert--err" }, "Bulk quotes aren't available on this store's plan right now."));
      return;
    }
    if (status === 409) {
      el.appendChild(h("div", { class: "pf-alert pf-alert--err" }, "Bulk quoting isn't configured on this store yet. Please contact the merchant."));
      return;
    }
    if (status >= 400 || json.error) {
      el.appendChild(h("div", { class: "pf-alert pf-alert--err" }, "Something went wrong (" + (json.error || status) + "). Please try again."));
      return;
    }

    // Success — regardless of the engine's decision branch (auto / counter /
    // escalate), the buyer sees one clean thanks state. Auto-approvals include
    // the invoice link inline so they can complete purchase without another
    // email hop.
    showThanks(json.invoiceUrl || null);
  }

  // ---------- public API ----------

  // Merchant-placed inline blocks (see blocks/quote-button.liquid) call this
  // on click. We snapshot the current variant + qty from whatever product
  // form is on the page, then open the modal. `opts.title` lets the block
  // pass its own label so the modal title matches the button that opened it.
  window.PricefloorQuote = window.PricefloorQuote || {};
  window.PricefloorQuote.open = function open(opts) {
    // Priority: caller-supplied context (from the Liquid button block, which
    // reads product.selected_or_first_available_variant directly) → DOM scan
    // → whatever we already had cached. The button path is the reliable one
    // because theme DOM structure varies across themes.
    const supplied = opts && opts.context;
    if (supplied && supplied.variantId) {
      currentContext = {
        variantId: supplied.variantId,
        quantity: (currentContext && currentContext.quantity) || 0,
        basePrice: supplied.basePrice != null ? supplied.basePrice : null,
      };
    } else {
      currentContext = pickCurrentContext() || currentContext;
    }
    if (opts && opts.product) currentProduct = opts.product;
    openModal({
      auto: false,
      title: opts && opts.title,
      product: opts && opts.product,
    });
  };
  window.PricefloorQuote.__pfInit = true;

  // ---------- boot ----------

  function boot() {
    scanQuantities();
    // Rescan on qty edits — themes often update values without triggering input events cleanly.
    document.addEventListener("input", (e) => {
      const t = e.target;
      if (!t || !(t.matches && (t.matches('input[name="quantity"]') || t.matches('input[name^="updates["]') || t.matches("input[data-quantity-input]")))) return;
      scanQuantities();
    });
    document.addEventListener("change", (e) => {
      const t = e.target;
      if (!t || !(t.matches && (t.matches('input[name="quantity"]') || t.matches('input[name^="updates["]') || t.matches("input[data-quantity-input]")))) return;
      scanQuantities();
    });
    // Escape to close modal.
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modalRoot) closeModal();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
