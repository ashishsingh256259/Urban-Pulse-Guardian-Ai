import { en, TranslationKey } from "./en";
import { hi } from "./hi";
import { pa } from "./pa";
import { Language } from "../types";

export const translations: Record<Language, Record<TranslationKey, string>> = {
  en,
  hi,
  pa
};

export type { TranslationKey };
