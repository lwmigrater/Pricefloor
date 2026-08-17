import React from "react";

export type MenuProps = React.JSX.IntrinsicElements['s-menu'];

export const Menu: React.FC<MenuProps> = (props) => {
  return <s-menu {...props} />;
};
