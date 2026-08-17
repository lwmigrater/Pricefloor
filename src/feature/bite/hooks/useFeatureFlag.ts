import { useRouteLoaderData } from "react-router";

/**
 * Hook to check if a feature flag is enabled.
 * Accesses data loaded in the root 'routes/app' loader.
 */
export function useFeatureFlag(flag: string): boolean {
  // Access data from the 'routes/app' route
  // Note: we need to cast the type or use a shared type definition for the loader data
  const data = useRouteLoaderData("routes/app") as { featureFlags?: Record<string, boolean> } | undefined;

  if (!data?.featureFlags) {
    return false;
  }

  return !!data.featureFlags[flag];
}
