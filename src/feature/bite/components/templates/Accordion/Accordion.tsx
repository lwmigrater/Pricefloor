// @ts-nocheck
import React, { useState } from "react";
import styles from "./Accordion.module.css";

export interface AccordionItem {
  id: number | string;
  title: string;
  content: React.ReactNode;
}

export interface AccordionProps {
  items: AccordionItem[];
}

export const Accordion: React.FC<AccordionProps> = ({ items }) => {
  const [expandedId, setExpandedId] = useState<number | string | null>(null);

  const toggleItem = (id: number | string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <s-section>
      <s-stack gap="200" block-align="start">
        {items.map((item) => {
          const isExpanded = expandedId === item.id;
          return (
            <s-box key={item.id} className={styles.accordionItem}>
              <s-clickable onClick={() => toggleItem(item.id)}>
                <s-stack gap="200" inline-align="space-between">
                  <s-heading as="h3">{item.title}</s-heading>
                  <s-icon source={isExpanded ? "chevron-up" : "chevron-down"} />
                </s-stack>
              </s-clickable>
              <div
                className={styles.accordionContent}
                data-expanded={isExpanded}
              >
                <s-text>{item.content}</s-text>
              </div>
            </s-box>
          );
        })}
      </s-stack>
    </s-section>
  );
};
