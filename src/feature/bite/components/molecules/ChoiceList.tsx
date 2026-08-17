import React from "react";

export type ChoiceListProps = React.JSX.IntrinsicElements['s-choice-list'];

export const ChoiceList: React.FC<ChoiceListProps> = (props) => {
  return <s-choice-list {...props} />;
};
