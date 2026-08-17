// @ts-nocheck
import React from "react";
import styles from "./Timeline.module.css";

type TimelineTone = "critical" | "caution" | "success" | "base";

export interface TimelineItem {
  timestamp: Date;
  timelineEvent: string;
  tone?: TimelineTone;
  icon?: React.ReactNode;
  url?: string;
}

export interface TimelineProps {
  items: TimelineItem[];
}

const getIconForTone = (tone?: TimelineTone): string => {
  switch (tone) {
    case "critical":
    case "caution":
      return "alert-circle";
    case "success":
      return "check-circle";
    default:
      return "circle";
  }
};

const formatTime = (date: Date): string => {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

const formatDate = (date: Date): string => {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
};

const groupByDate = (items: TimelineItem[]) => {
  const groups: { [key: string]: TimelineItem[] } = {};

  items.forEach((item) => {
    const dateKey = formatDate(item.timestamp);
    if (!groups[dateKey]) {
      groups[dateKey] = [];
    }
    groups[dateKey].push(item);
  });

  return groups;
};

export const Timeline: React.FC<TimelineProps> = ({ items }) => {
  const groupedItems = groupByDate(items);

  return (
    <s-box className={styles.timeline}>
      <s-stack gap="600" block-align="start">
        {Object.entries(groupedItems).map(([date, dateItems]) => (
          <s-stack key={date} gap="400" block-align="start">
            <s-text variant="headingSm" tone="subdued">
              {date}
            </s-text>
            <s-stack gap="300" block-align="start">
              {dateItems.map((item, index) => (
                <s-grid key={index} columns="auto 1fr" className={styles.timelineItem}>
                  <s-stack gap="100" block-align="center">
                    <s-text tone="subdued" variant="bodySm">
                      {formatTime(item.timestamp)}
                    </s-text>
                  </s-stack>
                  <s-stack gap="100" inline-align="start">
                    {item.url ? (
                      <s-link href={item.url}>
                        <s-stack gap="100" inline-align="start">
                          <s-icon
                            source={item.icon as string || getIconForTone(item.tone)}
                            tone={item.tone}
                          />
                          <s-text>{item.timelineEvent}</s-text>
                          <s-icon source="chevron-right" />
                        </s-stack>
                      </s-link>
                    ) : (
                      <s-stack gap="100" inline-align="start">
                        <s-icon
                          source={item.icon as string || getIconForTone(item.tone)}
                          tone={item.tone}
                        />
                        <s-text>{item.timelineEvent}</s-text>
                      </s-stack>
                    )}
                  </s-stack>
                </s-grid>
              ))}
            </s-stack>
          </s-stack>
        ))}
      </s-stack>
    </s-box>
  );
};
