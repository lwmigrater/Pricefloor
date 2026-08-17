import React from "react";

export interface SwitchProps extends React.HTMLAttributes<HTMLElement> {
  checked?: boolean;
  label?: string;
  [key: string]: any;
}

export const Switch: React.FC<SwitchProps> = (props) => {
  return <s-switch {...(props as any)} />;
};
