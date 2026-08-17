import React from "react";

export interface ChipProps extends React.HTMLAttributes<HTMLElement> {
  [key: string]: any;
}

export const Chip: React.FC<ChipProps> = (props) => {
  return <s-chip {...(props as any)} />;
};
