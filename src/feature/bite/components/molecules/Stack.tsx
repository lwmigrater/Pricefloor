import React from "react";

export interface StackProps extends React.HTMLAttributes<HTMLElement> {
  gap?: string;
  "block-align"?: string;
  align?: string;
  direction?: string;
  [key: string]: any;
}

export const Stack: React.FC<StackProps> = (props) => {
  return <s-stack {...(props as any)} />;
};
