import { useState, useEffect } from "react";

/**
 * ClientOnly Component
 *
 * Renders children only on the client-side, preventing SSR issues.
 * Useful for components that rely on browser APIs like window, document, etc.
 *
 * Example:
 * ```tsx
 * <ClientOnly fallback={<div>Loading...</div>}>
 *   {() => <ComponentThatNeedsWindow />}
 * </ClientOnly>
 * ```
 */

interface ClientOnlyProps {
  children: () => React.ReactNode;
  fallback?: React.ReactNode;
}

export const ClientOnly: React.FC<ClientOnlyProps> = ({ children, fallback = null }) => {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!hasMounted) {
    return <>{fallback}</>;
  }

  return <>{children()}</>;
};
