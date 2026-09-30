import React from 'react';
import { Camera, Navigation, AlertTriangle, FileText, Sparkles, ChevronRight, LayoutDashboard, ShieldAlert } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface CitizenHomeProps {
  onNavigate: (tab: string) => void;
  reportsCount: number;
  userName: string;
}

export default function CitizenHome({ onNavigate, reportsCount, userName }: CitizenHomeProps) {
  const { t } = useLanguage();

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-blue-50 to-white dark:from-slate-900 dark:to-slate-950 rounded-3xl p-8 sm:p-10 text-slate-900 dark:text-white relative overflow-hidden shadow-xs border border-blue-200 dark:border-slate-700">
        <div className="absolute top-0 right-0 p-12 text-blue-600 dark:text-blue-400 opacity-5 pointer-events-none">
           <LayoutDashboard className="w-48 h-48 rotate-12" />
        </div>
        
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded-full text-xs font-bold font-mono border border-violet-200 dark:border-violet-800/50 mb-4">
            <Sparkles className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
            {t("home.aiCitizenNode")}
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-3 text-slate-900 dark:text-white">
            {t("home.welcomeTitle")}
          </h1>
          <p className="text-slate-900 dark:text-white text-sm sm:text-base mb-2 font-semibold">
            {t("home.welcomeSubtitle")}
          </p>
          <p className="text-slate-500 dark:text-slate-300 text-xs sm:text-sm max-w-xl leading-relaxed">
            {t("home.welcomeDescription")}
          </p>
        </div>
      </div>

      {/* Primary Actions Grid (Low-literacy friendly: Icon + Short Text) */}
      <div>
        <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-widest mb-4">
          {t("home.quickActions")}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          <button
            id="quick-action-report"
            onClick={() => onNavigate('infrastructure')}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 rounded-2xl shadow-xs hover:shadow-md hover:border-[#2563EB] transition-all text-left group flex flex-col items-start gap-4 cursor-pointer"
          >
            <div className="w-12 h-12 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm mb-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors flex items-center justify-between">
                📍 {t("home.reportIssueCardTitle")}
                <ChevronRight className="w-4 h-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-slate-900 dark:text-white" />
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-300 line-clamp-2">{t("home.reportIssueCardDesc")}</p>
            </div>
          </button>

          <button
            id="quick-action-scanner"
            onClick={() => onNavigate('road-scanner')}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 rounded-2xl shadow-xs hover:shadow-md hover:border-[#7C3AED] transition-all text-left group flex flex-col items-start gap-4 cursor-pointer"
          >
            <div className="w-12 h-12 bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 border border-violet-200 dark:border-violet-800/50 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform">
              <Camera className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm mb-1 group-hover:text-[#7C3AED] transition-colors flex items-center justify-between">
                📷 {t("home.roadScannerCardTitle")}
                <ChevronRight className="w-4 h-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-violet-600 dark:text-violet-400" />
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-300 line-clamp-2">{t("home.roadScannerCardDesc")}</p>
            </div>
          </button>

          <button
            id="quick-action-route"
            onClick={() => onNavigate('safe-route')}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 rounded-2xl shadow-xs hover:shadow-md hover:border-[#16A34A] transition-all text-left group flex flex-col items-start gap-4 cursor-pointer"
          >
            <div className="w-12 h-12 bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-800 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform">
              <Navigation className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm mb-1 group-hover:text-green-600 dark:text-green-400 transition-colors flex items-center justify-between">
                🧭 {t("home.safeRouteCardTitle")}
                <ChevronRight className="w-4 h-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-green-600 dark:text-green-400" />
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-300 line-clamp-2">{t("home.safeRouteCardDesc")}</p>
            </div>
          </button>

          <button
            id="quick-action-sos"
            onClick={() => onNavigate('emergency-sos')}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 rounded-2xl shadow-xs hover:shadow-md hover:border-[#DC2626] transition-all text-left group flex flex-col items-start gap-4 cursor-pointer"
          >
            <div className="w-12 h-12 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm mb-1 group-hover:text-red-600 dark:text-red-400 transition-colors flex items-center justify-between">
                ⚠️ {t("home.emergencySosCardTitle")}
                <ChevronRight className="w-4 h-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-red-600 dark:text-red-400" />
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-300 line-clamp-2">{t("home.emergencySosCardDesc")}</p>
            </div>
          </button>

        </div>
      </div>

      {/* Secondary Status Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-2">
        <div className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-xs flex items-center justify-between">
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-sm mb-1">📋 {t("home.myReportsCardTitle")}</h4>
            <p className="text-xs text-slate-500 dark:text-slate-300 mb-4">{t("home.myReportsCardDesc")}</p>
            {reportsCount > 0 ? (
              <span className="text-2xl font-black text-slate-900 dark:text-white">{reportsCount} {t("home.activeCount")}</span>
            ) : (
              <span className="text-sm font-medium text-slate-400 dark:text-slate-400">{t("home.noReports")}</span>
            )}
          </div>
          <button 
            id="view-all-reports-btn"
            onClick={() => onNavigate('my-reports')} 
            className="px-4 py-2 bg-zinc-50 dark:bg-slate-900 hover:bg-zinc-100 dark:hover:bg-slate-800 border border-zinc-200 dark:border-slate-700 text-zinc-800 dark:text-slate-200 text-xs font-bold rounded-xl transition-colors cursor-pointer"
          >
            {t("home.viewAll")}
          </button>
        </div>

        <div className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-xs flex flex-col justify-center">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-[#EFF6FF] dark:bg-blue-950/50 border border-[#DBEAFE] dark:border-blue-900 flex items-center justify-center text-[#2563EB] dark:text-blue-400 shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white text-sm mb-1">{t("home.roadRiskCardTitle")}</h4>
              <p className="text-xs text-slate-500 dark:text-zinc-300 mb-3">{t("home.roadRiskCardDesc")}</p>
              <button onClick={() => onNavigate('road-risk-intelligence')} className="text-xs font-bold text-[#2563EB] dark:text-blue-400 hover:text-[#1D4ED8] flex items-center gap-1 cursor-pointer">
                {t("home.exploreCorridors")} <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
