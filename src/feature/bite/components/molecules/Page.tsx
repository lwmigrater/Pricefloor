import React from "react";
import { Page as PolarisPage } from "@shopify/polaris";

/**
 * Page component wrapper for Shopify Polaris Page.
 */
export interface PageProps {
  heading?: string;
  title?: string;
  children?: React.ReactNode;
  [key: string]: any;
}

export const Page: React.FC<PageProps> = ({ heading, title, children, ...rest }) => {
  return (
    <PolarisPage title={heading || title} {...rest}>
      <div style={{ paddingTop: "1rem", paddingBottom: "2rem" }}>
        {children}
      </div>
    </PolarisPage>
  );
};

