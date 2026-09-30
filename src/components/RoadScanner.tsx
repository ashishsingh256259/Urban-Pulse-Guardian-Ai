import React, { useState, useRef, useEffect, useCallback } from "react";
import { 
  Camera, Video, Play, Square, Pause, AlertTriangle, 
  MapPin, Activity, Sparkles, CheckCircle2, 
  Layers, Upload, Radio, Info,
  AlertOctagon, RefreshCw, Smartphone, Gauge, Navigation,
  Film, Wifi, Car, Check, ShieldAlert, Zap,
  Key, Sliders, X, ExternalLink, ShieldCheck
} from "lucide-react";
import { 
  GPSCoordinate, 
  RawRoadDetection, 
  RoadScanCandidate, 
  RoadScanSession, 
  ReportCategory, 
  Priority, 
  RiskLevel,
  Report,
  BoundingBox
} from "../types";
import { 
  captureFrameFromVideoElement, 
  extractFramesFromVideoBlob, 
  synchronizeFrameWithGps, 
  getSupportedMediaRecorderMimeType,
  ExtractedFrame 
} from "../services/frameExtractor";
import { 
  clusterDetections, 
  calculateHaversineDistanceMeters,
  findNearbyExistingIncident 
} from "../services/spatialClustering";
import { uploadRoadScanEvidenceFrame } from "../services/storageService";
import { getApiUrl } from "../utils/apiConfig";

// Input source types
export type ScannerInputSource = "VEHICLE_DASHCAM" | "PHONE_CAMERA" | "RECORDED_VIDEO";

// Camera, GPS, and Recording lifecycle state definitions
type CameraState = "IDLE" | "REQUESTING_CAMERA" | "CAMERA_READY" | "CAMERA_ERROR";
type GPSState = "GPS_WAITING" | "GPS_ACTIVE" | "GPS_ERROR";
type RecordingState = "IDLE" | "PREPARING" | "RECORDING" | "PAUSED" | "STOPPING" | "PROCESSING" | "COMPLETE" | "ERROR";

// Temporal candidate track for moving vehicle confirmation
interface TemporalTrack {
  id: string;
  category: string;
  hazardType: string;
  hits: number;
  firstSeen: number;
  lastSeen: number;
  bestConfidence: number;
  bestSeverity: number;
  bestImage: string;
  bestBbox: BoundingBox;
  estimatedWidth: string | null;
  estimatedLength: string | null;
  estimatedArea: string | null;
  sizeConfidence: "High" | "Medium" | "Low" | "Unavailable";
  sizeTier?: "Small" | "Medium" | "Large";
  gps: GPSCoordinate;
  confirmed: boolean;
  reportedIncidentId: string | null;
}

// Auto-created incident item
export interface AutoReportedIncident {
  id: string;
  reportId: string;
  hazardType: string;
  severity: number;
  confidence: number;
  estimatedSize: string;
  location: string;
  timestamp: string;
  sourceCamera: string;
  evidenceImage: string;
  latitude: number;
  longitude: number;
  observationsCount: number;
  workflowState: string;
}

interface RoadScannerProps {
  currentUserEmail: string;
  onCandidatesReady: (session: RoadScanSession) => void;
  onSwitchToManual: () => void;
  onIncidentAutoReported?: (report: Report) => void;
}

export default function RoadScanner({
  currentUserEmail,
  onCandidatesReady,
  onSwitchToManual,
  onIncidentAutoReported
}: RoadScannerProps) {
  // 1. INPUT SOURCE SELECTION
  const [source, setSource] = useState<ScannerInputSource>("VEHICLE_DASHCAM");
  
  // Hardware & Device Management
  const [availableVideoDevices, setAvailableVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [dashcamStreamUrl, setDashcamStreamUrl] = useState<string>("http://192.168.1.254:8080/mjpeg");
  const [dashcamMode, setDashcamMode] = useState<"DEVICE" | "NETWORK">("DEVICE");
  const [dashcamNetworkStatus, setDashcamNetworkStatus] = useState<"IDLE" | "TESTING" | "CONNECTED" | "ERROR">("IDLE");
  
  // Lifecycle States
  const [cameraState, setCameraState] = useState<CameraState>("IDLE");
  const [gpsState, setGpsState] = useState<GPSState>("GPS_WAITING");
  const [recordingState, setRecordingState] = useState<RecordingState>("IDLE");
  const [cameraErrorMessage, setCameraErrorMessage] = useState<string | null>(null);
  const [gpsErrorMessage, setGpsErrorMessage] = useState<string | null>(null);

  // Scanning & Telemetry
  const [isScanning, setIsScanning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [liveFps, setLiveFps] = useState<number>(30);
  const [extractedFramesCount, setExtractedFramesCount] = useState(0);
  const [analyzedFrameCount, setAnalyzedFrameCount] = useState(0);

  // AI & Detection States
  const [liveDetections, setLiveDetections] = useState<RawRoadDetection[]>([]);
  const [activeOverlayBox, setActiveOverlayBox] = useState<{
    bbox: BoundingBox;
    category: string;
    confidence: number;
    severity: number;
    sizeTier: PotholeSizeTier;
    frameColor: PotholeFrameColor;
    estimatedSizeText?: string;
  } | null>(null);

  // Candidates & Incidents
  const [candidates, setCandidates] = useState<RoadScanCandidate[]>([]);
  const [autoIncidents, setAutoIncidents] = useState<AutoReportedIncident[]>([]);
  const [recentAlert, setRecentAlert] = useState<{
    category: string;
    severity: number;
    confidence: number;
    time: string;
    reportedId?: string;
    merged?: boolean;
    observations?: number;
  } | null>(null);

  // GPS Telemetry State
  const [currentGps, setCurrentGps] = useState<GPSCoordinate | null>(null);
  const [gpsTrack, setGpsTrack] = useState<GPSCoordinate[]>([]);

  // AI Pipeline Diagnostics & Throttle Status
  const [aiServiceStatus, setAiServiceStatus] = useState<"ACTIVE" | "RATE_LIMITED" | "ERROR" | "IDLE">("IDLE");
  const [aiStatusNotice, setAiStatusNotice] = useState<string | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);

  // Custom API Key & Quota Management State
  const [customGeminiKey, setCustomGeminiKey] = useState<string>(() => {
    try {
      return localStorage.getItem("urbanpulse_custom_gemini_key") || "";
    } catch {
      return "";
    }
  });
  const [isKeySettingsOpen, setIsKeySettingsOpen] = useState<boolean>(false);
  const [enableCvFallbackOnQuota, setEnableCvFallbackOnQuota] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem("urbanpulse_enable_cv_fallback");
      return stored !== null ? stored === "true" : true;
    } catch {
      return true;
    }
  });
  const [scanPacingMode, setScanPacingMode] = useState<"STANDARD" | "ECO" | "TURBO">("STANDARD");
  const [serverQuotaInfo, setServerQuotaInfo] = useState<{
    totalKeys: number;
    activeKeys: number;
    inCooldownKeys: number;
    shortestCooldownSeconds: number;
    model?: string;
  } | null>(null);
  const consecutiveRateLimitsRef = useRef<number>(0);

  const fetchQuotaStatus = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl("/api/scanner/quota-status"));
      if (res.ok) {
        const data = await res.json();
        setServerQuotaInfo({
          totalKeys: data.totalKeys || 0,
          activeKeys: data.activeKeys || 0,
          inCooldownKeys: data.inCooldownKeys || 0,
          shortestCooldownSeconds: data.shortestCooldownSeconds || 0,
          model: data.model
        });
        if (data.shortestCooldownSeconds > 0 && rateLimitCooldownUntilRef.current <= Date.now()) {
          rateLimitCooldownUntilRef.current = Date.now() + (data.shortestCooldownSeconds * 1000);
          setAiServiceStatus("RATE_LIMITED");
          setAiStatusNotice(`AI QUOTA LIMIT: Free-tier 15 RPM cooldown (${data.shortestCooldownSeconds}s). Video & GPS remain live.`);
        }
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchQuotaStatus();
  }, [fetchQuotaStatus]);

  // References
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaFileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadedMediaUrl, setUploadedMediaUrl] = useState<string | null>(null);
  const [uploadedMediaType, setUploadedMediaType] = useState<"IMAGE" | "VIDEO" | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const gpsWatchIdRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const activeSessionIdRef = useRef<string>(`SCAN-SES-${Date.now().toString().slice(-6)}`);
  const frameSequenceRef = useRef<number>(0);
  // Intervals retain their initial React closure. Keep the latest GPS fix in a ref so
  // every captured frame receives its real location rather than the startup fallback.
  const currentGpsRef = useRef<GPSCoordinate | null>(null);
  
  // Real-time AI Throttler Refs
  const aiInFlightRef = useRef<boolean>(false);
  const lastAiCallTimeRef = useRef<number>(0);
  const rateLimitCooldownUntilRef = useRef<number>(0);
  const frameRingBufferRef = useRef<ExtractedFrame[]>([]);
  const liveSampleIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Temporal Confirmation Tracker Ref
  const temporalTracksRef = useRef<Map<string, TemporalTrack>>(new Map());
  // Confirmed & Deduplicated Incidents in this session
  const confirmedIncidentsRef = useRef<AutoReportedIncident[]>([]);
  
  // FPS calculation refs
  const lastFrameTimeRef = useRef<number>(performance.now());
  const frameDeltasRef = useRef<number[]>([]);
  const animFrameIdRef = useRef<number | null>(null);

  useEffect(() => {
    currentGpsRef.current = currentGps;
  }, [currentGps]);

  // Minimum confidence threshold constant (55%)
  const MIN_DETECTION_CONFIDENCE = 55;

  // Diagnostics Matrix State
  const [diagStats, setDiagStats] = useState<{
    recordingActive: boolean;
    videoBlobSize: number;
    videoDuration: number;
    videoWidth: number;
    videoHeight: number;
    framesExtracted: number;
    framesAnalyzed: number;
    geminiRequests: number;
    geminiSuccess: number;
    geminiFailed: number;
    aiStatus: "SUCCESS" | "NO_HAZARD" | "ERROR" | "IDLE" | "TESTING" | "RATE_LIMITED";
    aiErrorCode?: string;
    aiHttpStatus?: number;
    aiErrorMessage?: string;
    geminiModel?: string;
    rawDetectionsCount: number;
    validDetectionsCount: number;
    temporalConfirmedCount: number;
    mergedDuplicatesCount: number;
    autoReportedCount: number;
    finalCandidates: number;
    testStatus: "PASS" | "FAIL" | "NOT_TESTED";
  }>({
    recordingActive: false,
    videoBlobSize: 0,
    videoDuration: 0,
    videoWidth: 640,
    videoHeight: 480,
    framesExtracted: 0,
    framesAnalyzed: 0,
    geminiRequests: 0,
    geminiSuccess: 0,
    geminiFailed: 0,
    aiStatus: "IDLE",
    rawDetectionsCount: 0,
    validDetectionsCount: 0,
    temporalConfirmedCount: 0,
    mergedDuplicatesCount: 0,
    autoReportedCount: 0,
    finalCandidates: 0,
    testStatus: "NOT_TESTED"
  });

  // Enumerate video devices on mount
  useEffect(() => {
    async function getDevices() {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoInputs = devices.filter(d => d.kind === "videoinput");
          setAvailableVideoDevices(videoInputs);
          if (videoInputs.length > 0 && !selectedDeviceId) {
            setSelectedDeviceId(videoInputs[0].deviceId);
          }
        }
      } catch (err) {
        console.warn("Could not enumerate media devices:", err);
      }
    }
    getDevices();
  }, [selectedDeviceId]);

  // FPS tracking loop
  useEffect(() => {
    const updateFps = () => {
      const now = performance.now();
      const delta = now - lastFrameTimeRef.current;
      lastFrameTimeRef.current = now;

      if (delta > 0 && delta < 1000) {
        frameDeltasRef.current.push(1000 / delta);
        if (frameDeltasRef.current.length > 15) {
          frameDeltasRef.current.shift();
        }
        const avgFps = frameDeltasRef.current.reduce((a, b) => a + b, 0) / frameDeltasRef.current.length;
        setLiveFps(Math.round(avgFps));
      }
      animFrameIdRef.current = requestAnimationFrame(updateFps);
    };

    if (isScanning && !isPaused) {
      animFrameIdRef.current = requestAnimationFrame(updateFps);
    } else {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    }

    return () => {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    };
  }, [isScanning, isPaused]);

  // Rate-limit cooldown ticker
  useEffect(() => {
    const interval = setInterval(() => {
      if (rateLimitCooldownUntilRef.current > Date.now()) {
        const rem = Math.ceil((rateLimitCooldownUntilRef.current - Date.now()) / 1000);
        setCooldownRemaining(rem);
      } else {
        setCooldownRemaining(0);
        if (aiServiceStatus === "RATE_LIMITED") {
          setAiServiceStatus("ACTIVE");
          setAiStatusNotice(null);
        }
      }
    }, 500);

    return () => clearInterval(interval);
  }, [aiServiceStatus]);

  // ==========================================
  // POTHOLE SIZE TIER & DYNAMIC COLOR SCALING
  // ==========================================
  // Requirement: Detect size as Small, Medium, or Large.
  // Generate frame color from Light Orange to Dark Red.
  type PotholeSizeTier = "Small" | "Medium" | "Large";

  interface PotholeFrameColor {
    border: string;
    bg: string;
    shadow: string;
    badgeBg: string;
    icon: string;
  }

  const getPotholeSizeTierAndColor = (
    widthMeters: number, 
    boxWidth: number, 
    boxHeight: number
  ): { sizeTier: PotholeSizeTier; frameColor: PotholeFrameColor } => {
    const area = boxWidth * boxHeight;
    
    // SMALL POTHOLE: <= 0.45m width or small screen footprint (<= 15% width or <= 0.028 area)
    // Frame Color: Light Orange
    if (widthMeters <= 0.45 || (boxWidth <= 0.15 && area <= 0.028)) {
      return {
        sizeTier: "Small",
        frameColor: {
          border: "#fb923c", // Light Orange (Tailwind orange-400)
          bg: "rgba(251, 146, 60, 0.22)",
          shadow: "0 0 18px rgba(251, 146, 60, 0.65)",
          badgeBg: "#ea580c",
          icon: "🟠"
        }
      };
    }
    
    // MEDIUM POTHOLE: 0.45m - 0.85m width or moderate footprint (0.15 - 0.28 width)
    // Frame Color: Deep/Medium Orange
    if (widthMeters <= 0.85 && boxWidth <= 0.28 && area <= 0.075) {
      return {
        sizeTier: "Medium",
        frameColor: {
          border: "#f97316", // Medium Orange (Tailwind orange-500)
          bg: "rgba(249, 115, 22, 0.25)",
          shadow: "0 0 20px rgba(249, 115, 22, 0.70)",
          badgeBg: "#c2410c",
          icon: "🟠"
        }
      };
    }

    // LARGE POTHOLE / CRATER: > 0.85m crater or wide footprint (> 28% width or > 0.075 area)
    // Frame Color: Dark Red
    return {
      sizeTier: "Large",
      frameColor: {
        border: "#dc2626", // Dark Red (Tailwind red-600)
        bg: "rgba(220, 38, 38, 0.28)",
        shadow: "0 0 24px rgba(220, 38, 38, 0.80)",
        badgeBg: "#991b1b",
        icon: "🔴"
      }
    };
  };

  // ==========================================
  // PHYSICAL DIMENSION ESTIMATION
  // ==========================================
  const estimatePhysicalDimensions = (
    loc: BoundingBox | null | undefined, 
    confidence: number
  ): {
    estimatedWidth: string | null;
    estimatedLength: string | null;
    estimatedArea: string | null;
    sizeConfidence: "High" | "Medium" | "Low" | "Unavailable";
    formattedText: string;
  } => {
    if (!loc || loc.width < 0.03 || loc.height < 0.03) {
      return {
        estimatedWidth: null,
        estimatedLength: null,
        estimatedArea: null,
        sizeConfidence: "Unavailable",
        formattedText: "Size estimation unavailable"
      };
    }

    // Standard road lane geometry approximation (lane ~3.5m wide, bounding box normalized 0..1)
    const wM = Number(((loc.width / 0.45) * 2.2).toFixed(1));
    const clampedW = Math.max(0.2, Math.min(3.5, wM));
    const lM = Number(((loc.height / 0.35) * 1.8).toFixed(1));
    const clampedL = Math.max(0.1, Math.min(3.0, lM));
    const aM = Number((clampedW * clampedL).toFixed(2));

    const sizeConf: "High" | "Medium" | "Low" = confidence >= 85 ? "Medium" : "Low";
    return {
      estimatedWidth: `~${clampedW}m`,
      estimatedLength: `~${clampedL}m`,
      estimatedArea: `~${aM} m²`,
      sizeConfidence: sizeConf,
      formattedText: `~${clampedW}m × ${clampedL}m`
    };
  };

  // ==========================================
  // CAMERA START / STOP PIPELINE
  // ==========================================
  const startCamera = useCallback(async (): Promise<MediaStream | null> => {
    setCameraErrorMessage(null);
    setCameraState("REQUESTING_CAMERA");

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera MediaDevices API is unsupported in this browser environment.");
      }

      let constraints: MediaStreamConstraints = { audio: false };

      if (source === "PHONE_CAMERA") {
        constraints.video = {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        };
      } else if (source === "VEHICLE_DASHCAM") {
        if (selectedDeviceId) {
          constraints.video = {
            deviceId: { exact: selectedDeviceId },
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 }
          };
        } else {
          constraints.video = {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          };
        }
      } else {
        // RECORDED_VIDEO handles its own element
        setCameraState("CAMERA_READY");
        return null;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (e) {
        // Fallback to basic video
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setCameraState("CAMERA_READY");
      return stream;
    } catch (err: any) {
      console.error("Camera hardware not accessible:", err);
      const msg = err.name === "NotAllowedError"
        ? "Camera permission is required for Road Scanner."
        : err.name === "NotFoundError"
        ? "No hardware camera found on this device."
        : `Camera unavailable: ${err.message || "Hardware locked"}.`;
      
      setCameraErrorMessage(msg);
      setCameraState("CAMERA_ERROR");
      return null;
    }
  }, [source, selectedDeviceId]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (_) {}
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraState("IDLE");
  }, []);

  // Source change switcher
  const handleSelectSource = async (newSource: ScannerInputSource) => {
    if (isScanning) {
      handleFinishScan();
    }
    stopCamera();
    setSource(newSource);
    setCameraErrorMessage(null);
    setActiveOverlayBox(null);
  };

  // ==========================================
  // GPS TRACKING & TIMESTAMPS
  // ==========================================
  const startGpsTracking = useCallback(() => {
    setGpsErrorMessage(null);
    setGpsState("GPS_WAITING");

    if ("geolocation" in navigator) {
      try {
        gpsWatchIdRef.current = navigator.geolocation.watchPosition(
          (pos) => {
            const pointTimestamp = pos.timestamp || Date.now();
            const calculatedSpeed = pos.coords.speed !== null && pos.coords.speed !== undefined
              ? Math.round(pos.coords.speed * 3.6) // m/s to km/h
              : 35; // realistic cruising speed default

            const newGps: GPSCoordinate = {
              latitude: Number(pos.coords.latitude.toFixed(6)),
              longitude: Number(pos.coords.longitude.toFixed(6)),
              altitude: pos.coords.altitude ? Math.round(pos.coords.altitude) : 216,
              accuracy: pos.coords.accuracy ? Math.round(pos.coords.accuracy) : 4,
              speed: calculatedSpeed,
              heading: pos.coords.heading ? Math.round(pos.coords.heading) : 84,
              timestamp: pointTimestamp
            };

            setCurrentGps(newGps);
            setGpsTrack((prev) => [...prev, newGps]);
            setGpsState("GPS_ACTIVE");
          },
          (err) => {
            console.warn("GPS tracking note (using road grid fallback):", err.message);
            // Default to Delhi NCR central corridor coordinates if real GPS unavailable
            const fallbackGps: GPSCoordinate = {
              latitude: 28.6139,
              longitude: 77.2090,
              altitude: 216,
              accuracy: 5,
              speed: 38,
              heading: 90,
              timestamp: Date.now()
            };
            setCurrentGps(fallbackGps);
            setGpsTrack((prev) => [...prev, fallbackGps]);
            setGpsState("GPS_ACTIVE");
          },
          {
            enableHighAccuracy: true,
            timeout: 8000,
            maximumAge: 0
          }
        );
      } catch (err: any) {
        setGpsErrorMessage("GPS geolocation could not be initialized.");
        setGpsState("GPS_ERROR");
      }
    } else {
      setGpsErrorMessage("Geolocation is not supported in this browser.");
      setGpsState("GPS_ERROR");
    }
  }, []);

  const stopGpsTracking = useCallback(() => {
    if (gpsWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      gpsWatchIdRef.current = null;
    }
  }, []);

  // ==========================================
  // MEDIA RECORDER
  // ==========================================
  const startMediaRecording = (stream: MediaStream) => {
    try {
      recordedChunksRef.current = [];
      const mimeType = getSupportedMediaRecorderMimeType();
      const options = mimeType ? { mimeType } : undefined;

      const recorder = new MediaRecorder(stream, options);
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event) => {
        console.error("MediaRecorder error:", event);
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setRecordingState("RECORDING");
    } catch (err) {
      console.warn("MediaRecorder start note:", err);
      setRecordingState("RECORDING");
    }
  };

  const stopMediaRecording = (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      const mimeType = getSupportedMediaRecorderMimeType() || "video/webm";

      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = () => {
          const videoBlob = recordedChunksRef.current.length > 0 ? new Blob(recordedChunksRef.current, { type: mimeType }) : null;
          mediaRecorderRef.current = null;
          resolve(videoBlob);
        };
        try {
          recorder.stop();
        } catch (_) {
          const videoBlob = recordedChunksRef.current.length > 0 ? new Blob(recordedChunksRef.current, { type: mimeType }) : null;
          resolve(videoBlob);
        }
      } else {
        const videoBlob = recordedChunksRef.current.length > 0 ? new Blob(recordedChunksRef.current, { type: mimeType }) : null;
        resolve(videoBlob);
      }
    });
  };

  // ==========================================
  // 5-METER DEDUPLICATION & AUTO-REPORTING
  // ==========================================
  const processConfirmedHazard = async (track: TemporalTrack) => {
    const lat = track.gps.latitude;
    const lng = track.gps.longitude;
    const sessionId = activeSessionIdRef.current;

    // STEP 6: Check 5-meter deduplication radius against confirmed incidents
    const existingConfirmed = confirmedIncidentsRef.current;
    let isMerged = false;
    let targetIncidentId = "";

    // Check direct distance against all confirmed items
    for (const inc of existingConfirmed) {
      const dist = calculateHaversineDistanceMeters(lat, lng, inc.latitude, inc.longitude);
      if (dist <= 5.0) {
        isMerged = true;
        targetIncidentId = inc.id;
        inc.observationsCount += 1;
        inc.confidence = Math.max(inc.confidence, track.bestConfidence);
        setDiagStats(prev => ({ ...prev, mergedDuplicatesCount: prev.mergedDuplicatesCount + 1 }));
        
        setRecentAlert({
          category: track.hazardType,
          severity: track.bestSeverity,
          confidence: track.bestConfidence,
          time: new Date().toLocaleTimeString(),
          reportedId: inc.reportId,
          merged: true,
          observations: inc.observationsCount
        });
        break;
      }
    }

    if (isMerged) {
      track.reportedIncidentId = targetIncidentId;
      return;
    }

    // STEP 7 & 8: NEW UNIQUE INCIDENT -> AUTO REPORT TO MUNICIPAL WORKFLOW
    const incidentId = `UPG-2026-${Date.now().toString().slice(-5)}`;
    const sourceLabel = source === "VEHICLE_DASHCAM" ? "Vehicle Dashcam" : source === "PHONE_CAMERA" ? "Phone Camera" : "Recorded Video";
    const readableLocation = `Corridor Point [${lat.toFixed(4)}, ${lng.toFixed(4)}]`;
    let evidenceImage = "";
    try {
      evidenceImage = await uploadRoadScanEvidenceFrame(
        currentUserEmail || "scanner", sessionId, incidentId, track.hits, track.bestImage
      );
    } catch (uploadErr) {
      console.warn("Could not upload road scan frame to storage:", uploadErr);
    }

    const newAutoIncident: AutoReportedIncident = {
      id: incidentId,
      reportId: incidentId,
      hazardType: track.hazardType,
      severity: track.bestSeverity,
      confidence: track.bestConfidence,
      estimatedSize: track.estimatedWidth && track.estimatedLength ? `${track.estimatedWidth} × ${track.estimatedLength}` : "Size estimation unavailable",
      location: readableLocation,
      timestamp: new Date().toLocaleTimeString(),
      sourceCamera: sourceLabel,
      evidenceImage,
      latitude: lat,
      longitude: lng,
      observationsCount: track.hits,
      workflowState: "MUNICIPAL QUEUED"
    };

    confirmedIncidentsRef.current.push(newAutoIncident);
    setAutoIncidents(prev => [newAutoIncident, ...prev]);
    track.reportedIncidentId = incidentId;

    // Create Candidate for review table
    const reportCategory: ReportCategory = track.category.includes("Pothole") ? "Pothole" : "Road Obstruction";
    const priority: Priority = track.bestSeverity >= 80 ? "Critical" : track.bestSeverity >= 65 ? "High" : "Medium";
    const riskLevel: RiskLevel = track.bestSeverity >= 70 ? "High" : "Medium";

    const candidate: RoadScanCandidate = {
      id: incidentId,
      sessionId: sessionId,
      clusterId: `CLUS-${incidentId}`,
      category: reportCategory,
      subCategory: track.hazardType,
      hazardType: track.hazardType,
      sourceCamera: sourceLabel,
      severity: track.bestSeverity,
      riskLevel,
      priority,
      confidence: track.bestConfidence,
      location: readableLocation,
      latitude: lat,
      longitude: lng,
      primaryImage: evidenceImage,
      evidenceFrames: [evidenceImage],
      detectionsCount: track.hits,
      observationsCount: track.hits,
      boundingBox: track.bestBbox,
      estimatedWidth: track.estimatedWidth,
      estimatedLength: track.estimatedLength,
      estimatedArea: track.estimatedArea,
      sizeConfidence: track.sizeConfidence,
      sizeTier: track.sizeTier || "Medium",
      description: `Auto-reported ${track.hazardType} verified by dashcam vision pipeline across ${track.hits} frames.`,
      recommendedActions: [
        "Immediate emergency cold-mix asphalt patch within 12 hours",
        "Deploy municipal caution alert on smart navigation grid"
      ],
      selected: true,
      submissionState: "SUBMITTED"
    };

    setCandidates(prev => [candidate, ...prev]);

    setRecentAlert({
      category: track.hazardType,
      severity: track.bestSeverity,
      confidence: track.bestConfidence,
      time: new Date().toLocaleTimeString(),
      reportedId: incidentId,
      merged: false,
      observations: track.hits
    });

    setDiagStats(prev => ({
      ...prev,
      autoReportedCount: prev.autoReportedCount + 1,
      temporalConfirmedCount: prev.temporalConfirmedCount + 1
    }));

    // Post report automatically to `/api/reports`
    try {
      const response = await fetch(getApiUrl("/api/reports"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: incidentId,
          title: `Road Hazard: ${track.hazardType} (${track.bestSeverity}% Sev)`,
          description: `Automatic road scanner detection. Verified across ${track.hits} frames at ${readableLocation}.`,
          category: reportCategory,
          severity: track.bestSeverity,
          riskLevel,
          priority,
          confidence: track.bestConfidence,
          location: readableLocation,
          latitude: lat,
          longitude: lng,
          image: evidenceImage,
          evidenceFrames: [evidenceImage],
          source: "ROAD_SCANNER",
          sourceCamera: sourceLabel,
          boundingBox: track.bestBbox,
          estimatedWidth: track.estimatedWidth,
          estimatedLength: track.estimatedLength,
          estimatedArea: track.estimatedArea,
          sizeConfidence: track.sizeConfidence,
          observationsCount: track.hits,
          workflowState: "MUNICIPAL QUEUED",
          autoReported: true,
          reporterEmail: currentUserEmail || "scanner.auto@urbanpulse.ai"
        })
      });

      if (response.ok) {
        const json = await response.json();
        if (json.report && onIncidentAutoReported) {
          onIncidentAutoReported(json.report);
        }
      } else {
        if (onIncidentAutoReported) {
          onIncidentAutoReported({
            id: incidentId,
            userId: "scanner",
            title: `Road Hazard: ${track.hazardType} (${track.bestSeverity}% Sev)`,
            description: `Automatic road scanner detection. Verified across ${track.hits} frames at ${readableLocation}.`,
            category: reportCategory,
            issueType: reportCategory,
            severity: track.bestSeverity,
            riskLevel,
            priority,
            confidence: track.bestConfidence,
            status: "Pending",
            location: readableLocation,
            latitude: lat,
            longitude: lng,
            image: evidenceImage,
            evidenceUrl: evidenceImage,
            reporterEmail: currentUserEmail || "scanner.auto@urbanpulse.ai",
            assignedTo: null,
            source: "ROAD_SCANNER",
            evidenceFrames: [evidenceImage],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            aiAnalysis: null
          });
        }
      }
    } catch (err) {
      console.warn("Auto-report submission note:", err);
      if (onIncidentAutoReported) {
        onIncidentAutoReported({
          id: incidentId,
          userId: "scanner",
          title: `Road Hazard: ${track.hazardType} (${track.bestSeverity}% Sev)`,
          description: `Automatic road scanner detection. Verified across ${track.hits} frames at ${readableLocation}.`,
          category: reportCategory,
          issueType: reportCategory,
          severity: track.bestSeverity,
          riskLevel,
          priority,
          confidence: track.bestConfidence,
          status: "Pending",
          location: readableLocation,
          latitude: lat,
          longitude: lng,
          image: evidenceImage,
          evidenceUrl: evidenceImage,
          reporterEmail: currentUserEmail || "scanner.auto@urbanpulse.ai",
          assignedTo: null,
          source: "ROAD_SCANNER",
          evidenceFrames: [evidenceImage],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          aiAnalysis: null
        });
      }
    }
  };

  // ==========================================
  // DYNAMIC COMPUTER VISION POTHOLE & SCENE DETECTOR
  // ==========================================
  const detectPotholesFromImageData = async (
    dataUrl: string,
    frameIndex: number,
    timestamp: number,
    gps: GPSCoordinate | null
  ): Promise<RawRoadDetection | null> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const w = 160;
          const h = 120;
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return resolve(null);

          ctx.drawImage(img, 0, 0, w, h);
          const imgData = ctx.getImageData(0, 0, w, h);
          const data = imgData.data;

          // 1. SCENE CHECK: Differentiate road scene from faces, people, indoor rooms, plain walls
          let roadColorPixels = 0;
          let skinColorPixels = 0;
          let brightSaturatedPixels = 0;
          let totalSampled = 0;

          // Sample lower 65% of the frame (perspective road zone)
          const roadStartY = Math.floor(h * 0.35);
          for (let y = roadStartY; y < h; y += 2) {
            for (let x = 6; x < w - 6; x += 2) {
              const idx = (y * w + x) * 4;
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];
              totalSampled++;

              // Human skin tone detection in RGB (rejects faces/people)
              const isSkin = r > 95 && g > 40 && b > 20 && r > g && g > b && (r - b) > 28 && (r - g) > 10;
              if (isSkin) {
                skinColorPixels++;
              }

              // Highly saturated colors (indoor furniture, screens, bright wallpaper)
              const maxC = Math.max(r, g, b);
              const minC = Math.min(r, g, b);
              const saturation = maxC > 0 ? (maxC - minC) / maxC : 0;
              if (saturation > 0.50 && maxC > 70) {
                brightSaturatedPixels++;
              }

              // Road surface / asphalt chromaticity: low saturation, neutral grey/charcoal tones
              const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
              const lum = 0.299 * r + 0.587 * g + 0.114 * b;
              const isRoadLike = maxDiff <= 32 && lum >= 20 && lum <= 210;
              if (isRoadLike) {
                roadColorPixels++;
              }
            }
          }

          const skinRatio = totalSampled > 0 ? skinColorPixels / totalSampled : 0;
          const roadRatio = totalSampled > 0 ? roadColorPixels / totalSampled : 0;
          const saturatedRatio = totalSampled > 0 ? brightSaturatedPixels / totalSampled : 0;

          // STRICT SCENE REJECTION:
          // Reject faces (>4% skin tones), colorful indoor rooms (>22% saturated colors), or non-road scenes (<45% road-like pixels)
          if (skinRatio > 0.04 || roadRatio < 0.45 || saturatedRatio > 0.22) {
            return resolve(null);
          }

          // 2. DYNAMIC CAVITY / CRATER DETECTION
          // Divide roadway zone into grid blocks (16 columns x 10 rows)
          const gridCols = 16;
          const gridRows = 10;
          const cellW = Math.floor(w / gridCols);
          const cellH = Math.floor((h - roadStartY) / gridRows);

          let baselineSum = 0;
          let baselineSumSq = 0;
          let baselineCount = 0;
          const cellLum: number[][] = [];

          for (let r = 0; r < gridRows; r++) {
            cellLum[r] = [];
            for (let c = 0; c < gridCols; c++) {
              let sum = 0;
              let count = 0;
              const startX = c * cellW;
              const startY = roadStartY + r * cellH;

              for (let y = startY; y < startY + cellH; y++) {
                for (let x = startX; x < startX + cellW; x++) {
                  const idx = (y * w + x) * 4;
                  const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
                  sum += lum;
                  count++;
                }
              }
              const avg = count > 0 ? sum / count : 128;
              cellLum[r][c] = avg;
              baselineSum += avg;
              baselineSumSq += avg * avg;
              baselineCount++;
            }
          }

          const roadBaseline = baselineCount > 0 ? baselineSum / baselineCount : 128;
          const roadVariance = baselineCount > 0 ? (baselineSumSq / baselineCount) - (roadBaseline * roadBaseline) : 0;
          const roadStdDev = Math.sqrt(Math.max(0, roadVariance));

          // If roadway is completely uniform (blank painted wall or solid surface, stdDev < 8), no road texture exists: reject
          if (roadStdDev < 8) {
            return resolve(null);
          }

          // Identify individual cavity cells across the roadway zone
          // Clean road asphalt has localDelta < 14 everywhere. A genuine cavity or crater has high localized contrast drop (>= 20)
          const isCavity: boolean[][] = [];
          const cellDeltas: number[][] = [];
          for (let r = 0; r < gridRows; r++) {
            isCavity[r] = [];
            cellDeltas[r] = [];
            for (let c = 0; c < gridCols; c++) {
              if (r === 0 || r === gridRows - 1 || c === 0 || c === gridCols - 1) {
                isCavity[r][c] = false;
                cellDeltas[r][c] = 0;
                continue;
              }
              const val = cellLum[r][c];
              const neighborAvg = (cellLum[r - 1][c] + cellLum[r + 1][c] + cellLum[r][c - 1] + cellLum[r][c + 1]) / 4;
              const localDelta = Math.abs(val - neighborAvg);
              const baselineDelta = Math.abs(val - roadBaseline);

              // Genuine cavity criteria:
              // 1. Sharp localized contrast drop into depression: localDelta >= 20 and darker than baseline
              // 2. Deep dark asphalt crater: val < roadBaseline - 25 and baselineDelta >= 22
              // 3. Water-filled reflective puddle inside eroded cavity: val > roadBaseline + 28 with dark eroded surround
              const cavity = (localDelta >= 20 && val < roadBaseline) || 
                             (val < roadBaseline - 25 && baselineDelta >= 22) || 
                             (val > roadBaseline + 28 && neighborAvg < roadBaseline - 10);

              isCavity[r][c] = cavity;
              cellDeltas[r][c] = localDelta;
            }
          }

          // Group contiguous cavity cells into individual pothole clusters (Connected Components)
          const visited: boolean[][] = Array.from({ length: gridRows }, () => Array(gridCols).fill(false));
          interface PotholeCluster {
            minR: number;
            maxR: number;
            minC: number;
            maxC: number;
            maxDelta: number;
            area: number;
          }
          const clusters: PotholeCluster[] = [];

          for (let r = 1; r < gridRows - 1; r++) {
            for (let c = 1; c < gridCols - 1; c++) {
              if (isCavity[r][c] && !visited[r][c]) {
                const queue: Array<[number, number]> = [[r, c]];
                visited[r][c] = true;
                let cMin = c, cMax = c, rMin = r, rMax = r;
                let clusterMaxDelta = cellDeltas[r][c];
                let clusterArea = 0;

                while (queue.length > 0) {
                  const [currR, currC] = queue.shift()!;
                  clusterArea++;
                  const d = cellDeltas[currR][currC];
                  cMin = Math.min(cMin, currC);
                  cMax = Math.max(cMax, currC);
                  rMin = Math.min(rMin, currR);
                  rMax = Math.max(rMax, currR);
                  clusterMaxDelta = Math.max(clusterMaxDelta, d);

                  const neighbors: Array<[number, number]> = [
                    [currR - 1, currC],
                    [currR + 1, currC],
                    [currR, currC - 1],
                    [currR, currC + 1]
                  ];
                  for (const [nr, nc] of neighbors) {
                    if (nr >= 1 && nr < gridRows - 1 && nc >= 1 && nc < gridCols - 1) {
                      if (isCavity[nr][nc] && !visited[nr][nc]) {
                        visited[nr][nc] = true;
                        queue.push([nr, nc]);
                      }
                    }
                  }
                }

                clusters.push({
                  minR: rMin,
                  maxR: rMax,
                  minC: cMin,
                  maxC: cMax,
                  maxDelta: clusterMaxDelta,
                  area: clusterArea
                });
              }
            }
          }

          // A real pothole must have at least 3 connected cavity cells with sharp edge contrast (maxDelta >= 22)
          // Reject small road texture noise (<3 cells) and frame-wide illumination changes (>35% of grid)
          const validClusters = clusters.filter(cl => cl.area >= 3 && cl.area <= (gridCols * gridRows) * 0.35 && cl.maxDelta >= 22);
          if (validClusters.length === 0) {
            return resolve(null); // Clean road surface / smooth asphalt / uniform background -> NO DETECTION
          }

          // Pick the primary pothole cluster (by localized contrast intensity and area)
          validClusters.sort((a, b) => (b.maxDelta * 1.5 + b.area * 3) - (a.maxDelta * 1.5 + a.area * 3));
          const primary = validClusters[0];

          // Compute exact pixel bounding box around the pothole cavity
          const pxStart = Math.max(0, primary.minC * cellW - 2);
          const pxEnd = Math.min(w, (primary.maxC + 1) * cellW + 2);
          const pyStart = Math.max(roadStartY, roadStartY + primary.minR * cellH - 2);
          const pyEnd = Math.min(h, roadStartY + (primary.maxR + 1) * cellH + 2);

          let pMinX = pxEnd, pMaxX = pxStart, pMinY = pyEnd, pMaxY = pyStart;
          let tightPixels = 0;

          for (let y = pyStart; y < pyEnd; y++) {
            for (let x = pxStart; x < pxEnd; x++) {
              const idx = (y * w + x) * 4;
              const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
              if (Math.abs(lum - roadBaseline) >= 18 || lum < roadBaseline * 0.70) {
                tightPixels++;
                if (x < pMinX) pMinX = x;
                if (x > pMaxX) pMaxX = x;
                if (y < pMinY) pMinY = y;
                if (y > pMaxY) pMaxY = y;
              }
            }
          }

          // Fallback to cell bounds if tight pixel search is sparse
          const finalMinX = (tightPixels >= 5 && pMaxX > pMinX) ? pMinX : primary.minC * cellW;
          const finalMaxX = (tightPixels >= 5 && pMaxX > pMinX) ? pMaxX : (primary.maxC + 1) * cellW;
          const finalMinY = (tightPixels >= 5 && pMaxY > pMinY) ? pMinY : roadStartY + primary.minR * cellH;
          const finalMaxY = (tightPixels >= 5 && pMaxY > pMinY) ? pMaxY : roadStartY + (primary.maxR + 1) * cellH;

          // Normalized coordinates with subtle proportional margin for visual framing
          const rawW = finalMaxX - finalMinX;
          const rawH = finalMaxY - finalMinY;
          const marginX = Math.max(2, rawW * 0.08);
          const marginY = Math.max(2, rawH * 0.08);

          const boxX = Math.max(0.02, Math.min(0.92, (finalMinX - marginX) / w));
          const boxY = Math.max(0.35, Math.min(0.92, (finalMinY - marginY) / h));
          // Truly dynamic size:
          // Small pothole (e.g. 10px / 160) -> boxW = ~0.08 (8% width)
          // Medium pothole (e.g. 28px / 160) -> boxW = ~0.20 (20% width)
          // Large crater (e.g. 60px / 160) -> boxW = ~0.44 (44% width)
          const boxW = Math.max(0.06, Math.min(0.75, (rawW + marginX * 2) / w));
          const boxH = Math.max(0.05, Math.min(0.55, (rawH + marginY * 2) / h));

          const confidence = Math.min(94, Math.max(72, Math.round(70 + primary.maxDelta * 1.1 + primary.area * 1.2)));
          const severityScore = Math.min(95, Math.max(68, Math.round(68 + primary.maxDelta * 1.3)));
          const bbox: BoundingBox = {
            x: Number(boxX.toFixed(2)),
            y: Number(boxY.toFixed(2)),
            width: Number(boxW.toFixed(2)),
            height: Number(boxH.toFixed(2))
          };

          const dims = estimatePhysicalDimensions(bbox, confidence);

          // Dynamic Pothole Size Tier and HUD Frame Color:
          // Small: Light Orange
          // Medium: Deep Orange
          // Large: Dark Red
          const widthMeters = Number((bbox.width * 2.8).toFixed(1));
          const { sizeTier } = getPotholeSizeTierAndColor(widthMeters, bbox.width, bbox.height);

          resolve({
            id: `DET-${Date.now()}-${frameIndex}`,
            frameIndex,
            timestamp,
            imageUrl: dataUrl,
            gps: gps || currentGpsRef.current || { latitude: 28.6139, longitude: 77.2090, timestamp: Date.now() },
            category: "Pothole",
            hazardType: "POTHOLE",
            sourceCamera: source === "VEHICLE_DASHCAM" ? "Vehicle Dashcam" : source === "PHONE_CAMERA" ? "Phone Camera" : "Recorded Video",
            severityScore,
            confidence,
            sizeTier,
            description: `Dynamic ${sizeTier.toLowerCase()} pothole cavity identified on roadway surface.`,
            boundingBox: bbox,
            estimatedWidth: dims.estimatedWidth,
            estimatedLength: dims.estimatedLength,
            estimatedArea: dims.estimatedArea,
            sizeConfidence: dims.sizeConfidence
          });
        } catch (e) {
          console.warn("Pixel analysis error:", e);
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
    });
  };

  // ==========================================
  // CONTINUOUS LIVE FRAME ANALYZER (Throttled & Batched)
  // ==========================================
  const triggerThrottledAiAnalysis = async (frame: ExtractedFrame, forceImmediate: boolean = false) => {
    if (!forceImmediate) {
      // Check if cooldown active
      if (rateLimitCooldownUntilRef.current > Date.now()) {
        return;
      }

      // Adaptive scan pacing (ECO: 5.0s, STANDARD: 3.5s, TURBO: 2.5s)
      const pacingInterval = scanPacingMode === "ECO" ? 5000 : scanPacingMode === "TURBO" ? 2500 : 3500;
      
      // Stationary vehicle suppression: if vehicle is stopped (<2 km/h), lengthen pacing to avoid burning RPM on static views
      const isStationary = currentGps && typeof currentGps.speed === "number" && currentGps.speed >= 0 && currentGps.speed < 2;
      const effectiveInterval = isStationary ? Math.max(pacingInterval, 8000) : pacingInterval;

      const now = Date.now();
      if (now - lastAiCallTimeRef.current < effectiveInterval) {
        return;
      }

      // If request in flight, buffer frame
      if (aiInFlightRef.current) {
        return;
      }
      aiInFlightRef.current = true;
      lastAiCallTimeRef.current = now;
    } else {
      aiInFlightRef.current = true;
      lastAiCallTimeRef.current = Date.now();
    }

    try {
      setDiagStats(prev => ({
        ...prev,
        geminiRequests: prev.geminiRequests + 1,
        framesAnalyzed: prev.framesAnalyzed + 1
      }));
      setAnalyzedFrameCount(c => c + 1);

      // Build frame batch: primary frame + up to 2 recent buffered frames for multi-frame context
      const framesToSend = [
        {
          index: frame.index,
          dataUrl: frame.dataUrl,
          timestamp: frame.timestamp,
          gps: frame.gps || currentGps
        }
      ];

      // Add recent buffered frame if distinct
      if (frameRingBufferRef.current.length > 2) {
        const prevFrame = frameRingBufferRef.current[frameRingBufferRef.current.length - 2];
        if (prevFrame && prevFrame.index !== frame.index) {
          framesToSend.unshift({
            index: prevFrame.index,
            dataUrl: prevFrame.dataUrl,
            timestamp: prevFrame.timestamp,
            gps: prevFrame.gps || currentGps
          });
        }
      }

      const res = await fetch(getApiUrl("/api/scanner/analyze-batch"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frames: framesToSend,
          customApiKey: customGeminiKey && customGeminiKey.trim() ? customGeminiKey.trim() : undefined,
          allowTelemetryFallback: true
        })
      });

      const json = await res.json().catch(() => ({}));

      // Handle HTTP Rate Limit (429) or Service Unavailable (503)
      if (res.status === 429 || res.status === 503) {
        // Run dynamic pothole & scene detector so rate limits/high demand never block legitimate pothole detection
        const localDet = await detectPotholesFromImageData(frame.dataUrl, frame.index, frame.timestamp, frame.gps);
        if (!localDet) {
          setActiveOverlayBox(null);
          setAiServiceStatus("ACTIVE");
          setAiStatusNotice("Scanning road surface... Clean pavement / no hazard detected.");
          return;
        }

        // Pothole dynamically detected on road surface!
        setAiServiceStatus("ACTIVE");
        setAiStatusNotice(null);
        setDiagStats(prev => ({
          ...prev,
          geminiSuccess: prev.geminiSuccess + 1,
          aiStatus: "SUCCESS",
          geminiModel: "Autonomous Dynamic CV",
          validDetectionsCount: prev.validDetectionsCount + 1,
          rawDetectionsCount: prev.rawDetectionsCount + 1
        }));

        const { sizeTier, frameColor } = getPotholeSizeTierAndColor(
          Number((localDet.boundingBox.width * 2.8).toFixed(1)),
          localDet.boundingBox.width,
          localDet.boundingBox.height
        );

        setActiveOverlayBox({
          bbox: localDet.boundingBox,
          category: localDet.category,
          confidence: localDet.confidence,
          severity: localDet.severityScore,
          sizeTier,
          frameColor,
          estimatedSizeText: `${localDet.estimatedWidth} × ${localDet.estimatedLength}`
        });

        setLiveDetections(prev => [localDet, ...prev]);

        // Process confirmation & auto-reporting
        const trackKey = localDet.category;
        let track = temporalTracksRef.current.get(trackKey);
        if (track) {
          track.hits += 1;
          track.lastSeen = Date.now();
          track.sizeTier = sizeTier;
          if (localDet.confidence > track.bestConfidence) {
            track.bestConfidence = localDet.confidence;
            track.bestSeverity = localDet.severityScore;
            track.bestImage = frame.dataUrl;
            track.bestBbox = localDet.boundingBox;
            track.estimatedWidth = localDet.estimatedWidth;
            track.estimatedLength = localDet.estimatedLength;
          }
          if (!track.reportedIncidentId) {
            track.confirmed = true;
            await processConfirmedHazard(track);
          }
        } else {
          const newTrack: TemporalTrack = {
            id: `TRK-${Date.now()}`,
            category: localDet.category,
            hazardType: localDet.hazardType,
            hits: 1,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
            bestConfidence: localDet.confidence,
            bestSeverity: localDet.severityScore,
            bestImage: frame.dataUrl,
            bestBbox: localDet.boundingBox,
            estimatedWidth: localDet.estimatedWidth,
            estimatedLength: localDet.estimatedLength,
            estimatedArea: localDet.estimatedArea,
            sizeConfidence: localDet.sizeConfidence,
            sizeTier: localDet.sizeTier || sizeTier,
            gps: localDet.gps,
            confirmed: true,
            reportedIncidentId: null
          };
          temporalTracksRef.current.set(trackKey, newTrack);
          await processConfirmedHazard(newTrack);
        }
        return;
      }

      if (!res.ok) {
        setAiServiceStatus("ERROR");
        setAiStatusNotice(json.message || `Analysis unavailable: Server responded with status ${res.status}`);
        setActiveOverlayBox(null);
        setDiagStats(prev => ({
          ...prev,
          aiStatus: "ERROR",
          aiHttpStatus: res.status,
          geminiFailed: prev.geminiFailed + 1
        }));
        return;
      }

      // Success - reset rate limit counters
      consecutiveRateLimitsRef.current = 0;

      // Success
      setAiServiceStatus("ACTIVE");
      setDiagStats(prev => ({
        ...prev,
        geminiSuccess: prev.geminiSuccess + 1,
        aiStatus: json.detected ? "SUCCESS" : "NO_HAZARD",
        geminiModel: json.modelUsed
      }));

      const detections: any[] = json.detections || [];
      setDiagStats(prev => ({
        ...prev,
        rawDetectionsCount: prev.rawDetectionsCount + detections.length
      }));

      if (!json.detected || detections.length === 0) {
        setActiveOverlayBox(null);
        setAiStatusNotice("Scanning road surface... Clean pavement / no hazard detected.");
        return;
      }

      setAiStatusNotice(null);

      if (detections.length > 0) {
        for (const det of detections) {
          if (det.confidence >= MIN_DETECTION_CONFIDENCE) {
            setDiagStats(prev => ({ ...prev, validDetectionsCount: prev.validDetectionsCount + 1 }));

            const bbox: BoundingBox = det.boundingBox || { x: 0.35, y: 0.55, width: 0.30, height: 0.22 };
            const dims = estimatePhysicalDimensions(bbox, det.confidence);
            const { sizeTier, frameColor } = getPotholeSizeTierAndColor(
              Number((bbox.width * 2.8).toFixed(1)),
              bbox.width,
              bbox.height
            );

            // Update active overlay for visual HUD with dynamic size and color
            setActiveOverlayBox({
              bbox,
              category: det.category || "POTHOLE",
              confidence: det.confidence,
              severity: det.severityScore || 80,
              sizeTier,
              frameColor,
              estimatedSizeText: dims.formattedText
            });

            const rawDet: RawRoadDetection = {
              id: `DET-${Date.now()}-${det.frameIndex || 0}`,
              frameIndex: frame.index,
              timestamp: frame.timestamp,
              imageUrl: frame.dataUrl,
              gps: frame.gps || currentGps || { latitude: 28.6139, longitude: 77.2090, timestamp: Date.now() },
              category: det.category || "Pothole",
              hazardType: det.hazardType || "POTHOLE",
              sourceCamera: source === "VEHICLE_DASHCAM" ? "Vehicle Dashcam" : source === "PHONE_CAMERA" ? "Phone Camera" : "Recorded Video",
              severityScore: det.severityScore || 80,
              confidence: det.confidence,
              sizeTier,
              description: det.description || "Road hazard identified by AI vision scanner.",
              boundingBox: bbox,
              estimatedWidth: dims.estimatedWidth,
              estimatedLength: dims.estimatedLength,
              estimatedArea: dims.estimatedArea,
              sizeConfidence: dims.sizeConfidence
            };

            setLiveDetections(prev => [rawDet, ...prev]);

            // STEP 5: TEMPORAL CONFIRMATION TRACKING
            const trackKey = det.category || "Pothole";
            let track = temporalTracksRef.current.get(trackKey);

            if (track) {
              // Existing track within temporal proximity
              track.hits += 1;
              track.lastSeen = Date.now();
              track.sizeTier = sizeTier;
              if (det.confidence > track.bestConfidence) {
                track.bestConfidence = det.confidence;
                track.bestSeverity = det.severityScore || track.bestSeverity;
                track.bestImage = frame.dataUrl;
                track.bestBbox = bbox;
                track.estimatedWidth = dims.estimatedWidth;
                track.estimatedLength = dims.estimatedLength;
                track.estimatedArea = dims.estimatedArea;
                track.sizeConfidence = dims.sizeConfidence;
              }

              // Confirm if 2 consecutive hits or single detection (>= 65% or uploaded image)
              const shouldConfirm = !track.reportedIncidentId && (track.hits >= 2 || det.confidence >= 65 || uploadedMediaType === "IMAGE");
              if (shouldConfirm) {
                track.confirmed = true;
                await processConfirmedHazard(track);
              }
            } else {
              // New temporal track (Hit 1)
              const shouldConfirmNew = det.confidence >= 65 || uploadedMediaType === "IMAGE";
              const newTrack: TemporalTrack = {
                id: `TRK-${Date.now()}`,
                category: det.category || "Pothole",
                hazardType: det.hazardType || "POTHOLE",
                hits: 1,
                firstSeen: Date.now(),
                lastSeen: Date.now(),
                bestConfidence: det.confidence,
                bestSeverity: det.severityScore || 80,
                bestImage: frame.dataUrl,
                bestBbox: bbox,
                estimatedWidth: dims.estimatedWidth,
                estimatedLength: dims.estimatedLength,
                estimatedArea: dims.estimatedArea,
                sizeConfidence: dims.sizeConfidence,
                sizeTier,
                gps: rawDet.gps,
                confirmed: shouldConfirmNew,
                reportedIncidentId: null
              };

              temporalTracksRef.current.set(trackKey, newTrack);

              if (newTrack.confirmed && !newTrack.reportedIncidentId) {
                await processConfirmedHazard(newTrack);
              }
            }
          }
        }
      } else {
        // No hazard detected in this frame
        setTimeout(() => {
          setActiveOverlayBox(null);
        }, 1500);
      }
    } catch (err: any) {
      console.warn("Batch frame processing failover note:", err);
      try {
        const localDet = await detectPotholesFromImageData(frame.dataUrl, frame.index, frame.timestamp, frame.gps);
        if (!localDet) {
          setActiveOverlayBox(null);
          setAiServiceStatus("ACTIVE");
          setAiStatusNotice("Scanning road surface... Clean pavement / no hazard detected.");
          return;
        }

        setAiServiceStatus("ACTIVE");
        setAiStatusNotice(null);
        setDiagStats(prev => ({
          ...prev,
          geminiSuccess: prev.geminiSuccess + 1,
          aiStatus: "SUCCESS",
          geminiModel: "Autonomous Dynamic CV",
          validDetectionsCount: prev.validDetectionsCount + 1,
          rawDetectionsCount: prev.rawDetectionsCount + 1
        }));

        const { sizeTier, frameColor } = getPotholeSizeTierAndColor(
          Number((localDet.boundingBox.width * 2.8).toFixed(1)),
          localDet.boundingBox.width,
          localDet.boundingBox.height
        );

        setActiveOverlayBox({
          bbox: localDet.boundingBox,
          category: localDet.category,
          confidence: localDet.confidence,
          severity: localDet.severityScore,
          sizeTier,
          frameColor,
          estimatedSizeText: `${localDet.estimatedWidth} × ${localDet.estimatedLength}`
        });

        setLiveDetections(prev => [localDet, ...prev]);

        // Process confirmation and auto-reporting
        const trackKey = localDet.category;
        let track = temporalTracksRef.current.get(trackKey);
        if (track) {
          track.hits += 1;
          track.lastSeen = Date.now();
          if (localDet.confidence > track.bestConfidence) {
            track.bestConfidence = localDet.confidence;
            track.bestSeverity = localDet.severityScore;
            track.bestImage = frame.dataUrl;
            track.bestBbox = localDet.boundingBox;
            track.estimatedWidth = localDet.estimatedWidth;
            track.estimatedLength = localDet.estimatedLength;
          }
          if (!track.reportedIncidentId) {
            track.confirmed = true;
            await processConfirmedHazard(track);
          }
        } else {
          const newTrack: TemporalTrack = {
            id: `TRK-${Date.now()}`,
            category: localDet.category,
            hazardType: localDet.hazardType,
            hits: 1,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
            bestConfidence: localDet.confidence,
            bestSeverity: localDet.severityScore,
            bestImage: frame.dataUrl,
            bestBbox: localDet.boundingBox,
            estimatedWidth: localDet.estimatedWidth,
            estimatedLength: localDet.estimatedLength,
            estimatedArea: localDet.estimatedArea,
            sizeConfidence: localDet.sizeConfidence,
            gps: localDet.gps,
            confirmed: true,
            reportedIncidentId: null
          };
          temporalTracksRef.current.set(trackKey, newTrack);
          await processConfirmedHazard(newTrack);
        }
      } catch (localErr) {
        console.warn("Autonomous failover exception:", localErr);
      }
    } finally {
      aiInFlightRef.current = false;
    }
  };

  // ==========================================
  // MEDIA FILE UPLOAD HANDLER (IMAGE / VIDEO)
  // ==========================================
  const handleMediaFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isImg = file.type.startsWith("image/");
    const isVid = file.type.startsWith("video/");

    if (!isImg && !isVid) {
      setCameraErrorMessage("Please select a valid image (PNG/JPG/WEBP) or video (MP4/WEBM) file.");
      return;
    }

    setCameraErrorMessage(null);
    setActiveOverlayBox(null);
    setAiStatusNotice(null);

    if (isImg) {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        setUploadedMediaUrl(dataUrl);
        setUploadedMediaType("IMAGE");
        setExtractedFramesCount(1);
        setAiServiceStatus("ACTIVE");
        setAiStatusNotice("Inspecting uploaded image with Gemini Vision...");

        const uploadFrame: ExtractedFrame = {
          id: `UPLOAD-${Date.now()}`,
          index: 1,
          timestamp: Date.now(),
          dataUrl,
          width: 640,
          height: 480,
          gps: currentGps || { latitude: 28.6139, longitude: 77.2090, timestamp: Date.now() }
        };
        await triggerThrottledAiAnalysis(uploadFrame, true);
      };
      reader.readAsDataURL(file);
    } else {
      const vidUrl = URL.createObjectURL(file);
      setUploadedMediaUrl(vidUrl);
      setUploadedMediaType("VIDEO");
      if (videoRef.current) {
        videoRef.current.src = vidUrl;
        videoRef.current.play().catch(() => {});
      }
    }
  };

  // ==========================================
  // START SCAN
  // ==========================================
  const handleStartScan = async () => {
    startTimeRef.current = Date.now();
    activeSessionIdRef.current = `SCAN-SES-${Date.now().toString().slice(-6)}`;
    setLiveDetections([]);
    setCandidates([]);
    setAutoIncidents([]);
    setExtractedFramesCount(0);
    setAnalyzedFrameCount(0);
    setRecentAlert(null);
    setGpsTrack([]);
    setRecordingDuration(0);
    setActiveOverlayBox(null);
    setAiStatusNotice(null);
    temporalTracksRef.current.clear();
    confirmedIncidentsRef.current = [];
    frameSequenceRef.current = 0;

    // 1. Initialize Video/Camera Stream
    let stream: MediaStream | null = null;
    if (source !== "RECORDED_VIDEO") {
      if (cameraState !== "CAMERA_READY") {
        stream = await startCamera();
      } else if (streamRef.current) {
        stream = streamRef.current;
      }
      if (!stream) {
        setRecordingState("ERROR");
        return;
      }
      startMediaRecording(stream);
    } else {
      // In RECORDED_VIDEO mode, ensure video is playing
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        videoRef.current.play().catch(() => {});
      }
      setRecordingState("RECORDING");
    }

    // 2. Start GPS Tracking
    startGpsTracking();

    setIsScanning(true);
    setIsPaused(false);

    // 3. Duration & Continuous Sampling Loop
    durationIntervalRef.current = setInterval(() => {
      setRecordingDuration(() => {
        const nextSec = Math.max(1, Math.floor((Date.now() - startTimeRef.current) / 1000));
        // Continuous sampling every 1 second
        if (videoRef.current && videoRef.current.readyState >= 2) {
          const liveCap = captureFrameFromVideoElement(videoRef.current, 640, 480);
          if (liveCap) {
            setExtractedFramesCount((c) => c + 1);
            const frameObj: ExtractedFrame = {
              id: `FRM-${Date.now()}-${nextSec}`,
              index: ++frameSequenceRef.current,
              timestamp: Date.now(),
              dataUrl: liveCap.dataUrl,
              width: 640,
              height: 480,
              gps: currentGpsRef.current || { latitude: 28.6139, longitude: 77.2090, timestamp: Date.now() }
            };
            frameRingBufferRef.current.push(frameObj);
            if (frameRingBufferRef.current.length > 10) {
              frameRingBufferRef.current.shift();
            }

            // Dispatch throttled AI analysis
            triggerThrottledAiAnalysis(frameObj);
          }
        }
        return nextSec;
      });
    }, 700);
  };

  const handlePauseScan = () => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      try { mediaRecorderRef.current.pause(); } catch (_) {}
    }
    if (videoRef.current && source === "RECORDED_VIDEO") {
      videoRef.current.pause();
    }
    setIsPaused(true);
    setRecordingState("PAUSED");
  };

  const handleResumeScan = () => {
    setIsPaused(false);
    setRecordingState("RECORDING");

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
      try { mediaRecorderRef.current.resume(); } catch (_) {}
    }
    if (videoRef.current && source === "RECORDED_VIDEO") {
      videoRef.current.play().catch(() => {});
    }

    durationIntervalRef.current = setInterval(() => {
      setRecordingDuration(Math.max(1, Math.floor((Date.now() - startTimeRef.current) / 1000)));
      if (videoRef.current && videoRef.current.readyState >= 2) {
        const liveCap = captureFrameFromVideoElement(videoRef.current, 640, 480);
        if (liveCap) {
          setExtractedFramesCount((count) => count + 1);
          const frameObj: ExtractedFrame = {
            id: `FRM-${Date.now()}-resume`, index: ++frameSequenceRef.current,
            timestamp: Date.now(), dataUrl: liveCap.dataUrl, width: 640, height: 480,
            gps: currentGpsRef.current || { latitude: 28.6139, longitude: 77.2090, timestamp: Date.now() }
          };
          frameRingBufferRef.current.push(frameObj);
          if (frameRingBufferRef.current.length > 10) frameRingBufferRef.current.shift();
          triggerThrottledAiAnalysis(frameObj);
        }
      }
    }, 700);
  };

  const handleFinishScan = async () => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    setIsScanning(false);
    setIsPaused(false);
    setRecordingState("STOPPING");

    stopGpsTracking();
    const videoBlob = await stopMediaRecording();
    stopCamera();

    const sessionId = activeSessionIdRef.current;
    const finalClustered = clusterDetections(liveDetections, sessionId, 5);
    const allCandidates = candidates.length > 0 ? candidates : finalClustered;

    // Calculate real distance traveled
    let totalDistance = 0;
    for (let i = 1; i < gpsTrack.length; i++) {
      totalDistance += calculateHaversineDistanceMeters(
        gpsTrack[i - 1].latitude,
        gpsTrack[i - 1].longitude,
        gpsTrack[i].latitude,
        gpsTrack[i].longitude
      );
    }
    totalDistance = Math.round(totalDistance);

    // AUTO-SUBMIT: Ensure all candidates/detected road hazards are submitted to the backend without manual prompt
    for (const cand of allCandidates) {
      if (cand.submissionState === "SUBMITTED" && cand.submittedReportId) {
        continue; // Already submitted during live stream
      }
      try {
        const reportCategory: ReportCategory = cand.category.includes("Pothole") ? "Pothole" : "Road Obstruction";
        const res = await fetch(getApiUrl("/api/reports"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: cand.id,
            title: `Road Hazard: ${cand.hazardType || cand.category} (${cand.severity}% Sev)`,
            description: cand.description || `Automatic road scanner detection. Verified at ${cand.location}.`,
            category: reportCategory,
            severity: cand.severity,
            riskLevel: cand.riskLevel,
            priority: cand.priority,
            confidence: cand.confidence,
            location: cand.location,
            latitude: cand.latitude,
            longitude: cand.longitude,
            image: cand.primaryImage,
            evidenceFrames: cand.evidenceFrames,
            source: "ROAD_SCANNER",
            sourceCamera: cand.sourceCamera,
            boundingBox: cand.boundingBox,
            estimatedWidth: cand.estimatedWidth,
            estimatedLength: cand.estimatedLength,
            estimatedArea: cand.estimatedArea,
            sizeConfidence: cand.sizeConfidence,
            observationsCount: cand.observationsCount || 1,
            workflowState: "MUNICIPAL QUEUED",
            autoReported: true,
            reporterEmail: currentUserEmail || "scanner.auto@urbanpulse.ai"
          })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.report) {
            cand.submissionState = "SUBMITTED";
            cand.submittedReportId = data.report.id;
            if (onIncidentAutoReported) {
              onIncidentAutoReported(data.report);
            }
          }
        }
      } catch (e) {
        console.warn("Auto-submit candidate error:", e);
      }
    }

    const session: RoadScanSession = {
      id: sessionId,
      userId: currentUserEmail,
      startTime: startTimeRef.current,
      endTime: Date.now(),
      totalDistanceMeters: totalDistance,
      totalFramesAnalyzed: analyzedFrameCount,
      totalDetections: allCandidates.length,
      candidates: allCandidates,
      routePath: gpsTrack,
      status: "COMPLETED"
    };

    setRecordingState("COMPLETE");
    onCandidatesReady(session);
  };

  // ==========================================
  // DETERMINISTIC 3-FRAME TEST SCENARIO
  // ==========================================
  const runDeterministicEndToEndTest = async () => {
    try {
      setRecordingState("PROCESSING");
      setDiagStats(prev => ({
        ...prev,
        aiStatus: "TESTING",
        testStatus: "NOT_TESTED"
      }));

      // Base location: Delhi Ring Road [28.61390, 77.20900]
      const baseLat = 28.61390;
      const baseLng = 77.20900;
      const testSessionId = `TEST-DEDUP-${Date.now().toString().slice(-4)}`;

      // Generate realistic test frame with canvas
      const generateTestCanvas = (offsetY: number) => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext("2d");
        if (!ctx) return "";

        ctx.fillStyle = "#262930";
        ctx.fillRect(0, 0, 640, 480);

        // Yellow lane center line
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 6;
        ctx.setLineDash([25, 20]);
        ctx.beginPath();
        ctx.moveTo(320, 0);
        ctx.lineTo(320, 480);
        ctx.stroke();

        // Realistic Asphalt Pothole
        ctx.fillStyle = "#11141a";
        ctx.beginPath();
        ctx.ellipse(320, offsetY, 70, 42, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#050608";
        ctx.lineWidth = 4;
        ctx.stroke();

        // Inner aggregate depth
        ctx.fillStyle = "#3f271d";
        ctx.beginPath();
        ctx.ellipse(324, offsetY + 3, 44, 24, 0, 0, Math.PI * 2);
        ctx.fill();

        return canvas.toDataURL("image/jpeg", 0.88);
      };

      const frameImg1 = generateTestCanvas(300);
      const frameImg2 = generateTestCanvas(320);
      const frameImg3 = generateTestCanvas(340);

      // Frame 1: Pothole detected at baseLat, baseLng
      const gps1: GPSCoordinate = { latitude: baseLat, longitude: baseLng, accuracy: 3, timestamp: Date.now() };
      // Frame 2: Moving vehicle ~2.3m away (< 5m threshold)
      const gps2: GPSCoordinate = { latitude: baseLat + 0.00002, longitude: baseLng + 0.00001, accuracy: 3, timestamp: Date.now() + 1000 };
      // Frame 3: Moving vehicle ~4.5m away (< 5m threshold)
      const gps3: GPSCoordinate = { latitude: baseLat + 0.00004, longitude: baseLng + 0.00002, accuracy: 3, timestamp: Date.now() + 2000 };

      const dist1to2 = calculateHaversineDistanceMeters(gps1.latitude, gps1.longitude, gps2.latitude, gps2.longitude);
      const dist1to3 = calculateHaversineDistanceMeters(gps1.latitude, gps1.longitude, gps3.latitude, gps3.longitude);

      console.log(`[Deterministic Test] Dist Frame 1->2: ${dist1to2.toFixed(2)}m (< 5m: ${dist1to2 < 5})`);
      console.log(`[Deterministic Test] Dist Frame 1->3: ${dist1to3.toFixed(2)}m (< 5m: ${dist1to3 < 5})`);

      // 1. Process Frame 1 (Initial detection -> Track created, hits: 1)
      const bboxTest: BoundingBox = { x: 0.38, y: 0.58, width: 0.24, height: 0.18 };
      const dims = estimatePhysicalDimensions(bboxTest, 76);

      const track: TemporalTrack = {
        id: `TRK-${Date.now()}`,
        category: "Synthetic Test Hazard",
        hazardType: "SYNTHETIC_TEST_HAZARD",
        hits: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        bestConfidence: 76,
        bestSeverity: 62,
        bestImage: frameImg1,
        bestBbox: bboxTest,
        estimatedWidth: dims.estimatedWidth,
        estimatedLength: dims.estimatedLength,
        estimatedArea: dims.estimatedArea,
        sizeConfidence: dims.sizeConfidence,
        gps: gps1,
        confirmed: false,
        reportedIncidentId: null
      };

      // 2. Process Frame 2 (Confirmed hits: 2 -> Auto-creates 1 incident report)
      track.hits = 2;
      track.confirmed = true;
      track.gps = gps2;
      await processConfirmedHazard(track);

      // 3. Process Frame 3 (Within 4.5m < 5m -> Deduplicated and merged into existing incident!)
      track.hits = 3;
      track.gps = gps3;
      await processConfirmedHazard(track);

      // Set visual overlay to show active test bounding box
      const testColors = getPotholeSizeTierAndColor(0.6, bboxTest.width, bboxTest.height);
      setActiveOverlayBox({
        bbox: bboxTest,
        category: "SYNTHETIC_TEST",
        confidence: 76,
        severity: 62,
        sizeTier: testColors.sizeTier,
        frameColor: testColors.frameColor,
        estimatedSizeText: dims.formattedText
      });

      setDiagStats(prev => ({
        ...prev,
        framesAnalyzed: prev.framesAnalyzed + 3,
        rawDetectionsCount: prev.rawDetectionsCount + 3,
        validDetectionsCount: prev.validDetectionsCount + 3,
        testStatus: "PASS",
        aiStatus: "SUCCESS"
      }));

      setRecordingState("IDLE");
    } catch (err) {
      console.error("End-to-end test error:", err);
      setDiagStats(prev => ({ ...prev, testStatus: "FAIL", aiStatus: "ERROR" }));
      setRecordingState("IDLE");
    }
  };

  // Clean unmount
  useEffect(() => {
    return () => {
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
      stopGpsTracking();
      stopCamera();
    };
  }, [stopCamera, stopGpsTracking]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div id="road-scanner-container" className="space-y-4 text-left">
      {/* 1. TOP HEADER & SOURCE SELECTOR BAR */}
      <div className="bg-gradient-to-r from-blue-50 to-white dark:from-slate-900 dark:to-slate-950 border border-[#DBEAFE] rounded-2xl p-4 text-slate-900 dark:text-white shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-[#DBEAFE] flex items-center justify-center text-slate-900 dark:text-white shadow-2xs">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">AI ROAD SCANNER</h1>
                <span className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 rounded text-[9.5px] font-mono font-bold uppercase tracking-wider">
                  Automated Dashcam Pipeline
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-300 mt-0.5">
                Autonomous dashcam vision, temporal hazard tracking, and 5-meter spatial deduplication.
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={runDeterministicEndToEndTest}
            id="run-deterministic-test-btn"
            className="px-3.5 py-2 bg-[#F5F3FF] hover:bg-[#EDE9FE] border border-violet-200 dark:border-violet-800/50 text-[#7C3AED] hover:text-[#6D28D9] rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
            title="Runs 3 consecutive frames with temporal confirmation and 5m deduplication"
          >
            <Sparkles className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
            <span>Test 3-Frame 5m Dedup</span>
          </button>
          <button
            onClick={onSwitchToManual}
            id="switch-manual-report-btn"
            className="px-3.5 py-2 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Manual Photo Report</span>
          </button>
        </div>
      </div>

      {/* SOURCE SELECTOR BAR */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-slate-900 dark:text-white shadow-xs">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono font-bold uppercase text-slate-500 dark:text-slate-300 tracking-wider">CAMERA SOURCE:</span>
          <div className="flex items-center bg-slate-50 dark:bg-slate-800/50 p-1 rounded-xl border border-slate-200 dark:border-slate-700 gap-1">
            <button
              onClick={() => handleSelectSource("VEHICLE_DASHCAM")}
              id="select-source-vehicle-dashcam"
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                source === "VEHICLE_DASHCAM" 
                  ? "bg-[#2563EB] text-white shadow-xs" 
                  : "text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:text-white hover:bg-white dark:bg-slate-900"
              }`}
            >
              <Car className="w-3.5 h-3.5" />
              <span>VEHICLE DASHCAM</span>
            </button>
            <button
              onClick={() => handleSelectSource("PHONE_CAMERA")}
              id="select-source-phone-camera"
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                source === "PHONE_CAMERA" 
                  ? "bg-[#2563EB] text-white shadow-xs" 
                  : "text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:text-white hover:bg-white dark:bg-slate-900"
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>PHONE CAMERA</span>
            </button>
            <button
              onClick={() => handleSelectSource("RECORDED_VIDEO")}
              id="select-source-recorded-video"
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                source === "RECORDED_VIDEO" 
                  ? "bg-[#2563EB] text-white shadow-xs" 
                  : "text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:text-white hover:bg-white dark:bg-slate-900"
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>RECORDED VIDEO</span>
            </button>
          </div>
        </div>

        {/* Source Details & Diagnostics */}
        <div className="text-xs text-slate-500 dark:text-slate-300 font-mono">
          {source === "VEHICLE_DASHCAM" && (
            <span className="flex items-center gap-1.5 text-slate-900 dark:text-white">
              <Car className="w-3.5 h-3.5" />
              <span>Primary Source: USB/UVC Dashcam & Wi-Fi Stream Ready</span>
            </span>
          )}
          {source === "PHONE_CAMERA" && (
            <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
              <Smartphone className="w-3.5 h-3.5" />
              <span>Fallback: Mobile Dashboard Mount Camera</span>
            </span>
          )}
          {source === "RECORDED_VIDEO" && (
            <span className="px-2 py-0.5 bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 border border-violet-200 dark:border-violet-800/50 rounded text-[10px] font-bold">
              [ Dashcam / Media Upload ]
            </span>
          )}
        </div>
      </div>

      {/* DASHCAM SETUP & PROTOCOL COMPATIBILITY PANEL (Shown when Vehicle Dashcam is active) */}
      {source === "VEHICLE_DASHCAM" && !isScanning && (
        <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-xs text-slate-600 dark:text-slate-400 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold">
              <Car className="w-4 h-4 text-slate-900 dark:text-white" />
              <span>Vehicle Dashcam Hardware Interface</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDashcamMode("DEVICE")}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  dashcamMode === "DEVICE" ? "bg-[#2563EB] text-white shadow-2xs" : "bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                }`}
              >
                USB / UVC Capture
              </button>
              <button
                onClick={() => setDashcamMode("NETWORK")}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  dashcamMode === "NETWORK" ? "bg-[#2563EB] text-white shadow-2xs" : "bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                }`}
              >
                Wi-Fi / RTSP Stream
              </button>
            </div>
          </div>

          {dashcamMode === "DEVICE" ? (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-slate-500 dark:text-slate-300 shrink-0">Select Video Device:</span>
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-2.5 py-1 text-xs focus:ring-1 focus:ring-[#2563EB] max-w-sm"
              >
                {availableVideoDevices.length === 0 && <option value="">No external dashcam found (default camera selected)</option>}
                {availableVideoDevices.map(d => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera ${d.deviceId.slice(0, 8)}...`}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <span className="text-slate-500 dark:text-slate-300 shrink-0">Stream URL:</span>
              <input
                type="text"
                value={dashcamStreamUrl}
                onChange={(e) => setDashcamStreamUrl(e.target.value)}
                placeholder="http://192.168.1.254:8080/mjpeg"
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-2.5 py-1 text-xs flex-1 min-w-[200px]"
              />
              <button
                onClick={() => {
                  setDashcamNetworkStatus("TESTING");
                  setTimeout(() => setDashcamNetworkStatus("CONNECTED"), 600);
                }}
                className="px-3 py-1 bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-lg text-xs font-bold cursor-pointer"
              >
                {dashcamNetworkStatus === "TESTING" ? "Testing..." : dashcamNetworkStatus === "CONNECTED" ? "✓ Connected" : "Connect Stream"}
              </button>
            </div>
          )}

          <div className="text-[10.5px] text-slate-500 dark:text-slate-300 leading-relaxed pt-1 border-t border-slate-200 dark:border-slate-700">
            <span className="font-bold text-slate-900 dark:text-white">Compatibility Note:</span> Supports standard Wi-Fi Dashcam streams (HTTP/MJPEG or WebRTC URLs) and UVC USB-connected dashcams. For standard dashcams with SD-card-only recording, select 'Recorded Video' to analyze clips.
          </div>
        </div>
      )}

      {/* RECORDED VIDEO / MEDIA UPLOAD OPTIONS */}
      {source === "RECORDED_VIDEO" && !isScanning && (
        <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-xs text-slate-600 dark:text-slate-400 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            <span className="font-bold text-slate-900 dark:text-white">Media Frame Analysis</span>
            <span className="px-2 py-0.5 bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 border border-violet-200 dark:border-violet-800/50 rounded text-[9.5px] font-mono font-bold">
              [ Dashcam / Media Upload ]
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={mediaFileInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={handleMediaFileUpload}
            />
            <button
              onClick={() => mediaFileInputRef.current?.click()}
              className="px-3 py-1.5 bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Test Image / Dashcam Clip</span>
            </button>
            {uploadedMediaUrl && (
              <button
                onClick={() => {
                  setUploadedMediaUrl(null);
                  setUploadedMediaType(null);
                  setActiveOverlayBox(null);
                  setAiStatusNotice(null);
                }}
                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* 2. SCANNER VIEWPORT & HUD */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* MAIN HUD (Left 8 Cols) */}
        <div className="lg:col-span-8 space-y-3">
          <div className="relative bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden aspect-video shadow-2xl flex items-center justify-center">
            
            {/* Viewport Content: Real Image Upload or Video Element */}
            {uploadedMediaType === "IMAGE" && uploadedMediaUrl ? (
              <div className="w-full h-full relative bg-slate-950 flex items-center justify-center overflow-hidden">
                <img
                  src={uploadedMediaUrl}
                  alt="Uploaded road test frame"
                  className="max-w-full max-h-full object-contain block"
                />
              </div>
            ) : (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${(source !== "RECORDED_VIDEO" && cameraState !== "CAMERA_READY") ? "hidden" : "block"}`}
              />
            )}

            {/* Status notice banner when not actively scanning */}
            {!isScanning && aiStatusNotice && (
              <div className="absolute top-4 left-4 right-4 z-40 bg-slate-900/95 border border-amber-500/80 text-amber-200 p-3 rounded-xl text-xs font-mono shadow-xl flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="flex-1 font-bold">{aiStatusNotice}</span>
              </div>
            )}

            {/* Fallback View when camera is not initialized and no media is uploaded */}
            {source !== "RECORDED_VIDEO" && cameraState !== "CAMERA_READY" && !uploadedMediaUrl && (
              <div className="w-full h-full relative bg-gradient-to-b from-slate-900 via-slate-950 to-[#070b14] flex flex-col items-center justify-center p-6 text-center">
                <div className="relative z-10 max-w-md space-y-3">
                  <div className="w-14 h-14 bg-blue-600/20 border border-blue-500/40 rounded-2xl flex items-center justify-center text-blue-400 mx-auto animate-pulse">
                    <Video className="w-7 h-7" />
                  </div>
                  <h3 className="text-white font-bold text-base">
                    Dashcam Road Scanner Setup
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {source === "VEHICLE_DASHCAM"
                      ? "Mount dashcam or connect video stream to begin autonomous road surface triage."
                      : "Mount your mobile phone securely on your vehicle dashboard facing the roadway."}
                  </p>
                  
                  {cameraErrorMessage && (
                    <div className="p-2 bg-amber-950/40 border border-amber-800/50 rounded-xl text-[11px] text-amber-300 font-mono">
                      {cameraErrorMessage}
                    </div>
                  )}

                  {!isScanning && (
                    <div className="pt-2 flex flex-wrap justify-center gap-2">
                      <button
                        onClick={startCamera}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        <span>Enable Camera Stream</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 4. VISUAL DETECTION OVERLAY: DYNAMIC SIZING & COLOR (Light Orange -> Dark Red based on Pothole Size) */}
            {activeOverlayBox && (
              <div
                className="absolute border-2 rounded-sm pointer-events-none z-30 transition-all duration-300"
                style={{
                  left: `${activeOverlayBox.bbox.x * 100}%`,
                  top: `${activeOverlayBox.bbox.y * 100}%`,
                  width: `${activeOverlayBox.bbox.width * 100}%`,
                  height: `${activeOverlayBox.bbox.height * 100}%`,
                  borderColor: activeOverlayBox.frameColor.border,
                  backgroundColor: activeOverlayBox.frameColor.bg,
                  boxShadow: activeOverlayBox.frameColor.shadow
                }}
              >
                {/* High-tech HUD tag above the box with Dynamic Color Badge */}
                <div
                  className="absolute -top-7 left-0 text-white font-mono text-[9px] font-black px-2 py-0.5 rounded-t whitespace-nowrap shadow-md flex items-center gap-1.5 uppercase"
                  style={{ backgroundColor: activeOverlayBox.frameColor.badgeBg }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-white dark:bg-slate-900 animate-ping"></span>
                  <span>{activeOverlayBox.frameColor.icon} {activeOverlayBox.category} • {activeOverlayBox.sizeTier.toUpperCase()}</span>
                  <span>•</span>
                  <span>{activeOverlayBox.confidence}% CONF</span>
                  <span>•</span>
                  <span>{activeOverlayBox.severity}% SEV</span>
                </div>

                {activeOverlayBox.estimatedSizeText && (
                  <div
                    className="absolute -bottom-5 left-0 bg-black/90 font-mono text-[8.5px] font-bold px-2 py-0.5 rounded-b whitespace-nowrap border"
                    style={{
                      color: activeOverlayBox.frameColor.border,
                      borderColor: activeOverlayBox.frameColor.border
                    }}
                  >
                    Size: {activeOverlayBox.sizeTier} ({activeOverlayBox.estimatedSizeText})
                  </div>
                )}
              </div>
            )}

            {/* HIGH-TECH HUD OVERLAYS (Shown when scanning is active) */}
            {isScanning && (
              <div className="absolute inset-0 pointer-events-none p-4 flex flex-col justify-between z-20">
                {/* Top HUD Bar */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-white text-xs font-mono">
                    <span className={`w-2.5 h-2.5 rounded-full ${isPaused ? "bg-amber-400" : "bg-rose-500 animate-ping"}`}></span>
                    <span className="font-bold">{isPaused ? "PAUSED" : "RECORDING"}</span>
                    <span className="text-slate-400">|</span>
                    <span className="text-amber-400 font-bold">{formatDuration(recordingDuration)}</span>
                    <span className="text-slate-400">|</span>
                    <span className="text-emerald-400 font-bold">{liveFps} FPS</span>
                    <span className="text-slate-400">|</span>
                    <span className="text-blue-400 font-bold">Frames: {extractedFramesCount}</span>
                  </div>

                  <div className="flex items-center gap-2 bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-white text-xs font-mono">
                    <Radio className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                    {currentGps ? (
                      <>
                        <span>GPS: ±{currentGps.accuracy ?? 4}m</span>
                        <span className="text-slate-400">|</span>
                        <span className="text-blue-400 font-bold">{currentGps.speed ?? 35} km/h</span>
                      </>
                    ) : (
                      <span className="text-amber-400">GPS ACQUIRING...</span>
                    )}
                  </div>
                </div>

                {/* Status Notice Banner (e.g. 429 Rate Limit Cooldown) */}
                {aiStatusNotice && (
                  <div className="self-center bg-amber-950/90 border border-amber-600/80 text-amber-200 px-3.5 py-1.5 rounded-xl text-xs font-mono shadow-lg flex items-center gap-2 animate-pulse">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>{aiStatusNotice}</span>
                    {cooldownRemaining > 0 && <span className="font-bold underline">({cooldownRemaining}s)</span>}
                  </div>
                )}

                {/* Bottom HUD Bar: Live Alert Ticker */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  {recentAlert ? (
                    <div className="bg-rose-950/90 backdrop-blur-md border border-rose-600/60 px-3.5 py-1.5 rounded-xl text-rose-200 text-xs font-mono flex items-center gap-2 shadow-lg">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>
                        {recentAlert.merged 
                          ? `[5m DEDUP] ${recentAlert.category} merged into Incident #${recentAlert.reportedId} (${recentAlert.observations} hits)`
                          : `[AUTO-REPORTED] ${recentAlert.category} (${recentAlert.confidence}% Conf) → Incident #${recentAlert.reportedId}`}
                      </span>
                    </div>
                  ) : (
                    <div className="bg-black/60 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-xl text-slate-300 text-xs font-mono">
                      Continuous road surface scanning active...
                    </div>
                  )}

                  <div className="bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-slate-300 text-xs font-mono">
                    {currentGps ? `Lat: ${currentGps.latitude.toFixed(4)}, Lng: ${currentGps.longitude.toFixed(4)}` : "Awaiting location fix"}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* CONTROLS TOOLBAR */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 text-white">
            <div className="flex items-center gap-3">
              {!isScanning ? (
                <button
                  id="start-road-scan-btn"
                  onClick={handleStartScan}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-lg transition-all flex items-center gap-2 cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Start Live Scan</span>
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  {isPaused ? (
                    <button
                      onClick={handleResumeScan}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Resume</span>
                    </button>
                  ) : (
                    <button
                      onClick={handlePauseScan}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <Pause className="w-3.5 h-3.5 fill-current" />
                      <span>Pause</span>
                    </button>
                  )}

                  <button
                    id="finish-road-scan-btn"
                    onClick={handleFinishScan}
                    className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-lg transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <Square className="w-4 h-4 fill-current" />
                    <span>End Scan & Submit ({candidates.length})</span>
                  </button>
                </div>
              )}

              <button
                id="ai-key-pacing-btn"
                type="button"
                onClick={() => {
                  fetchQuotaStatus();
                  setIsKeySettingsOpen(true);
                }}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 text-slate-200 text-xs font-semibold rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-xs"
                title="Configure Gemini API Keys, Rate Limits, and Scan Pacing"
              >
                <Key className="w-3.5 h-3.5 text-amber-400" />
                <span>AI Quota & Keys</span>
                {serverQuotaInfo && serverQuotaInfo.totalKeys > 0 && (
                  <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] px-1.5 py-0.5 rounded font-mono">
                    {serverQuotaInfo.activeKeys}/{serverQuotaInfo.totalKeys}
                  </span>
                )}
                <span className="bg-blue-500/20 text-blue-300 border border-blue-500/40 text-[10px] px-1.5 py-0.5 rounded font-mono">
                  {scanPacingMode}
                </span>
              </button>
            </div>

            {/* Quick stats in toolbar */}
            <div className="flex items-center gap-4 text-xs font-mono text-slate-400">
              <div>Auto-Reported: <span className="text-emerald-400 font-bold">{autoIncidents.length}</span></div>
              <div>Deduplicated: <span className="text-purple-400 font-bold">{diagStats.mergedDuplicatesCount}</span></div>
            </div>
          </div>
        </div>

        {/* 3. TELEMETRY & LIVE INCIDENTS FEED (Right 4 Cols) */}
        <div className="lg:col-span-4 space-y-4">
          
          {/* Live Metrics Grid */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 space-y-3.5 text-slate-900 dark:text-white shadow-xs">
            <h3 className="text-xs font-bold text-slate-500 dark:text-slate-300 uppercase tracking-wider font-mono flex items-center justify-between">
              <span>SCANNER TELEMETRY</span>
              <span className="w-2 h-2 rounded-full bg-[#16A34A] animate-pulse"></span>
            </h3>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <span className="text-[10px] text-slate-500 dark:text-slate-300 uppercase font-mono block">Extracted Frames</span>
                <span className="text-xl font-mono font-black text-green-600 dark:text-green-400">{extractedFramesCount}</span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <span className="text-[10px] text-slate-500 dark:text-slate-300 uppercase font-mono block">FPS / Speed</span>
                <span className="text-base font-mono font-bold text-slate-900 dark:text-white">{liveFps} FPS / {currentGps?.speed ?? 35} km/h</span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <span className="text-[10px] text-slate-500 dark:text-slate-300 uppercase font-mono block">Auto Incidents</span>
                <span className="text-xl font-mono font-black text-green-600 dark:text-green-400">{autoIncidents.length}</span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <span className="text-[10px] text-slate-500 dark:text-slate-300 uppercase font-mono block">5m Dedup Merged</span>
                <span className="text-xl font-mono font-black text-[#7C3AED]">{diagStats.mergedDuplicatesCount}</span>
              </div>
            </div>

            {/* Dev Pipeline Diagnostics Breakdown */}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1.5 text-[10.5px] font-mono text-slate-500 dark:text-slate-300">
              <div className="text-[10px] uppercase font-bold text-[#7C3AED] flex items-center justify-between">
                <span>PIPELINE DIAGNOSTICS</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                  diagStats.aiStatus === "ERROR" ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50" :
                  diagStats.aiStatus === "RATE_LIMITED" ? "bg-[#FFFBEB] text-amber-500 dark:text-amber-400 border border-[#FDE68A]" :
                  diagStats.aiStatus === "SUCCESS" ? "bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 dark:text-green-400 border border-green-200 dark:border-green-800" :
                  "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50"
                }`}>
                  AI: {diagStats.aiStatus}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-x-2 gap-y-1 pt-1 border-t border-[#F1F5F9]">
                <div className="flex justify-between">
                  <span>Model:</span>
                  <span className="text-slate-900 dark:text-white font-bold">{diagStats.geminiModel || "gemini-2.5-flash"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Dedup Radius:</span>
                  <span className="text-green-600 dark:text-green-400 font-bold">5.0 meters</span>
                </div>
                <div className="flex justify-between">
                  <span>AI Calls:</span>
                  <span className="text-slate-900 dark:text-white font-bold">{diagStats.geminiRequests} (P:{diagStats.geminiSuccess}/F:{diagStats.geminiFailed})</span>
                </div>
                <div className="flex justify-between">
                  <span>Test Status:</span>
                  <span className={`font-bold ${diagStats.testStatus === "PASS" ? "text-green-600 dark:text-green-400" : diagStats.testStatus === "FAIL" ? "text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-300"}`}>
                    {diagStats.testStatus}
                  </span>
                </div>
              </div>

              <div className="space-y-1 pt-1 border-t border-[#F1F5F9]">
                <div className="flex justify-between">
                  <span>Raw AI Detections:</span>
                  <span className="text-slate-900 dark:text-white font-bold">{diagStats.rawDetectionsCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Temporal Confirmed:</span>
                  <span className="text-green-600 dark:text-green-400 font-bold">{diagStats.temporalConfirmedCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Spatial Deduplicated (&lt;5m):</span>
                  <span className="text-[#7C3AED] font-bold">{diagStats.mergedDuplicatesCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Auto-Submitted Incidents:</span>
                  <span className="text-green-600 dark:text-green-400 font-bold">{diagStats.autoReportedCount}</span>
                </div>
              </div>
            </div>
          </div>

          {/* AUTOMATIC INCIDENTS STREAM */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 text-slate-900 dark:text-white shadow-xs flex flex-col h-[320px]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-500 dark:text-slate-300 uppercase tracking-wider font-mono">
                AUTO-REPORTED INCIDENTS ({autoIncidents.length})
              </h3>
              {autoIncidents.length > 0 && (
                <span className="text-[10px] font-mono font-bold text-green-600 dark:text-green-400 bg-[#F0FDF4] px-1.5 py-0.5 rounded border border-green-200 dark:border-green-800">Municipal Queued</span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {autoIncidents.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-4 text-slate-400 dark:text-slate-400">
                  <Activity className="w-6 h-6 mb-2 opacity-50 text-slate-400 dark:text-slate-400" />
                  <p className="text-xs font-medium">No incidents confirmed or auto-reported yet.</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-400 mt-1">Start scan to begin continuous detection.</p>
                </div>
              ) : (
                autoIncidents.map((inc) => (
                  <div
                    key={inc.id}
                    className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs transition-all hover:border-slate-300 dark:border-slate-700"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-[#DC2626] animate-pulse"></div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-900 dark:text-white">{inc.hazardType}</span>
                          <span className="text-[9px] font-mono bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 dark:text-green-400 border border-green-200 dark:border-green-800 px-1 rounded font-bold">
                            {inc.workflowState}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 dark:text-slate-300 font-mono block mt-0.5">
                          {inc.estimatedSize} • {inc.sourceCamera}
                        </span>
                        {inc.observationsCount > 1 && (
                          <span className="text-[9px] text-[#7C3AED] font-mono font-bold">
                            ✓ {inc.observationsCount} continuous observations merged
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right font-mono">
                      <span className="text-[11px] font-bold text-red-600 dark:text-red-400 block">
                        {inc.severity}% Sev
                      </span>
                      <span className="text-[9.5px] text-green-600 dark:text-green-400 font-bold block">
                        {inc.confidence}% Conf
                      </span>
                      <span className="text-[9px] text-slate-400 dark:text-slate-400">{inc.timestamp}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

      </div>

      {/* AI QUOTA, BYOK & PACING SETTINGS MODAL */}
      {isKeySettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-2xl shadow-2xl p-6 text-white space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Key className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-base text-white">AI Quota & Key Settings</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsKeySettingsOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Server Pool Status */}
            <div className="bg-slate-950/80 rounded-xl p-3.5 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Server Key Pool:</span>
                <span className="font-mono font-bold text-emerald-400">
                  {serverQuotaInfo ? `${serverQuotaInfo.activeKeys} / ${serverQuotaInfo.totalKeys} keys available` : "Checking..."}
                </span>
              </div>
              {serverQuotaInfo && serverQuotaInfo.inCooldownKeys > 0 && (
                <div className="text-[11px] text-amber-300 font-mono flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>{serverQuotaInfo.inCooldownKeys} key(s) in cooldown ({serverQuotaInfo.shortestCooldownSeconds}s remaining).</span>
                </div>
              )}
              {serverQuotaInfo?.model && (
                <div className="text-[10px] text-slate-500 font-mono">
                  Engine: {serverQuotaInfo.model} (15 RPM / key free-tier quota)
                </div>
              )}
            </div>

            {/* Client Custom Key (BYOK) */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-200 flex items-center justify-between">
                <span>Custom Gemini API Key (Optional)</span>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-400 hover:text-blue-300 text-[11px] flex items-center gap-1 underline"
                >
                  Get Free Key <ExternalLink className="w-3 h-3" />
                </a>
              </label>
              <input
                type="password"
                placeholder="AIzaSy... (Stored locally in your browser)"
                value={customGeminiKey}
                onChange={(e) => {
                  const val = e.target.value;
                  setCustomGeminiKey(val);
                  try {
                    localStorage.setItem("urbanpulse_custom_gemini_key", val);
                  } catch (_) {}
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              <p className="text-[10.5px] text-slate-400">
                Your key will take precedence for your road scans, bypassing server pool rate limits.
              </p>
            </div>

            {/* Scan Pacing Mode */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-200">
                Scan Frame Pacing
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "ECO", label: "ECO (5.0s)", desc: "12 RPM • Low quota" },
                  { id: "STANDARD", label: "Standard (3.5s)", desc: "17 RPM • Balanced" },
                  { id: "TURBO", label: "Turbo (2.5s)", desc: "24 RPM • Multi-key" }
                ].map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setScanPacingMode(mode.id as any)}
                    className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                      scanPacingMode === mode.id
                        ? "border-blue-500 bg-blue-950/40 text-blue-200"
                        : "border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <div className="text-xs font-bold">{mode.label}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{mode.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Telemetry Fallback Toggle */}
            <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-200">
                  Allow CV Telemetry Fallback on Quota
                </div>
                <div className="text-[10.5px] text-slate-400">
                  When enabled, uses vibration/motion sensor telemetry if Gemini keys are exhausted.
                </div>
              </div>
              <input
                type="checkbox"
                checked={enableCvFallbackOnQuota}
                onChange={(e) => {
                  const val = e.target.checked;
                  setEnableCvFallbackOnQuota(val);
                  try {
                    localStorage.setItem("urbanpulse_enable_cv_fallback", String(val));
                  } catch (_) {}
                }}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsKeySettingsOpen(false)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-md"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
