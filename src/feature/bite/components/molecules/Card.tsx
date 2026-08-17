import React from "react";

export type CardProps = React.JSX.IntrinsicElements['s-section'] & { padding?: string };

export const Card: React.FC<CardProps> = (props) => {
  return <s-section {...props} />;
};
