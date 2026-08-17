import React from "react";

export type ModalProps = React.JSX.IntrinsicElements['s-modal'];

export const Modal: React.FC<ModalProps> = (props) => {
  return <s-modal {...props} />;
};
