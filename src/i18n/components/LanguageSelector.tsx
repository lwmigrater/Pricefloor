import { useTranslation } from 'react-i18next';

export function LanguageSelector() {
  const { i18n, t } = useTranslation('common');

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  return (
    <s-select
      label={t('language.select')}
      labelAccessibilityVisibility="exclusive"
      value={i18n.language}
      onChange={(e: any) => changeLanguage(e.target.value)}
    >
      <s-option value="en">{t('language.english')}</s-option>
      <s-option value="tr">{t('language.turkish')}</s-option>
      <s-option value="es">{t('language.spanish')}</s-option>
      <s-option value="fr">{t('language.french')}</s-option>
      <s-option value="de">{t('language.german')}</s-option>
      <s-option value="pt">{t('language.portuguese')}</s-option>
      <s-option value="it">{t('language.italian')}</s-option>
      <s-option value="nl">{t('language.dutch')}</s-option>
      <s-option value="ja">{t('language.japanese')}</s-option>
      <s-option value="zh">{t('language.chinese')}</s-option>
      <s-option value="ko">{t('language.korean')}</s-option>
      <s-option value="pl">{t('language.polish')}</s-option>
      <s-option value="ar">{t('language.arabic')}</s-option>
    </s-select>
  );
}
