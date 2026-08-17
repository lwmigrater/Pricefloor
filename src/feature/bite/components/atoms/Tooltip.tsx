import React from "react";

export interface TooltipProps extends React.HTMLAttributes<HTMLElement> {
  content?: string;
  [key: string]: any;
}

export const Tooltip: React.FC<TooltipProps> = (props) => {
  return <s-tooltip {...(props as any)} />;
};
