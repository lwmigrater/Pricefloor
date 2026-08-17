import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    return redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>TEMPLATE_APP_NAME</h1>
        <p className={styles.text}>
          A Shopify app built on the Vayes boilerplate.
        </p>
        <p className={styles.text}>
          Install TEMPLATE_APP_NAME from the{" "}
          <a
            href="https://apps.shopify.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Shopify App Store
          </a>{" "}
          to get started.
        </p>
      </div>
    </div>
  );
}
