import React from "react";

export interface LinkProps extends React.HTMLAttributes<HTMLElement> {
  href?: string;
  target?: string;
  [key: string]: any;
}

export const Link: React.FC<LinkProps> = (props) => {
  return <s-link {...(props as any)} />;
};
