import React from "react";
import { SimpleBarChart as PolarisSimpleBarChart } from "@shopify/polaris-viz";
import "@shopify/polaris-viz/build/esm/styles.css";

export interface SimpleBarChartDataPoint {
  key: string;
  value: number;
}

export interface SimpleBarChartSeries {
  data: SimpleBarChartDataPoint[];
}

export interface SimpleBarChartProps {
  data: SimpleBarChartSeries[];
  xAxisOptions?: {
    labelFormatter?: (value: string) => string;
  };
  yAxisOptions?: {
    labelFormatter?: (value: number) => string;
  };
  theme?: "Light" | "Dark";
}

export const SimpleBarChart: React.FC<SimpleBarChartProps> = (props) => {
  return <PolarisSimpleBarChart {...(props as any)} />;
};
