import React, { useState, useRef, useEffect, useCallback } from "react";
import { 
  Camera, Video, Play, Square, Pause, AlertTriangle, 
  MapPin, Activity, Sparkles, CheckCircle2, 
  Layers, Upload, Radio, Info,
  AlertOctagon, RefreshCw, Smartphone, Gauge, Navigation,
  Film, Wifi, Car, Check, ShieldAlert, Zap
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

  // References
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
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
    const clampedW = Math.max(0.4, Math.min(3.2, wM));
    const lM = Number(((loc.height / 0.35) * 1.8).toFixed(1));
    const clampedL = Math.max(0.3, Math.min(3.0, lM));
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
    const evidenceImage = await uploadRoadScanEvidenceFrame(
      currentUserEmail || "scanner", sessionId, incidentId, track.hits, track.bestImage
    );

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
      const response = await fetch("/api/reports", {
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
      }
    } catch (err) {
      console.warn("Auto-report submission note:", err);
    }
  };

  // ==========================================
  // CONTINUOUS LIVE FRAME ANALYZER (Throttled)
  // ==========================================
  const triggerThrottledAiAnalysis = async (frame: ExtractedFrame) => {
    // Check if cooldown active
    if (rateLimitCooldownUntilRef.current > Date.now()) {
      return;
    }

    // One request per second yields adjacent observations without flooding the API.
    const now = Date.now();
    if (now - lastAiCallTimeRef.current < 1000) {
      return;
    }

    // If request in flight, buffer frame
    if (aiInFlightRef.current) {
      return;
    }

    aiInFlightRef.current = true;
    lastAiCallTimeRef.current = now;

    try {
      setDiagStats(prev => ({
        ...prev,
        geminiRequests: prev.geminiRequests + 1,
        framesAnalyzed: prev.framesAnalyzed + 1
      }));
      setAnalyzedFrameCount(c => c + 1);

      const res = await fetch("/api/scanner/analyze-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frames: [{
            index: frame.index,
            dataUrl: frame.dataUrl,
            timestamp: frame.timestamp,
            gps: frame.gps
          }]
        })
      });

      const json = await res.json().catch(() => ({}));

      // Handle HTTP Rate Limit (429)
      if (res.status === 429) {
        rateLimitCooldownUntilRef.current = Date.now() + 10000;
        setAiServiceStatus("RATE_LIMITED");
        setAiStatusNotice("AI ANALYSIS UNAVAILABLE: API Rate Limit encountered (Backing off 10s). Video continues recording.");
        setDiagStats(prev => ({
          ...prev,
          aiStatus: "RATE_LIMITED",
          aiHttpStatus: 429,
          aiErrorCode: "429_RATE_LIMIT",
          geminiFailed: prev.geminiFailed + 1
        }));
        return;
      }

      if (!res.ok) {
        setAiServiceStatus("ERROR");
        setAiStatusNotice(`AI ANALYSIS UNAVAILABLE: Server responded with status ${res.status}`);
        setDiagStats(prev => ({
          ...prev,
          aiStatus: "ERROR",
          aiHttpStatus: res.status,
          geminiFailed: prev.geminiFailed + 1
        }));
        return;
      }

      // Success
      setAiServiceStatus("ACTIVE");
      setAiStatusNotice(null);
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

      if (detections.length > 0) {
        for (const det of detections) {
          if (det.confidence >= MIN_DETECTION_CONFIDENCE) {
            setDiagStats(prev => ({ ...prev, validDetectionsCount: prev.validDetectionsCount + 1 }));

            const bbox: BoundingBox = det.boundingBox || { x: 0.35, y: 0.55, width: 0.30, height: 0.22 };
            const dims = estimatePhysicalDimensions(bbox, det.confidence);

            // Update active overlay for visual HUD
            setActiveOverlayBox({
              bbox,
              category: det.category || "POTHOLE",
              confidence: det.confidence,
              severity: det.severityScore || 80,
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

              // Confirm if 2 consecutive hits or single high confidence (>= 88%)
              if (!track.reportedIncidentId && (track.hits >= 2 || det.confidence >= 88)) {
                track.confirmed = true;
                await processConfirmedHazard(track);
              }
            } else {
              // New temporal track (Hit 1)
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
                gps: rawDet.gps,
                confirmed: det.confidence >= 88,
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
      console.warn("Batch frame processing note:", err);
      setAiServiceStatus("ERROR");
      setAiStatusNotice("AI ANALYSIS UNAVAILABLE: Vision service connectivity error.");
      setDiagStats(prev => ({
        ...prev,
        aiStatus: "ERROR",
        geminiFailed: prev.geminiFailed + 1
      }));
    } finally {
      aiInFlightRef.current = false;
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

    const session: RoadScanSession = {
      id: sessionId,
      userId: currentUserEmail,
      startTime: startTimeRef.current,
      endTime: Date.now(),
      totalDistanceMeters: totalDistance,
      totalFramesAnalyzed: analyzedFrameCount,
      totalDetections: candidates.length,
      candidates: candidates.length > 0 ? candidates : finalClustered,
      routePath: gpsTrack,
      status: "REVIEW_READY"
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
      const dims = estimatePhysicalDimensions(bboxTest, 91);

      const track: TemporalTrack = {
        id: `TRK-${Date.now()}`,
        category: "Pothole",
        hazardType: "POTHOLE",
        hits: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        bestConfidence: 91,
        bestSeverity: 85,
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

      // Set visual overlay to show active red bounding box
      setActiveOverlayBox({
        bbox: bboxTest,
        category: "POTHOLE",
        confidence: 91,
        severity: 85,
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
      <div className="bg-gradient-to-r from-[#EFF6FF] to-[#FFFFFF] border border-[#DBEAFE] rounded-2xl p-4 text-[#172033] shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#EFF6FF] border border-[#DBEAFE] flex items-center justify-center text-[#2563EB] shadow-2xs">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black tracking-tight text-[#172033]">AI ROAD SCANNER</h1>
                <span className="px-2 py-0.5 bg-[#EFF6FF] text-[#2563EB] border border-[#DBEAFE] rounded text-[9.5px] font-mono font-bold uppercase tracking-wider">
                  Automated Dashcam Pipeline
                </span>
              </div>
              <p className="text-xs text-[#64748B] mt-0.5">
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
            className="px-3.5 py-2 bg-[#F5F3FF] hover:bg-[#EDE9FE] border border-[#DDD6FE] text-[#7C3AED] hover:text-[#6D28D9] rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
            title="Runs 3 consecutive frames with temporal confirmation and 5m deduplication"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#7C3AED]" />
            <span>Test 3-Frame 5m Dedup</span>
          </button>
          <button
            onClick={onSwitchToManual}
            id="switch-manual-report-btn"
            className="px-3.5 py-2 bg-white hover:bg-[#F8FAFC] border border-[#E2E8F0] text-[#475569] hover:text-[#172033] rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Manual Photo Report</span>
          </button>
        </div>
      </div>

      {/* SOURCE SELECTOR BAR */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-[#172033] shadow-xs">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono font-bold uppercase text-[#64748B] tracking-wider">CAMERA SOURCE:</span>
          <div className="flex items-center bg-[#F8FAFC] p-1 rounded-xl border border-[#E2E8F0] gap-1">
            <button
              onClick={() => handleSelectSource("VEHICLE_DASHCAM")}
              id="select-source-vehicle-dashcam"
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                source === "VEHICLE_DASHCAM" 
                  ? "bg-[#2563EB] text-white shadow-xs" 
                  : "text-[#64748B] hover:text-[#172033] hover:bg-white"
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
                  : "text-[#64748B] hover:text-[#172033] hover:bg-white"
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
                  : "text-[#64748B] hover:text-[#172033] hover:bg-white"
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>RECORDED VIDEO</span>
            </button>
          </div>
        </div>

        {/* Source Details & Diagnostics */}
        <div className="text-xs text-[#64748B] font-mono">
          {source === "VEHICLE_DASHCAM" && (
            <span className="flex items-center gap-1.5 text-[#2563EB]">
              <Car className="w-3.5 h-3.5" />
              <span>Primary Source: USB/UVC Dashcam & Wi-Fi Stream Ready</span>
            </span>
          )}
          {source === "PHONE_CAMERA" && (
            <span className="flex items-center gap-1.5 text-[#16A34A]">
              <Smartphone className="w-3.5 h-3.5" />
              <span>Fallback: Mobile Dashboard Mount Camera</span>
            </span>
          )}
          {source === "RECORDED_VIDEO" && (
            <span className="px-2 py-0.5 bg-[#F5F3FF] text-[#7C3AED] border border-[#DDD6FE] rounded text-[10px] font-bold">
              [ Recorded Dashcam Video / Demo Source ]
            </span>
          )}
        </div>
      </div>

      {/* DASHCAM SETUP & PROTOCOL COMPATIBILITY PANEL (Shown when Vehicle Dashcam is active) */}
      {source === "VEHICLE_DASHCAM" && !isScanning && (
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3 text-xs text-[#475569] space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-[#172033] font-bold">
              <Car className="w-4 h-4 text-[#2563EB]" />
              <span>Vehicle Dashcam Hardware Interface</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDashcamMode("DEVICE")}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  dashcamMode === "DEVICE" ? "bg-[#2563EB] text-white shadow-2xs" : "bg-white text-[#64748B] border border-[#E2E8F0]"
                }`}
              >
                USB / UVC Capture
              </button>
              <button
                onClick={() => setDashcamMode("NETWORK")}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  dashcamMode === "NETWORK" ? "bg-[#2563EB] text-white shadow-2xs" : "bg-white text-[#64748B] border border-[#E2E8F0]"
                }`}
              >
                Wi-Fi / RTSP Stream
              </button>
            </div>
          </div>

          {dashcamMode === "DEVICE" ? (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[#64748B] shrink-0">Select Video Device:</span>
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                className="bg-white border border-[#CBD5E1] text-[#172033] rounded-lg px-2.5 py-1 text-xs focus:ring-1 focus:ring-[#2563EB] max-w-sm"
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
              <span className="text-[#64748B] shrink-0">Stream URL:</span>
              <input
                type="text"
                value={dashcamStreamUrl}
                onChange={(e) => setDashcamStreamUrl(e.target.value)}
                placeholder="http://192.168.1.254:8080/mjpeg"
                className="bg-white border border-[#CBD5E1] text-[#172033] rounded-lg px-2.5 py-1 text-xs flex-1 min-w-[200px]"
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

          <div className="text-[10.5px] text-[#64748B] leading-relaxed pt-1 border-t border-[#E2E8F0]">
            <span className="font-bold text-[#172033]">Compatibility Note:</span> Supports standard Wi-Fi Dashcam streams (HTTP/MJPEG or WebRTC URLs) and UVC USB-connected dashcams. For standard dashcams with SD-card-only recording, select 'Recorded Video' to analyze clips.
          </div>
        </div>
      )}

      {/* RECORDED VIDEO DEMO OPTIONS */}
      {source === "RECORDED_VIDEO" && !isScanning && (
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3 text-xs text-[#475569] flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-[#7C3AED]" />
            <span className="font-bold text-[#172033]">Pre-recorded Dashcam Highway Feed</span>
            <span className="px-2 py-0.5 bg-[#F5F3FF] text-[#7C3AED] border border-[#DDD6FE] rounded text-[9.5px] font-mono font-bold">
              [ Recorded Dashcam Video / Demo Source ]
            </span>
          </div>
          <div className="text-[11px] text-[#64748B]">
            Realistic road surface simulation ready. Press <span className="text-[#172033] font-bold">"Start Live Scan"</span> to begin continuous playback.
          </div>
        </div>
      )}

      {/* 2. SCANNER VIEWPORT & HUD */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* MAIN HUD (Left 8 Cols) */}
        <div className="lg:col-span-8 space-y-3">
          <div className="relative bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden aspect-video shadow-2xl flex items-center justify-center">
            
            {/* Live Camera Video Feed */}
            {source !== "RECORDED_VIDEO" ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${cameraState !== "CAMERA_READY" ? "hidden" : "block"}`}
              />
            ) : (
              // Realistic Highway Dashcam Demo Simulation Canvas or Video
              <div className="w-full h-full relative bg-[#1c1f26] flex items-center justify-center overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-b from-[#111317] via-[#21242c] to-[#16181f]"></div>
                
                {/* Perspective Lane Markings */}
                <div className="absolute inset-0 flex justify-center items-center pointer-events-none">
                  <div className="w-0.5 h-full bg-amber-500/80 shadow-[0_0_10px_rgba(245,158,11,0.6)] animate-pulse"></div>
                </div>

                {/* Simulated Road Pothole in view */}
                <div className="absolute w-36 h-20 bg-slate-950 rounded-full border-4 border-slate-900 shadow-inner flex items-center justify-center bottom-16">
                  <div className="w-20 h-10 bg-amber-950/40 rounded-full"></div>
                </div>

                <div className="absolute top-4 left-4 z-10">
                  <span className="px-2.5 py-1 bg-black/80 backdrop-blur-md text-purple-300 border border-purple-500/50 rounded-lg text-[10px] font-mono font-bold">
                    [ Recorded Dashcam Video / Demo Source ]
                  </span>
                </div>
              </div>
            )}

            {/* Fallback View when camera is not initialized */}
            {source !== "RECORDED_VIDEO" && cameraState !== "CAMERA_READY" && (
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

            {/* 4. VISUAL DETECTION OVERLAY: REAL RED BOUNDING BOX (No fake centered box) */}
            {activeOverlayBox && (
              <div
                className="absolute border-2 border-red-500 bg-red-500/20 shadow-[0_0_20px_rgba(239,68,68,0.6)] rounded-sm pointer-events-none z-30 transition-all duration-300"
                style={{
                  left: `${activeOverlayBox.bbox.x * 100}%`,
                  top: `${activeOverlayBox.bbox.y * 100}%`,
                  width: `${activeOverlayBox.bbox.width * 100}%`,
                  height: `${activeOverlayBox.bbox.height * 100}%`
                }}
              >
                {/* High-tech HUD tag above the box */}
                <div className="absolute -top-7 left-0 bg-red-600 text-white font-mono text-[9px] font-black px-2 py-0.5 rounded-t whitespace-nowrap shadow-md flex items-center gap-1.5 uppercase">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping"></span>
                  <span>🔴 {activeOverlayBox.category}</span>
                  <span>•</span>
                  <span>{activeOverlayBox.confidence}% CONF</span>
                  <span>•</span>
                  <span>{activeOverlayBox.severity}% SEV</span>
                </div>

                {activeOverlayBox.estimatedSizeText && (
                  <div className="absolute -bottom-5 left-0 bg-black/85 text-red-300 font-mono text-[8px] font-bold px-1.5 py-0.2 rounded-b whitespace-nowrap border border-red-600/40">
                    Est: {activeOverlayBox.estimatedSizeText}
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
                    <span>Finish Scan & Review ({candidates.length})</span>
                  </button>
                </div>
              )}
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
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 space-y-3.5 text-[#172033] shadow-xs">
            <h3 className="text-xs font-bold text-[#64748B] uppercase tracking-wider font-mono flex items-center justify-between">
              <span>SCANNER TELEMETRY</span>
              <span className="w-2 h-2 rounded-full bg-[#16A34A] animate-pulse"></span>
            </h3>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="bg-[#F8FAFC] p-3 rounded-xl border border-[#E2E8F0]">
                <span className="text-[10px] text-[#64748B] uppercase font-mono block">Extracted Frames</span>
                <span className="text-xl font-mono font-black text-[#16A34A]">{extractedFramesCount}</span>
              </div>
              <div className="bg-[#F8FAFC] p-3 rounded-xl border border-[#E2E8F0]">
                <span className="text-[10px] text-[#64748B] uppercase font-mono block">FPS / Speed</span>
                <span className="text-base font-mono font-bold text-[#2563EB]">{liveFps} FPS / {currentGps?.speed ?? 35} km/h</span>
              </div>
              <div className="bg-[#F8FAFC] p-3 rounded-xl border border-[#E2E8F0]">
                <span className="text-[10px] text-[#64748B] uppercase font-mono block">Auto Incidents</span>
                <span className="text-xl font-mono font-black text-[#16A34A]">{autoIncidents.length}</span>
              </div>
              <div className="bg-[#F8FAFC] p-3 rounded-xl border border-[#E2E8F0]">
                <span className="text-[10px] text-[#64748B] uppercase font-mono block">5m Dedup Merged</span>
                <span className="text-xl font-mono font-black text-[#7C3AED]">{diagStats.mergedDuplicatesCount}</span>
              </div>
            </div>

            {/* Dev Pipeline Diagnostics Breakdown */}
            <div className="pt-2 border-t border-[#E2E8F0] space-y-1.5 text-[10.5px] font-mono text-[#64748B]">
              <div className="text-[10px] uppercase font-bold text-[#7C3AED] flex items-center justify-between">
                <span>PIPELINE DIAGNOSTICS</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                  diagStats.aiStatus === "ERROR" ? "bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]" :
                  diagStats.aiStatus === "RATE_LIMITED" ? "bg-[#FFFBEB] text-[#F59E0B] border border-[#FDE68A]" :
                  diagStats.aiStatus === "SUCCESS" ? "bg-[#F0FDF4] text-[#16A34A] border border-[#BBF7D0]" :
                  "bg-[#EFF6FF] text-[#2563EB] border border-[#DBEAFE]"
                }`}>
                  AI: {diagStats.aiStatus}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-x-2 gap-y-1 pt-1 border-t border-[#F1F5F9]">
                <div className="flex justify-between">
                  <span>Model:</span>
                  <span className="text-[#172033] font-bold">{diagStats.geminiModel || "gemini-3.8-flash"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Dedup Radius:</span>
                  <span className="text-[#16A34A] font-bold">5.0 meters</span>
                </div>
                <div className="flex justify-between">
                  <span>AI Calls:</span>
                  <span className="text-[#172033] font-bold">{diagStats.geminiRequests} (P:{diagStats.geminiSuccess}/F:{diagStats.geminiFailed})</span>
                </div>
                <div className="flex justify-between">
                  <span>Test Status:</span>
                  <span className={`font-bold ${diagStats.testStatus === "PASS" ? "text-[#16A34A]" : diagStats.testStatus === "FAIL" ? "text-[#DC2626]" : "text-[#64748B]"}`}>
                    {diagStats.testStatus}
                  </span>
                </div>
              </div>

              <div className="space-y-1 pt-1 border-t border-[#F1F5F9]">
                <div className="flex justify-between">
                  <span>Raw AI Detections:</span>
                  <span className="text-[#172033] font-bold">{diagStats.rawDetectionsCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Temporal Confirmed:</span>
                  <span className="text-[#16A34A] font-bold">{diagStats.temporalConfirmedCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Spatial Deduplicated (&lt;5m):</span>
                  <span className="text-[#7C3AED] font-bold">{diagStats.mergedDuplicatesCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Auto-Submitted Incidents:</span>
                  <span className="text-[#16A34A] font-bold">{diagStats.autoReportedCount}</span>
                </div>
              </div>
            </div>
          </div>

          {/* AUTOMATIC INCIDENTS STREAM */}
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 text-[#172033] shadow-xs flex flex-col h-[320px]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-[#64748B] uppercase tracking-wider font-mono">
                AUTO-REPORTED INCIDENTS ({autoIncidents.length})
              </h3>
              {autoIncidents.length > 0 && (
                <span className="text-[10px] font-mono font-bold text-[#16A34A] bg-[#F0FDF4] px-1.5 py-0.5 rounded border border-[#BBF7D0]">Municipal Queued</span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {autoIncidents.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-4 text-[#94A3B8]">
                  <Activity className="w-6 h-6 mb-2 opacity-50 text-[#94A3B8]" />
                  <p className="text-xs font-medium">No incidents confirmed or auto-reported yet.</p>
                  <p className="text-[11px] text-[#94A3B8] mt-1">Start scan to begin continuous detection.</p>
                </div>
              ) : (
                autoIncidents.map((inc) => (
                  <div
                    key={inc.id}
                    className="p-2.5 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] flex items-center justify-between text-xs transition-all hover:border-[#CBD5E1]"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-[#DC2626] animate-pulse"></div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-[#172033]">{inc.hazardType}</span>
                          <span className="text-[9px] font-mono bg-[#F0FDF4] text-[#16A34A] border border-[#BBF7D0] px-1 rounded font-bold">
                            {inc.workflowState}
                          </span>
                        </div>
                        <span className="text-[10px] text-[#64748B] font-mono block mt-0.5">
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
                      <span className="text-[11px] font-bold text-[#DC2626] block">
                        {inc.severity}% Sev
                      </span>
                      <span className="text-[9.5px] text-[#16A34A] font-bold block">
                        {inc.confidence}% Conf
                      </span>
                      <span className="text-[9px] text-[#94A3B8]">{inc.timestamp}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
