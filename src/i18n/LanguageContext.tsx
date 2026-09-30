import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from "react";
import { Language, LanguageInfo, SUPPORTED_LANGUAGES } from "./types";
import { translations, TranslationKey } from "./translations";

const STORAGE_KEY = "urbanpulse_language";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  /** Translation function with automatic English fallback */
  t: (key: TranslationKey | string, fallback?: string) => string;
  languages: LanguageInfo[];
  currentLanguageInfo: LanguageInfo;
  /** BCP-47 locale tag ready for future Speech-to-Text / Web Speech API */
  speechLocale: string;
  /** Translate UI display of incident status while keeping Firestore backend values untouched */
  tStatus: (status: string) => string;
  /** Translate UI display of category while keeping Firestore backend values untouched */
  tCategory: (category: string) => string;
  /** Translate UI display of risk level */
  tRiskLevel: (risk: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY) as Language;
      if (saved && (saved === "en" || saved === "hi" || saved === "pa")) {
        return saved;
      }
    }
    return "en";
  });

  const setLanguage = (newLang: Language) => {
    if (newLang === "en" || newLang === "hi" || newLang === "pa") {
      setLanguageState(newLang);
      try {
        localStorage.setItem(STORAGE_KEY, newLang);
      } catch (err) {
        console.warn("[i18n] Failed to persist language to localStorage:", err);
      }
    }
  };

  const currentLanguageInfo = useMemo(() => {
    return SUPPORTED_LANGUAGES[language] || SUPPORTED_LANGUAGES.en;
  }, [language]);

  const languages = useMemo(() => {
    return Object.values(SUPPORTED_LANGUAGES);
  }, []);

  const t = useMemo(() => {
    return (key: TranslationKey | string, fallback?: string): string => {
      const activeDict = translations[language] || translations.en;
      if (activeDict && key in activeDict && (activeDict as any)[key]) {
        return (activeDict as any)[key];
      }
      // Strict Fallback to English dictionary (Requirement #10)
      const enDict = translations.en;
      if (enDict && key in enDict && (enDict as any)[key]) {
        return (enDict as any)[key];
      }
      return fallback || key;
    };
  }, [language]);

  // Status translator for UI presentation (keeps backend values "Pending", "Assigned", etc. pure)
  const tStatus = useMemo(() => {
    return (status: string): string => {
      const normalized = (status || "").toLowerCase().trim();
      if (normalized === "pending") return t("status.pending");
      if (normalized === "assigned") return t("status.assigned");
      if (normalized === "in progress" || normalized === "in_progress") return t("status.inProgress");
      if (normalized === "resolved") return t("status.resolved");
      if (normalized === "active") return t("status.active");
      if (normalized === "all") return t("status.all");
      return status;
    };
  }, [t]);

  // Category translator for UI presentation (keeps backend Firestore enums pure)
  const tCategory = useMemo(() => {
    return (category: string): string => {
      const normalized = (category || "").toLowerCase().trim();
      if (normalized.includes("pothole")) return t("category.pothole");
      if (normalized.includes("streetlight") || normalized.includes("light")) return t("category.streetlight");
      if (normalized.includes("garbage") || normalized.includes("waste")) return t("category.garbage");
      if (normalized.includes("water") || normalized.includes("flood")) return t("category.waterLogging");
      if (normalized.includes("pipe")) return t("category.brokenPipe");
      if (normalized.includes("traffic") || normalized.includes("signal")) return t("category.trafficSignal");
      if (normalized.includes("hazard")) return t("category.roadHazards");
      if (normalized.includes("other")) return t("category.other");
      return category;
    };
  }, [t]);

  // Risk level translator
  const tRiskLevel = useMemo(() => {
    return (risk: string): string => {
      const normalized = (risk || "").toLowerCase().trim();
      if (normalized === "low") return t("risk.low");
      if (normalized === "medium") return t("risk.medium");
      if (normalized === "high") return t("risk.high");
      if (normalized === "critical") return t("risk.critical");
      return risk;
    };
  }, [t]);

  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage,
        t,
        languages,
        currentLanguageInfo,
        speechLocale: currentLanguageInfo.speechCode,
        tStatus,
        tCategory,
        tRiskLevel
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
