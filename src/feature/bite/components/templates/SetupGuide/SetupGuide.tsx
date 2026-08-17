// @ts-nocheck
import React, { useState, useId } from "react";
import {
  BlockStack,
  Card,
  Text,
  InlineStack,
  ButtonGroup,
  Button,
  ProgressBar,
  Box,
  Collapsible,
  Tooltip,
  Spinner,
  Icon,
  Popover,
  ActionList,
  Image,
} from "@shopify/polaris";
import {
  MenuHorizontalIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CheckIcon,
  XIcon,
} from "@shopify/polaris-icons";
import styles from "./SetupGuide.module.css";

/**
 * Setup Guide Component
 *
 * IMPORTANT: This component requires @shopify/polaris and @shopify/polaris-icons.
 * Install with: npm install @shopify/polaris @shopify/polaris-icons
 *
 * A multi-step onboarding/setup wizard component with progress tracking,
 * expandable items, and completion states.
 *
 * Example usage:
 * ```tsx
 * import { SetupGuide } from "@/feature/bite/components/templates/SetupGuide/SetupGuide";
 *
 * const [items, setItems] = useState([
 *   {
 *     id: 0,
 *     title: "Add your first product",
 *     description: "Get started by adding products...",
 *     complete: false,
 *     primaryButton: {
 *       content: "Add product",
 *       props: { url: "/products/new" }
 *     }
 *   }
 * ]);
 *
 * <SetupGuide
 *   items={items}
 *   onDismiss={() => setShowGuide(false)}
 *   onStepComplete={async (id) => {
 *     // Update completion state
 *     setItems(prev => prev.map(item =>
 *       item.id === id ? { ...item, complete: !item.complete } : item
 *     ));
 *   }}
 * />
 * ```
 */

export interface SetupGuideItem {
  id: number;
  title: string;
  description: string;
  complete: boolean;
  image?: {
    url: string;
    alt?: string;
  };
  primaryButton?: {
    content: string;
    props: {
      url?: string;
      external?: boolean;
      onAction?: () => void;
    };
  };
  secondaryButton?: {
    content: string;
    props: {
      url?: string;
      external?: boolean;
      onAction?: () => void;
    };
  };
}

export interface SetupGuideProps {
  items: SetupGuideItem[];
  onDismiss: () => void;
  onStepComplete: (id: number) => Promise<void> | void;
}

interface SetupItemProps extends SetupGuideItem {
  expanded: boolean;
  setExpanded: () => void;
  onComplete: (id: number) => Promise<void> | void;
}

export const SetupGuide: React.FC<SetupGuideProps> = ({
  onDismiss,
  onStepComplete,
  items,
}) => {
  const [expanded, setExpanded] = useState<number>(
    items.find((item) => !item.complete)?.id ?? items[0]?.id ?? 0
  );
  const [isGuideOpen, setIsGuideOpen] = useState(true);
  const [popoverActive, setPopoverActive] = useState(false);
  const accessId = useId();
  const completedItemsLength = items.filter((item) => item.complete).length;

  return (
    <Card padding="0">
      <Box padding="400" paddingBlockEnd="400">
        <BlockStack>
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingMd">
              Setup Guide
            </Text>
            <ButtonGroup gap="tight" noWrap>
              <Popover
                active={popoverActive}
                onClose={() => setPopoverActive((prev) => !prev)}
                activator={
                  <Button
                    onClick={() => setPopoverActive((prev) => !prev)}
                    variant="tertiary"
                    icon={MenuHorizontalIcon}
                  />
                }
              >
                <ActionList
                  actionRole="menuitem"
                  items={[
                    {
                      content: "Dismiss",
                      onAction: onDismiss,
                      prefix: (
                        <div
                          style={{
                            height: "1rem",
                            width: "1rem",
                            paddingTop: ".05rem",
                          }}
                        >
                          <Icon tone="subdued" source={XIcon} />
                        </div>
                      ),
                    },
                  ]}
                />
              </Popover>

              <Button
                variant="tertiary"
                icon={isGuideOpen ? ChevronUpIcon : ChevronDownIcon}
                onClick={() => {
                  setIsGuideOpen((prev) => {
                    if (!prev)
                      setExpanded(items.find((item) => !item.complete)?.id ?? items[0]?.id ?? 0);
                    return !prev;
                  });
                }}
                ariaControls={accessId}
              />
            </ButtonGroup>
          </InlineStack>
          <Text as="p" variant="bodyMd">
            Use this personalized guide to get your app up and running.
          </Text>
          <div style={{ marginTop: ".8rem" }}>
            <InlineStack blockAlign="center" gap="200">
              {completedItemsLength === items.length ? (
                <div style={{ maxHeight: "1rem" }}>
                  <InlineStack wrap={false} gap="100">
                    <Icon
                      source={CheckIcon}
                      tone="subdued"
                      accessibilityLabel="Check icon to indicate completion of Setup Guide"
                    />
                    <Text as="p" variant="bodySm" tone="subdued">
                      Done
                    </Text>
                  </InlineStack>
                </div>
              ) : (
                <Text as="span" variant="bodySm">
                  {completedItemsLength} / {items.length} completed
                </Text>
              )}

              {completedItemsLength !== items.length ? (
                <div style={{ width: "100px" }}>
                  <ProgressBar
                    progress={
                      (items.filter((item) => item.complete).length /
                        items.length) *
                      100
                    }
                    size="small"
                    tone="primary"
                    animated
                  />
                </div>
              ) : null}
            </InlineStack>
          </div>
        </BlockStack>
      </Box>
      <Collapsible open={isGuideOpen} id={accessId}>
        <Box padding="200">
          <BlockStack gap="100">
            {items.map((item) => {
              return (
                <SetupItem
                  key={item.id}
                  expanded={expanded === item.id}
                  setExpanded={() => setExpanded(item.id)}
                  onComplete={onStepComplete}
                  {...item}
                />
              );
            })}
          </BlockStack>
        </Box>
      </Collapsible>
      {completedItemsLength === items.length ? (
        <Box
          background="bg-surface-secondary"
          borderBlockStartWidth="025"
          borderColor="border-secondary"
          padding="300"
        >
          <InlineStack align="end">
            <Button onClick={onDismiss}>Dismiss Guide</Button>
          </InlineStack>
        </Box>
      ) : null}
    </Card>
  );
};

const SetupItem: React.FC<SetupItemProps> = ({
  complete,
  onComplete,
  expanded,
  setExpanded,
  title,
  description,
  image,
  primaryButton,
  secondaryButton,
  id,
}) => {
  const [loading, setLoading] = useState(false);

  const completeItem = async () => {
    setLoading(true);
    await onComplete(id);
    setLoading(false);
  };

  return (
    <Box borderRadius="200" background={expanded ? "bg-surface-active" : undefined}>
      <div
        className={`${styles.setupItem} ${expanded ? styles.setupItemExpanded : ""
          }`}
      >
        <InlineStack gap="200" align="start" blockAlign="start" wrap={false}>
          <Tooltip
            content={complete ? "Mark as not done" : "Mark as done"}
            activatorWrapper="div"
          >
            <Button onClick={completeItem} variant="monochromePlain">
              <div className={styles.completeButton}>
                {loading ? (
                  <Spinner size="small" />
                ) : complete ? (
                  <CheckIcon
                    style={{
                      width: "1.25rem",
                      height: "1.25rem",
                      borderRadius: "100%",
                      background: "#303030",
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      fill: "white",
                    }}
                  />
                ) : (
                  outlineSvg
                )}
              </div>
            </Button>
          </Tooltip>
          <div
            className={styles.itemContent}
            onClick={expanded ? undefined : setExpanded}
            style={{
              cursor: expanded ? "default" : "pointer",
              paddingTop: ".15rem",
              width: "100%",
            }}
          >
            <BlockStack gap="300" id={id.toString()}>
              <Text as="h4" variant={expanded ? "headingSm" : "bodyMd"}>
                {title}
              </Text>
              <Collapsible open={expanded} id={id.toString()}>
                <Box paddingBlockEnd="150" paddingInlineEnd="150">
                  <BlockStack gap="400">
                    <Text as="p" variant="bodyMd">
                      {description}
                    </Text>
                    {primaryButton || secondaryButton ? (
                      <ButtonGroup gap="loose">
                        {primaryButton ? (
                          <Button variant="primary" {...primaryButton.props}>
                            {primaryButton.content}
                          </Button>
                        ) : null}
                        {secondaryButton ? (
                          <Button variant="tertiary" {...secondaryButton.props}>
                            {secondaryButton.content}
                          </Button>
                        ) : null}
                      </ButtonGroup>
                    ) : null}
                  </BlockStack>
                </Box>
              </Collapsible>
            </BlockStack>
            {image && expanded ? (
              <Image
                className={styles.itemImage}
                source={image.url}
                alt={image.alt}
                style={{ maxHeight: "7.75rem" }}
              />
            ) : null}
          </div>
        </InlineStack>
      </div>
    </Box>
  );
};

// SVG icon for uncompleted state
const outlineSvg = (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M10.5334 2.10692C11.0126 2.03643 11.5024 2 12 2C12.4976 2 12.9874 2.03643 13.4666 2.10692C14.013 2.18729 14.3908 2.6954 14.3104 3.2418C14.23 3.78821 13.7219 4.166 13.1755 4.08563C12.7924 4.02927 12.3999 4 12 4C11.6001 4 11.2076 4.02927 10.8245 4.08563C10.2781 4.166 9.76995 3.78821 9.68958 3.2418C9.6092 2.6954 9.987 2.18729 10.5334 2.10692ZM7.44122 4.17428C7.77056 4.61763 7.67814 5.24401 7.23479 5.57335C6.603 6.04267 6.04267 6.603 5.57335 7.23479C5.24401 7.67814 4.61763 7.77056 4.17428 7.44122C3.73094 7.11188 3.63852 6.4855 3.96785 6.04216C4.55386 5.25329 5.25329 4.55386 6.04216 3.96785C6.4855 3.63852 7.11188 3.73094 7.44122 4.17428ZM16.5588 4.17428C16.8881 3.73094 17.5145 3.63852 17.9578 3.96785C18.7467 4.55386 19.4461 5.25329 20.0321 6.04216C20.3615 6.4855 20.2691 7.11188 19.8257 7.44122C19.3824 7.77056 18.756 7.67814 18.4267 7.23479C17.9573 6.603 17.397 6.04267 16.7652 5.57335C16.3219 5.24401 16.2294 4.61763 16.5588 4.17428ZM3.2418 9.68958C3.78821 9.76995 4.166 10.2781 4.08563 10.8245C4.02927 11.2076 4 11.6001 4 12C4 12.3999 4.02927 12.7924 4.08563 13.1755C4.166 13.7219 3.78821 14.23 3.2418 14.3104C2.6954 14.3908 2.18729 14.013 2.10692 13.4666C2.03643 12.9874 2 12.4976 2 12C2 11.5024 2.03643 11.0126 2.10692 10.5334C2.18729 9.987 2.6954 9.6092 3.2418 9.68958ZM20.7582 9.68958C21.3046 9.6092 21.8127 9.987 21.8931 10.5334C21.9636 11.0126 22 11.5024 22 12C22 12.4976 21.9636 12.9874 21.8931 13.4666C21.8127 14.013 21.3046 14.3908 20.7582 14.3104C20.2118 14.23 19.834 13.7219 19.9144 13.1755C19.9707 12.7924 20 12.3999 20 12C20 11.6001 19.9707 11.2076 19.9144 10.8245C19.834 10.2781 20.2118 9.76995 20.7582 9.68958ZM4.17428 16.5588C4.61763 16.2294 5.24401 16.3219 5.57335 16.7652C6.04267 17.397 6.603 17.9573 7.23479 18.4267C7.67814 18.756 7.77056 19.3824 7.44122 19.8257C7.11188 20.2691 6.4855 20.3615 6.04216 20.0321C5.25329 19.4461 4.55386 18.7467 3.96785 17.9578C3.63852 17.5145 3.73094 16.8881 4.17428 16.5588ZM19.8257 16.5588C20.2691 16.8881 20.3615 17.5145 20.0321 17.9578C19.4461 18.7467 18.7467 19.4461 17.9578 20.0321C17.5145 20.3615 16.8881 20.2691 16.5588 19.8257C16.2294 19.3824 16.3219 18.756 16.7652 18.4267C17.397 17.9573 17.9573 17.397 18.4267 16.7652C18.756 16.3219 19.3824 16.2294 19.8257 16.5588ZM9.68958 20.7582C9.76995 20.2118 10.2781 19.834 10.8245 19.9144C11.2076 19.9707 11.6001 20 12 20C12.3999 20 12.7924 19.9707 13.1755 19.9144C13.7219 19.834 14.23 20.2118 14.3104 20.7582C14.3908 21.3046 14.013 21.8127 13.4666 21.8931C12.9874 21.9636 12.4976 22 12 22C11.5024 22 11.0126 21.9636 10.5334 21.8931C9.987 21.8127 9.6092 21.3046 9.68958 20.7582Z"
      fill="#8A8A8A"
    />
  </svg>
);
