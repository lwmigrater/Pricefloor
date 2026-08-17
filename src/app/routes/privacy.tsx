export default function PrivacyPolicy() {
  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <h1 style={styles.h1}>Privacy Policy</h1>
        <p style={styles.meta}>Last updated: (fill in on release)</p>

        <p style={styles.p}>
          TEMPLATE_APP_NAME ("we", "our", or "us") operates the TEMPLATE_APP_NAME app
          (the "App") available on the Shopify App Store. This Privacy Policy explains
          how we collect, use, and protect personal data when merchants install our App.
        </p>

        <h2 style={styles.h2}>1. Data We Collect</h2>
        <ul style={styles.ul}>
          <li><strong>Shop data:</strong> Store domain, Shopify plan, and configuration settings required to operate the App.</li>
          <li><strong>Order data:</strong> Where the App's features require it, we process order details on behalf of the merchant.</li>
          <li><strong>Customer name and email:</strong> When required by a feature the merchant enables, we process the minimum personal data needed.</li>
        </ul>

        <h2 style={styles.h2}>2. How We Use Data</h2>
        <ul style={styles.ul}>
          <li>Providing the App's features to the merchant.</li>
          <li>Diagnosing technical issues and improving App reliability.</li>
        </ul>
        <p style={styles.p}>We do not sell, rent, or share personal data with third parties for marketing purposes.</p>

        <h2 style={styles.h2}>3. Data Storage and Security</h2>
        <p style={styles.p}>
          Data is stored in Supabase, a cloud database provider with encryption at rest
          and in transit (TLS). Access to production data is restricted to authorised
          personnel only.
        </p>

        <h2 style={styles.h2}>4. Data Retention</h2>
        <p style={styles.p}>
          We retain data for as long as a merchant's account is active. When a merchant
          uninstalls the App, their data is flagged for deletion and removed within 30
          days, in accordance with Shopify's GDPR requirements.
        </p>

        <h2 style={styles.h2}>5. GDPR and Privacy Webhooks</h2>
        <ul style={styles.ul}>
          <li><strong>customers/data_request:</strong> We respond to customer data requests within the timeframe required by applicable law.</li>
          <li><strong>customers/redact:</strong> We delete customer personal data upon request.</li>
          <li><strong>shop/redact:</strong> We delete all shop data when a merchant uninstalls the App.</li>
        </ul>

        <h2 style={styles.h2}>6. Third-Party Services</h2>
        <ul style={styles.ul}>
          <li><strong>Supabase</strong> — database storage (<a href="https://supabase.com/privacy" style={styles.a}>privacy policy</a>)</li>
          <li><strong>Vercel</strong> — application hosting (<a href="https://vercel.com/legal/privacy-policy" style={styles.a}>privacy policy</a>)</li>
        </ul>

        <h2 style={styles.h2}>7. Contact</h2>
        <p style={styles.p}>
          For privacy-related questions or data requests, please contact us at:{" "}
          <a href="mailto:CHANGE_ME@example.com" style={styles.a}>CHANGE_ME@example.com</a>
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    backgroundColor: "#f9fafb",
    padding: "48px 16px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  content: {
    maxWidth: "720px",
    margin: "0 auto",
    backgroundColor: "#ffffff",
    borderRadius: "8px",
    padding: "40px 48px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
  },
  h1: { fontSize: "28px", fontWeight: 700, color: "#111827", marginBottom: "4px" },
  h2: { fontSize: "18px", fontWeight: 600, color: "#111827", marginTop: "32px", marginBottom: "12px" },
  meta: { fontSize: "14px", color: "#6b7280", marginBottom: "32px" },
  p: { fontSize: "15px", lineHeight: "1.7", color: "#374151", marginBottom: "12px" },
  ul: { fontSize: "15px", lineHeight: "1.7", color: "#374151", paddingLeft: "24px", marginBottom: "12px" },
  a: { color: "#2563eb", textDecoration: "underline" },
};
