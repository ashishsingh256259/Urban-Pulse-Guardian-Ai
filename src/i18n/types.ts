export type Language = "en" | "hi" | "pa";

export interface LanguageInfo {
  code: Language;
  name: string;
  nativeName: string;
  /** BCP-47 locale tag for future Web Speech / Speech-to-Text integration (e.g., 'hi-IN', 'pa-IN') */
  speechCode: string;
  direction: "ltr";
}

export const SUPPORTED_LANGUAGES: Record<Language, LanguageInfo> = {
  en: {
    code: "en",
    name: "English",
    nativeName: "English",
    speechCode: "en-IN",
    direction: "ltr"
  },
  hi: {
    code: "hi",
    name: "Hindi",
    nativeName: "हिन्दी",
    speechCode: "hi-IN",
    direction: "ltr"
  },
  pa: {
    code: "pa",
    name: "Punjabi",
    nativeName: "ਪੰਜਾਬੀ",
    speechCode: "pa-IN",
    direction: "ltr"
  }
};
