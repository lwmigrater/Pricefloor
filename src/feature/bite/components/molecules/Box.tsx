import React from "react";

export type BoxProps = React.JSX.IntrinsicElements['s-box'];

export const Box: React.FC<BoxProps> = (props) => {
  return <s-box {...props} />;
};
