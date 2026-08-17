import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translation files
import enCommon from './locales/en/common.json';
import enPages from './locales/en/pages.json';
import trCommon from './locales/tr/common.json';
import trPages from './locales/tr/pages.json';
import esCommon from './locales/es/common.json';
import esPages from './locales/es/pages.json';
import frCommon from './locales/fr/common.json';
import frPages from './locales/fr/pages.json';
import deCommon from './locales/de/common.json';
import dePages from './locales/de/pages.json';
import ptCommon from './locales/pt/common.json';
import ptPages from './locales/pt/pages.json';
import itCommon from './locales/it/common.json';
import itPages from './locales/it/pages.json';
import nlCommon from './locales/nl/common.json';
import nlPages from './locales/nl/pages.json';
import jaCommon from './locales/ja/common.json';
import jaPages from './locales/ja/pages.json';
import zhCommon from './locales/zh/common.json';
import zhPages from './locales/zh/pages.json';
import koCommon from './locales/ko/common.json';
import koPages from './locales/ko/pages.json';
import plCommon from './locales/pl/common.json';
import plPages from './locales/pl/pages.json';
import arCommon from './locales/ar/common.json';
import arPages from './locales/ar/pages.json';

const resources = {
  en: { common: enCommon, pages: enPages },
  tr: { common: trCommon, pages: trPages },
  es: { common: esCommon, pages: esPages },
  fr: { common: frCommon, pages: frPages },
  de: { common: deCommon, pages: dePages },
  pt: { common: ptCommon, pages: ptPages },
  it: { common: itCommon, pages: itPages },
  nl: { common: nlCommon, pages: nlPages },
  ja: { common: jaCommon, pages: jaPages },
  zh: { common: zhCommon, pages: zhPages },
  ko: { common: koCommon, pages: koPages },
  pl: { common: plCommon, pages: plPages },
  ar: { common: arCommon, pages: arPages },
};

i18n
  .use(LanguageDetector) // Detect user language
  .use(initReactI18next) // Pass i18n instance to react-i18next
  .init({
    resources,
    fallbackLng: 'en', // Fallback language
    supportedLngs: ['en', 'tr', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'ja', 'zh', 'ko', 'pl', 'ar'],
    load: 'languageOnly', // Transformation: en-US -> en
    defaultNS: 'common', // Default namespace
    ns: ['common', 'pages'], // Available namespaces

    interpolation: {
      escapeValue: false, // React already escapes values
    },

    detection: {
      // Order of language detection
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'], // Cache user language preference
    },
  });

export default i18n;
