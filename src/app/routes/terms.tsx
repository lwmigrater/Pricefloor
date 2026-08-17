export default function TermsOfService() {
  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <h1 style={styles.h1}>Terms of Service</h1>
        <p style={styles.meta}>Last updated: (fill in on release)</p>

        <p style={styles.p}>
          These Terms of Service ("Terms") govern your access to and use of the
          TEMPLATE_APP_NAME app ("App") provided by TEMPLATE_APP_NAME ("we", "us", or "our").
          By installing or using the App, you ("Merchant") agree to be bound by these
          Terms.
        </p>

        <h2 style={styles.h2}>1. Description of Service</h2>
        <p style={styles.p}>
          The App is a Shopify application that provides functionality to merchants
          using the Shopify platform. Specific features are described inside the App.
        </p>

        <h2 style={styles.h2}>2. Eligibility</h2>
        <p style={styles.p}>
          You must have an active Shopify store to use the App. By accepting these Terms,
          you represent that you have the authority to bind your business to these Terms.
        </p>

        <h2 style={styles.h2}>3. Acceptable Use</h2>
        <p style={styles.p}>You agree not to:</p>
        <ul style={styles.ul}>
          <li>Use the App for any unlawful purpose or in violation of Shopify's Partner Program Agreement.</li>
          <li>Attempt to reverse-engineer, decompile, or extract the source code of the App.</li>
          <li>Use the App to send unsolicited communications or spam to customers.</li>
        </ul>

        <h2 style={styles.h2}>4. Merchant Responsibilities</h2>
        <p style={styles.p}>You are solely responsible for:</p>
        <ul style={styles.ul}>
          <li>The content you configure or publish through the App.</li>
          <li>Ensuring your use of the App complies with applicable laws, including consumer protection and privacy laws in your jurisdiction.</li>
          <li>Maintaining your own Privacy Policy that discloses the use of third-party apps including this App.</li>
        </ul>

        <h2 style={styles.h2}>5. Data Processing</h2>
        <p style={styles.p}>
          By using the App, you authorise us to process order and customer data on your
          behalf as described in our{" "}
          <a href="/privacy" style={styles.a}>Privacy Policy</a>. You remain the data
          controller for your customers' personal data. We act as a data processor on
          your behalf.
        </p>

        <h2 style={styles.h2}>6. Subscription and Billing</h2>
        <p style={styles.p}>
          The App may offer free and paid subscription plans. Paid plans are billed
          through Shopify's billing system. Charges are shown before confirmation and
          are non-refundable except where required by law.
        </p>

        <h2 style={styles.h2}>7. Intellectual Property</h2>
        <p style={styles.p}>
          The App and all related intellectual property rights are owned by
          TEMPLATE_APP_NAME. These Terms do not grant you any ownership rights. You are
          granted a limited, non-exclusive, non-transferable licence to use the App
          solely for your Shopify store.
        </p>

        <h2 style={styles.h2}>8. Disclaimer of Warranties</h2>
        <p style={styles.p}>
          The App is provided "as is" and "as available" without warranties of any kind,
          express or implied.
        </p>

        <h2 style={styles.h2}>9. Limitation of Liability</h2>
        <p style={styles.p}>
          To the maximum extent permitted by law, TEMPLATE_APP_NAME shall not be liable
          for any indirect, incidental, special, or consequential damages arising from
          your use of the App.
        </p>

        <h2 style={styles.h2}>10. Termination</h2>
        <p style={styles.p}>
          You may terminate these Terms at any time by uninstalling the App from your
          Shopify store.
        </p>

        <h2 style={styles.h2}>11. Contact</h2>
        <p style={styles.p}>
          For questions about these Terms, contact us at:{" "}
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
