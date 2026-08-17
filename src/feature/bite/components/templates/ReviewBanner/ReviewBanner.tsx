// @ts-nocheck
import React, { useState } from "react";
import styles from "./ReviewBanner.module.css";

export interface ReviewBannerProps {
  title: string;
  description: string;
  onReview: (rating: number) => void;
  onClose: () => void;
}

export const ReviewBanner: React.FC<ReviewBannerProps> = ({
  title,
  description,
  onReview,
  onClose,
}) => {
  const [hoveredStar, setHoveredStar] = useState<number | null>(null);
  const [selectedStar, setSelectedStar] = useState<number | null>(null);

  const handleStarClick = (rating: number) => {
    setSelectedStar(rating);
    onReview(rating);
  };

  return (
    <s-section>
      <s-stack gap="400" block-align="start">
        <s-stack gap="200" inline-align="space-between">
          <s-stack gap="200" block-align="start">
            <s-heading as="h3">{title}</s-heading>
            <s-paragraph>{description}</s-paragraph>
          </s-stack>
          <s-button variant="plain" onClick={onClose}>
            <s-icon source="x-small" />
          </s-button>
        </s-stack>
        <div className={styles.stars}>
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              className={styles.star}
              data-filled={
                selectedStar
                  ? star <= selectedStar
                  : hoveredStar
                  ? star <= hoveredStar
                  : false
              }
              onClick={() => handleStarClick(star)}
              onMouseEnter={() => setHoveredStar(star)}
              onMouseLeave={() => setHoveredStar(null)}
              aria-label={`Rate ${star} stars`}
            >
              ★
            </button>
          ))}
        </div>
      </s-stack>
    </s-section>
  );
};
