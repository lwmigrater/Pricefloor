import React from "react";
import { LineChart as PolarisLineChart } from "@shopify/polaris-viz";
import "@shopify/polaris-viz/build/esm/styles.css";
import { ClientOnly } from "../utils/ClientOnly";

export interface LineChartDataPoint {
  key: string;
  value: number;
}

export interface LineChartSeries {
  name: string;
  data: LineChartDataPoint[];
  color?: string;
}

export interface LineChartProps {
  data: LineChartSeries[];
  xAxisOptions?: {
    labelFormatter?: (value: string) => string;
  };
  yAxisOptions?: {
    labelFormatter?: (value: number) => string;
  };
  showLegend?: boolean;
  theme?: "Light" | "Dark";
}

export const LineChart: React.FC<LineChartProps> = (props) => {
  return (
    <ClientOnly>
      {() => <PolarisLineChart {...(props as any)} />}
    </ClientOnly>
  );
};
