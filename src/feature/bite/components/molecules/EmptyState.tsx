import { EmptyState, LegacyCard } from "@shopify/polaris";
import React from "react";

interface EmptyStateProps {
  heading: string;
  image: string;
  action?: {
    content: string;
    onAction: () => void;
  };
  secondaryAction?: {
    content: string;
    onAction: () => void;
  };
  children?: React.ReactNode;
}

export function EmptyStateComponent({ heading, image, action, secondaryAction, children }: EmptyStateProps) {
  return (
    <LegacyCard sectioned>
      <EmptyState
        heading={heading}
        action={action}
        secondaryAction={secondaryAction}
        image={image}
      >
        {children}
      </EmptyState>
    </LegacyCard>
  );
}
