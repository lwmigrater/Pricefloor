import React from "react";

/**
 * Section component wrapper for Shopify Polaris s-section element.
 */
export interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  heading?: string;
  [key: string]: any;
}

export const Section: React.FC<SectionProps> = (props) => {
  return <s-section {...(props as any)}>{props.children}</s-section>;
};
