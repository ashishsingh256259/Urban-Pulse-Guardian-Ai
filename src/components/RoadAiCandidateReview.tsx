import React, { useState } from "react";
import { 
  CheckCircle2, AlertTriangle, MapPin, Sparkles, ChevronRight, 
  Trash2, Edit3, Image as ImageIcon, Shield, ArrowRight, RefreshCw, 
  Layers, CheckSquare, Square, Eye, Award, ExternalLink, HelpCircle,
  AlertOctagon, Check, X, RotateCcw
} from "lucide-react";
import { RoadScanSession, RoadScanCandidate, Report, ReportCategory, Priority, RiskLevel } from "../types";
import { createReport, validateCoordinates } from "../services/reportsService";
import { uploadReportEvidence } from "../services/storageService";
import { useAuth } from "../context/AuthContext";

interface RoadAiCandidateReviewProps {
  session: RoadScanSession;
  currentUserEmail: string;
  onReportsSubmitted: (newReports: Report[], awardedPoints: number) => void;
  onDiscardSession: () => void;
}

export default function RoadAiCandidateReview({
  session,
  currentUserEmail,
  onReportsSubmitted,
  onDiscardSession
}: RoadAiCandidateReviewProps) {
  const { user, userProfile } = useAuth();
  const currentUid = user?.uid || userProfile?.uid || "anonymous_citizen";
  const effectiveEmail = user?.email || userProfile?.email || currentUserEmail || "citizen@urbanpulse.gov";

  const [candidates, setCandidates] = useState<RoadScanCandidate[]>(session.candidates);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>(
    session.candidates[0]?.id || ""
  );
  const [activeEvidenceFrameIndex, setActiveEvidenceFrameIndex] = useState<number>(0);
  
  // Overall submission process state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionProgress, setSubmissionProgress] = useState<{ current: number; total: number }>({
    current: 0,
    total: session.candidates.length
  });
  const [submittedReportsState, setSubmittedReportsState] = useState<Report[]>([]);
  const [submissionErrorBanner, setSubmissionErrorBanner] = useState<string | null>(null);

  if (candidates.length === 0) {
    return (
      <div className="bg-[#0A0E1A] border border-slate-800 rounded-2xl p-10 text-center shadow-xl flex flex-col items-center justify-center min-h-[50vh]">
        <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mb-6 border border-slate-800">
          <CheckCircle2 className="w-8 h-8 text-emerald-500" />
        </div>
        <h2 className="text-2xl font-black text-white tracking-tight mb-2">Scan Complete</h2>
        <p className="text-slate-400 max-w-md mx-auto mb-8 leading-relaxed">
          No road hazards detected in this scan. The road surface analysis found no actionable issues matching the defined hazard categories.
        </p>
        <button
          onClick={onDiscardSession}
          className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold transition-all border border-slate-700 shadow-md cursor-pointer"
        >
          Return to Scanner
        </button>
      </div>
    );
  }

  // Toggle selection for a single candidate
  const toggleSelectCandidate = (id: string) => {
    if (isSubmitting) return;
    setCandidates((prev) =>
      prev.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c))
    );
  };

  // Toggle select all
  const toggleSelectAll = () => {
    if (isSubmitting) return;
    const allSelected = candidates.every((c) => c.selected);
    setCandidates((prev) => prev.map((c) => ({ ...c, selected: !allSelected })));
  };

  // Currently focused candidate
  const currentCandidate = candidates.find((c) => c.id === selectedCandidateId) || candidates[0];

  // Submit all selected candidate reports to Firestore using the Canonical Report Service
  const handleSubmitSelected = async () => {
    // Only submit candidates that are selected and NOT already submitted
    const toSubmit = candidates.filter((c) => c.selected && c.submissionState !== "SUBMITTED");
    if (toSubmit.length === 0 || isSubmitting) return;

    setIsSubmitting(true);
    setSubmissionErrorBanner(null);
    setSubmissionProgress({ current: 0, total: toSubmit.length });

    const newlyCreatedReports: Report[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < toSubmit.length; i++) {
      const cand = toSubmit[i];
      setSubmissionProgress({ current: i + 1, total: toSubmit.length });

      // Mark candidate as SUBMITTING
      setCandidates((prev) =>
        prev.map((c) => (c.id === cand.id ? { ...c, submissionState: "SUBMITTING", errorMessage: undefined } : c))
      );

      try {
        // Step 23: Coordinate validation
        const coordCheck = validateCoordinates(cand.latitude, cand.longitude);
        if (!coordCheck.valid) {
          throw new Error(coordCheck.error || "Invalid GPS coordinates");
        }

        // Step 14: Evidence upload to Firebase Storage
        let finalEvidenceUrl: string | null = cand.primaryImage;
        if (cand.primaryImage && cand.primaryImage.startsWith("data:")) {
          try {
            const uploadedUrl = await uploadReportEvidence(
              currentUid,
              `road_${cand.id}_${Date.now()}`,
              cand.primaryImage,
              `evidence_${cand.clusterId || "frame"}.jpg`
            );
            if (uploadedUrl) {
              finalEvidenceUrl = uploadedUrl;
            }
          } catch (storageErr) {
            console.warn("Storage upload failed for candidate evidence frame, retaining fallback:", storageErr);
          }
        }

        // Step 13 & 21: Canonical Firestore Report creation with source = ROAD_SCANNER
        const reportPayload = {
          title: `AI Road Scan: ${cand.subCategory || cand.category} (${cand.severity}% Sev)`,
          description: cand.description || `Autonomous dashcam detection with spatial cluster of ${cand.detectionsCount} frames.`,
          category: cand.category,
          severity: cand.severity,
          riskLevel: cand.riskLevel,
          priority: cand.priority,
          confidence: cand.confidence,
          location: cand.location,
          latitude: cand.latitude,
          longitude: cand.longitude,
          image: finalEvidenceUrl,
          source: "ROAD_SCANNER" as const,
          roadScanId: session.id,
          clusterCount: cand.detectionsCount,
          evidenceFrames: cand.evidenceFrames,
          boundingBox: cand.boundingBox,
          aiAnalysis: {
            category: cand.subCategory || cand.category,
            severityScore: cand.severity,
            riskLevel: cand.riskLevel,
            confidence: cand.confidence,
            description: cand.description,
            recommendedActions: cand.recommendedActions
          }
        };

        const createdReport = await createReport(reportPayload, {
          uid: currentUid,
          email: effectiveEmail,
          name: userProfile?.name || user?.displayName || "Citizen Road Scanner"
        });

        if (createdReport && createdReport.id) {
          newlyCreatedReports.push(createdReport);
          successCount++;

          setCandidates((prev) =>
            prev.map((c) =>
              c.id === cand.id
                ? { ...c, submissionState: "SUBMITTED", submittedReportId: createdReport.id }
                : c
            )
          );

          // Also notify backend sync API in the background (non-blocking)
          fetch("/api/reports/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...reportPayload,
              id: createdReport.id,
              userId: currentUid,
              reporterEmail: effectiveEmail
            })
          }).catch((syncErr) => console.warn("Backend sync notification non-blocking notice:", syncErr));
        } else {
          throw new Error("Firestore report creation did not return a valid document ID.");
        }
      } catch (err: any) {
        console.error(`Error submitting candidate ${cand.id}:`, err);
        failureCount++;
        setCandidates((prev) =>
          prev.map((c) =>
            c.id === cand.id
              ? { ...c, submissionState: "FAILED", errorMessage: err.message || "Failed to create Firestore report" }
              : c
          )
        );
      }
    }

    setIsSubmitting(false);

    if (newlyCreatedReports.length > 0) {
      setSubmittedReportsState((prev) => [...prev, ...newlyCreatedReports]);
      onReportsSubmitted(newlyCreatedReports, 0);
    }

    if (failureCount > 0) {
      setSubmissionErrorBanner(`${failureCount} hazard candidate(s) could not be submitted. You can retry failed items individually or adjust selection.`);
    }
  };

  const selectedCount = candidates.filter((c) => c.selected && c.submissionState !== "SUBMITTED").length;
  const submittedCount = candidates.filter((c) => c.submissionState === "SUBMITTED").length;
  const isAllSubmitted = candidates.length > 0 && candidates.every((c) => c.submissionState === "SUBMITTED");
  const failedCount = candidates.filter((c) => c.submissionState === "FAILED").length;

  return (
    <div id="road-candidate-review-container" className="space-y-5">
      {/* HEADER BAR */}
      <div className="bg-[#0A0E1A] border border-slate-800 rounded-2xl p-5 text-white shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black tracking-tight text-slate-100">
                  AI ROAD SCANNER: CANDIDATE REVIEW
                </h1>
                <span className="px-2 py-0.5 bg-emerald-950 text-emerald-400 border border-emerald-800/50 rounded text-[9.5px] font-mono font-bold uppercase tracking-wider">
                  {candidates.length} Unique Spatial {candidates.length === 1 ? "Cluster" : "Clusters"}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Haversine clustering grouped continuous video frames into distinct physical road hazards.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onDiscardSession}
            disabled={isSubmitting}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
          >
            Discard Session
          </button>

          <button
            id="submit-candidates-btn"
            onClick={handleSubmitSelected}
            disabled={isSubmitting || (selectedCount === 0 && failedCount === 0) || isAllSubmitted}
            className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg cursor-pointer ${
              isAllSubmitted
                ? "bg-emerald-700 text-white cursor-default"
                : (selectedCount === 0 && failedCount === 0)
                ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-500 text-white hover:shadow-blue-500/25"
            }`}
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Saving Reports ({submissionProgress.current}/{submissionProgress.total})...</span>
              </>
            ) : isAllSubmitted ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>All {candidates.length} Reports Logged Successfully</span>
              </>
            ) : failedCount > 0 && selectedCount === 0 ? (
              <>
                <RotateCcw className="w-4 h-4" />
                <span>Retry {failedCount} Failed Submission(s)</span>
              </>
            ) : (
              <>
                <Shield className="w-4 h-4" />
                <span>Submit {selectedCount} Selected</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ERROR BANNER FOR PARTIAL FAILURES */}
      {submissionErrorBanner && (
        <div className="p-4 bg-rose-950/70 border border-rose-700/60 rounded-2xl flex items-center justify-between text-rose-200">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <p className="text-xs">{submissionErrorBanner}</p>
          </div>
          <button 
            onClick={() => setSubmissionErrorBanner(null)}
            className="text-xs text-rose-400 hover:text-rose-200 underline ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* SUCCESS BANNER WHEN SUBMITTED */}
      {submittedCount > 0 && (
        <div className="p-4 bg-emerald-950/60 border border-emerald-700/60 rounded-2xl flex items-center justify-between text-emerald-200">
          <div className="flex items-center gap-3">
            <Award className="w-6 h-6 text-emerald-400 shrink-0" />
            <div>
              <p className="text-sm font-bold">
                {submittedCount} Road Hazard {submittedCount > 1 ? "Reports" : "Report"} Successfully Synchronized!
              </p>
              <p className="text-xs text-emerald-400">
                Source tagged as <span className="font-mono font-bold">ROAD_SCANNER</span> • Recorded into municipal intelligence pipeline.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 2-COLUMN REVIEW LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* CANDIDATES LIST (Left 5 Cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between px-1">
            <button
              onClick={toggleSelectAll}
              disabled={isSubmitting}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              {candidates.every((c) => c.selected) ? (
                <CheckSquare className="w-4 h-4 text-blue-400" />
              ) : (
                <Square className="w-4 h-4 text-slate-500" />
              )}
              <span>Select All ({candidates.length})</span>
            </button>
            <span className="text-xs text-slate-500 font-mono">
              {candidates.filter(c => c.selected).length} of {candidates.length} Selected
            </span>
          </div>

          <div className="space-y-2.5 max-h-[640px] overflow-y-auto pr-1 custom-scrollbar">
            {candidates.map((cand) => {
              const isSelected = cand.id === currentCandidate?.id;
              return (
                <div
                  key={cand.id}
                  onClick={() => setSelectedCandidateId(cand.id)}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                    isSelected
                      ? "bg-slate-900 border-blue-500 shadow-md ring-1 ring-blue-500/30"
                      : "bg-slate-950/80 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/50"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelectCandidate(cand.id);
                      }}
                      disabled={isSubmitting || cand.submissionState === "SUBMITTED"}
                      className="mt-0.5 cursor-pointer text-slate-400 hover:text-white disabled:opacity-50"
                    >
                      {cand.submissionState === "SUBMITTED" ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : cand.selected ? (
                        <CheckSquare className="w-4 h-4 text-blue-400" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-600" />
                      )}
                    </button>

                    <div className="w-16 h-14 rounded-xl overflow-hidden bg-slate-900 flex-shrink-0 border border-slate-800">
                      <img
                        src={cand.primaryImage}
                        alt="Candidate preview"
                        className="w-full h-full object-cover"
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-bold text-xs text-slate-200 truncate">
                          {cand.subCategory || cand.category}
                        </span>
                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                          cand.severity > 75 ? "bg-rose-950 text-rose-400 border border-rose-800" : "bg-amber-950 text-amber-400 border border-amber-800"
                        }`}>
                          {cand.severity}% Sev
                        </span>
                      </div>

                      <p className="text-[11px] text-slate-400 truncate mt-0.5 flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-slate-500 flex-shrink-0" />
                        <span className="truncate">{cand.location}</span>
                      </p>

                      <div className="flex items-center gap-2 mt-1.5 text-[10px] font-mono">
                        <span className="text-blue-400">{cand.detectionsCount} {cand.detectionsCount === 1 ? "frame" : "frames"} clustered</span>
                        <span className="text-slate-600">•</span>
                        <span className="text-emerald-400">{cand.confidence}% AI confidence</span>
                      </div>
                    </div>
                  </div>

                  {/* Submission Status Badge */}
                  {cand.submissionState === "SUBMITTING" && (
                    <div className="mt-2 text-[10px] text-blue-400 flex items-center gap-1 font-mono">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      <span>Creating Firestore record...</span>
                    </div>
                  )}
                  {cand.submissionState === "SUBMITTED" && (
                    <div className="mt-2 text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Firestore document: {cand.submittedReportId}</span>
                    </div>
                  )}
                  {cand.submissionState === "FAILED" && (
                    <div className="mt-2 text-[10px] text-rose-400 flex items-center gap-1 font-mono">
                      <AlertTriangle className="w-3 h-3" />
                      <span>Submission Error: {cand.errorMessage}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* CANDIDATE DETAIL & EVIDENCE REEL (Right 7 Cols) */}
        <div className="lg:col-span-7">
          {currentCandidate ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 text-white">
              
              {/* Top Details & Tags */}
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-800">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-blue-950 text-blue-400 border border-blue-800/60 rounded text-[10px] font-mono font-bold">
                      {currentCandidate.clusterId}
                    </span>
                    <h2 className="text-base font-bold text-slate-100">
                      {currentCandidate.subCategory || currentCandidate.category}
                    </h2>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-500" />
                    <span>{currentCandidate.location}</span>
                  </p>
                </div>

                <div className="text-right">
                  <span className={`text-xs font-mono font-bold px-2.5 py-1 rounded-lg ${
                    currentCandidate.riskLevel === "High"
                      ? "bg-rose-950 text-rose-300 border border-rose-800"
                      : "bg-amber-950 text-amber-300 border border-amber-800"
                  }`}>
                    {currentCandidate.riskLevel} Severity ({currentCandidate.severity}/100)
                  </span>
                </div>
              </div>

              {/* Primary Evidence Frame View */}
              <div className="space-y-2">
                <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center">
                  <div className="relative max-w-full max-h-full inline-block">
                    <img
                      src={currentCandidate.evidenceFrames[activeEvidenceFrameIndex] || currentCandidate.primaryImage}
                      alt="Road damage evidence"
                      className="max-w-full max-h-full object-contain block"
                    />
                    {currentCandidate.boundingBox && activeEvidenceFrameIndex === 0 && (
                      <div 
                        className="absolute border-[3px] border-red-500 bg-red-500/30"
                        style={{
                          left: `${currentCandidate.boundingBox.x * 100}%`,
                          top: `${currentCandidate.boundingBox.y * 100}%`,
                          width: `${currentCandidate.boundingBox.width * 100}%`,
                          height: `${currentCandidate.boundingBox.height * 100}%`
                        }}
                      />
                    )}
                  </div>
                  <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur-md px-2.5 py-1 rounded text-[10px] font-mono text-slate-300 border border-white/10">
                    GPS: {currentCandidate.latitude.toFixed(5)}, {currentCandidate.longitude.toFixed(5)}
                  </div>
                </div>

                {/* Evidence Burst Reel (if multiple frames in cluster) */}
                {currentCandidate.evidenceFrames.length > 1 && (
                  <div className="flex items-center gap-2 overflow-x-auto py-1">
                    {currentCandidate.evidenceFrames.map((frameUrl, fIdx) => (
                      <button
                        key={fIdx}
                        onClick={() => setActiveEvidenceFrameIndex(fIdx)}
                        className={`w-16 h-12 rounded-lg overflow-hidden border-2 flex-shrink-0 transition-all cursor-pointer ${
                          activeEvidenceFrameIndex === fIdx ? "border-blue-500 ring-2 ring-blue-500/20" : "border-slate-800 opacity-60 hover:opacity-100"
                        }`}
                      >
                        <img src={frameUrl} alt={`Burst ${fIdx + 1}`} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* AI Description & Recommended Actions */}
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/80 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-blue-400">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Gemini Vision Road Diagnostics</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {currentCandidate.description}
                </p>
                {currentCandidate.recommendedActions?.length > 0 && (
                  <div className="pt-2 border-t border-slate-900 space-y-1">
                    <span className="text-[10px] text-slate-500 uppercase font-mono block">Recommended Municipal Actions:</span>
                    {currentCandidate.recommendedActions.map((act, aIdx) => (
                      <div key={aIdx} className="text-xs text-slate-400 flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-blue-400"></span>
                        <span>{act}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          ) : (
            <div className="h-64 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-center text-slate-500 text-xs">
              Select a candidate from the left list to review evidence.
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
