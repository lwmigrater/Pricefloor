import React from "react";

export type OrderedListProps = React.JSX.IntrinsicElements['s-ordered-list'];

export const OrderedList: React.FC<OrderedListProps> = (props) => {
  return <s-ordered-list {...props} />;
};
