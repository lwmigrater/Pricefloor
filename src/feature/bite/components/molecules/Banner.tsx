import React from "react";

/**
 * Banner component wrapper for Shopify Polaris s-banner element.
 */
export interface BannerProps extends React.HTMLAttributes<HTMLElement> {
  heading?: string;
  tone?: string;
  dismissible?: boolean;
  [key: string]: any;
}

export const Banner: React.FC<BannerProps> = (props) => {
  return <s-banner {...(props as any)}>{props.children}</s-banner>;
};
