import React from "react";

export interface CheckboxProps extends React.HTMLAttributes<HTMLElement> {
  checked?: boolean;
  label?: string;
  [key: string]: any;
}

export const Checkbox: React.FC<CheckboxProps> = (props) => {
  return <s-checkbox {...(props as any)} />;
};
