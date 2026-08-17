import { useEffect } from "react";
import { useSearchParams } from "react-router";

export default function ExitIframe() {
  const [searchParams] = useSearchParams();
  const redirectUri = searchParams.get("redirectUri");

  useEffect(() => {
    if (redirectUri) {
      // Break out of iframe and redirect to Shopify payment page
      window.open(redirectUri, "_top");
    }
  }, [redirectUri]);

  return (
    <div style={{ padding: "20px", textAlign: "center" }}>
      <p>Redirecting to Shopify...</p>
    </div>
  );
}
