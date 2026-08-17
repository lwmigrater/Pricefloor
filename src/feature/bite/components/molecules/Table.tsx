import React from "react";

export type TableProps = React.JSX.IntrinsicElements['s-table'];

export const Table: React.FC<TableProps> = (props) => {
  return <s-table {...props} />;
};
