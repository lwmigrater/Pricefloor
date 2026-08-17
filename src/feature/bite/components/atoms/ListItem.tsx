import React from "react";

export interface ListItemProps extends React.HTMLAttributes<HTMLElement> {
  [key: string]: any;
}

export const ListItem: React.FC<ListItemProps> = (props) => {
  return <s-list-item {...(props as any)} />;
};
