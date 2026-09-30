import React from "react";
import { Report } from "../types";
import { 
  AlertOctagon, 
  MapPin, 
  Radio, 
  ExternalLink, 
  X, 
  Crosshair, 
  Clock, 
  User, 
  ShieldAlert,
  Flame,
  CheckCircle2
} from "lucide-react";

interface EmergencySOSSidebarProps {
  alerts: Report[];
  onDismiss: (reportId: string) => void;
  onViewOnMap: (report: Report) => void;
  onOpenIncident: (report: Report) => void;
}

export default function EmergencySOSSidebar({
  alerts,
  onDismiss,
  onViewOnMap,
  onOpenIncident
}: EmergencySOSSidebarProps) {
  if (!alerts || alerts.length === 0) return null;

  return (
    <div 
      className="fixed top-20 right-4 z-50 flex flex-col gap-3.5 max-w-sm sm:max-w-md w-full pointer-events-none"
      role="region"
      aria-label="Live Emergency SOS Alerts"
    >
      {alerts.map((alert, index) => {
        const receivedTime = alert.sosTriggeredAt || alert.createdAt
          ? new Date(alert.sosTriggeredAt || alert.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit"
            })
          : "Just now";

        const latFormatted = typeof alert.latitude === "number" ? `${alert.latitude.toFixed(6)}° N` : "N/A";
        const lngFormatted = typeof alert.longitude === "number" ? `${alert.longitude.toFixed(6)}° E` : "N/A";
        const accuracyFormatted = alert.gpsAccuracy !== undefined ? `±${Math.round(alert.gpsAccuracy)} m` : "±8 m";

        return (
          <div
            key={alert.id}
            className={`pointer-events-auto rounded-2xl bg-slate-950/95 border-2 border-red-600 text-white shadow-[0_0_35px_rgba(220,38,38,0.45)] backdrop-blur-xl p-4 transition-all duration-300 ease-out transform translate-x-0 ${
              index === 0 ? "scale-100 ring-2 ring-red-500/50" : "scale-[0.98] opacity-90"
            }`}
            style={{
              animation: "slideInRight 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards"
            }}
          >
            {/* Header: Pulsing Live Beacon & Close Button */}
            <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-red-900/60">
              <div className="flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                </span>
                <span className="font-mono text-xs font-black tracking-wider text-red-400 uppercase flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5 animate-pulse text-red-400" />
                  LIVE SOS ALERT
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-950 border border-red-800 text-red-300 font-bold">
                  {alert.id}
                </span>
              </div>

              <button
                onClick={() => onDismiss(alert.id)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="Acknowledge & Dismiss Alert"
                aria-label="Dismiss SOS alert"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Emergency Severity & Category Title */}
            <div className="mt-2.5 mb-2">
              <div className="flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-red-500 shrink-0" />
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-red-400">
                  CRITICAL EMERGENCY
                </span>
              </div>
              <h4 className="font-bold text-sm text-white tracking-tight mt-0.5 leading-snug">
                {alert.sosType || alert.title.replace(/^🚨\s*(LIVE\s*)?SOS:\s*/i, "") || "Citizen Emergency SOS"}
              </h4>
            </div>

            {/* Citizen Details */}
            <div className="flex items-center gap-2 text-xs text-slate-300 bg-red-950/30 border border-red-900/40 rounded-xl px-2.5 py-1.5 mb-3">
              <User className="w-3.5 h-3.5 text-red-400 shrink-0" />
              <div className="flex-1 truncate">
                <span className="text-[10px] text-slate-400 block uppercase font-mono tracking-wider">Citizen Reporter</span>
                <span className="font-medium text-slate-200 truncate block text-[11px] font-mono">
                  {alert.reporterEmail || "citizen@urbanpulse.org"}
                </span>
              </div>
            </div>

            {/* Exact GPS Coordinates Grid */}
            <div className="bg-black/60 rounded-xl p-2.5 border border-red-900/50 mb-3 font-mono">
              <div className="flex items-center justify-between text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">
                <span className="flex items-center gap-1 text-red-400">
                  <Crosshair className="w-3.5 h-3.5" />
                  EXACT GPS LOCATION
                </span>
                <span className="text-emerald-400 font-bold">Accuracy: {accuracyFormatted}</span>
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-xs font-bold text-white pt-1">
                <div className="bg-slate-900/90 rounded-lg p-1.5 border border-white/5 text-center">
                  <span className="text-[9px] text-slate-400 block uppercase">LATITUDE</span>
                  <span className="text-slate-100">{latFormatted}</span>
                </div>
                <div className="bg-slate-900/90 rounded-lg p-1.5 border border-white/5 text-center">
                  <span className="text-[9px] text-slate-400 block uppercase">LONGITUDE</span>
                  <span className="text-slate-100">{lngFormatted}</span>
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-400 pt-2 mt-1 border-t border-white/10">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-500" />
                  Received: <strong className="text-slate-200 font-mono">{receivedTime}</strong>
                </span>
                <span className="text-[9px] text-amber-300 font-sans font-semibold">Priority: Critical</span>
              </div>
            </div>

            {/* Action Buttons: VIEW ON MAP & OPEN INCIDENT */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => onViewOnMap(alert)}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-bold border border-slate-700 transition-all hover:border-slate-500 active:scale-[0.98]"
              >
                <MapPin className="w-3.5 h-3.5 text-blue-400" />
                <span>VIEW ON MAP</span>
              </button>

              <button
                onClick={() => onOpenIncident(alert)}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-bold shadow-lg shadow-red-900/40 transition-all active:scale-[0.98]"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>OPEN INCIDENT</span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
