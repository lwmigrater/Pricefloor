import React from "react";

export type PopoverProps = React.JSX.IntrinsicElements['s-popover'];

export const Popover: React.FC<PopoverProps> = (props) => {
  return <s-popover {...props} />;
};
