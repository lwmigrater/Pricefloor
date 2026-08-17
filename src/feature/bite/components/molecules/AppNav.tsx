import React from "react";

export type AppNavProps = React.JSX.IntrinsicElements['s-app-nav'];

export const AppNav: React.FC<AppNavProps> = (props) => {
  return <s-app-nav {...props} />;
};
