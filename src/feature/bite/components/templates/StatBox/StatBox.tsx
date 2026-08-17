import React from "react";
import { SparkLineChart } from "@shopify/polaris-viz";
import "@shopify/polaris-viz/build/esm/styles.css";
import { ClientOnly } from "../../utils";

/**
 * StatBox Component
 *
 * Displays a statistic with an optional sparkline chart showing trend data.
 *
 * IMPORTANT: This component requires @shopify/polaris-viz package.
 * Install with: npm install @shopify/polaris-viz
 *
 * The chart is automatically rendered client-side only to prevent SSR issues.
 *
 * Example usage:
 * ```tsx
 * import { StatBox } from "@/feature/bite/components/templates/StatBox/StatBox";
 *
 * <StatBox title="Sales" value="$1,234" data={[10, 20, 15, 30, 25]} />
 * ```
 */

export interface StatBoxProps {
  title: string;
  value: string | number;
  data?: number[];
}

export const StatBox: React.FC<StatBoxProps> = ({ title, value, data = [] }) => {
  // Calculate percentage change
  const calculatePercentageChange = () => {
    if (data.length < 2) return 0;
    const firstValue = data[0];
    const lastValue = data[data.length - 1];
    if (firstValue === 0) return 0;
    const change = ((lastValue - firstValue) / firstValue) * 100;
    return Math.min(Math.max(change, -999), 999); // Cap at ±999%
  };

  const percentageChange = calculatePercentageChange();
  const isPositive = percentageChange >= 0;

  const chartData = [
    {
      data: data.map((value, index) => ({
        key: index.toString(),
        value,
      })),
    },
  ];

  return (
    <s-section padding="none">
      <s-box paddingBlock="base" paddingInlineStart="base">
        <div
          style={{
            height: 65,
            position: 'relative',
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between'
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'end',
              minWidth: 30
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: -8,
                left: -2,
                zIndex: 20
              }}
            >
              <s-heading>
                {title}
              </s-heading>
            </div>
            <span style={{ fontWeight: 'bold', fontSize: '20px' }}>
              {value}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: -4 }}>
              {percentageChange ? (
                percentageChange > 0 ? (
                  <s-icon type="arrow-up" tone="success" size="small" />
                ) : (
                  <s-icon type="arrow-down" tone="critical" size="small" />
                )
              ) : null}
              <s-text color="subdued">
                <span
                  style={
                    percentageChange
                      ? {
                        color: percentageChange > 0 ? 'green' : 'red'
                      }
                      : undefined
                  }
                >
                  {Math.abs(percentageChange).toFixed(1) || '-'}%
                </span>
              </s-text>
            </div>
          </div>
          <ClientOnly>
            {() => (
              <div style={{ flex: 1, width: '50%', height: '80%', alignSelf: 'end' }}>
                <SparkLineChart offsetLeft={4} offsetRight={0} data={chartData} />
              </div>
            )}
          </ClientOnly>
        </div>
      </s-box>
    </s-section>
  );
};
