import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Page,
  Card,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  ProgressBar,
  InlineStack,
  Text,
  Divider,
} from '@shopify/polaris';
import { ArrowLeftIcon } from '@shopify/polaris-icons';

interface Step {
  title: string;
  description: string;
  renderContent: () => React.ReactNode;
  canProceed?: boolean;
  hero?: React.ReactNode;
}

interface OnboardingWizardProps {
  steps: Step[];
  onComplete: () => void;
  title?: string;
}

export function OnboardingWizard({ steps, onComplete }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const { t } = useTranslation('common');

  const step = steps[currentStep];
  const canProceed = step.canProceed ?? true;
  const isLast = currentStep === steps.length - 1;
  const isFirst = currentStep === 0;
  const progress = ((currentStep + 1) / steps.length) * 100;

  const handleNext = () => {
    if (!canProceed) return;
    if (!isLast) setCurrentStep(currentStep + 1);
    else onComplete();
  };

  const handleBack = () => {
    if (!isFirst) setCurrentStep(currentStep - 1);
  };

  return (
    <Page>
      <BlockStack gap="500">
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="span" variant="bodySm" tone="subdued">
              {t('actions.step', { defaultValue: 'Step' })} {currentStep + 1} /{' '}
              {steps.length}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {Math.round(progress)}%
            </Text>
          </InlineStack>
          <ProgressBar progress={progress} size="small" tone="primary" />
        </BlockStack>

        <Card>
          <BlockStack gap="500">
            {step.hero && (
              <Box paddingBlockStart="200">
                <InlineStack align="center">{step.hero}</InlineStack>
              </Box>
            )}

            <BlockStack gap="200">
              <Text
                as="h1"
                variant="heading2xl"
                alignment={step.hero ? 'center' : 'start'}
              >
                {step.title}
              </Text>
              <Text
                as="p"
                variant="bodyLg"
                tone="subdued"
                alignment={step.hero ? 'center' : 'start'}
              >
                {step.description}
              </Text>
            </BlockStack>

            <Box paddingBlockStart="200">{step.renderContent()}</Box>

            <Divider />

            <InlineStack align="space-between" blockAlign="center">
              <Text as="span" tone="subdued" variant="bodySm">
                {t('actions.step', { defaultValue: 'Step' })} {currentStep + 1}{' '}
                {t('common.of', { defaultValue: 'of' })} {steps.length}
              </Text>
              <ButtonGroup>
                <Button
                  disabled={isFirst}
                  onClick={handleBack}
                  icon={ArrowLeftIcon}
                >
                  {t('actions.back', { defaultValue: 'Back' })}
                </Button>
                <Button
                  variant="primary"
                  size="large"
                  disabled={!canProceed}
                  onClick={handleNext}
                >
                  {isLast
                    ? t('actions.finish', { defaultValue: 'Get started' })
                    : t('actions.next', { defaultValue: 'Continue' })}
                </Button>
              </ButtonGroup>
            </InlineStack>
          </BlockStack>
        </Card>

        <Box>
          <Text as="p" variant="bodySm" tone="subdued" alignment="center">
            {t('onboarding.footer_hint', {
              defaultValue: 'You can change all of these later from Settings.',
            })}
          </Text>
        </Box>
      </BlockStack>
    </Page>
  );
}
