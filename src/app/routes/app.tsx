import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError, redirect, Link as RouterLink } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";

import { authenticate } from "@/adapters/shopify/shopify.server";
import { AppNav, Link } from "@/feature/bite/components";
import "@/i18n/config";
import { useTranslation } from "react-i18next";
import { companyService } from "@/feature/bite/services/company.service";
import { getEnabledModules } from "@/feature/bite/modules/modules.server";
import { MODULE_REGISTRY, type ModuleId } from "@/feature/bite/modules";
import { forwardRef, useEffect } from "react";
import { ToastProvider } from "@/feature/bite/hooks/useToast";

const PolarisLink = forwardRef<HTMLAnchorElement, any>(function PolarisLink(
  { url, external, target, children, ...rest },
  ref
) {
  const isExternal =
    external ||
    target === "_blank" ||
    target === "_top" ||
    (typeof url === "string" && /^(https?:)?\/\//.test(url));
  if (isExternal) {
    const resolvedTarget = target ?? "_blank";
    return (
      <a
        href={url}
        ref={ref}
        target={resolvedTarget}
        rel={resolvedTarget === "_blank" ? "noopener noreferrer" : undefined}
        {...rest}
      >
        {children}
      </a>
    );
  }
  return (
    <RouterLink to={url} ref={ref} {...rest}>
      {children}
    </RouterLink>
  );
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const company = await companyService.findByShop(session.shop);

  const url = new URL(request.url);
  const isOnboardingPath = url.pathname === "/app/onboarding";

  if (company) {
    const onboardingCompleted = await companyService.getMeta(company.id, "onboarding_completed");
    if (onboardingCompleted !== "true" && !isOnboardingPath) {
      return redirect(`/app/onboarding?${url.searchParams.toString()}`);
    }
  } else if (!isOnboardingPath) {
    return redirect(`/app/onboarding?${url.searchParams.toString()}`);
  }

  let language = "en";
  let enabledModules: ModuleId[] = [];

  if (company) {
    const savedLang = await companyService.getMeta(company.id, "language");
    if (savedLang) language = savedLang;
    enabledModules = await getEnabledModules(company.id);
  }

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    language,
    enabledModules,
  };
};

export default function App() {
  const { apiKey, language, enabledModules } = useLoaderData<typeof loader>();
  const { t, i18n } = useTranslation("common");

  useEffect(() => {
    if (language && i18n.language !== language) {
      i18n.changeLanguage(language);
    }
  }, [language, i18n]);

  const moduleNavLinks = enabledModules.flatMap((id) =>
    (MODULE_REGISTRY[id]?.navItems ?? []).map((item) => (
      <Link key={item.to} href={item.to}>
        {t(item.i18nKey, { defaultValue: item.fallbackLabel })}
      </Link>
    ))
  );

  return (
    <PolarisAppProvider i18n={{}} linkComponent={PolarisLink}>
      <AppProvider embedded apiKey={apiKey}>
        <ToastProvider>
          <AppNav>
            <Link href="/app">{t("nav.dashboard", { defaultValue: "Dashboard" })}</Link>
            {moduleNavLinks}
            <Link href="/app/subscriptions">
              {t("nav.subscriptions", { defaultValue: "Subscriptions" })}
            </Link>
            <Link href="/app/settings">{t("nav.settings", { defaultValue: "Settings" })}</Link>
          </AppNav>
          <Outlet />
        </ToastProvider>
      </AppProvider>
    </PolarisAppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
