import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  FirestoreDataConverter,
  DocumentData,
  QueryDocumentSnapshot,
  SnapshotOptions
} from "firebase/firestore";
import { db, auth, handleFirestoreError, OperationType, stripUndefinedDeep } from "../lib/firebase";
import { 
  Report, 
  ReportCategory, 
  ReportStatus, 
  ReportSource, 
  Priority, 
  RiskLevel,
  UserProfile 
} from "../types";
import { uploadReportEvidence } from "./storageService";

// ===================================================
// CANONICAL FIRESTORE CONVERTER FOR REPORTS
// ===================================================

export const reportConverter: FirestoreDataConverter<Report> = {
  toFirestore(report: Report): DocumentData {
    // Safety check: ensure only remote download URLs or storage paths are stored, NEVER raw base64 or blob: strings
    const safeImage = (report.image && (report.image.startsWith("http://") || report.image.startsWith("https://") || report.image.startsWith("gs://") || report.image.startsWith("reports/")))
      ? report.image
      : null;
    const safeEvidenceUrl = (report.evidenceUrl && (report.evidenceUrl.startsWith("http://") || report.evidenceUrl.startsWith("https://") || report.evidenceUrl.startsWith("gs://") || report.evidenceUrl.startsWith("reports/")))
      ? report.evidenceUrl
      : safeImage;

    const docData: DocumentData = {
      id: report.id,
      reportId: report.id,
      userId: report.userId || "",
      reporterEmail: report.reporterEmail || "citizen@urbanpulse.gov",
      title: report.title || "Hazard Incident",
      description: report.description || "",
      category: report.category || "Pothole",
      issueType: report.issueType || report.category || "Pothole",
      severity: Number(report.severity) || 50,
      riskLevel: report.riskLevel || "Medium",
      priority: report.priority || (report.severity >= 75 ? "High" : report.severity >= 45 ? "Medium" : "Low"),
      confidence: Number(report.confidence) || 0,
      aiConfidence: Number(report.confidence ?? report.aiAnalysis?.confidence ?? 0),
      aiAssessment: report.aiAnalysis?.description || report.description || "Manual incident assessment",
      status: report.status || "Pending",
      location: report.location || "Urban Corridor",
      latitude: Number(report.latitude),
      longitude: Number(report.longitude),
      image: safeImage,
      evidenceUrl: safeEvidenceUrl,
      assignedTo: report.assignedTo || null,
      source: report.source || "MANUAL_REPORT",
      roadScanId: report.roadScanId || null,
      clusterCount: report.clusterCount ?? 1,
      evidenceFrames: (report.evidenceFrames || []).filter(f => typeof f === "string" && (f.startsWith("http://") || f.startsWith("https://"))),
      createdAt: report.createdAt || new Date().toISOString(),
      updatedAt: report.updatedAt || new Date().toISOString(),
      aiAnalysis: report.aiAnalysis || null
    };

    if (report.fieldStatus) docData.fieldStatus = report.fieldStatus;
    if (report.assignment) docData.assignment = report.assignment;
    if (report.fieldVerification) docData.fieldVerification = report.fieldVerification;
    if (report.resolution) docData.resolution = report.resolution;
    if (report.unsafeConditions) docData.unsafeConditions = report.unsafeConditions;
    if (report.workflowState) docData.workflowState = report.workflowState;
    if (report.sourceCamera) docData.sourceCamera = report.sourceCamera;
    if (report.boundingBox) docData.boundingBox = report.boundingBox;

    return stripUndefinedDeep(docData);
  },
  fromFirestore(snapshot: QueryDocumentSnapshot, options: SnapshotOptions): Report {
    const data = snapshot.data(options);
    const severity = Number(data.severity ?? 50);
    const riskLevel: RiskLevel = data.riskLevel || (severity >= 75 ? "High" : severity >= 45 ? "Medium" : "Low");
    const priority: Priority = data.priority || (severity >= 75 ? "High" : severity >= 45 ? "Medium" : "Low");

    return {
      id: snapshot.id,
      userId: data.userId || "",
      title: data.title || "Hazard Report",
      description: data.description || "",
      category: (data.category || data.issueType || "Pothole") as ReportCategory,
      issueType: data.issueType || data.category || "Pothole",
      severity: severity,
      riskLevel: riskLevel,
      priority: priority,
      confidence: Number(data.confidence ?? 85),
      status: (data.status || "Pending") as ReportStatus,
      location: data.location || "Delhi NCR Grid",
      latitude: Number(data.latitude) || 0,
      longitude: Number(data.longitude) || 0,
      image: data.image || data.evidenceUrl || null,
      evidenceUrl: data.evidenceUrl || data.image || null,
      reporterEmail: data.reporterEmail || "citizen@urbanpulse.gov",
      assignedTo: data.assignedTo || null,
      source: (data.source || "MANUAL_REPORT") as ReportSource,
      roadScanId: data.roadScanId || undefined,
      clusterCount: data.clusterCount ?? 1,
      evidenceFrames: data.evidenceFrames || [],
      fieldStatus: data.fieldStatus,
      assignment: data.assignment,
      fieldVerification: data.fieldVerification,
      resolution: data.resolution,
      unsafeConditions: data.unsafeConditions,
      workflowState: data.workflowState,
      sourceCamera: data.sourceCamera,
      boundingBox: data.boundingBox,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString(),
      aiAnalysis: data.aiAnalysis || null
    };
  }
};

// ===================================================
// COORDINATES & DATA VALIDATION HELPERS
// ===================================================

export interface CreateReportInput {
  id?: string;
  title: string;
  description: string;
  category: ReportCategory;
  location: string;
  latitude: number;
  longitude: number;
  image?: File | Blob | string | null;
  source?: ReportSource;
  severity?: number;
  riskLevel?: RiskLevel;
  priority?: Priority;
  confidence?: number;
  aiAnalysis?: Report["aiAnalysis"];
  roadScanId?: string;
  clusterCount?: number;
  evidenceFrames?: string[];
}

export function validateCoordinates(lat: number, lng: number): { valid: boolean; error?: string } {
  if (typeof lat !== "number" || typeof lng !== "number") {
    return { valid: false, error: "Coordinates must be numeric floating point values." };
  }
  if (isNaN(lat) || isNaN(lng)) {
    return { valid: false, error: "Coordinates contain NaN (Not-a-Number)." };
  }
  if (!isFinite(lat) || !isFinite(lng)) {
    return { valid: false, error: "Coordinates must be finite numbers." };
  }
  if (lat < -90 || lat > 90) {
    return { valid: false, error: `Latitude ${lat} is out of the valid range (-90 to +90 degrees).` };
  }
  if (lng < -180 || lng > 180) {
    return { valid: false, error: `Longitude ${lng} is out of the valid range (-180 to +180 degrees).` };
  }
  return { valid: true };
}

// In-memory idempotency cache (sliding window of 60 seconds)
const recentSubmissions = new Map<string, { timestamp: number; reportId: string }>();

function generateIdempotencyKey(userId: string, title: string, category: string, lat: number, lng: number): string {
  const roundedLat = lat.toFixed(4);
  const roundedLng = lng.toFixed(4);
  return `${userId}_${category}_${roundedLat}_${roundedLng}_${title.trim().toLowerCase()}`;
}

// ===================================================
// CANONICAL REPORT SERVICE OPERATIONS
// ===================================================

/**
 * Creates a canonical report in Firestore `reports/{reportId}`.
 * Uploads evidence to Firebase Storage if an image is provided.
 */
export async function createReport(
  input: CreateReportInput,
  currentUser?: { uid?: string; id?: string; email?: string; name?: string; fullName?: string }
): Promise<Report> {
  // 0. Enforce authenticated Firebase session before any Firestore operation
  const currentAuthUser = auth.currentUser;
  if (!currentAuthUser) {
    console.warn(`[reportsService] Denied Firestore write: No authenticated Firebase user session. Path: reports/*`);
    throw new Error("Please sign in before submitting a report.");
  }

  const userId = currentAuthUser.uid;
  const userEmail = currentAuthUser.email || "citizen@urbanpulse.ai";

  // 1. Validate mandatory fields
  if (!input.title || !input.title.trim()) {
    throw new Error("Report title is required.");
  }
  if (!input.location || !input.location.trim()) {
    throw new Error("Incident location is required.");
  }

  // 2. Validate coordinates
  const coordValidation = validateCoordinates(input.latitude, input.longitude);
  if (!coordValidation.valid) {
    throw new Error(`Location validation error: ${coordValidation.error}`);
  }

  // 3. Duplicate / Idempotency protection check
  const idempotencyKey = generateIdempotencyKey(
    userId,
    input.title,
    input.category,
    input.latitude,
    input.longitude
  );
  const now = Date.now();
  const existingSubmission = recentSubmissions.get(idempotencyKey);
  if (existingSubmission && (now - existingSubmission.timestamp) < 45000) {
    console.warn("Duplicate report submission intercepted by idempotency engine:", idempotencyKey);
    // Return existing report if already saved
    const existing = await getReport(existingSubmission.reportId);
    if (existing) return existing;
  }

  const reportId = input.id || `UP-${Math.floor(1000 + Math.random() * 9000)}`;
  const timestamp = new Date().toISOString();

  // 4. Upload evidence image to Firebase Storage if available (and not already an HTTP/HTTPS URL)
  let evidenceUrl: string | null = null;
  if (input.image) {
    if (
      typeof input.image === "string" &&
      (input.image.startsWith("http://") || input.image.startsWith("https://")) &&
      !input.image.startsWith("blob:") &&
      !input.image.startsWith("data:")
    ) {
      evidenceUrl = input.image;
    } else {
      // Must upload File, Blob, or base64 data to Firebase Storage
      try {
        evidenceUrl = await uploadReportEvidence(
          userId,
          reportId,
          input.image,
          `evidence_${Date.now()}.jpg`
        );
      } catch (uploadError: any) {
        console.error("[reportsService] Evidence Storage upload failed:", uploadError);
        throw new Error(`Evidence image upload failed: ${uploadError?.message || "Storage error"}. Report creation stopped.`);
      }
    }
  }

  const severity = input.severity ?? (input.aiAnalysis?.severityScore || 50);
  const riskLevel: RiskLevel = input.riskLevel || input.aiAnalysis?.riskLevel || (severity >= 75 ? "High" : severity >= 45 ? "Medium" : "Low");
  const priority: Priority = input.priority || (severity >= 75 ? "High" : severity >= 45 ? "Medium" : "Low");

  const canonicalReport: Report = {
    id: reportId,
    userId: userId,
    title: input.title.trim(),
    description: input.description?.trim() || `Automated report for ${input.title}`,
    category: input.category || "Pothole",
    issueType: input.category || "Pothole",
    severity: severity,
    riskLevel: riskLevel,
    priority: priority,
    confidence: input.confidence ?? (input.aiAnalysis?.confidence || 85),
    status: "Pending",
    location: input.location.trim(),
    latitude: input.latitude,
    longitude: input.longitude,
    image: evidenceUrl,
    evidenceUrl: evidenceUrl,
    reporterEmail: userEmail,
    assignedTo: null,
    source: input.source || "MANUAL_REPORT",
    roadScanId: input.roadScanId,
    clusterCount: input.clusterCount ?? 1,
    evidenceFrames: input.evidenceFrames || [],
    createdAt: timestamp,
    updatedAt: timestamp,
    aiAnalysis: input.aiAnalysis || null
  };

  // 5. Write to Firestore `reports/{reportId}`
  const path = `reports/${reportId}`;

  // Log pre-write state without sensitive tokens (Rule 10)
  console.log(`[Firestore Pre-Write Auth Check] Operation: ${OperationType.CREATE} | Path: ${path} | Has currentUser: ${Boolean(currentAuthUser)} | UID: ${currentAuthUser.uid}`);

  try {
    const reportRef = doc(db, "reports", reportId).withConverter(reportConverter);
    
    // Hard 10-second timeout on Firestore setDoc
    const writePromise = setDoc(reportRef, canonicalReport);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Firestore write timed out after 10 seconds.")), 10000)
    );
    await Promise.race([writePromise, timeoutPromise]);
    
    // Register idempotency key
    recentSubmissions.set(idempotencyKey, { timestamp: now, reportId });

    // 6. Log status history record in `history` collection (non-blocking)
    const historyId = `hist_${Date.now().toString(36)}`;
    setDoc(doc(db, "history", historyId), {
      id: historyId,
      reportId: reportId,
      status: "Pending",
      updatedBy: userEmail,
      comment: `Incident registered from ${canonicalReport.source === "ROAD_SCANNER" ? "AI Road Scanner" : "Manual Citizen Portal"}.`,
      createdAt: timestamp
    }).catch(hErr => console.warn("Could not log initial history document:", hErr));

    return canonicalReport;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
    return canonicalReport;
  }
}

/**
 * Retrieves a single report by document ID.
 */
export async function getReport(reportId: string): Promise<Report | null> {
  const path = `reports/${reportId}`;
  try {
    const reportRef = doc(db, "reports", reportId).withConverter(reportConverter);
    const snap = await getDoc(reportRef);
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
    return null;
  }
}

/**
 * Retrieves all reports created by a specific citizen.
 * Queries by userId or reporterEmail and returns unified list (Manual + Road Scanner).
 */
export async function getCitizenReports(userIdentifier: string): Promise<Report[]> {
  const path = "reports";
  try {
    // Try querying by reporterEmail first
    const isEmail = userIdentifier.includes("@");
    const fieldName = isEmail ? "reporterEmail" : "userId";
    
    const q = query(
      collection(db, path).withConverter(reportConverter),
      where(fieldName, "==", userIdentifier),
      limit(100)
    );
    
    const snap = await getDocs(q);
    const results = snap.docs.map(d => d.data());
    
    // Sort chronologically (latest first)
    return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

/**
 * Retrieves all reports for the Municipal Command Center with optional filters.
 */
export interface MunicipalReportFilters {
  status?: string;
  category?: string;
  riskLevel?: string;
  source?: ReportSource;
  limitCount?: number;
}

export async function getMunicipalReports(filters?: MunicipalReportFilters): Promise<Report[]> {
  const path = "reports";
  try {
    const constraints: any[] = [];

    if (filters?.status && filters.status !== "All") {
      constraints.push(where("status", "==", filters.status));
    }
    if (filters?.category && filters.category !== "All") {
      constraints.push(where("category", "==", filters.category));
    }
    if (filters?.source) {
      constraints.push(where("source", "==", filters.source));
    }

    const q = query(
      collection(db, path).withConverter(reportConverter),
      ...constraints,
      limit(filters?.limitCount || 150)
    );

    const snap = await getDocs(q);
    const results = snap.docs.map(d => d.data());

    return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

/**
 * Updates a report's lifecycle status, assignment, and audit trail in Firestore.
 */
export async function updateReportStatus(
  reportId: string,
  newStatus: ReportStatus,
  officerName: string = "Municipal Dispatch",
  comment: string = "",
  assignedTo?: string | null,
  userRole?: string
): Promise<void> {
  if (userRole && userRole !== "admin" && userRole !== "municipal") {
    throw new Error("Unauthorized: Only Municipal officers can change ticket status.");
  }

  const path = `reports/${reportId}`;
  const timestamp = new Date().toISOString();

  try {
    const reportRef = doc(db, "reports", reportId);
    const updates: Record<string, any> = {
      status: newStatus,
      updatedAt: timestamp
    };
    if (assignedTo !== undefined) {
      updates.assignedTo = assignedTo;
    }

    await updateDoc(reportRef, updates);

    // Record in history sub-log
    const historyId = `hist_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 5)}`;
    await setDoc(doc(db, "history", historyId), {
      id: historyId,
      reportId: reportId,
      status: newStatus,
      updatedBy: officerName,
      comment: comment || `Status transitioned to ${newStatus}.`,
      createdAt: timestamp
    });

    // Record municipal action audit
    const actionId = `act_${Date.now().toString(36)}`;
    await setDoc(doc(db, "municipalActions", actionId), {
      id: actionId,
      reportId: reportId,
      action: `STATUS_CHANGE_TO_${newStatus.toUpperCase().replace(/ /g, "_")}`,
      status: newStatus,
      officerName: officerName,
      comment: comment,
      createdAt: timestamp
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Deletes a report document from Firestore. Requires Municipal or Admin role.
 */
export async function deleteReport(reportId: string, userRole?: string): Promise<void> {
  if (userRole && userRole !== "admin" && userRole !== "municipal") {
    throw new Error("Unauthorized: Only Municipal officers can delete incident reports.");
  }

  const path = `reports/${reportId}`;
  try {
    await deleteDoc(doc(db, "reports", reportId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Retrieves status history audit trail for a report from Firestore.
 */
export async function getReportHistory(reportId: string): Promise<{ id: string; reportId: string; status: string; updatedBy: string; comment: string; createdAt: string; }[]> {
  const path = "history";
  try {
    const q = query(
      collection(db, path),
      where("reportId", "==", reportId),
      limit(50)
    );
    const snap = await getDocs(q);
    const historyList = snap.docs.map(d => ({
      id: d.id,
      reportId: d.data().reportId || reportId,
      status: d.data().status || "Pending",
      updatedBy: d.data().updatedBy || "Municipal Officer",
      comment: d.data().comment || "",
      createdAt: d.data().createdAt || new Date().toISOString()
    }));

    return historyList.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}
