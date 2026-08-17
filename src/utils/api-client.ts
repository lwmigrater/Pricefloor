import { getSessionToken } from "@shopify/app-bridge-utils";

interface ApiClientOptions extends RequestInit {
  appBridge?: any;
}

/**
 * A wrapper around fetch that automatically adds the session token to the request headers.
 * This is useful for making authenticated requests to your app's backend.
 * 
 * @param url The URL to fetch
 * @param options Fetch options
 * @returns The response
 */
export async function apiClient(url: string, options: ApiClientOptions = {}) {
  const { appBridge, headers, ...rest } = options;

  const defaultHeaders: HeadersInit = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  // If we are in the Shopify Admin context, getting a session token is handled by App Bridge.
  // Note: Standard fetch in the frontend usually doesn't need manual token if using standard Remix loaders/actions via form submission.
  // But for pure client-side fetch (e.g. from a button click without navigation), we need the token.

  // Since we are using Remix, often we rely on `useSubmit` or `useFetcher`. 
  // However, for external APIs or specific needs, this client is useful.

  if (appBridge) {
    const token = await getSessionToken(appBridge);
    if (token) {
      (defaultHeaders as any)['Authorization'] = `Bearer ${token}`;
    }
  } else if ((window as any).shopify) {
    // Try to get token from global shopify object if available (legacy or outside react context)
    try {
      const token = await getSessionToken((window as any).shopify);
      if (token) {
        (defaultHeaders as any)['Authorization'] = `Bearer ${token}`;
      }
    } catch (e) {
      console.warn("Failed to get session token", e);
    }
  }

  const mergedHeaders = { ...defaultHeaders, ...headers };

  const response = await fetch(url, {
    headers: mergedHeaders,
    ...rest,
  });

  if (!response.ok) {
    // Handle errors globally if needed
    throw new Error(`API Error: ${response.statusText}`);
  }

  return response;
}
