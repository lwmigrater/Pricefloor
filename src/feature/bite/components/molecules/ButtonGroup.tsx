import React from "react";

export type ButtonGroupProps = React.JSX.IntrinsicElements['s-button-group'];

export const ButtonGroup: React.FC<ButtonGroupProps> = (props) => {
  return <s-button-group {...props} />;
};
