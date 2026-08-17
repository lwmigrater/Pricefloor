import React from "react";

export interface TextProps extends React.HTMLAttributes<HTMLElement> {
  variant?: string;
  tone?: string;
  as?: string;
  [key: string]: any;
}

export const Text: React.FC<TextProps> = (props) => {
  return <s-text {...(props as any)} />;
};
