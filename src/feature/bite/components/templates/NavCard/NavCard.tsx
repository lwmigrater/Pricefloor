// @ts-nocheck
import React from "react";

export interface NavCardProps {
  title: string;
  description: string;
  icon?: string;
  onClick: () => void;
}

export const NavCard: React.FC<NavCardProps> = ({
  title,
  description,
  icon,
  onClick,
}) => {
  return (
    <s-clickable onClick={onClick}>
      <s-section>
        <s-stack gap="200" inline-align="space-between">
          <s-stack gap="200" block-align="start">
            {icon && <s-icon source={icon} />}
            <s-stack gap="100" block-align="start">
              <s-text variant="headingMd" as="h3">
                {title}
              </s-text>
              <s-text tone="subdued">{description}</s-text>
            </s-stack>
          </s-stack>
          <s-icon source="chevron-right" />
        </s-stack>
      </s-section>
    </s-clickable>
  );
};
