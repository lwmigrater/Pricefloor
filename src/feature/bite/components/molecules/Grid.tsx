import React from "react";

export type GridProps = React.JSX.IntrinsicElements['s-grid'];

export const Grid: React.FC<GridProps> = (props) => {
  return <s-grid {...props} />;
};
