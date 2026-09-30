import React, { useState, useEffect } from "react";
import { Report, StatusHistory, UserRole } from "../types";
import { 
  X, ShieldAlert, CheckCircle2, User, Clock, AlertTriangle, ArrowRight, 
  Loader2, Camera, FileText, Layers, Sparkles, MapPin, Check, ThumbsUp, RotateCcw, Wrench
} from "lucide-react";
import { getReportHistory } from "../services/reportsService";
import { DEFAULT_FIELD_TEAMS, approveFieldResolution, rejectFieldResolution } from "../services/fieldOperationsService";

interface ReportDetailsModalProps {
  report: Report | null;
  onClose: () => void;
  isAdmin: boolean;
  userRole?: UserRole;
  onUpdateStatus: (payload: {
    id: string;
    status: Report["status"];
    assignedTo: string | null;
    comment: string;
    officerName: string;
  }) => Promise<void>;
}

export default function ReportDetailsModal({
  report,
  onClose,
  isAdmin,
  userRole,
  onUpdateStatus
}: ReportDetailsModalProps) {
  const isAuthorizedManager = isAdmin || userRole === "admin" || userRole === "municipal";
  const isFieldTeam = userRole === "field_team";
  const [history, setHistory] = useState<StatusHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number>(0);

  // Resolution approval/rejection state
  const [resolutionProcessing, setResolutionProcessing] = useState(false);
  const [rejectionModalOpen, setRejectionModalOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("Incomplete Repair");
  const [rejectionNotes, setRejectionNotes] = useState("");

  // Form Fields for status updates (For Admin/Municipality Officer)
  const [statusInput, setStatusInput] = useState<Report["status"]>("Pending");
  const [assignedToInput, setAssignedToInput] = useState("");
  const [commentInput, setCommentInput] = useState("");

  useEffect(() => {
    if (!report) return;

    // Sync form fields with selected report
    setStatusInput(report.status);
    setAssignedToInput(report.assignedTo || "");
    setCommentInput("");
    setSelectedFrameIndex(0);

    // Fetch status history trail via Firestore service with fallback
    setLoadingHistory(true);
    getReportHistory(report.id)
      .then((historyLogs) => {
        if (historyLogs && historyLogs.length > 0) {
          setHistory(historyLogs);
        } else {
          return fetch(`/api/reports/${report.id}/history`)
            .then((res) => res.json())
            .then((data) => {
              if (data.history) setHistory(data.history);
            });
        }
      })
      .catch((err) => {
        console.warn("Firestore history query fallback to API:", err);
        fetch(`/api/reports/${report.id}/history`)
          .then((res) => res.json())
          .then((data) => {
            if (data.history) setHistory(data.history);
          })
          .catch((e) => console.error("Error loading status log timeline:", e));
      })
      .finally(() => setLoadingHistory(false));
  }, [report]);

  if (!report) return null;

  // Evidence frames array resolution
  const rawFrames: string[] = [];
  if (Array.isArray(report.evidenceFrames) && report.evidenceFrames.length > 0) {
    report.evidenceFrames.forEach((f) => {
      if (f && typeof f === "string" && !rawFrames.includes(f)) {
        rawFrames.push(f);
      }
    });
  }
  if (report.image && typeof report.image === "string" && !rawFrames.includes(report.image)) {
    rawFrames.unshift(report.image);
  }
  if (report.evidenceUrl && typeof report.evidenceUrl === "string" && !rawFrames.includes(report.evidenceUrl)) {
    if (!rawFrames.length) rawFrames.push(report.evidenceUrl);
  }

  const evidenceFrames = rawFrames;
  const currentMainImage = evidenceFrames[selectedFrameIndex] || report.image || report.evidenceUrl || null;

  const handleApplyUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (updating) return;

    setUpdating(true);
    try {
      await onUpdateStatus({
        id: report.id,
        status: statusInput,
        assignedTo: assignedToInput.trim() !== "" ? assignedToInput.trim() : null,
        comment: commentInput.trim() !== "" ? commentInput.trim() : `Status transitioned to ${statusInput}.`,
        officerName: "Director Marcus Vance"
      });

      // Refetch history locally
      const updatedHistory = await getReportHistory(report.id);
      if (updatedHistory && updatedHistory.length > 0) {
        setHistory(updatedHistory);
      } else {
        const res = await fetch(`/api/reports/${report.id}/history`);
        const data = await res.json();
        if (data.history) {
          setHistory(data.history);
        }
      }
      setCommentInput("");
    } catch (e) {
      console.error("Failed to commit status modifications:", e);
    } finally {
      setUpdating(false);
    }
  };

  // Status badge colors
  const statusColors = {
    Pending: "bg-red-50 text-red-800 border-red-200",
    Assigned: "bg-blue-50 text-blue-800 border-blue-200",
    "In Progress": "bg-amber-50 text-amber-800 border-amber-200",
    Resolved: "bg-emerald-50 text-emerald-800 border-emerald-200"
  };

  const isRoadScanner = report.source === "ROAD_SCANNER";

  return (
    <div className="fixed inset-0 z-[1200] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header bar */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-slate-50">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-xs font-semibold text-slate-500 bg-slate-200/70 px-2 py-0.5 rounded">
              Ticket: {report.id}
            </span>

            {/* Unified Report Source & SOS Badges */}
            {report.isSOS ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-300 shadow-xs animate-pulse">
                <ShieldAlert className="w-3.5 h-3.5 text-red-600" />
                <span>🚨 LIVE CITIZEN SOS</span>
              </span>
            ) : isRoadScanner ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 shadow-3xs">
                <Camera className="w-3.5 h-3.5 text-purple-600" />
                <span>AI Road Scanner</span>
                {report.clusterCount && report.clusterCount > 1 && (
                  <span className="ml-1 px-1 rounded bg-purple-200 text-purple-900 text-[9px] font-mono">
                    {report.clusterCount} merged
                  </span>
                )}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 shadow-3xs">
                <FileText className="w-3.5 h-3.5 text-blue-600" />
                <span>Manual Citizen Report</span>
              </span>
            )}

            <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${statusColors[report.status]}`}>
              {report.status}
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable contents */}
        <div className="overflow-y-auto flex-1 p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Column 1: Core Details & Evidence Frame Gallery */}
          <div className="flex flex-col gap-4">
            
            {/* Visual asset Main View */}
            <div className="relative aspect-video rounded-xl overflow-hidden border border-gray-200 bg-gray-900 group shadow-sm flex items-center justify-center">
              {currentMainImage ? (
                <div className="relative max-w-full max-h-full inline-block flex items-center justify-center">
                  <img
                    src={currentMainImage}
                    alt={report.title}
                    className="max-w-full max-h-full object-contain block transition-transform duration-300"
                    referrerPolicy="no-referrer"
                  />
                  {report.boundingBox && selectedFrameIndex === 0 && (
                    <div 
                      className="absolute border-[3px] border-red-500 bg-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.5)]"
                      style={{
                        left: `${report.boundingBox.x * 100}%`,
                        top: `${report.boundingBox.y * 100}%`,
                        width: `${report.boundingBox.width * 100}%`,
                        height: `${report.boundingBox.height * 100}%`,
                        pointerEvents: 'none'
                      }}
                    >
                      <div className="absolute -top-6 left-[-3px] bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 whitespace-nowrap rounded-t-sm uppercase tracking-wider">
                        {report.category} ({Math.round(report.confidence || 0)}%)
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400">
                  <Camera className="w-10 h-10 text-slate-600 mb-2 opacity-60" />
                  <p className="text-xs font-semibold text-slate-400">No incident image available</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">No photographic evidence was attached to this report</p>
                </div>
              )}
              <div className="absolute top-2 left-2 bg-black/75 px-2.5 py-1 rounded text-[10px] text-white font-semibold flex items-center gap-1.5 backdrop-blur-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>{isRoadScanner ? "Road Telemetry Frame" : "Incident Asset Lock"}</span>
                {evidenceFrames.length > 1 && (
                  <span className="text-[9px] font-mono text-slate-300">
                    ({selectedFrameIndex + 1}/{evidenceFrames.length})
                  </span>
                )}
              </div>

              {isRoadScanner && (
                <div className="absolute bottom-2 right-2 bg-purple-950/80 border border-purple-500/40 text-purple-200 px-2 py-0.5 rounded text-[9.5px] font-mono flex items-center gap-1 backdrop-blur-xs">
                  <Sparkles className="w-3 h-3 text-purple-400" />
                  <span>AI Vision Lock</span>
                </div>
              )}
            </div>

            {/* Evidence Frames Thumbnail Strip for AI Road Scanner */}
            {evidenceFrames.length > 1 && (
              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/80">
                <div className="flex items-center justify-between mb-1.5 px-1">
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <Layers className="w-3 h-3 text-blue-600" />
                    <span>Evidence Frame Sequence ({evidenceFrames.length} Frames)</span>
                  </span>
                  <span className="text-[8.5px] text-slate-400 font-mono">Click to preview</span>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {evidenceFrames.map((frameUrl, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedFrameIndex(idx)}
                      className={`relative shrink-0 w-16 h-12 rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                        selectedFrameIndex === idx
                          ? "border-blue-500 ring-2 ring-blue-400/30 scale-105"
                          : "border-slate-200 opacity-70 hover:opacity-100 hover:border-slate-300"
                      }`}
                    >
                      <img
                        src={frameUrl}
                        alt={`Evidence Frame ${idx + 1}`}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                      <span className="absolute bottom-0 right-0 bg-black/70 text-[8px] font-mono text-white px-1">
                        #{idx + 1}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Core Info description block */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/60 text-left">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                  {isRoadScanner ? "Automated Road Defect Report" : "Citizen Incident Report"}
                </span>
                {report.roadScanId && (
                  <span className="text-[9px] font-mono bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded border border-purple-200">
                    Scan ID: {report.roadScanId.slice(0, 12)}
                  </span>
                )}
              </div>

              <h3 className="font-display font-medium text-lg text-slate-800 tracking-tight mt-1 mb-2">{report.title}</h3>
              <p className="text-xs text-gray-600 leading-relaxed max-h-36 overflow-y-auto">{report.description}</p>
              
              <div className="flex flex-col gap-2 border-t border-slate-200 pt-3 mt-3 text-slate-500 font-medium">
                <div className="flex justify-between text-xs items-center">
                  <span className="flex items-center gap-1 text-slate-500">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    <span>Location:</span>
                  </span>
                  <span className="text-slate-800 font-semibold">{report.location}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span>GPS Coordinates:</span>
                  <span className="text-slate-700 font-mono text-[11px] font-semibold">
                    {report.latitude?.toFixed(6)}°, {report.longitude?.toFixed(6)}°
                  </span>
                </div>
                {report.gpsAccuracy !== undefined && (
                  <div className="flex justify-between text-xs">
                    <span>GPS Fix Accuracy:</span>
                    <span className="text-emerald-700 font-mono text-[11px] font-bold">
                      ±{Math.round(report.gpsAccuracy)} meters ({report.gpsSource || "browser-geolocation"})
                    </span>
                  </div>
                )}
                {report.sosType && (
                  <div className="flex justify-between text-xs">
                    <span>Emergency Incident:</span>
                    <span className="text-red-700 font-bold">
                      {report.sosType}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span>Source Channel:</span>
                  <span className="text-slate-800 font-bold">
                    {report.isSOS ? "🚨 Citizen Live SOS Beacon" : isRoadScanner ? "AI Dashcam Vision Scanner" : "Manual Citizen Submission"}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span>Reporter Node:</span>
                  <span id="reporter-email-span" className="text-slate-800 font-mono">{report.reporterEmail}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span>Registered Timestamp:</span>
                  <span className="text-slate-800">{new Date(report.createdAt).toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* In-Depth Status Work timeline logs / Professional Audit Trail */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 p-5 rounded-xl">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-xs font-black uppercase text-slate-800 tracking-wider flex items-center gap-2">
                  <span className="w-2.5 h-2.5 bg-blue-600 rounded-full animate-ping-slow shrink-0" />
                  <span>Interactive Audit Trail</span>
                </h4>
                <span className="text-[10px] font-mono font-bold bg-slate-100 px-2 py-0.5 rounded text-slate-600 border border-slate-200">
                  FIRESTORE LEDGER RECORD
                </span>
              </div>

              {/* Complete Step Lifecycle Stepper */}
              <div className="space-y-4 text-left border-l-2 border-slate-100 pl-4.5 relative mb-6">
                
                {/* STEP 1: Reported */}
                <div className="relative">
                  <div className="absolute -left-7.5 top-0.5 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-[10px] border-4 border-white shadow-xs">
                    ✓
                  </div>
                  <div>
                    <h5 className="text-[11.5px] font-bold text-slate-800 flex items-center gap-1.5">
                      <span>1. {isRoadScanner ? "Road Defect Scanned & Clustered" : "Issue Reported"}</span>
                      <span className="text-[10px] font-mono font-normal text-slate-400">
                        {new Date(report.createdAt).toLocaleDateString()}
                      </span>
                    </h5>
                    <p className="text-[10.5px] text-slate-500 leading-normal mt-0.5">
                      {isRoadScanner
                        ? `GPS-synchronized road scan candidate confirmed. Source: ${report.reporterEmail}.`
                        : `Verified citizen submit ledger entry created. Reporter: ${report.reporterEmail}.`}
                    </p>
                  </div>
                </div>

                {/* STEP 2: Issue Verified */}
                <div className="relative">
                  <div className="absolute -left-7.5 top-0.5 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-[10px] border-4 border-white shadow-xs">
                    ✓
                  </div>
                  <div>
                    <h5 className="text-[11.5px] font-bold text-slate-800 flex items-center gap-1.5">
                      <span>2. Issue Confirmed via AI</span>
                      <span className="text-[10px] bg-blue-50 text-blue-700 px-1 rounded border border-blue-100 text-[9px] font-black">
                        {report.confidence}% MATCH
                      </span>
                    </h5>
                    <p className="text-[10.5px] text-slate-500 leading-normal mt-0.5">
                      Automated Gemini neural classification succeeded. Identified match with standard <span className="font-semibold text-slate-700">{report.category}</span> indices.
                    </p>
                  </div>
                </div>

                {/* STEP 3: Risk Score Updated */}
                <div className="relative">
                  <div className="absolute -left-7.5 top-0.5 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-[10px] border-4 border-white shadow-xs">
                    ✓
                  </div>
                  <div>
                    <h5 className="text-[11.5px] font-bold text-slate-800 flex items-center gap-1.5">
                      <span>3. Risk Score Formulated</span>
                      <span className="text-[10px] font-mono font-black text-rose-600">
                        {report.severity}/100 Severity
                      </span>
                    </h5>
                    <p className="text-[10.5px] text-slate-500 leading-normal mt-0.5">
                      Designated priority: <span className="font-bold underline text-slate-700">{report.riskLevel} Risk</span> (Priority: {report.priority || (report.severity >= 75 ? "Critical" : report.severity >= 50 ? "High" : "Medium")}).
                    </p>
                  </div>
                </div>

                {/* STEP 4: Officer Assigned */}
                <div className="relative">
                  {report.assignedTo ? (
                    <div className="absolute -left-7.5 top-0.5 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-[10px] border-4 border-white shadow-xs">
                      ✓
                    </div>
                  ) : (
                    <div className="absolute -left-7.5 top-0.5 w-5 h-5 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-[10px] border-4 border-white shadow-xs">
                      ●
                    </div>
                  )}
                  <div>
                    <h5 className="text-[11.5px] font-bold text-slate-800">
                      4. Dispatch Crew Tasked
                    </h5>
                    <p className="text-[10.5px] text-slate-500 leading-normal mt-0.5">
                      {report.assignedTo ? (
                        <span>
                          Supervisory delegate assigned to: <strong className="text-blue-700 font-semibold">{report.assignedTo}</strong>.
                        </span>
                      ) : (
                        <span className="text-slate-400 font-medium italic">
                          Awaiting administrative dispatch crew designation on control deck...
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                {/* STEP 5: Issue Resolved */}
                <div className="relative">
                  {report.status === "Resolved" ? (
                    <div className="absolute -left-7.5 top-0.5 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-[10px] border-4 border-white shadow-xs">
                      ✓
                    </div>
                  ) : (
                    <div className="absolute -left-7.5 top-0.5 w-5 h-5 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-[10px] border-4 border-white shadow-xs">
                      ●
                    </div>
                  )}
                  <div>
                    <h5 className="text-[11.5px] font-bold text-slate-800">
                      5. Issue Resolved & Sworn
                    </h5>
                    <p className="text-[10.5px] text-slate-500 leading-normal mt-0.5">
                      {report.status === "Resolved" ? (
                        <span className="text-emerald-700 font-bold bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded inline-block mt-0.5">
                          ✓ Completed & Signed off by Delhi NCR Municipal Overseers
                        </span>
                      ) : (
                        <span className="text-amber-600 font-semibold bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded inline-block mt-0.5">
                          ⏳ Active Resolution / Scheduled repair works operating
                        </span>
                      )}
                    </p>
                  </div>
                </div>

              </div>

              {/* Workflow Audit log details trail */}
              <div className="border-t border-slate-100 pt-3">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-2 text-left">Officer Ledger Log Updates</span>
                {loadingHistory ? (
                  <div className="flex items-center gap-2 text-xs text-gray-400 p-2 justify-center">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                    <span>Fetching history...</span>
                  </div>
                ) : (
                  <div className="relative pl-3.5 border-l border-slate-200 flex flex-col gap-3 max-h-36 overflow-y-auto pt-1 text-left">
                    {history.length === 0 ? (
                      <div className="text-[10.5px] text-slate-400 italic">No supervisor overrides recorded yet on this ticket.</div>
                    ) : (
                      history.map((log) => (
                        <div key={log.id} className="relative z-10">
                          <span className="absolute -left-5 top-1 w-2.5 h-2.5 rounded-full bg-blue-500 border border-white"></span>
                          <div className="flex items-center gap-1.5 text-[9.5px] text-gray-400 font-medium">
                            <span className="font-bold text-slate-700">{log.updatedBy}</span>
                            <span>•</span>
                            <span>{new Date(log.createdAt).toLocaleString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <div className="mt-0.5">
                            <span className="text-[9px] font-mono font-bold bg-slate-100 text-slate-700 px-1 rounded">
                              {log.status}
                            </span>
                            <p className="text-[10px] text-gray-600 mt-0.5 italic pl-1 border-l-2 border-slate-100">
                              "{log.comment}"
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* Column 2: AI Diagnostics and Administration update form */}
          <div className="flex flex-col gap-4 text-left">
            
            {/* Gemini AI Diagnostics widget (Sleek professional card) */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 shadow-sm p-6 rounded-2xl border-t-4 border-blue-600">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-blue-600 animate-pulse" />
                  <div>
                    <h3 className="font-display font-bold text-sm tracking-tight text-slate-800 leading-4">AI GUARDIAN DIAGNOSTICS</h3>
                    <p className="text-[9px] text-slate-400 font-mono">
                      {isRoadScanner ? "Gemini 2.5 Flash Vision Node" : "Multimodal Incident Diagnostic"}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold font-mono text-blue-600">{report.confidence}% Confidence</div>
                  <div className="text-[8px] uppercase font-semibold text-slate-400">Model Verified</div>
                </div>
              </div>

              {report.aiAnalysis ? (
                <div className="flex flex-col gap-4">
                  <div>
                    <div className="flex justify-between items-center text-[10px] text-slate-500 uppercase font-bold mb-1">
                      <span>Threat Severity Ratio</span>
                      <span className="text-rose-600 font-mono font-extrabold">{report.severity}% / ({report.riskLevel} Risk)</span>
                    </div>
                    {/* Visual Progress Bar */}
                    <div className="w-full bg-slate-150 rounded-full h-2 overflow-hidden flex">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          report.severity >= 75 ? "bg-red-500" : report.severity >= 45 ? "bg-amber-500" : "bg-emerald-500"
                        }`}
                        style={{ width: `${report.severity}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* SMART ISSUE ANALYSIS GRID */}
                  <div className="bg-slate-50 border border-slate-200/80 p-3.5 rounded-xl">
                    <span className="text-[9px] font-bold uppercase text-blue-600 tracking-wider block mb-2 px-1">Smart Operations Diagnostic Overview</span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-left text-[11px]">
                      <div className="bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-150">
                        <span className="text-[8px] text-slate-400 uppercase font-semibold block">Issue Type</span>
                        <span className="text-xs font-bold text-slate-800">{report.category}</span>
                      </div>
                      <div className="bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-150">
                        <span className="text-[8px] text-slate-400 uppercase font-semibold block">Severity Score</span>
                        <span className={`text-xs font-bold ${report.severity >= 75 ? "text-rose-600" : report.severity >= 45 ? "text-amber-600" : "text-emerald-600"}`}>{report.severity}%</span>
                      </div>
                      <div className="bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-150">
                        <span className="text-[8px] text-slate-400 uppercase font-semibold block">Priority</span>
                        <span className={`text-xs font-bold ${report.severity >= 75 ? "text-red-600 font-extrabold animate-pulse" : report.severity >= 45 ? "text-amber-600" : "text-emerald-600"}`}>
                          {report.priority || (report.severity >= 75 ? "Critical" : report.severity >= 45 ? "Medium" : "Low")}
                        </span>
                      </div>
                      <div className="bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-150 font-mono">
                        <span className="text-[8px] text-slate-400 uppercase font-semibold block font-sans">Est. Repair Cost</span>
                        <span className="text-xs font-bold text-blue-600">
                          {report.category === "Pothole" ? "₹15,000" : report.category === "Garbage Overflow" ? "₹5,600" : report.category === "Broken Streetlight" ? "₹9,200" : report.category === "Road Obstruction" ? "₹12,400" : "₹8,300"}
                        </span>
                      </div>
                      <div className="bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-150 font-mono">
                        <span className="text-[8px] text-slate-400 uppercase font-semibold block font-sans">Citizens Affected</span>
                        <span className="text-[11px] font-bold text-violet-600">
                          {(() => {
                            let baseImpact = 400;
                            if (report.category === "Broken Streetlight") baseImpact = 850;
                            else if (report.category === "Pothole") baseImpact = 620;
                            else if (report.category === "Garbage Overflow") baseImpact = 1450;
                            else if (report.category === "Road Obstruction") baseImpact = 1100;
                            return Math.round(baseImpact * (report.severity / 75)).toLocaleString() + "+";
                          })()}
                        </span>
                      </div>
                      <div className="bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-150">
                        <span className="text-[8px] text-slate-400 uppercase font-semibold block">Est. Repair Time</span>
                        <span className="text-xs font-bold text-slate-700">
                          {report.severity >= 75 ? "2 Days" : report.severity >= 45 ? "4 Days" : "7 Days"}
                        </span>
                      </div>
                      <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-150 col-span-2 sm:col-span-3">
                        <span className="text-[8px] text-slate-400 uppercase font-semibold block">Citizen Impact Level</span>
                        <span className={`text-[11px] font-bold ${report.severity >= 75 ? "text-red-650" : report.severity >= 45 ? "text-amber-700" : "text-emerald-700"}`}>
                          {report.severity >= 70 ? "🔥 High Critical (Severe obstruction on transport arteries)" : report.severity >= 40 ? "⚠️ Medium (Minor lanes and neighborhood access risk)" : "✅ Normal / Low Level Hazard"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <span className="text-[9px] font-bold uppercase text-slate-400 tracking-wider block">AI Incident Assessment</span>
                    <p className="text-[11px] text-slate-600 leading-relaxed italic mt-0.5 font-sans">
                      "{report.aiAnalysis.description}"
                    </p>
                  </div>

                  <div>
                    <span className="text-[9px] font-bold uppercase text-slate-400 tracking-wider block mb-1.5">Prescribed Dispatch Priorities</span>
                    <div className="flex flex-col gap-1.5">
                      {report.aiAnalysis.recommendedActions.map((action, i) => (
                        <div key={i} className="flex items-start gap-2 bg-slate-50 hover:bg-slate-100 border border-slate-200/60 p-2.5 rounded-lg transition-colors">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          <span className="text-[11px] text-slate-700 font-medium leading-relaxed">{action}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-slate-400 text-xs text-mono">
                  Loading AI Diagnostic results...
                </div>
              )}
            </div>

            {/* RESOLUTION REVIEW / EVIDENCE AUDIT */}
            {(report.resolution || report.fieldStatus === "RESOLUTION_SUBMITTED") && (
              <div className="bg-white dark:bg-slate-900 border-2 border-emerald-500/30 p-5 rounded-2xl shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping-slow shrink-0" />
                    <h4 className="font-bold text-xs uppercase tracking-wider text-emerald-800">
                      Field Resolution Evidence Review
                    </h4>
                  </div>
                  <span className="text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded border border-emerald-200">
                    {report.fieldStatus === "CLOSED" ? "APPROVED & CLOSED" : "PENDING MUNICIPAL SIGN-OFF"}
                  </span>
                </div>

                {/* Before vs After Photos */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Before Condition</span>
                    <div className="aspect-video bg-slate-100 rounded-lg overflow-hidden border border-slate-200">
                      {report.resolution?.beforeEvidence?.[0] || report.evidenceUrl || report.image ? (
                        <img
                          src={report.resolution?.beforeEvidence?.[0] || report.evidenceUrl || report.image || ""}
                          alt="Before Repair"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-400">
                          Initial Citizen Photo
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">After Repair Evidence</span>
                    <div className="aspect-video bg-slate-100 rounded-lg overflow-hidden border border-slate-200">
                      {report.resolution?.afterEvidence?.[0] ? (
                        <img
                          src={report.resolution?.afterEvidence?.[0]}
                          alt="After Repair"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-400">
                          Awaiting After Photo
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action details */}
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Action:</span>
                    <span className="font-semibold text-slate-800">{report.resolution?.action || "Road Repair Completed"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Submitted By:</span>
                    <span className="font-mono text-slate-700">{report.resolution?.submittedBy || report.assignedTo || "Field Crew"}</span>
                  </div>
                  {report.resolution?.notes && (
                    <div className="pt-1 text-[11px] text-slate-600 border-t border-slate-200/60 mt-1">
                      "{report.resolution.notes}"
                    </div>
                  )}
                </div>

                {/* Municipal Approval Buttons */}
                {isAuthorizedManager && report.fieldStatus === "RESOLUTION_SUBMITTED" && (
                  <div className="flex items-center gap-2 pt-2">
                    <button
                      type="button"
                      disabled={resolutionProcessing}
                      onClick={async () => {
                        setResolutionProcessing(true);
                        try {
                          await approveFieldResolution(report.id, "Director Rachel Chen (Municipal Dispatch)");
                          onClose();
                        } catch (err) {
                          console.error("Failed to approve resolution:", err);
                        } finally {
                          setResolutionProcessing(false);
                        }
                      }}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-2 px-3 rounded-lg text-xs transition flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                      <span>{resolutionProcessing ? "Approving..." : "Approve Resolution"}</span>
                    </button>

                    <button
                      type="button"
                      disabled={resolutionProcessing}
                      onClick={() => setRejectionModalOpen(true)}
                      className="flex-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold py-2 px-3 rounded-lg text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Send Back to Crew</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Officer command action board */}
            {isAuthorizedManager ? (
              <div className="bg-white dark:bg-slate-900 border border-slate-200/80 p-5 rounded-2xl shadow-sm">
                <span className="text-[10px] font-semibold text-blue-600 uppercase tracking-widest block mb-2">Dispatcher Control board</span>
                <h4 className="font-display font-medium text-sm text-slate-800 mb-3 tracking-tight">Modify Status & Dispatch Crew</h4>
                
                <form onSubmit={handleApplyUpdate} className="flex flex-col gap-3 text-xs text-slate-700">
                  
                  {/* Status toggle */}
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Target Workflow Status</label>
                    <div className="grid grid-cols-4 gap-1.5 bg-gray-100 p-1 rounded-lg border border-gray-200">
                      {(["Pending", "Assigned", "In Progress", "Resolved"] as Report["status"][]).map((st) => (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setStatusInput(st)}
                          className={`py-1.5 rounded-md font-bold text-[10px] transition-all text-center cursor-pointer ${
                            statusInput === st
                              ? "bg-white dark:bg-slate-900 text-slate-800 shadow-xs border border-gray-200"
                              : "text-gray-400 hover:text-gray-700"
                          }`}
                        >
                          {st}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Division assignment */}
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Assign Dispatch Crew Unit</label>
                    <select
                      id="assign-crew-select"
                      value={assignedToInput}
                      onChange={(e) => setAssignedToInput(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-gray-200 px-3 py-2 rounded-lg text-slate-800 shadow-2xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-xs font-semibold"
                    >
                      <option value="">-- Unassigned --</option>
                      {DEFAULT_FIELD_TEAMS.map((team) => (
                        <option key={team.id} value={team.name}>
                          {team.name} ({team.district} • {team.availability})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Commentary */}
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Administrative Action Comment</label>
                    <textarea
                      id="update-comment-textarea"
                      rows={2}
                      value={commentInput}
                      onChange={(e) => setCommentInput(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-gray-200 px-3 py-2 rounded-lg text-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-xs"
                      placeholder="Input comments regarding dispatch crews, schedule times, blockages, or closures..."
                      required
                    />
                  </div>

                  {/* Apply actions */}
                  <button
                    id="submit-status-update-btn"
                    type="submit"
                    disabled={updating}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold py-2 rounded-lg shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 font-sans cursor-pointer"
                  >
                    {updating ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Updating Operational Records...</span>
                      </>
                    ) : (
                      <>
                        <span>Apply Status modifications</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>

                </form>
              </div>
            ) : isFieldTeam ? (
              <div className="bg-emerald-50/70 border border-emerald-200 p-5 rounded-2xl text-center shadow-2xs">
                <Wrench className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                <h4 className="font-semibold text-xs text-emerald-800">Field Crew Inspection Mode</h4>
                <p className="text-[11px] text-emerald-700 leading-relaxed max-w-xs mx-auto mt-1">
                  Task acceptance, onsite GPS verification, and completion proof uploads are managed through the <strong>Field Operations Deck</strong>.
                </p>
                <div className="mt-4 p-2 bg-white dark:bg-slate-900 rounded-lg text-[10px] font-semibold text-emerald-800 border border-emerald-200 shadow-2xs">
                  Incident Status: [ {report.status} ] • Assigned To: {report.assignedTo || "Unassigned"}
                </div>
              </div>
            ) : (
              <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl text-center shadow-2xs">
                <ShieldAlert className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <h4 className="font-semibold text-xs text-slate-700">Citizen Read-Only View</h4>
                <p className="text-[11px] text-gray-500 leading-relaxed max-w-xs mx-auto mt-1">
                  Municipality status change tools are restricted. Only registered Smart-City Officers can assign crews and transition workflow status keys on other tickets.
                </p>
                <div className="mt-4 p-2 bg-blue-50 rounded-lg text-[10px] font-semibold text-blue-700 border border-blue-100">
                  Status of this incident is [ {report.status} ]
                </div>
              </div>
            )}

          </div>

        </div>

        {/* MODAL: REJECT RESOLUTION PROMPT */}
        {rejectionModalOpen && (
          <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 rounded-2xl p-6 shadow-2xl max-w-md w-full space-y-4">
              <div className="flex items-center gap-2 text-rose-700 font-bold text-sm">
                <RotateCcw className="w-4 h-4" />
                <span>Return Incident for Crew Rework</span>
              </div>
              <p className="text-xs text-slate-500">
                Specify why this resolution cannot be signed off yet. The field team will be notified with your feedback.
              </p>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Rejection Reason</label>
                  <select
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 font-semibold"
                  >
                    <option value="Incomplete Repair">Incomplete Repair</option>
                    <option value="Substandard Materials / Patching">Substandard Materials / Patching</option>
                    <option value="Unresolved Hazard Condition">Unresolved Hazard Condition</option>
                    <option value="Unclear / Insufficient After Photo">Unclear / Insufficient After Photo</option>
                    <option value="Incorrect GPS / Location Repaired">Incorrect GPS / Location Repaired</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Rectification Instructions for Field Crew</label>
                  <textarea
                    rows={3}
                    placeholder="e.g. Surface layer requires additional compaction and sealant..."
                    value={rejectionNotes}
                    onChange={(e) => setRejectionNotes(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-hidden focus:border-rose-500"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRejectionModalOpen(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={resolutionProcessing || !rejectionNotes.trim()}
                  onClick={async () => {
                    setResolutionProcessing(true);
                    try {
                      await rejectFieldResolution(
                        report.id,
                        "Director Rachel Chen (Municipal Dispatch)",
                        rejectionReason,
                        rejectionNotes.trim()
                      );
                      setRejectionModalOpen(false);
                      onClose();
                    } catch (err) {
                      console.error("Failed to reject resolution:", err);
                    } finally {
                      setResolutionProcessing(false);
                    }
                  }}
                  className="px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-lg transition shadow-xs cursor-pointer"
                >
                  {resolutionProcessing ? "Returning..." : "Send Back for Rework"}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
