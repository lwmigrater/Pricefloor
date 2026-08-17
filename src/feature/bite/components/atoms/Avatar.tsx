import React from "react";

export interface AvatarProps extends React.HTMLAttributes<HTMLElement> {
  [key: string]: any;
}

export const Avatar: React.FC<AvatarProps> = (props) => {
  return <s-avatar {...(props as any)} />;
};
