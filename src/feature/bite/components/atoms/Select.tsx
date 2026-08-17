import React from "react";

export interface SelectProps extends React.HTMLAttributes<HTMLElement> {
  options: { label: string; value: string }[];
  label?: string;
  value?: string;
  [key: string]: any;
}

export const Select: React.FC<SelectProps> = (props) => {
  return <s-select {...(props as any)} />;
};
