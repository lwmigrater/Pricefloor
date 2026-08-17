import React from "react";

export interface IconProps extends React.HTMLAttributes<HTMLElement> {
  source?: string;
  tone?: string;
  [key: string]: any;
}

export const Icon: React.FC<IconProps> = (props) => {
  return <s-icon {...(props as any)} />;
};
