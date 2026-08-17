import React from "react";

export type UnorderedListProps = React.JSX.IntrinsicElements['s-unordered-list'];

export const UnorderedList: React.FC<UnorderedListProps> = (props) => {
  return <s-unordered-list {...props} />;
};
