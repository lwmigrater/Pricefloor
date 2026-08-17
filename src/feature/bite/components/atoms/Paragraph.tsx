import React from "react";

export interface ParagraphProps extends React.HTMLAttributes<HTMLElement> {
  [key: string]: any;
}

export const Paragraph: React.FC<ParagraphProps> = (props) => {
  return <s-paragraph {...(props as any)} />;
};
