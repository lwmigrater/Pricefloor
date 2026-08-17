// @ts-nocheck
import React from "react";

export interface ActionCardProps {
  title: string;
  description: string;
  primaryAction?: {
    content: string;
    onAction: () => void;
  };
  menuActions?: Array<{
    content: string;
    onAction: () => void;
  }>;
}

export const ActionCard: React.FC<ActionCardProps> = ({
  title,
  description,
  primaryAction,
  menuActions = [],
}) => {
  return (
    <s-section>
      <s-stack gap="400" block-align="start">
        <s-stack gap="200" block-align="start">
          <s-heading as="h3">{title}</s-heading>
          <s-paragraph>{description}</s-paragraph>
        </s-stack>
        <s-stack gap="200" inline-align="start">
          {primaryAction && (
            <s-button variant="primary" onClick={primaryAction.onAction}>
              {primaryAction.content}
            </s-button>
          )}
          {menuActions.length > 0 && (
            <>
              <s-button id="action-card-menu">More actions</s-button>
              <s-menu command-for="action-card-menu">
                {menuActions.map((action, index) => (
                  <s-button key={index} onClick={action.onAction}>
                    {action.content}
                  </s-button>
                ))}
              </s-menu>
            </>
          )}
        </s-stack>
      </s-stack>
    </s-section>
  );
};
