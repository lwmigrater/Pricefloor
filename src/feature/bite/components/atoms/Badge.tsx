import React from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLElement> {
  tone?: string;
  variant?: string;
  [key: string]: any;
}

export const Badge: React.FC<BadgeProps> = (props) => {
  return <s-badge {...(props as any)} />;
};
