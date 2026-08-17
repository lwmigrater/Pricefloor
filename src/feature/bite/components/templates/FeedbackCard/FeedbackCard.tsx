import React from "react";

export interface FeedbackCardProps {
  title: string;
  description: string;
  onPositive: () => void;
  onNegative: () => void;
  onClose: () => void;
}

export const FeedbackCard: React.FC<FeedbackCardProps> = ({
  title,
  description,
  onPositive,
  onNegative,
  onClose,
}) => {
  return (
    <s-section>
      <s-stack {...({ gap: "400", "block-align": "start" } as any)}>
        <s-stack {...({ gap: "200", "inline-align": "space-between" } as any)}>
          <s-stack {...({ gap: "200", "block-align": "start" } as any)}>
            <s-heading {...({ as: "h3" } as any)}>{title}</s-heading>
            <s-paragraph>{description}</s-paragraph>
          </s-stack>
          <s-button {...({ variant: "plain" } as any)} onClick={onClose}>
            <s-icon {...({ source: "x-small" } as any)} />
          </s-button>
        </s-stack>
        <s-box>
          <s-button-group {...({ variant: "segmented" } as any)}>
            <s-button onClick={onPositive}>
              <s-icon {...({ source: "thumbs-up" } as any)} />
            </s-button>
            <s-button onClick={onNegative}>
              <s-icon {...({ source: "thumbs-down" } as any)} />
            </s-button>
          </s-button-group>
        </s-box>
      </s-stack>
    </s-section>
  );
};
