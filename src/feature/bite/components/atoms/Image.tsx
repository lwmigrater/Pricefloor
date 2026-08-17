import React from "react";

export interface ImageProps extends React.HTMLAttributes<HTMLElement> {
  source?: string;
  alt?: string;
  [key: string]: any;
}

export const Image: React.FC<ImageProps> = (props) => {
  return <s-image {...(props as any)} />;
};
