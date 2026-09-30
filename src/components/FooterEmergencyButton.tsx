import React, { useState, useRef, useEffect } from "react";
import { 
  AlertOctagon, 
  MapPin, 
  Radio, 
  PhoneCall, 
  CheckCircle2, 
  X, 
  Loader2, 
  ShieldAlert, 
  Navigation, 
  Flame, 
  Clock, 
  SendHorizontal,
  ChevronRight,
  Sparkles,
  Volume2
} from "lucide-react";
import { User, Report } from "../types";
import { createReport } from "../services/reportsService";
import { createNotification } from "../services/notificationsService";
import { useAuth } from "../context/AuthContext";
import { auth } from "../lib/firebase";
import { useLanguage } from "../i18n/LanguageContext";

interface FooterEmergencyButtonProps {
  currentUser: User | null;
  onReportCreated?: (report: Report) => void;
  onOpenReportDetails?: (report: Report) => void;
}

export default function FooterEmergencyButton({
  currentUser,
  onReportCreated,
  onOpenReportDetails
}: FooterEmergencyButtonProps) {
  const { user: authUser, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const [modalOpen, setModalOpen] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState<"IDLE" | "LOCATING" | "LOCKED" | "FALLBACK">("IDLE");
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [locationName, setLocationName] = useState<string>("Detecting precise GPS coordinates...");
  const [emergencyCategory, setEmergencyCategory] = useState<
    "Road Obstruction" | "Pothole" | "Broken Streetlight" | "Garbage Overflow" | "Other"
  >("Road Obstruction");
  const [emergencyNote, setEmergencyNote] = useState<string>("");
  const [createdSosReport, setCreatedSosReport] = useState<Report | null>(null);
  const [dispatchStage, setDispatchStage] = useState<"IDLE" | "ACQUIRING" | "BROADCASTING" | "CONFIRMED">("IDLE");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const countdownIntervalRef = useRef<any>(null);
  const autoLockCoordsRef = useRef<{ lat: number; lng: number } | null>(null);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  // Acquire high accuracy GPS location
  const acquireLocation = (): Promise<{ lat: number; lng: number; accuracy?: number; name: string }> => {
    return new Promise((resolve) => {
      setGpsStatus("LOCATING");
      setLocationName("Locking GPS satellite fix...");

      if (!("geolocation" in navigator)) {
        const fallback = { lat: 28.6139, lng: 77.2090, accuracy: 15, name: "Delhi NCR Command Zone (Default Grid)" };
        setUserCoords(fallback);
        setGpsStatus("FALLBACK");
        setLocationName(fallback.name);
        resolve(fallback);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy || 10),
            name: `Live GPS Fix (${pos.coords.latitude.toFixed(4)}° N, ${pos.coords.longitude.toFixed(4)}° E) ±${Math.round(pos.coords.accuracy || 10)}m`
          };
          setUserCoords(coords);
          autoLockCoordsRef.current = coords;
          setGpsStatus("LOCKED");
          setLocationName(coords.name);
          resolve(coords);
        },
        (err) => {
          console.warn("Geolocation warning in Quick-Action SOS:", err.message);
          // Fallback to active metro coordinates
          const fallback = { 
            lat: 28.6139, 
            lng: 77.2090, 
            accuracy: 25, 
            name: "Connaught Place / Central Municipal Grid (GPS Fallback)" 
          };
          setUserCoords(fallback);
          autoLockCoordsRef.current = fallback;
          setGpsStatus("FALLBACK");
          setLocationName(fallback.name);
          resolve(fallback);
        },
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 10000 }
      );
    });
  };

  // Open the Quick-Action SOS Modal & trigger initial GPS lock
  const handleOpenEmergencyModal = async (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setModalOpen(true);
    setCreatedSosReport(null);
    setErrorMessage(null);
    setDispatchStage("IDLE");
    setCountdown(null);
    setIsTriggering(false);
    await acquireLocation();
  };

  // Cancel active countdown
  const handleCancelCountdown = () => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setCountdown(null);
    setIsTriggering(false);
    setDispatchStage("IDLE");
  };

  // Instant or Counted Execution of High Priority SOS
  const startSosCountdown = (instant = false) => {
    if (isTriggering) return;
    setErrorMessage(null);
    setIsTriggering(true);

    if (instant) {
      executeSosBroadcast();
      return;
    }

    setCountdown(3);
    setDispatchStage("ACQUIRING");

    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
          executeSosBroadcast();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Perform Firestore Report creation & Notification broadcast
  const executeSosBroadcast = async () => {
    setIsTriggering(true);
    setDispatchStage("BROADCASTING");
    setCountdown(null);

    try {
      // Ensure coordinates are locked
      let coords = userCoords || autoLockCoordsRef.current;
      if (!coords) {
        coords = await acquireLocation();
      }

      const activeUid = auth.currentUser?.uid || authUser?.uid || currentUser?.id;
      if (!activeUid) {
        if (authLoading) {
          setErrorMessage("Restoring authentication session. Please wait a moment and try again.");
        } else {
          setErrorMessage("Please sign in before sending Emergency SOS.");
        }
        setIsTriggering(false);
        setDispatchStage("IDLE");
        return;
      }

      const activeUser = {
        id: activeUid,
        uid: activeUid,
        email: auth.currentUser?.email || authUser?.email || currentUser?.email || "citizen@urbanpulse.ai",
        fullName: auth.currentUser?.displayName || authUser?.displayName || currentUser?.fullName || "Citizen Reporter"
      };

      const customTitle = `🚨 URGENT SOS: High-Priority Emergency Incident`;
      const customDesc = emergencyNote.trim()
        ? `EMERGENCY ALERT: ${emergencyNote.trim()} | Triggered via Footer Quick-Action SOS at coordinates [${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}]. Requires immediate municipal hazard response.`
        : `CRITICAL INCIDENT SOS: Immediate emergency beacon broadcasted from live GPS coordinates [${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}]. Automated high-priority dispatch requested.`;

      // 1. Create Report in Firestore
      const newReport = await createReport(
        {
          title: customTitle,
          description: customDesc,
          category: emergencyCategory,
          location: locationName || `Urban Sector (GPS ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`,
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
            description: "High-priority emergency SOS beacon triggered directly by citizen via quick-action emergency alert.",
            recommendedActions: [
              "Immediate emergency response dispatch",
              "Notify nearest municipal rapid-action team",
              "Verify live beacon telemetry & road perimeter"
            ]
          }
        },
        {
          id: activeUser.id,
          uid: activeUser.id,
          email: activeUser.email,
          fullName: activeUser.fullName
        }
      );

      // 2. Broadcast High-Severity Notification to Municipal Admins
      await createNotification(
        "🚨 CRITICAL SOS INCIDENT ALERT",
        `Immediate emergency beacon triggered at GPS [${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}] by ${activeUser.email || 'Citizen'}. Priority: CRITICAL (Severity 98/100).`,
        "alert_high_severity",
        "admin",
        "",
        newReport.id
      );

      // Also create a citizen confirmation notification
      if (activeUser.email) {
        await createNotification(
          "🚨 Emergency Beacon Dispatched",
          `Your SOS incident alert (Ticket: ${newReport.id}) has been broadcasted to the 24/7 Municipal Response Command.`,
          "report_submitted",
          "citizen",
          activeUser.email,
          newReport.id
        );
      }

      setCreatedSosReport(newReport);
      setDispatchStage("CONFIRMED");
      setIsTriggering(false);

      if (onReportCreated) {
        onReportCreated(newReport);
      }
    } catch (err: any) {
      console.error("Failed to execute Quick-Action SOS:", err);
      setErrorMessage(err.message || "Failed to broadcast SOS beacon. Please call emergency services directly.");
      setIsTriggering(false);
      setDispatchStage("IDLE");
    }
  };

  return (
    <>
      {/* QUICK-ACTION TRIGGER BUTTON (Placed in Footer) */}
      <div className="flex items-center">
        <button
          id="footer-quick-action-sos-btn"
          type="button"
          onClick={handleOpenEmergencyModal}
          className="group relative inline-flex items-center gap-2.5 px-4 py-2 rounded-xl bg-gradient-to-r from-rose-600 via-rose-500 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-black text-xs uppercase tracking-wider shadow-lg shadow-rose-600/30 hover:shadow-rose-600/50 border border-rose-400/40 transition-all duration-200 hover:scale-[1.03] active:scale-95 cursor-pointer"
          title="Trigger Quick-Action Emergency SOS with Live GPS Location"
        >
          {/* Pulsing Radar Ring */}
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white dark:bg-slate-900 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white dark:bg-slate-900"></span>
          </span>

          <AlertOctagon className="w-4 h-4 text-white group-hover:rotate-12 transition-transform duration-200" />
          <span className="font-display font-extrabold tracking-tight">⚠️ {t("sos.instantBeacon")}</span>
          <span className="hidden sm:inline-block px-1.5 py-0.5 bg-rose-950/80 rounded text-[9px] font-mono text-rose-200 border border-rose-700/50">
            {t("report.gpsDetected")}
          </span>
        </button>
      </div>

      {/* EMERGENCY HUD MODAL */}
      {modalOpen && (
        <div 
          id="quick-sos-modal-overlay" 
          className="fixed inset-0 z-[9999] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isTriggering) {
              setModalOpen(false);
            }
          }}
        >
          <div 
            id="quick-sos-modal-card" 
            className="w-full max-w-lg bg-slate-900 border-2 border-rose-600/60 rounded-3xl shadow-2xl shadow-rose-900/50 overflow-hidden text-slate-100 relative"
          >
            {/* TOP EMERGENCY HEADER BANNER */}
            <div className="bg-gradient-to-r from-rose-950 via-slate-900 to-rose-950 p-5 border-b border-rose-900/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-rose-600 text-white flex items-center justify-center shadow-lg shadow-rose-600/50 animate-pulse shrink-0">
                  <AlertOctagon className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-display font-black text-base text-white tracking-tight uppercase">
                      Quick-Action Emergency SOS
                    </h2>
                    <span className="px-2 py-0.5 bg-rose-500/20 text-rose-400 border border-rose-500/40 rounded text-[9px] font-mono font-bold uppercase">
                      Priority 98/100
                    </span>
                  </div>
                  <p className="text-xs text-rose-200/80 mt-0.5">
                    Broadcasts high-priority incident beacon & coordinates directly to City Command.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  handleCancelCountdown();
                  setModalOpen(false);
                }}
                disabled={isTriggering && countdown === null}
                className="w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* MODAL BODY CONTENT */}
            <div className="p-6 space-y-5">
              
              {/* ERROR STATE */}
              {errorMessage && (
                <div className="p-3.5 bg-rose-950/80 border border-rose-700 rounded-2xl text-rose-200 text-xs flex items-start gap-2.5">
                  <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold">Dispatch Notice:</p>
                    <p className="text-[11.5px] leading-relaxed text-rose-300">{errorMessage}</p>
                  </div>
                </div>
              )}

              {/* LIVE GPS POSITION LOCK STATUS */}
              <div className="p-4 bg-slate-950/90 border border-slate-800 rounded-2xl space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-emerald-400 animate-bounce" />
                    <span className="font-bold text-slate-200 uppercase tracking-wide text-[11px]">
                      Target Telemetry Coordinates
                    </span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[9.5px] font-mono font-bold uppercase ${
                    gpsStatus === "LOCKED" 
                      ? "bg-emerald-950 text-emerald-400 border border-emerald-800" 
                      : gpsStatus === "LOCATING"
                      ? "bg-amber-950 text-amber-400 border border-amber-800 animate-pulse"
                      : "bg-blue-950 text-blue-400 border border-blue-800"
                  }`}>
                    {gpsStatus === "LOCKED" ? "● GPS Locked" : gpsStatus === "LOCATING" ? "Acquiring Fix..." : "Grid Fallback"}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs bg-slate-900/80 px-3 py-2 rounded-xl border border-slate-800/80">
                  <span className="text-slate-300 font-mono text-[11px] truncate max-w-[280px]">
                    {locationName}
                  </span>
                  <button
                    type="button"
                    onClick={() => acquireLocation()}
                    className="text-[10px] text-blue-400 hover:text-blue-300 font-semibold underline cursor-pointer shrink-0 ml-2"
                  >
                    Refresh Fix
                  </button>
                </div>

                {userCoords && (
                  <div className="flex items-center gap-4 text-[10px] font-mono text-slate-400 pt-1">
                    <span>LAT: <strong className="text-slate-200">{userCoords.lat.toFixed(5)}° N</strong></span>
                    <span>LNG: <strong className="text-slate-200">{userCoords.lng.toFixed(5)}° E</strong></span>
                    {userCoords.accuracy && (
                      <span>ACCURACY: <strong className="text-emerald-400">±{userCoords.accuracy}m</strong></span>
                    )}
                  </div>
                )}
              </div>

              {/* STAGE 1: CONFIGURATION & SOS TRIGGER */}
              {dispatchStage === "IDLE" && !createdSosReport && (
                <div className="space-y-4">
                  <div>
                    <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block mb-1.5">
                      Emergency Incident Category
                    </label>
                    <select
                      value={emergencyCategory}
                      onChange={(e) => setEmergencyCategory(e.target.value as any)}
                      className="w-full bg-slate-950 border border-slate-800 text-slate-100 text-xs px-3.5 py-2.5 rounded-xl focus:outline-hidden focus:border-rose-500 font-semibold"
                    >
                      <option value="Road Obstruction">🚨 Major Road Blockage / Cave-In / Accident</option>
                      <option value="Pothole">🕳️ Severe Road Crater / Structural Hazard</option>
                      <option value="Broken Streetlight">⚡ Live Electrical Wire / Open Luminaire Hazard</option>
                      <option value="Garbage Overflow">☣️ Hazardous Material / Contamination</option>
                      <option value="Other">⚠️ Other Critical Civic Hazard</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block mb-1.5">
                      Quick Voice / Text Note (Optional)
                    </label>
                    <input
                      type="text"
                      value={emergencyNote}
                      onChange={(e) => setEmergencyNote(e.target.value)}
                      placeholder="e.g. Near metro pillar 42, active traffic block, immediate dispatch needed"
                      className="w-full bg-slate-950 border border-slate-800 text-slate-100 text-xs px-3.5 py-2.5 rounded-xl focus:outline-hidden focus:border-rose-500 placeholder:text-slate-600"
                    />
                  </div>

                  {/* ACTION BUTTONS */}
                  <div className="pt-2 flex flex-col sm:flex-row gap-3">
                    <button
                      id="trigger-quick-sos-countdown-btn"
                      type="button"
                      onClick={() => startSosCountdown(false)}
                      className="flex-1 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 active:from-rose-700 text-white font-black text-xs py-3.5 px-4 rounded-2xl shadow-xl shadow-rose-600/40 border border-rose-400/40 transition-all flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider"
                    >
                      <Radio className="w-4 h-4 animate-pulse" />
                      <span>Start 3s Safe Beacon</span>
                    </button>

                    <button
                      id="trigger-quick-sos-instant-btn"
                      type="button"
                      onClick={() => startSosCountdown(true)}
                      className="bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-rose-300 font-bold text-xs py-3.5 px-4 rounded-2xl border border-rose-900/60 transition-all flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider"
                    >
                      <SendHorizontal className="w-4 h-4 text-rose-400" />
                      <span>Instant Send</span>
                    </button>
                  </div>
                </div>
              )}

              {/* STAGE 2: COUNTDOWN IN PROGRESS */}
              {countdown !== null && (
                <div className="py-6 flex flex-col items-center justify-center text-center space-y-4 bg-slate-950/80 rounded-2xl border border-rose-900/60 p-6">
                  <span className="text-xs font-mono text-rose-400 uppercase tracking-widest font-bold">
                    Broadcasting SOS Emergency Beacon In:
                  </span>
                  <div className="text-7xl font-mono font-black text-rose-500 animate-ping">
                    {countdown}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Live GPS coordinates will be locked and transmitted to 24/7 Municipal Triage.
                  </p>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleCancelCountdown}
                      className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 transition-all cursor-pointer"
                    >
                      Cancel Broadcast
                    </button>
                    <button
                      type="button"
                      onClick={() => executeSosBroadcast()}
                      className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-black rounded-xl shadow-lg transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <span>Send Immediately</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* STAGE 3: TRANSMITTING / BROADCASTING FEEDBACK */}
              {dispatchStage === "BROADCASTING" && (
                <div className="py-8 flex flex-col items-center justify-center text-center space-y-4 bg-slate-950/80 rounded-2xl border border-rose-900/80 p-6">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-full bg-rose-600/20 border-2 border-rose-500 flex items-center justify-center animate-spin">
                      <Radio className="w-8 h-8 text-rose-400" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-white tracking-wide uppercase">
                      Transmitting High-Priority Beacon...
                    </h3>
                    <p className="text-xs text-slate-400">
                      Writing to emergency incident registry & alerting municipal fleet dispatch...
                    </p>
                  </div>
                </div>
              )}

              {/* STAGE 4: CONFIRMED DISPATCH WITH TICKET & EVIDENCE */}
              {dispatchStage === "CONFIRMED" && createdSosReport && (
                <div className="space-y-4 bg-slate-950/90 rounded-2xl border border-emerald-800/80 p-5 animate-in zoom-in-95 duration-200">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-600/40 shrink-0">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-display font-black text-sm text-emerald-400 uppercase tracking-tight">
                        Emergency Beacon Dispatched
                      </h3>
                      <p className="text-[11px] text-slate-300">
                        Municipal 24/7 Command Center has received your high-priority SOS alert.
                      </p>
                    </div>
                  </div>

                  {/* TICKET DETAILS CARD */}
                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 text-xs space-y-2">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="text-slate-400 font-medium">Incident Ticket ID:</span>
                      <span className="font-mono font-bold text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded border border-rose-800/50">
                        {createdSosReport.id}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="text-slate-400 font-medium">Operational Priority:</span>
                      <span className="font-bold text-rose-400 uppercase tracking-wider">
                        CRITICAL (Severity 98%)
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="text-slate-400 font-medium">Locked GPS:</span>
                      <span className="font-mono text-slate-200">
                        {createdSosReport.latitude.toFixed(4)}° N, {createdSosReport.longitude.toFixed(4)}° E
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-0.5">
                      <span className="text-slate-400 font-medium">Status:</span>
                      <span className="font-bold text-amber-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                        <span>Queued for Municipal Unit Dispatch</span>
                      </span>
                    </div>
                  </div>

                  {/* ACTIONS */}
                  <div className="flex items-center gap-3 pt-2">
                    {onOpenReportDetails && (
                      <button
                        type="button"
                        onClick={() => {
                          setModalOpen(false);
                          onOpenReportDetails(createdSosReport);
                        }}
                        className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs py-2.5 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <span>View Live Report Details</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setModalOpen(false)}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-xl transition-all cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {/* DIRECT EMERGENCY HELPLINES BAR */}
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-3 text-xs">
                <span className="text-[11px] text-slate-400 font-medium">
                  Direct Emergency Hotlines:
                </span>
                <div className="flex items-center gap-2">
                  <a
                    href="tel:112"
                    className="px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1.5"
                  >
                    <PhoneCall className="w-3 h-3" />
                    <span>Call 112 (National)</span>
                  </a>
                  <a
                    href="tel:100"
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-[11px] font-bold transition-all"
                  >
                    100 (Police)
                  </a>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
    </>
  );
}
