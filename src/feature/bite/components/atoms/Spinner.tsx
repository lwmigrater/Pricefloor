import React from "react";

export interface SpinnerProps extends React.HTMLAttributes<HTMLElement> {
  size?: string;
  [key: string]: any;
}

export const Spinner: React.FC<SpinnerProps> = (props) => {
  return <s-spinner {...(props as any)} />;
};
