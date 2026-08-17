import React from "react";

export interface TextFieldProps extends React.HTMLAttributes<HTMLElement> {
  value?: string;
  label?: string;
  type?: string;
  placeholder?: string;
  [key: string]: any;
}

export const TextField: React.FC<TextFieldProps> = (props) => {
  return <s-text-field {...(props as any)} />;
};
