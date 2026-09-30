import React, { useState, useRef, DragEvent, useEffect } from "react";
import { 
  Upload, Image as ImageIcon, MapPin, Loader2, Sparkles, AlertCircle, 
  ArrowUpRight, HelpCircle, CheckCircle2, Activity, Shield, Clock, 
  FileImage, Trash2, Camera, X, Compass, Check, AlertTriangle, RefreshCw,
  Building2, Copy
} from "lucide-react";
import { Report, ReportCategory } from "../types";
import { useAuth } from "../context/AuthContext";
import { auth } from "../lib/firebase";
import { validateEvidenceFile, uploadEvidenceImage } from "../services/storageService";
import { validateCoordinates, createReport as createFirestoreReport } from "../services/reportsService";
import { AIAnalysisResponse, validateAIAnalysisOutput } from "../services/aiAnalysisService";
import { createNotification } from "../services/notificationsService";
import CitizenSuccessToast, { getEstimatedResolutionTimeline } from "./CitizenSuccessToast";

interface CitizenUploadProps {
  onReportCreated: (report: Report) => void;
  currentUserEmail: string;
  onViewReportDetails?: (report: Report) => void;
}

type WorkflowStep = "FORM" | "ANALYZING" | "REVIEW" | "IRRELEVANT" | "SUBMITTING" | "SUCCESS";

const DEFAULT_DELHI_COORDS = { lat: 28.6139, lng: 77.2090 };

/**
 * Client-side image compression targeting max 1280px dimension and JPEG quality ~0.75.
 * Keeps file payload lean for fast network uploads and reduces Storage bandwidth.
 */
async function compressImageFile(file: File, maxWidth = 1280, maxHeight = 1280, quality = 0.75): Promise<File> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/") || file.type.includes("svg")) {
      return resolve(file);
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;

      // If dimensions are within bounds and file is reasonably small (< 500KB), keep as-is
      if (width <= maxWidth && height <= maxHeight && file.size < 500 * 1024) {
        return resolve(file);
      }

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(file);

      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) return resolve(file);
          const cleanName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
          const compressed = new File([blob], cleanName, {
            type: "image/jpeg",
            lastModified: Date.now()
          });
          resolve(compressed);
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };
    img.src = objectUrl;
  });
}

export default function CitizenUpload({ onReportCreated, currentUserEmail, onViewReportDetails }: CitizenUploadProps) {
  const { user, userProfile } = useAuth();
  
  // Workflow step
  const [currentStep, setCurrentStep] = useState<WorkflowStep>("FORM");
  
  // Form input states
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ReportCategory>("Pothole");
  const [location, setLocation] = useState("");
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  
  // Evidence image states
  const [rawImageFile, setRawImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Preserve uploaded Storage URL and target report ID for idempotent retries
  const uploadedStorageUrlRef = useRef<string | null>(null);
  const activeReportIdRef = useRef<string | null>(null);

  // Analysis result for review stage
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysisResponse | null>(null);
  const [createdReport, setCreatedReport] = useState<Report | null>(null);

  // Success Toast notification state
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [toastReport, setToastReport] = useState<Report | null>(null);
  const [copiedRefId, setCopiedRefId] = useState(false);

  // Progress and submission states
  const [dragActive, setDragActive] = useState(false);
  const [aiProgress, setAiProgress] = useState<number | null>(null);
  const [aiStatusMessage, setAiStatusMessage] = useState<string>("");
  const [submittingStatus, setSubmittingStatus] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLockRef = useRef(false);

  // Development Diagnostics state
  const [diagTrace, setDiagTrace] = useState({
    submissionStatus: "IDLE" as "IDLE" | "VALIDATING" | "SUCCESS" | "ERROR",
    aiStatus: "PENDING" as "PENDING" | "SUCCESS" | "AI_UNAVAILABLE" | "ERROR",
    storageStatus: "PENDING" as "PENDING" | "SUCCESS" | "ERROR",
    firestoreStatus: "PENDING" as "PENDING" | "SUCCESS" | "ERROR",
    notificationStatus: "PENDING" as "PENDING" | "SUCCESS" | "ERROR" | "SKIPPED",
    reportId: null as string | null,
    lastEvent: "IDLE"
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraNativeInputRef = useRef<HTMLInputElement>(null);

  // Camera handling
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<"environment" | "user">("environment");
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Geolocation
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Cleanup camera stream on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Robustly bind live stream to video element whenever video element or cameraStream updates
  useEffect(() => {
    if (isCameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch((playErr) => {
        console.warn("Video auto-play interrupted:", playErr);
      });
    }
  }, [isCameraActive, cameraStream]);

  const startCamera = async (targetFacing?: "environment" | "user", e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const facing = targetFacing || cameraFacing;
    setCameraError(null);
    setFileError(null);
    setIsCameraLoading(true);
    setIsCameraActive(true);

    // Stop existing stream if active
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        // Fallback for browsers without direct MediaDevices stream access
        setIsCameraActive(false);
        setIsCameraLoading(false);
        cameraNativeInputRef.current?.click();
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });
      } catch (idealErr) {
        console.warn("FacingMode camera ideal constraint failed, attempting generic video:", idealErr);
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });
      }

      streamRef.current = stream;
      setCameraStream(stream);
      setIsCameraLoading(false);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch((err) => console.warn("Video play error:", err));
      }
    } catch (err: any) {
      console.error("Camera access failed:", err);
      let errorMsg = "Could not activate camera. Please confirm device camera permissions or use file upload.";
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        errorMsg = "Camera access denied. Please grant device camera permissions in your browser.";
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        errorMsg = "No suitable camera detected. You can upload an existing photo.";
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        errorMsg = "Camera hardware is in use by another app. Please close other camera tabs.";
      }
      setCameraError(errorMsg);
      setIsCameraActive(false);
      setIsCameraLoading(false);
      setCameraStream(null);
    }
  };

  const toggleCameraFacing = async () => {
    const nextFacing = cameraFacing === "environment" ? "user" : "environment";
    setCameraFacing(nextFacing);
    await startCamera(nextFacing);
  };

  const stopCamera = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraStream(null);
    setIsCameraActive(false);
    setIsCameraLoading(false);
    setCameraError(null);
  };

  const capturePhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!videoRef.current) return;

    try {
      const video = videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;

      const context = canvas.getContext("2d");
      if (context) {
        if (cameraFacing === "user") {
          // Mirror for front camera selfie mode
          context.translate(canvas.width, 0);
          context.scale(-1, 1);
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.80);
        
        // Convert to File object for unified Storage uploads
        fetch(dataUrl)
          .then((res) => res.blob())
          .then((blob) => {
            const capturedFile = new File([blob], `camera_capture_${Date.now()}.jpg`, { type: "image/jpeg" });
            setRawImageFile(capturedFile);
          });

        uploadedStorageUrlRef.current = null;
        activeReportIdRef.current = null;

        const approxBytes = Math.round((dataUrl.length * 3) / 4);
        const sizeStr = approxBytes > 1024 * 1024
          ? `${(approxBytes / (1024 * 1024)).toFixed(1)} MB`
          : `${(approxBytes / 1024).toFixed(0)} KB`;
          
        setFileName(`camera_capture_${Date.now().toString().slice(-6)}.jpg`);
        setFileSize(sizeStr);
        setImagePreview(dataUrl);
        setFileError(null);
        setFormError(null);
      }
      stopCamera();
    } catch (err) {
      console.error("Failed to capture freeze frame image:", err);
      setFileError("Camera capture module failed to process picture.");
    }
  };

  const detectLocation = async (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setDetectingLocation(true);
    setLocationError(null);
    setFormError(null);

    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported by your browser.");
      setDetectingLocation(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setSelectedCoords({ lat: latitude, lng: longitude });

        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`,
            { headers: { "Accept-Language": "en" } }
          );
          if (response.ok) {
            const data = await response.json();
            if (data && data.display_name) {
              const addressObj = data.address || {};
              const roadName = addressObj.road || addressObj.suburb || addressObj.neighbourhood || addressObj.construction || "";
              const cityName = addressObj.city || addressObj.town || addressObj.county || "";
              const shortAddress = roadName 
                ? `${roadName}${cityName ? `, ${cityName}` : ""}` 
                : data.display_name.split(",").slice(0, 3).join(",").trim();
              
              setLocation(shortAddress);
            } else {
              setLocation(`Lat: ${latitude.toFixed(5)}, Lng: ${longitude.toFixed(5)}`);
            }
          } else {
            setLocation(`Lat: ${latitude.toFixed(5)}, Lng: ${longitude.toFixed(5)}`);
          }
        } catch (err) {
          console.warn("Reverse geocoding display name lookup failed:", err);
          setLocation(`Lat: ${latitude.toFixed(5)}, Lng: ${longitude.toFixed(5)}`);
        } finally {
          setDetectingLocation(false);
        }
      },
      (error) => {
        console.error("Geolocation retrieval failed:", error);
        let errorMsg = "Could not access device location.";
        if (error.code === error.PERMISSION_DENIED) {
          errorMsg = "Location permission denied. Please enable location access in browser settings.";
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          errorMsg = "Physical position unavailable. Please check GPS signal or network connectivity.";
        } else if (error.code === error.TIMEOUT) {
          errorMsg = "Request to retrieve device location timed out.";
        }
        setLocationError(errorMsg);
        setDetectingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };
  const handleFileProcess = async (file: File) => {
    const validation = validateEvidenceFile(file);
    if (!validation.valid) {
      setFileError(validation.error || "Invalid file selected.");
      setImagePreview(null);
      setRawImageFile(null);
      setFileName(null);
      setFileSize(null);
      uploadedStorageUrlRef.current = null;
      activeReportIdRef.current = null;
      return;
    }

    setFileError(null);
    setFormError(null);
    uploadedStorageUrlRef.current = null;
    activeReportIdRef.current = null;

    try {
      const compressedFile = await compressImageFile(file, 1280, 1280, 0.75);
      setRawImageFile(compressedFile);
      setFileName(compressedFile.name);

      const compSizeFormatted = compressedFile.size > 1024 * 1024
        ? `${(compressedFile.size / (1024 * 1024)).toFixed(1)} MB`
        : `${(compressedFile.size / 1024).toFixed(0)} KB`;
      setFileSize(compSizeFormatted);

      const reader = new FileReader();
      reader.onload = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(compressedFile);
    } catch (compErr) {
      console.warn("Client-side compression fallback to original file:", compErr);
      setRawImageFile(file);
      setFileName(file.name);
      setFileSize(validation.sizeFormatted || "Unknown size");

      const reader = new FileReader();
      reader.onload = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileProcess(e.target.files[0]);
    }
  };

  const handleDrag = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileProcess(e.dataTransfer.files[0]);
    }
  };

  const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, errorMsg: string): Promise<T> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(errorMsg)), timeoutMs);
      promise.then(
        (res) => { clearTimeout(timer); resolve(res); },
        (err) => { clearTimeout(timer); reject(err); }
      );
    });
  };

  // STEP: Trigger AI Analysis
  const handleTriggerAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setFormError("Please enter an issue title overview.");
      return;
    }
    if (!location.trim()) {
      setFormError("Please specify a street address location.");
      return;
    }
    if (!imagePreview) {
      setFormError("Please attach a photo or visual evidence for AI validation.");
      return;
    }

    setFormError(null);
    setCurrentStep("ANALYZING");
    setAiProgress(10);
    setAiStatusMessage("Connecting to AI evaluation endpoint...");

    console.log("[Diagnostics] AI_VALIDATION_STARTED");
    setDiagTrace(prev => ({ ...prev, aiStatus: "PENDING", lastEvent: "AI_VALIDATION_STARTED" }));

    const progressTimer = setInterval(() => {
      setAiProgress((prev) => {
        if (!prev) return 15;
        if (prev >= 90) return 90;
        return prev + Math.floor(Math.random() * 12) + 6;
      });
    }, 120);

    try {
      const fetchPromise = fetch("/api/ai/analyze-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: imagePreview,
          title,
          description,
          category,
          location
        })
      });

      const response = await withTimeout(fetchPromise, 8000, "AI evaluation timed out after 8 seconds.");

      clearInterval(progressTimer);
      setAiProgress(100);

      if (response.ok) {
        const data = await response.json();
        const validated = validateAIAnalysisOutput(data.analysis);
        
        if (validated.valid && validated.result) {
          const result = validated.result;
          setAiAnalysis(result);

          if (!result.issueDetected) {
            console.log("[Diagnostics] AI_VALIDATION_COMPLETED: NO_HAZARD");
            setDiagTrace(prev => ({ ...prev, aiStatus: "SUCCESS", lastEvent: "AI_VALIDATION_COMPLETED" }));
            setCurrentStep("IRRELEVANT");
            return;
          }

          console.log("[Diagnostics] AI_VALIDATION_COMPLETED: SUCCESS");
          setDiagTrace(prev => ({ ...prev, aiStatus: "SUCCESS", lastEvent: "AI_VALIDATION_COMPLETED" }));
          setCurrentStep("REVIEW");
          return;
        }
      }

      // If 429, error or validation failed
      console.warn("[Diagnostics] AI_VALIDATION_UNAVAILABLE (Status:", response.status, ")");
      setDiagTrace(prev => ({ ...prev, aiStatus: "AI_UNAVAILABLE", lastEvent: "AI_VALIDATION_UNAVAILABLE" }));
      
      // Set honest AI_UNAVAILABLE analysis result
      setAiAnalysis({
        issueDetected: true,
        issueType: category || "Pothole",
        confidence: 0,
        severity: 50,
        priority: "Medium",
        riskLevel: "Medium",
        description: description ? `${description} (AI Validation Unavailable)` : `Report on ${title} (AI Validation Quota Limit)`,
        recommendedActions: ["Manual inspection required by municipal officer"],
        source: "AI_UNAVAILABLE" as any
      });
      setCurrentStep("REVIEW");

    } catch (err: any) {
      console.warn("[Diagnostics] AI_VALIDATION_UNAVAILABLE error:", err?.message || err);
      clearInterval(progressTimer);
      setDiagTrace(prev => ({ ...prev, aiStatus: "AI_UNAVAILABLE", lastEvent: "AI_VALIDATION_UNAVAILABLE" }));
      
      // Allow user to proceed to REVIEW with honest AI_UNAVAILABLE status!
      setAiAnalysis({
        issueDetected: true,
        issueType: category || "Pothole",
        confidence: 0,
        severity: 50,
        priority: "Medium",
        riskLevel: "Medium",
        description: description ? `${description} (AI Validation Unavailable)` : `Report on ${title} (AI Validation Quota/Timeout)`,
        recommendedActions: ["Manual inspection required by municipal officer"],
        source: "AI_UNAVAILABLE" as any
      });
      setCurrentStep("REVIEW");
    } finally {
      clearInterval(progressTimer);
      setAiProgress(null);
      setAiStatusMessage("");
    }
  };

  // STEP: Citizen Confirms and Submits to Firebase Storage + Firestore
  const handleConfirmAndSubmit = async () => {
    if (submitLockRef.current || isSubmitting) return;
    submitLockRef.current = true;
    setIsSubmitting(true);
    setFormError(null);

    console.log("[Diagnostics] SUBMISSION_STARTED");
    setDiagTrace(prev => ({
      ...prev,
      submissionStatus: "VALIDATING",
      lastEvent: "SUBMISSION_VALIDATING"
    }));

    const activeAnalysis = aiAnalysis || {
      issueDetected: true,
      issueType: category || "Other",
      confidence: 0,
      severity: 40,
      priority: "Medium" as const,
      riskLevel: "Low" as const,
      description: description || `Report on ${title}`,
      recommendedActions: ["Inspect reported hazard location"],
      source: "AI_UNAVAILABLE" as const
    };

    setCurrentStep("SUBMITTING");
    setSubmittingStatus("Preparing report evidence and coordinates...");

    const targetLat = selectedCoords?.lat ?? DEFAULT_DELHI_COORDS.lat;
    const targetLng = selectedCoords?.lng ?? DEFAULT_DELHI_COORDS.lng;

    const coordCheck = validateCoordinates(targetLat, targetLng);
    if (!coordCheck.valid) {
      setCurrentStep("REVIEW");
      setFormError(`Geographic coordinate error: ${coordCheck.error}`);
      setDiagTrace(prev => ({ ...prev, submissionStatus: "ERROR", lastEvent: "INVALID_COORDINATES" }));
      submitLockRef.current = false;
      setIsSubmitting(false);
      return;
    }

    const currentAuthUser = auth.currentUser;
    if (!currentAuthUser) {
      setCurrentStep("REVIEW");
      setFormError("Authentication required: Please sign in before submitting an incident report.");
      setDiagTrace(prev => ({ ...prev, submissionStatus: "ERROR", lastEvent: "AUTH_REQUIRED" }));
      submitLockRef.current = false;
      setIsSubmitting(false);
      return;
    }
    const currentUid = currentAuthUser.uid;

    // 0. GENERATE OR PRESERVE REPORT ID
    const targetReportId = activeReportIdRef.current || `UP-${Math.floor(1000 + Math.random() * 9000)}`;
    activeReportIdRef.current = targetReportId;

    // 1. EVIDENCE CHECK & STORAGE UPLOAD
    let finalEvidenceUrl: string | null = uploadedStorageUrlRef.current;

    // If already uploaded previously (e.g. user retrying after a Firestore error), reuse it
    if (finalEvidenceUrl && (finalEvidenceUrl.startsWith("https://") || finalEvidenceUrl.startsWith("http://"))) {
      console.log("[Diagnostics] STORAGE_REUSED: Reusing previously uploaded evidence URL:", finalEvidenceUrl);
      setDiagTrace(prev => ({ ...prev, storageStatus: "SUCCESS", lastEvent: "STORAGE_REUSED" }));
    } else if (rawImageFile && rawImageFile.size > 0) {
      console.log("[Diagnostics] STORAGE_UPLOAD_STARTED");
      setDiagTrace(prev => ({ ...prev, storageStatus: "PENDING", lastEvent: "STORAGE_UPLOAD_STARTED" }));
      setSubmittingStatus("Uploading evidence file to Firebase Storage...");

      try {
        const uploadRes = await uploadEvidenceImage(rawImageFile, currentUid, targetReportId);
        if (uploadRes.success && uploadRes.downloadUrl) {
          finalEvidenceUrl = uploadRes.downloadUrl;
          uploadedStorageUrlRef.current = uploadRes.downloadUrl; // Cache for retry
          console.log("[Diagnostics] STORAGE_UPLOAD_COMPLETED URL:", finalEvidenceUrl);
          setDiagTrace(prev => ({ ...prev, storageStatus: "SUCCESS", lastEvent: "STORAGE_UPLOAD_COMPLETED" }));
        } else {
          // STRICT REQUIREMENT: STOP submission on Storage failure! DO NOT fallback to base64!
          console.error("[Diagnostics] STORAGE_UPLOAD_FAILED:", uploadRes.error);
          setDiagTrace(prev => ({ ...prev, submissionStatus: "ERROR", storageStatus: "ERROR", lastEvent: "STORAGE_UPLOAD_FAILED" }));
          setCurrentStep("REVIEW");
          setFormError(`Evidence image upload failed: ${uploadRes.error || "Firebase Storage connection error"}. Please retry.`);
          submitLockRef.current = false;
          setIsSubmitting(false);
          return;
        }
      } catch (storageErr: any) {
        console.error("[Diagnostics] STORAGE_UPLOAD_EXCEPTION:", storageErr);
        const errDetail = storageErr instanceof Error ? storageErr.message : String(storageErr);
        setDiagTrace(prev => ({ ...prev, submissionStatus: "ERROR", storageStatus: "ERROR", lastEvent: "STORAGE_UPLOAD_ERROR" }));
        setCurrentStep("REVIEW");
        setFormError(`Evidence image upload failed: ${errDetail}. Please retry.`);
        submitLockRef.current = false;
        setIsSubmitting(false);
        return;
      }
    } else {
      console.log("[Diagnostics] STORAGE_UPLOAD_SKIPPED (No evidence attached)");
      finalEvidenceUrl = null;
      setDiagTrace(prev => ({ ...prev, storageStatus: "SUCCESS", lastEvent: "STORAGE_SKIPPED" }));
    }

    // Safety guard: NEVER allow base64 or blob: strings to proceed to Firestore
    if (finalEvidenceUrl && (finalEvidenceUrl.startsWith("data:") || finalEvidenceUrl.startsWith("blob:"))) {
      console.error("[Diagnostics] Base64 / blob URL intercepted before Firestore write!");
      setDiagTrace(prev => ({ ...prev, submissionStatus: "ERROR", storageStatus: "ERROR", lastEvent: "INVALID_EVIDENCE_URL" }));
      setCurrentStep("REVIEW");
      setFormError("Evidence must be uploaded to Firebase Storage before creating report. Please retry.");
      submitLockRef.current = false;
      setIsSubmitting(false);
      return;
    }

    // 2. FIRESTORE WRITE
    console.log("[Diagnostics] FIRESTORE_WRITE_STARTED");
    setDiagTrace(prev => ({ ...prev, firestoreStatus: "PENDING", lastEvent: "FIRESTORE_WRITE_STARTED" }));
    setSubmittingStatus("Writing report record to canonical Firestore database...");

    const isManualSubmission = !aiAnalysis || (activeAnalysis.source as string) === "AI_UNAVAILABLE";
    const reportPayload = {
      id: targetReportId,
      title: title.trim(),
      description: description.trim() || `Report on ${title}`,
      category: (activeAnalysis.issueType || category || "Pothole") as ReportCategory,
      issueType: activeAnalysis.issueType || category || "Pothole",
      severity: isManualSubmission ? 50 : activeAnalysis.severity,
      riskLevel: isManualSubmission ? ("Medium" as const) : activeAnalysis.riskLevel,
      priority: isManualSubmission ? ("Medium" as const) : activeAnalysis.priority,
      confidence: isManualSubmission ? 0 : activeAnalysis.confidence,
      location: location.trim() || "Delhi NCR Jurisdiction",
      latitude: targetLat,
      longitude: targetLng,
      image: finalEvidenceUrl,
      evidenceUrl: finalEvidenceUrl,
      source: "MANUAL_REPORT" as const,
      aiAnalysis: isManualSubmission ? null : {
        category: activeAnalysis.issueType,
        severityScore: activeAnalysis.severity,
        riskLevel: activeAnalysis.riskLevel,
        confidence: activeAnalysis.confidence,
        description: activeAnalysis.description,
        recommendedActions: activeAnalysis.recommendedActions
      }
    };

    try {
      const created = await withTimeout(
        createFirestoreReport(reportPayload, {
          uid: currentUid,
          id: currentUid,
          email: currentAuthUser.email || user?.email || userProfile?.email || currentUserEmail,
          name: currentAuthUser.displayName || userProfile?.name || "Citizen Reporter"
        }),
        12000,
        "Firestore report creation timed out after 12 seconds."
      );

      const actualReportId = created.id;
      console.log("[Diagnostics] FIRESTORE_WRITE_COMPLETED. Report ID:", actualReportId);

      setDiagTrace(prev => ({
        ...prev,
        submissionStatus: "SUCCESS",
        firestoreStatus: "SUCCESS",
        reportId: actualReportId,
        lastEvent: "FIRESTORE_WRITE_COMPLETED"
      }));

      // Successfully saved to Firestore: clear idempotency cache
      activeReportIdRef.current = null;
      uploadedStorageUrlRef.current = null;

      setCreatedReport(created);
      setToastReport(created);
      setShowSuccessToast(true);
      onReportCreated(created);
      setCurrentStep("SUCCESS");
      console.log("[Diagnostics] SUBMISSION_COMPLETED");

      // 3. NON-BLOCKING SECONDARY OPERATIONS (Notification + Server Sync)
      (async () => {
        console.log("[Diagnostics] NOTIFICATION_STARTED");
        setDiagTrace(prev => ({ ...prev, notificationStatus: "PENDING", lastEvent: "NOTIFICATION_STARTED" }));
        try {
          await withTimeout(
            createNotification(
              `New Citizen Report: ${created.title}`,
              `A new incident (${created.category}) has been logged in ${created.location}.`,
              "report_submitted",
              "admin",
              "",
              actualReportId
            ),
            5000,
            "Notification timed out"
          );
          console.log("[Diagnostics] NOTIFICATION_COMPLETED");
          setDiagTrace(prev => ({ ...prev, notificationStatus: "SUCCESS", lastEvent: "NOTIFICATION_COMPLETED" }));
        } catch (notifErr) {
          console.warn("[Diagnostics] NOTIFICATION_FAILED (non-blocking):", notifErr);
          setDiagTrace(prev => ({ ...prev, notificationStatus: "ERROR", lastEvent: "NOTIFICATION_FAILED" }));
        }
      })();

      fetch("/api/reports/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...reportPayload,
          id: actualReportId,
          reporterEmail: currentAuthUser.email || user?.email || userProfile?.email || currentUserEmail
        })
      }).catch(e => console.warn("Backend report sync note:", e));

    } catch (createErr: any) {
      console.error("[Diagnostics] FIRESTORE_WRITE_FAILED:", createErr);
      setDiagTrace(prev => ({ ...prev, submissionStatus: "ERROR", firestoreStatus: "ERROR", lastEvent: "FIRESTORE_WRITE_FAILED" }));
      setCurrentStep("REVIEW");

      let readableError = "Report could not be saved to database. Please retry.";
      if (createErr?.message) {
        try {
          const parsed = JSON.parse(createErr.message);
          if (parsed?.error) {
            readableError = `Firestore database write failed: ${parsed.error}`;
          }
        } catch {
          readableError = `Firestore database write failed: ${createErr.message}`;
        }
      }
      setFormError(readableError);
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    submitLockRef.current = false;
    setIsSubmitting(false);
    activeReportIdRef.current = null;
    uploadedStorageUrlRef.current = null;
    setCurrentStep("FORM");
    setTitle("");
    setDescription("");
    setCategory("Pothole");
    setLocation("");
    setImagePreview(null);
    setRawImageFile(null);
    setFileName(null);
    setFileSize(null);
    setFileError(null);
    setFormError(null);
    setAiAnalysis(null);
    setCreatedReport(null);
    setDiagTrace({
      submissionStatus: "IDLE",
      aiStatus: "PENDING",
      storageStatus: "PENDING",
      firestoreStatus: "PENDING",
      notificationStatus: "PENDING",
      reportId: null,
      lastEvent: "IDLE"
    });
  };

  // Helper for image URLs
  const getDisplayImage = (img: string | null) => {
    if (img && (img.startsWith("data:") || img.startsWith("http:") || img.startsWith("https:") || img.startsWith("blob:"))) {
      return img;
    }
    return img || "";
  };

  // ----------------------------------------------------
  // STEP: IRRELEVANT IMAGE REJECTION VIEW
  // ----------------------------------------------------
  if (currentStep === "IRRELEVANT") {
    return (
      <div className="bg-white dark:bg-slate-900 border border-amber-200 shadow-md rounded-2xl p-6 text-left space-y-4">
        <div className="flex items-center gap-3 p-4 bg-amber-50 rounded-xl border border-amber-250">
          <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0" />
          <div>
            <h4 className="text-sm font-bold uppercase tracking-wider text-amber-900">No Valid Urban Infrastructure Hazard Detected</h4>
            <p className="text-xs text-amber-700 mt-0.5">
              The AI analysis engine inspected the attached photo and did not identify a qualifying road, sanitation, lighting, or municipal issue.
            </p>
          </div>
        </div>

        {imagePreview && (
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">Evaluated Asset</span>
            <div className="relative aspect-video max-h-48 rounded-lg overflow-hidden border border-slate-300">
              <img src={getDisplayImage(imagePreview)} alt="Evaluated" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            </div>
          </div>
        )}

        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 text-xs leading-relaxed space-y-1">
          <p className="font-semibold text-slate-800">Guidelines for Accepted Photos:</p>
          <ul className="list-disc pl-4 text-slate-600 text-[11px] space-y-0.5">
            <li>Road surface damage (potholes, severe asphalt cracks, cave-ins)</li>
            <li>Overflowing public municipal trash bins or illegal dumping</li>
            <li>Broken, dark, or leaning public streetlights</li>
            <li>Blocked public walkways, sidewalks, or road obstruction hazards</li>
          </ul>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            onClick={() => {
              setAiAnalysis({
                issueDetected: true,
                issueType: category || "Other",
                confidence: 0,
                severity: 40,
                priority: "Low",
                riskLevel: "Low",
                description: description || `Citizen-reported issue at ${location || "Delhi NCR"}. (Manual review requested).`,
                recommendedActions: ["Field inspector evaluation requested"],
                source: "MANUAL_USER" as any
              });
              setCurrentStep("REVIEW");
            }}
            className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold py-2.5 px-3 rounded-xl transition-all text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Check className="w-4 h-4" />
            <span>Submit Report Anyway</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setImagePreview(null);
              setRawImageFile(null);
              setCurrentStep("FORM");
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-3 rounded-xl transition-all text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Upload className="w-4 h-4" />
            <span>Select Another Photo</span>
          </button>
          <button
            type="button"
            onClick={() => setCurrentStep("FORM")}
            className="px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl border border-slate-200 transition-all text-xs cursor-pointer"
          >
            Back to Form
          </button>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // STEP: CITIZEN REVIEW VIEW
  // ----------------------------------------------------
  if (currentStep === "REVIEW" && aiAnalysis) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 shadow-md rounded-2xl p-6 text-left space-y-4 animate-fadeIn">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-600 animate-pulse" />
            <div>
              <h4 className="text-sm font-bold text-slate-800">Citizen Review & AI Diagnostics</h4>
              <p className="text-[11px] text-slate-500">Review the AI structural evaluation before submitting to the municipal command grid.</p>
            </div>
          </div>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase ${
            aiAnalysis.source === "AI_GEMINI" 
              ? "bg-blue-50 text-blue-700 border-blue-200" 
              : "bg-amber-50 text-amber-700 border-amber-200"
          }`}>
            {aiAnalysis.source === "AI_GEMINI" ? "✨ Gemini Verified" : "⚠️ Manual Citizen Report"}
          </span>
        </div>

        {formError && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 flex items-start gap-2.5 text-xs">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{formError}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Photo Preview */}
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex flex-col justify-between">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">Evidence Asset</span>
            <div className="relative aspect-video rounded-lg overflow-hidden border border-slate-300 shadow-xs mb-2">
              <img src={getDisplayImage(imagePreview)} alt="Evidence" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            </div>
            <div className="text-[11px] text-slate-600 space-y-0.5">
              <div className="font-semibold text-slate-800 truncate">{title}</div>
              <div className="text-slate-500 flex items-center gap-1 text-[10px]">
                <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                <span className="truncate">{location}</span>
              </div>
            </div>
          </div>

          {/* AI Scorecard */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">AI Evaluation Attributes</span>
            
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-150">
                <span className="text-[9px] text-slate-400 font-bold block uppercase">Issue Category</span>
                <span className="font-bold text-slate-900 block mt-0.5">{aiAnalysis.issueType}</span>
              </div>
              <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-150">
                <span className="text-[9px] text-slate-400 font-bold block uppercase">Severity Score</span>
                <span className="font-bold text-rose-600 block mt-0.5">{aiAnalysis.severity}%</span>
              </div>
              <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-150">
                <span className="text-[9px] text-slate-400 font-bold block uppercase">Priority Level</span>
                <span className={`font-bold block mt-0.5 ${
                  aiAnalysis.priority === "Critical" ? "text-rose-700" :
                  aiAnalysis.priority === "High" ? "text-amber-700" : "text-slate-700"
                }`}>
                  {aiAnalysis.priority} Action
                </span>
              </div>
              <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-150">
                <span className="text-[9px] text-slate-400 font-bold block uppercase">Confidence</span>
                <span className="font-bold text-emerald-700 block mt-0.5">{aiAnalysis.confidence}%</span>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-150 text-xs">
              <span className="text-[9px] text-slate-400 font-bold block uppercase">AI Assessment</span>
              <p className="text-[11px] text-slate-600 italic mt-0.5 leading-relaxed">
                "{aiAnalysis.description}"
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-2 pt-2">
          <button
            type="button"
            id="confirm-submit-report-btn"
            disabled={isSubmitting}
            onClick={handleConfirmAndSubmit}
            className={`flex-1 ${isSubmitting ? "bg-blue-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700 cursor-pointer"} text-white font-bold py-2.5 rounded-xl shadow-xs transition-all text-xs flex items-center justify-center gap-1.5`}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Submitting Report...</span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>Confirm & Submit Report</span>
              </>
            )}
          </button>
          
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => setCurrentStep("FORM")}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 px-4 rounded-xl border border-slate-200 transition-all text-xs cursor-pointer disabled:opacity-50"
          >
            Edit Details
          </button>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleReset}
            className="bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold py-2.5 px-4 rounded-xl border border-rose-100 transition-all text-xs cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
        </div>

        {/* Development Diagnostics Panel */}
        <div className="mt-4 p-3 bg-slate-900 text-slate-200 rounded-xl border border-slate-800 text-xs font-mono space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <span className="font-bold text-blue-400 flex items-center gap-1 text-[11px]">
              <Activity className="w-3.5 h-3.5 text-blue-400" />
              DEVELOPMENT DIAGNOSTICS TRACE
            </span>
            <span className="text-[10px] text-slate-400">Event: {diagTrace.lastEvent}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px]">
            <div className="bg-slate-800/80 p-1.5 rounded">
              <span className="text-slate-400 block text-[9px]">SUBMISSION</span>
              <span className={`font-bold ${
                diagTrace.submissionStatus === "SUCCESS" ? "text-emerald-400" :
                diagTrace.submissionStatus === "VALIDATING" ? "text-amber-400 animate-pulse" :
                diagTrace.submissionStatus === "ERROR" ? "text-rose-400" : "text-slate-300"
              }`}>{diagTrace.submissionStatus}</span>
            </div>
            <div className="bg-slate-800/80 p-1.5 rounded">
              <span className="text-slate-400 block text-[9px]">AI VALIDATION</span>
              <span className={`font-bold ${
                diagTrace.aiStatus === "SUCCESS" ? "text-emerald-400" :
                diagTrace.aiStatus === "PENDING" ? "text-amber-400 animate-pulse" :
                diagTrace.aiStatus === "AI_UNAVAILABLE" ? "text-orange-400" : "text-rose-400"
              }`}>{diagTrace.aiStatus}</span>
            </div>
            <div className="bg-slate-800/80 p-1.5 rounded">
              <span className="text-slate-400 block text-[9px]">STORAGE</span>
              <span className={`font-bold ${
                diagTrace.storageStatus === "SUCCESS" ? "text-emerald-400" :
                diagTrace.storageStatus === "PENDING" ? "text-amber-400 animate-pulse" : "text-rose-400"
              }`}>{diagTrace.storageStatus}</span>
            </div>
            <div className="bg-slate-800/80 p-1.5 rounded">
              <span className="text-slate-400 block text-[9px]">FIRESTORE</span>
              <span className={`font-bold ${
                diagTrace.firestoreStatus === "SUCCESS" ? "text-emerald-400" :
                diagTrace.firestoreStatus === "PENDING" ? "text-amber-400 animate-pulse" : "text-rose-400"
              }`}>{diagTrace.firestoreStatus}</span>
            </div>
            <div className="bg-slate-800/80 p-1.5 rounded">
              <span className="text-slate-400 block text-[9px]">NOTIFICATION</span>
              <span className={`font-bold ${
                diagTrace.notificationStatus === "SUCCESS" ? "text-emerald-400" :
                diagTrace.notificationStatus === "PENDING" ? "text-amber-400 animate-pulse" :
                diagTrace.notificationStatus === "SKIPPED" ? "text-blue-400" : "text-rose-400"
              }`}>{diagTrace.notificationStatus}</span>
            </div>
          </div>
          {diagTrace.reportId && (
            <div className="text-[10px] text-emerald-400 border-t border-slate-800/60 pt-1 flex justify-between font-mono">
              <span>REPORT DOCUMENT ID:</span>
              <span className="font-bold">{diagTrace.reportId}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // STEP: SUBMISSION SUCCESS VIEW
  // ----------------------------------------------------
  if (currentStep === "SUCCESS" && createdReport) {
    const timeline = getEstimatedResolutionTimeline(createdReport);
    const refCode = createdReport.id.startsWith("REP-") 
      ? createdReport.id 
      : `REF-${createdReport.id.substring(0, 8).toUpperCase()}`;

    return (
      <div className="bg-white dark:bg-slate-900 border border-emerald-200 shadow-lg rounded-2xl p-6 text-left space-y-4 animate-fadeIn relative">
        {showSuccessToast && toastReport && (
          <CitizenSuccessToast 
            report={toastReport} 
            onClose={() => setShowSuccessToast(false)} 
            onViewDetails={onViewReportDetails} 
          />
        )}

        <div className="flex items-center justify-between bg-emerald-50 text-emerald-900 p-4 rounded-xl border border-emerald-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-xs font-black uppercase tracking-wider text-emerald-900">Incident Committed to Command Grid</h4>
              <span className="text-[11px] text-emerald-700 font-medium block">
                Logged to Canonical Firestore & Municipal Layer
              </span>
            </div>
          </div>
          <span className="text-[10px] font-mono font-bold bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded border border-emerald-300">
            {timeline.slaCode}
          </span>
        </div>

        {/* Unique Reference ID Card */}
        <div className="bg-slate-900 text-white p-3.5 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Unique Reference Tracking ID
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-mono text-base font-black text-emerald-400 tracking-wide">
                {refCode}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">({createdReport.id})</span>
            </div>
          </div>

          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(createdReport.id);
              setCopiedRefId(true);
              setTimeout(() => setCopiedRefId(false), 2000);
            }}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 border border-slate-700 cursor-pointer self-start sm:self-auto"
          >
            {copiedRefId ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">ID Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>Copy Reference ID</span>
              </>
            )}
          </button>
        </div>

        {/* Estimated Resolution Timeline Box */}
        <div className="bg-gradient-to-br from-emerald-50 via-teal-50 to-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-900 font-bold text-xs">
              <Clock className="w-4 h-4 text-emerald-700" />
              <span>Estimated Resolution Timeline (SLA)</span>
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-emerald-600 text-white shadow-xs">
              {timeline.timeframe}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs">
            <div className="bg-white dark:bg-slate-900/80 dark:bg-slate-900/80 p-2.5 rounded-lg border border-emerald-100 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <div>
                <span className="text-[9px] text-slate-500 uppercase font-bold block">Assigned Ward</span>
                <span className="font-semibold text-slate-800 text-[11px] truncate block">{timeline.department}</span>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900/80 dark:bg-slate-900/80 p-2.5 rounded-lg border border-emerald-100 flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-600 shrink-0" />
              <div>
                <span className="text-[9px] text-slate-500 uppercase font-bold block">Target Resolution</span>
                <span className="font-semibold text-slate-800 text-[11px] truncate block">By {timeline.targetDate}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Logged Evidence */}
        <div className="bg-slate-50 p-3 rounded-xl border border-gray-200">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-2 block">Logged Evidence</span>
          <div className="relative aspect-video max-h-48 rounded-lg overflow-hidden border border-gray-300 shadow-xs">
            <img
              src={getDisplayImage(createdReport.evidenceUrl || createdReport.image)}
              alt="Submitted Evidence"
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
            <div className="absolute top-2 left-2 bg-slate-900/80 px-2 py-0.5 rounded text-[9px] font-mono text-white">
              📝 MANUAL CITIZEN REPORT
            </div>
          </div>
        </div>

        {/* Attributes Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-150">
            <span className="text-[9px] text-slate-400 font-bold block uppercase">Category</span>
            <span className="font-bold text-slate-900 block mt-0.5">{createdReport.category}</span>
          </div>
          <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-150">
            <span className="text-[9px] text-slate-400 font-bold block uppercase">Severity</span>
            <span className="font-bold text-rose-600 block mt-0.5">{createdReport.severity}%</span>
          </div>
          <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-150">
            <span className="text-[9px] text-slate-400 font-bold block uppercase">Priority</span>
            <span className="font-bold text-amber-700 block mt-0.5">{createdReport.priority || createdReport.riskLevel}</span>
          </div>
          <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-150">
            <span className="text-[9px] text-slate-400 font-bold block uppercase">Status</span>
            <span className="font-bold text-blue-700 block mt-0.5">{createdReport.status}</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          {onViewReportDetails && (
            <button
              type="button"
              onClick={() => onViewReportDetails(createdReport)}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl transition-colors text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
            >
              <ArrowUpRight className="w-4 h-4" />
              <span>Track Incident on Command Map</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleReset}
            className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-2.5 rounded-xl border border-slate-200 transition-colors text-xs cursor-pointer flex items-center justify-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
            <span>File Another Incident</span>
          </button>
        </div>

        {/* Development Diagnostics Panel */}
        <div className="mt-4 p-3 bg-slate-900 text-slate-200 rounded-xl border border-slate-800 text-xs font-mono space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <span className="font-bold text-blue-400 flex items-center gap-1 text-[11px]">
              <Activity className="w-3.5 h-3.5 text-blue-400" />
              DEVELOPMENT DIAGNOSTICS TRACE
            </span>
            <span className="text-[10px] text-slate-400">Event: {diagTrace.lastEvent}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px]">
            <div className="bg-slate-800/80 p-1.5 rounded">
              <span className="text-slate-400 block text-[9px]">SUBMISSION</span>
              <span className="font-bold text-emerald-400">SUCCESS</span>
            </div>
            <div className="bg-slate-800/80 p-1.5 rounded">
              <span className="text-slate-400 block text-[9px]">AI VALIDATION</span>
              <span className={`font-bold ${
                diagTrace.aiStatus === "SUCCESS" ? "text-emerald-400" :
                diagTrace.aiStatus === "PENDING" ? "text-amber-400 animate-pulse" :
                diagTrace.aiStatus === "AI_UNAVAILABLE" ? "text-orange-400" : "text-rose-400"
              }`}>{diagTrace.aiStatus}</span>
            </div>
            <div className="bg-slate-800/80 p-1.5 rounded">
              <span className="text-slate-400 block text-[9px]">STORAGE</span>
              <span className={`font-bold ${
                diagTrace.storageStatus === "SUCCESS" ? "text-emerald-400" :
                diagTrace.storageStatus === "PENDING" ? "text-amber-400 animate-pulse" : "text-rose-400"
              }`}>{diagTrace.storageStatus}</span>
            </div>
            <div className="bg-slate-800/80 p-1.5 rounded">
              <span className="text-slate-400 block text-[9px]">FIRESTORE</span>
              <span className="font-bold text-emerald-400">SUCCESS</span>
            </div>
            <div className="bg-slate-800/80 p-1.5 rounded">
              <span className="text-slate-400 block text-[9px]">NOTIFICATION</span>
              <span className={`font-bold ${
                diagTrace.notificationStatus === "SUCCESS" ? "text-emerald-400" :
                diagTrace.notificationStatus === "PENDING" ? "text-amber-400 animate-pulse" :
                diagTrace.notificationStatus === "SKIPPED" ? "text-blue-400" : "text-rose-400"
              }`}>{diagTrace.notificationStatus}</span>
            </div>
          </div>
          {diagTrace.reportId && (
            <div className="text-[10px] text-emerald-400 border-t border-slate-800/60 pt-1 flex justify-between font-mono">
              <span>REPORT DOCUMENT ID:</span>
              <span className="font-bold">{diagTrace.reportId}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // STEP: SUBMITTING / UPLOADING SPINNER VIEW
  // ----------------------------------------------------
  if (currentStep === "SUBMITTING") {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 shadow-md rounded-2xl p-8 text-center space-y-4 animate-fadeIn">
        <div className="relative w-14 h-14 mx-auto flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border-2 border-blue-200 animate-ping opacity-50"></div>
          <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-slate-800">Finalizing Report Submission</h4>
          <p className="text-xs text-slate-500 mt-1">{submittingStatus}</p>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // STEP: PRIMARY FORM VIEW
  // ----------------------------------------------------
  return (
    <div className="bg-white dark:bg-slate-900 border border-gray-200 shadow-sm rounded-2xl p-6 relative">
      {showSuccessToast && toastReport && (
        <CitizenSuccessToast 
          report={toastReport} 
          onClose={() => setShowSuccessToast(false)} 
          onViewDetails={onViewReportDetails} 
        />
      )}
      
      {/* Visual Header */}
      <div className="flex items-center gap-2 mb-4 text-left">
        <Sparkles className="w-5 h-5 text-blue-600 shrink-0" />
        <div>
          <h3 className="font-display font-semibold text-base text-slate-800 tracking-tight leading-5">Infrastructure Report Ingestion</h3>
          <p className="text-[11px] text-gray-500">File a municipal incident report. Our server-side Gemini AI engine will evaluate structural safety hazards.</p>
        </div>
      </div>

      

      {/* Primary Ingestion Form */}
      <form onSubmit={handleTriggerAnalysis} className="flex flex-col gap-4 text-xs text-slate-700 text-left">
        
        {/* Title & category */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">Issue Overview Title</label>
            <input
              id="citizen-title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-50 border border-gray-200 px-3 py-2 rounded-lg text-slate-800 focus:bg-white dark:bg-slate-900 focus:border-blue-500 focus:outline-hidden"
              placeholder="e.g. Broken drainage pipe flooding sidewalk"
              required
            />
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">Incident Category</label>
            <select
              id="citizen-category-select"
              value={category}
              onChange={(e) => setCategory(e.target.value as ReportCategory)}
              className="w-full bg-slate-50 border border-gray-200 px-3 py-2 rounded-lg text-slate-800 focus:bg-white dark:bg-slate-900 focus:border-blue-500 focus:outline-hidden font-semibold"
            >
              <option value="Pothole">🚧 Pothole / Asphalt Fracture</option>
              <option value="Garbage Overflow">🚮 Garbage Overflow / Litter</option>
              <option value="Broken Streetlight">💡 Broken Streetlight / Darkness</option>
              <option value="Road Obstruction">🛑 Road Obstruction / Blockage</option>
              <option value="Vandals / Graffiti">🎨 Vandals / Graffiti Facade</option>
              <option value="Other">❓ Other Incidents</option>
            </select>
          </div>
        </div>

        {/* Location input fields */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] font-bold uppercase text-gray-400 block">Street Address Location</label>
            {selectedCoords && (
              <span className="text-[9px] font-mono font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-150 animate-fadeIn">
                🛰️ GPS: {selectedCoords.lat.toFixed(5)}, {selectedCoords.lng.toFixed(5)}
              </span>
            )}
          </div>
          <div className="relative">
            <input
              id="citizen-location-input"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full bg-slate-50 border border-gray-200 pl-9 pr-24 py-2 rounded-lg text-slate-800 focus:bg-white dark:bg-slate-900 focus:border-blue-500 focus:outline-hidden text-xs font-medium"
              placeholder="e.g. 482 Pine Street, Financial District"
              required
            />
            <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            
            <button
              type="button"
              onClick={detectLocation}
              disabled={detectingLocation}
              className={`absolute right-1.5 top-1 text-[10px] font-bold px-2.5 py-1.2 rounded-md transition-all flex items-center gap-1 cursor-pointer select-none ${
                detectingLocation 
                  ? "bg-slate-100 text-slate-400 cursor-not-allowed" 
                  : "bg-blue-50 hover:bg-blue-100 text-blue-700 active:scale-95 border border-blue-250/20"
              }`}
              title="Detect my current location using GPS"
            >
              {detectingLocation ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                  <span>Finding...</span>
                </>
              ) : (
                <>
                  <Compass className="w-3.5 h-3.5 text-blue-500" />
                  <span>Locate</span>
                </>
              )}
            </button>
          </div>

          {locationError && (
            <div className="mt-1.5 text-rose-600 text-[10px] font-medium flex items-center gap-1.5 justify-start p-2 bg-rose-50/80 rounded-lg border border-rose-150 animate-fadeIn text-left">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-500" />
              <span>{locationError}</span>
            </div>
          )}
        </div>

        {/* Issue Description commentary */}
        <div>
          <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">Incident Description Notes</label>
          <textarea
            id="citizen-description-textarea"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-slate-50 border border-gray-200 px-3 py-2 rounded-lg text-slate-800 focus:bg-white dark:bg-slate-900 focus:border-blue-500 focus:outline-hidden"
            placeholder="Provide context on severity, hazard height, traffic levels, or other variables..."
          />
        </div>

        {/* Form Error Message */}
        {formError && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 flex items-start gap-2.5 animate-fadeIn">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-left text-[11px]">
              <span className="font-bold uppercase tracking-wider block text-rose-800 mb-0.5">VALIDATION WARNING</span>
              <p>{formError}</p>
            </div>
          </div>
        )}

        {/* Evidence File Uploader */}
        <div>
          <label className="text-[10px] font-bold uppercase text-gray-400 block mb-1">Visual Evidence File Upload</label>
          <div
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            className={`relative border-2 border-dashed rounded-xl p-5 text-center flex flex-col items-center justify-center transition-all min-h-[140px] select-none ${
              dragActive 
                ? "border-blue-500 bg-blue-50/70 scale-[0.99] shadow-inner" 
                : "border-gray-200 bg-slate-50 hover:bg-slate-100/50 hover:border-gray-300 shadow-2xs"
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*"
              className="hidden"
            />
            <input
              type="file"
              ref={cameraNativeInputRef}
              onChange={handleFileChange}
              accept="image/*"
              capture="environment"
              className="hidden"
            />

            {dragActive && (
              <div className="absolute inset-0 bg-blue-600/90 backdrop-blur-xs flex flex-col items-center justify-center text-white rounded-xl z-20 pointer-events-none transition-all duration-200">
                <Upload className="w-10 h-10 mb-2 animate-bounce text-blue-100" />
                <span className="font-display font-bold text-xs">Drop Photo Here Immediately!</span>
                <span className="text-[9px] text-blue-200 block mt-0.5">Release to upload evidence asset</span>
              </div>
            )}

            {isCameraActive ? (
              <div className="w-full flex flex-col items-center p-1.5 animate-fadeIn">
                <div className="relative w-full aspect-video bg-slate-950 rounded-lg overflow-hidden border border-slate-800 shadow-inner flex items-center justify-center">
                  {isCameraLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 text-white z-10 gap-2 backdrop-blur-xs">
                      <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
                      <span className="text-[11px] font-mono text-slate-300">Connecting to camera feed...</span>
                    </div>
                  )}

                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    onLoadedMetadata={() => {
                      if (videoRef.current) {
                        videoRef.current.play().catch(() => {});
                      }
                    }}
                    className={`w-full h-full object-cover ${cameraFacing === "user" ? "scale-x-[-1]" : ""}`}
                  />

                  {/* Live Status Badge */}
                  <div className="absolute top-2 right-2 px-2 py-0.5 bg-rose-600/90 text-[9px] font-mono text-white rounded-full flex items-center gap-1.5 shadow-xs backdrop-blur-xs">
                    <span className="w-2 h-2 rounded-full bg-white dark:bg-slate-900 animate-pulse" />
                    <span>LIVE FEED</span>
                  </div>

                  {/* Camera Flip (Rear / Front) */}
                  <button
                    type="button"
                    onClick={toggleCameraFacing}
                    title="Switch Camera (Front / Rear)"
                    className="absolute top-2 left-2 px-2.5 py-1 bg-slate-900/80 hover:bg-slate-800 text-white rounded-lg border border-slate-700 shadow-sm transition-all cursor-pointer flex items-center gap-1.5 text-[10px]"
                  >
                    <RefreshCw className="w-3 h-3 text-blue-400" />
                    <span className="font-sans text-[9px] capitalize">{cameraFacing === "environment" ? "Back Cam" : "Front Cam"}</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 sm:gap-3 mt-4 w-full justify-center flex-wrap">
                  <button
                    type="button"
                    onClick={capturePhoto}
                    disabled={isCameraLoading}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-[11px] px-4 py-2 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Capture Photo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => cameraNativeInputRef.current?.click()}
                    className="bg-slate-800 hover:bg-slate-700 text-white font-semibold text-[11px] px-3 py-2 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                    title="Open device native camera"
                  >
                    <Camera className="w-3 h-3 text-emerald-400" />
                    <span>Native Cam</span>
                  </button>
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-[11px] px-3.5 py-2 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Cancel</span>
                  </button>
                </div>
              </div>
            ) : imagePreview ? (
              <div className="flex flex-col sm:flex-row items-center gap-4 w-full p-2">
                <div className="relative w-full sm:w-36 aspect-video rounded-lg overflow-hidden border border-gray-300 shadow-xs shrink-0 bg-slate-100">
                  <img
                    src={getDisplayImage(imagePreview)}
                    alt="Evidence Thumbnail"
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute top-1 left-1 bg-slate-900/70 text-[8px] font-mono text-white px-1.5 py-0.5 rounded">
                    PREVIEW
                  </div>
                </div>

                <div className="flex-1 text-left w-full space-y-1">
                  <div className="flex items-center gap-1.5 text-slate-800 font-bold text-[11px] flex-wrap">
                    <FileImage className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="truncate max-w-[150px] sm:max-w-[200px]" title={fileName || "Uploaded Evidence"}>
                      {fileName || "Evidence_Photo.jpg"}
                    </span>
                    <span className="bg-emerald-50 text-emerald-850 text-[9px] px-2 py-0.5 rounded-full border border-emerald-200 font-mono">
                      {fileSize || "1.2 MB"}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500">Evidence attached and ready for AI inspection.</p>
                  
                  <div className="flex items-center gap-2 pt-1.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-[10px] font-bold bg-white dark:bg-slate-900 hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                    >
                      <Upload className="w-3 h-3 text-slate-400" />
                      <span>Change Photo</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => startCamera()}
                      className="text-[10px] font-bold bg-white dark:bg-slate-900 hover:bg-slate-50 text-emerald-700 border border-slate-200 hover:border-slate-300 px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Camera</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setImagePreview(null);
                        setRawImageFile(null);
                        setFileName(null);
                        setFileSize(null);
                        setFileError(null);
                      }}
                      className="text-[10px] font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-100 px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3 text-rose-500" />
                      <span>Remove</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-4 text-slate-400 w-full h-full py-4">
                <div className="flex items-center gap-3">
                  <div 
                    onClick={() => fileInputRef.current?.click()} 
                    className="p-3 bg-white dark:bg-slate-900 border border-slate-150 rounded-2xl shadow-2xs hover:scale-105 hover:text-blue-600 transition-all cursor-pointer flex items-center justify-center text-slate-500"
                    title="Browse local files"
                  >
                    <Upload className="w-5 h-5 shrink-0" />
                  </div>
                  <div 
                    onClick={() => startCamera()} 
                    className="p-3 bg-white dark:bg-slate-900 border border-slate-150 rounded-2xl shadow-2xs hover:scale-105 hover:text-emerald-600 transition-all cursor-pointer flex items-center justify-center text-slate-500"
                    title="Take live photo using device camera"
                  >
                    <Camera className="w-5 h-5 shrink-0" />
                  </div>
                </div>
                <div className="space-y-0.5">
                  <p className="font-semibold text-[11px] text-slate-700">
                    Drag & drop evidence photo here, <span onClick={() => fileInputRef.current?.click()} className="text-blue-600 hover:text-blue-700 underline underline-offset-2 cursor-pointer">browse files</span>, or <span onClick={() => startCamera()} className="text-emerald-600 hover:text-emerald-700 underline underline-offset-2 cursor-pointer font-bold">take photo</span>
                  </p>
                  <p className="text-[10px] text-gray-400">Supports high-res PNG, JPG, JPEG, WEBP or HEIC (Max 10MB)</p>
                </div>
              </div>
            )}
          </div>

          {(fileError || cameraError) && (
            <div className="mt-2 text-rose-600 text-[10px] font-medium flex items-center gap-1.5 justify-start p-2 bg-rose-50/80 rounded-lg border border-rose-150 animate-fadeIn text-left">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-500" />
              <span>{fileError || cameraError}</span>
            </div>
          )}
        </div>

        {/* AI Progress HUD */}
        {currentStep === "ANALYZING" && aiProgress !== null && (
          <div className="p-4 bg-slate-900 text-white rounded-xl border border-slate-800 shadow-lg space-y-3 animate-fadeIn">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="relative flex items-center justify-center w-5 h-5">
                  <div className="absolute inset-0 rounded-full border border-blue-400 animate-ping opacity-60"></div>
                  <Sparkles className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                </div>
                <span className="font-sans font-bold text-[11px] uppercase tracking-wider text-blue-300">Guardian AI Structural Diagnostics</span>
              </div>
              <span className="font-mono text-xs font-bold text-blue-400">{aiProgress}%</span>
            </div>

            <div className="space-y-1.5">
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden border border-slate-700">
                <div 
                  className="bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-600 h-full rounded-full transition-all duration-150 ease-out"
                  style={{ width: `${aiProgress}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span className="animate-pulse flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping"></span>
                  {aiStatusMessage}
                </span>
                <span className="font-mono text-[9px] text-slate-500">Secure Gemini Server Pipeline</span>
              </div>
            </div>
          </div>
        )}

        {/* Advisory Warning */}
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 flex items-start gap-2.5">
          <AlertCircle className="w-4.5 h-4.5 text-amber-500 shrink-0 mt-0.5 animate-pulse" />
          <p className="text-[10px] leading-relaxed">
            <strong>Guardian OS Legal Advisory:</strong> Reporting false safety incidents carries municipal penalty fines under civil guidelines. Gemini AI will evaluate visual assets to block spam entries.
          </p>
        </div>

        {/* Submit button */}
        <button
          id="submit-inc-guardian-btn"
          type="submit"
          disabled={currentStep === "ANALYZING"}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold py-2.5 rounded-xl shadow-xs hover:shadow-md transition-all flex items-center justify-center gap-2 text-xs font-sans mt-2 cursor-pointer"
        >
          {currentStep === "ANALYZING" ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Guardian AI Analyzing Visual Structures...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 shrink-0" />
              <span>Submit for AI Analysis & Review</span>
            </>
          )}
        </button>

      </form>
    </div>
  );
}
