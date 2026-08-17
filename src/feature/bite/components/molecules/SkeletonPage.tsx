import {
  Page,
  Layout,
  SkeletonPage,
  SkeletonBodyText,
  SkeletonDisplayText,
  Card,
  TextContainer,
  Box,
} from "@shopify/polaris";

interface SkeletonProps {
  primaryAction?: boolean;
}

export function SkeletonPageLoading({ primaryAction = true }: SkeletonProps) {
  return (
    <SkeletonPage primaryAction={primaryAction}>
      <Layout>
        <Layout.Section>
          <Card>
            <Box padding="400">
              <TextContainer>
                <SkeletonDisplayText size="small" />
                <SkeletonBodyText />
              </TextContainer>
            </Box>
          </Card>
          <Card>
            <Box padding="400">
              <TextContainer>
                <SkeletonDisplayText size="small" />
                <SkeletonBodyText />
              </TextContainer>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </SkeletonPage>
  );
}
