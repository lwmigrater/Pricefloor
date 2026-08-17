import React from "react";

export type DividerProps = React.JSX.IntrinsicElements['s-divider'];

export const Divider: React.FC<DividerProps> = (props) => {
  return <s-divider {...props} />;
};
