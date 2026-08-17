import React from "react";
import { DonutChart as PolarisDonutChart } from "@shopify/polaris-viz";
import "@shopify/polaris-viz/build/esm/styles.css";
import { ClientOnly } from "../utils/ClientOnly";

export interface DonutChartDataPoint {
  key: string;
  value: number;
}

export interface DonutChartSeries {
  name: string;
  data: DonutChartDataPoint[];
  color?: string;
}

export interface DonutChartProps {
  data: DonutChartSeries[];
  showLegend?: boolean;
  legendPosition?: "left" | "right" | "bottom";
  theme?: "Light" | "Dark";
  comparisonMetric?: {
    metric: string;
    trend: "positive" | "negative" | "neutral";
    value: string;
  };
}

export const DonutChart: React.FC<DonutChartProps> = ({ data, ...rest }) => {
  // Polaris-viz DonutChart expects series format: each segment as a separate series
  // Transform our data format to polaris-viz format
  const transformedData = data.length > 0
    ? data[0].data.map(point => ({
      name: point.key,
      data: [{ key: point.key, value: point.value }],
    }))
    : [];

  return (
    <ClientOnly>
      {() => <PolarisDonutChart data={transformedData} {...(rest as any)} />}
    </ClientOnly>
  );
};
