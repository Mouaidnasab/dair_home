import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import arTranslation from "./locales/ar/translation.json";
import enTranslation from "./locales/en/translation.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: enTranslation }, ar: { translation: arTranslation } },
    fallbackLng: "en",
    supportedLngs: ["en", "ar"],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
  });

export default i18n;
