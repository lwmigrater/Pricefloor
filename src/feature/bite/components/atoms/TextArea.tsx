import React from "react";

export interface TextAreaProps extends React.HTMLAttributes<HTMLElement> {
  value?: string;
  label?: string;
  rows?: number | string;
  placeholder?: string;
  [key: string]: any;
}

export const TextArea: React.FC<TextAreaProps> = (props) => {
  return <s-text-area {...(props as any)} />;
};
