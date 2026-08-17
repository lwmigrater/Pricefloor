import React from "react";

export type ButtonProps = React.JSX.IntrinsicElements['s-button'];

export const Button: React.FC<ButtonProps> = (props) => {
  return <s-button {...props} />;
};
