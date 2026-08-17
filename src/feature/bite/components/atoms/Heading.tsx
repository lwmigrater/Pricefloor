import React from "react";

export interface HeadingProps extends React.HTMLAttributes<HTMLElement> {
  as?: string;
  level?: string | number;
  [key: string]: any;
}

export const Heading: React.FC<HeadingProps> = (props) => {
  return <s-heading {...(props as any)} />;
};
