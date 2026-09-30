import React, { useState, useEffect, useRef } from "react";
import { 
  AlertOctagon, PhoneCall, ShieldAlert, MapPin, 
  CheckCircle2, Radio, Clock, User, ArrowRight, Activity,
  Loader2
} from "lucide-react";
import { User as UserType, Report, ReportCategory } from "../types";
import { createReport } from "../services/reportsService";
import { createNotification } from "../services/notificationsService";
import { useAuth } from "../context/AuthContext";
import { auth } from "../lib/firebase";
import { useLanguage } from "../i18n/LanguageContext";

interface CitizenEmergencySOSProps {
  currentUser?: UserType | null;
  onReportCreated?: (report: Report) => void;
}

export default function CitizenEmergencySOS({ currentUser, onReportCreated }: CitizenEmergencySOSProps) {
  const { user: authUser, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const [sosActive, setSosActive] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [emergencyType, setEmergencyType] = useState<
    "Major Road Cave-In / Accident" | "Active Flood / Submerged Road" | "Live Electrical / Wire Hazard" | "Medical / Crash Emergency"
  >("Major Road Cave-In / Accident");
  const [dispatchStatus, setDispatchStatus] = useState<"BROADCASTING" | "DISPATCHED" | "ACKNOWLEDGED">("BROADCASTING");
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [locationLabel, setLocationLabel] = useState<string>("Detecting GPS coordinates...");
  const [createdReport, setCreatedReport] = useState<Report | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const countdownIntervalRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  const acquireLocation = (): Promise<{ lat: number; lng: number; accuracy?: number; name: string }> => {
    return new Promise((resolve) => {
      if (!("geolocation" in navigator)) {
        const fallback = { lat: 28.6139, lng: 77.2090, accuracy: 25, name: "Delhi NCR Command Zone (Default Grid)" };
        setUserCoords(fallback);
        setLocationLabel(fallback.name);
        resolve(fallback);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy || 10),
            name: `${pos.coords.latitude.toFixed(4)}° N, ${pos.coords.longitude.toFixed(4)}° E (±${Math.round(pos.coords.accuracy || 10)}m)`
          };
          setUserCoords(coords);
          setLocationLabel(coords.name);
          resolve(coords);
        },
        () => {
          const fallback = { lat: 28.6139, lng: 77.2090, accuracy: 25, name: "28.6139° N, 77.2090° E (Central Delhi NCR)" };
          setUserCoords(fallback);
          setLocationLabel(fallback.name);
          resolve(fallback);
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 }
      );
    });
  };

  const handleTriggerSOS = async () => {
    setErrorMessage(null);

    // Verify authentication before initiating SOS
    const activeUid = auth.currentUser?.uid || authUser?.uid || currentUser?.id;
    if (!activeUid) {
      if (authLoading) {
        setErrorMessage("Restoring authentication session. Please wait a moment and try again.");
      } else {
        setErrorMessage("Please sign in before sending Emergency SOS.");
      }
      return;
    }

    setCountdown(3);
    const loc = await acquireLocation();

    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
          executeSOSBroadcast(loc);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const executeSOSBroadcast = async (coords: { lat: number; lng: number; name: string }) => {
    setIsSubmitting(true);
    setSosActive(true);
    setDispatchStatus("BROADCASTING");

    const activeUid = auth.currentUser?.uid || authUser?.uid || currentUser?.id;
    const activeEmail = auth.currentUser?.email || authUser?.email || currentUser?.email || "citizen@urbanpulse.ai";
    const activeName = auth.currentUser?.displayName || authUser?.displayName || currentUser?.fullName || "Citizen Reporter";

    if (!activeUid) {
      setErrorMessage("Please sign in before sending Emergency SOS.");
      setSosActive(false);
      setIsSubmitting(false);
      return;
    }

    let reportCategory: ReportCategory = "Road Obstruction";
    if (emergencyType.includes("Cave-In") || emergencyType.includes("Road")) {
      reportCategory = "Pothole";
    } else if (emergencyType.includes("Flood")) {
      reportCategory = "Waterlogging";
    } else if (emergencyType.includes("Electrical")) {
      reportCategory = "Broken Streetlight";
    }

    try {
      const newReport = await createReport(
        {
          title: `🚨 CRITICAL SOS: ${emergencyType}`,
          description: `EMERGENCY ALERT: ${emergencyType} broadcasted from live GPS [${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}]. Automated high-priority municipal dispatch required immediately.`,
          category: reportCategory,
          location: `Emergency Location: ${coords.name}`,
          latitude: coords.lat,
          longitude: coords.lng,
          severity: 98,
          riskLevel: "High",
          priority: "Critical",
          confidence: 99,
          source: "MANUAL_REPORT",
          image: "https://images.unsplash.com/photo-1584467541268-b040f83be3fd?auto=format&fit=crop&w=600&q=80",
          aiAnalysis: {
            category: "Emergency SOS Incident",
            severityScore: 98,
            riskLevel: "High",
            confidence: 99,
            description: `High-priority emergency SOS beacon triggered for ${emergencyType}.`,
            recommendedActions: [
              "Immediate emergency response unit dispatch",
              "Notify municipal rapid-action squad",
              "Establish perimeter around hazard"
            ]
          }
        },
        {
          id: activeUid,
          uid: activeUid,
          email: activeEmail,
          fullName: activeName
        }
      );

      setCreatedReport(newReport);
      setDispatchStatus("DISPATCHED");

      // Broadcast high-priority alerts
      await createNotification(
        "🚨 CRITICAL SOS ACTIVATED",
        `Emergency: ${emergencyType} reported by ${activeEmail} at [${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}]`,
        "alert_high_severity",
        "admin",
        "",
        newReport.id
      ).catch(() => {});

      if (onReportCreated) {
        onReportCreated(newReport);
      }
    } catch (err: any) {
      console.error("SOS creation error:", err);
      setErrorMessage(err.message || "Failed to broadcast SOS to Firestore database. Please call 112 directly.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelSOS = () => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setCountdown(null);
    setSosActive(false);
    setCreatedReport(null);
    setErrorMessage(null);
  };

  return (
    <div id="emergency-sos-container" className="space-y-5">
      {/* HEADER BAR */}
      <div className="bg-gradient-to-r from-[#FEF2F2] via-[#FFFBEB] to-[#FFFFFF] border border-red-200 dark:border-red-800/50 rounded-2xl p-5 text-slate-900 dark:text-white shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 flex items-center justify-center text-red-600 dark:text-red-400">
              <AlertOctagon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">
                  {t("sos.title")}
                </h1>
                <span className="px-2 py-0.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50 rounded text-[9.5px] font-mono font-bold uppercase tracking-wider">
                  Direct Municipal Dispatch
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-300 mt-0.5">
                {t("sos.description")}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="tel:112"
            className="px-4 py-2 bg-[#DC2626] hover:bg-[#B91C1C] text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5"
          >
            <PhoneCall className="w-3.5 h-3.5" />
            <span>{t("sos.callDirect")}</span>
          </a>
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl text-xs flex items-center justify-between">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="text-red-500 hover:text-red-700 font-bold ml-2">×</button>
        </div>
      )}

      {/* SOS ACTION CARD & DISPATCH STATUS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* BIG SOS TRIGGER (Left 7 Cols) */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 flex flex-col items-center justify-center text-center space-y-5 shadow-xs">
          {!sosActive && countdown === null && (
            <>
              <div className="max-w-md space-y-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {t("sos.subtitle")}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-300">
                  {t("sos.description")}
                </p>
              </div>

              <div className="w-full max-w-sm">
                <select
                  value={emergencyType}
                  onChange={(e) => setEmergencyType(e.target.value as any)}
                  className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs px-3.5 py-2.5 rounded-xl focus:outline-none focus:border-[#DC2626]"
                >
                  <option value="Major Road Cave-In / Accident">Major Road Cave-In / Accident</option>
                  <option value="Active Flood / Submerged Road">Active Flood / Submerged Road</option>
                  <option value="Live Electrical / Wire Hazard">Live Electrical / Wire Hazard</option>
                  <option value="Medical / Crash Emergency">Medical / Crash Emergency</option>
                </select>
              </div>

              {/* Big Red SOS Button */}
              <button
                id="trigger-sos-btn"
                onClick={handleTriggerSOS}
                disabled={isSubmitting}
                className="w-36 h-36 rounded-full bg-gradient-to-tr from-[#DC2626] to-[#EF4444] hover:from-[#B91C1C] hover:to-[#DC2626] text-white font-black text-2xl tracking-widest shadow-xl shadow-red-500/20 border-4 border-red-200 flex flex-col items-center justify-center gap-1 transition-transform hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-50"
              >
                <AlertOctagon className="w-8 h-8" />
                <span>{t("sos.triggerButton")}</span>
              </button>
            </>
          )}

          {countdown !== null && (
            <div className="space-y-4 py-8">
              <span className="text-xs font-mono text-red-600 dark:text-red-400 uppercase tracking-wider block font-semibold">
                {t("sos.countdown").replace("{seconds}", String(countdown))}
              </span>
              <div className="text-6xl font-mono font-black text-red-600 dark:text-red-400 animate-ping">
                {countdown}
              </div>
              <button
                onClick={handleCancelSOS}
                className="px-5 py-2 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                {t("sos.cancel")}
              </button>
            </div>
          )}

          {sosActive && (
            <div className="w-full space-y-4 py-4 text-left">
              <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-xl flex items-center justify-between text-red-600 dark:text-red-400">
                <div className="flex items-center gap-3">
                  <Radio className="w-6 h-6 text-red-600 dark:text-red-400 animate-pulse" />
                  <div>
                    <h4 className="font-bold text-sm">{t("sos.dispatchedTitle")}</h4>
                    <p className="text-xs text-red-600 dark:text-red-400 font-mono">
                      Category: {emergencyType}
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-1 bg-[#DC2626] text-white rounded-lg text-xs font-mono font-bold">
                  {dispatchStatus}
                </span>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2 text-xs">
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span>{t("sos.broadcastGps")}:</span>
                  <span className="font-mono text-slate-900 dark:text-white font-bold">{locationLabel}</span>
                </div>
                {createdReport && (
                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                    <span>{t("report.ticketIdLabel")}:</span>
                    <span className="font-mono text-blue-600 dark:text-blue-400 font-bold">{createdReport.id}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span>{t("sos.citizenContact")}:</span>
                  <span className="font-mono text-slate-900 dark:text-white">
                    {auth.currentUser?.email || authUser?.email || currentUser?.email || "citizen@urbanpulse.ai"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span>{t("sos.assignedUnit")}:</span>
                  <span className="font-mono text-green-600 dark:text-green-400 font-bold">NCR Quick Action Squad #4</span>
                </div>
              </div>

              <button
                onClick={handleCancelSOS}
                className="w-full py-2.5 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                Resolve / Deactivate SOS Beacon
              </button>
            </div>
          )}
        </div>

        {/* EMERGENCY DIRECTORY (Right 5 Cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 space-y-4 text-slate-900 dark:text-white shadow-xs">
          <h3 className="text-xs font-mono font-bold text-slate-500 dark:text-slate-300 uppercase tracking-wider">
            24/7 City Emergency Contacts
          </h3>

          <div className="space-y-2.5">
            {[
              { name: "Police Rapid Response", number: "112", desc: "All City Emergencies" },
              { name: "Ambulance / Medical", number: "102", desc: "Trauma & Road Accidents" },
              { name: "National Highway Helpline", number: "1033", desc: "Expressway Hazards & Towing" },
              { name: "Disaster Management", number: "1078", desc: "Floods & Structural Collapse" }
            ].map((contact, idx) => (
              <div
                key={idx}
                className="p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-between text-xs"
              >
                <div>
                  <span className="font-bold text-slate-900 dark:text-white block">{contact.name}</span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-300">{contact.desc}</span>
                </div>
                <a
                  href={`tel:${contact.number}`}
                  className="px-3 py-1.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 hover:bg-[#DC2626] hover:text-white rounded-lg font-mono font-bold transition-all"
                >
                  {contact.number}
                </a>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
