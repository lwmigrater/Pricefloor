import React from "react";
import { BarChart as PolarisBarChart } from "@shopify/polaris-viz";
import "@shopify/polaris-viz/build/esm/styles.css";

/**
 * BarChart Component
 *
 * Wrapper for Polaris Viz BarChart
 *
 * Example:
 * ```tsx
 * import { BarChart } from "@/feature/bite/components/charts/BarChart";
 *
 * <BarChart
 *   data={[
 *     {
 *       name: "Sales",
 *       data: [
 *         { key: "Monday", value: 100 },
 *         { key: "Tuesday", value: 150 },
 *       ]
 *     }
 *   ]}
 * />
 * ```
 */

export interface BarChartDataPoint {
  key: string;
  value: number;
}

export interface BarChartSeries {
  name: string;
  data: BarChartDataPoint[];
  color?: string;
}

export interface BarChartProps {
  data: BarChartSeries[];
  xAxisOptions?: {
    labelFormatter?: (value: string) => string;
  };
  yAxisOptions?: {
    labelFormatter?: (value: number) => string;
  };
  showLegend?: boolean;
  theme?: "Light" | "Dark";
}

export const BarChart: React.FC<BarChartProps> = (props) => {
  return <PolarisBarChart {...(props as any)} />;
};
