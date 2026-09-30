// --- CORE DOMAIN USER & ROLE TYPES ---

export type UserRole = "citizen" | "admin" | "municipal" | "field_team";

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  active?: boolean;
  department?: string;
  teamId?: string;
  teamName?: string;
  teamLead?: string;
  availability?: "AVAILABLE" | "BUSY" | "OFFLINE";
  points?: number;
  badges?: string[];
  scansCount?: number;
  reportsCount?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface UserProfile {
  uid: string;
  id?: string;
  email: string;
  name: string;
  fullName?: string;
  role: UserRole;
  active?: boolean;
  department?: string;
  teamId?: string;
  teamName?: string;
  teamLead?: string;
  availability?: "AVAILABLE" | "BUSY" | "OFFLINE";
  points: number;
  badges?: string[];
  scansCount?: number;
  reportsCount?: number;
  createdAt: string;
  updatedAt: string;
}

// --- FIELD OPERATIONS DATA MODELS ---

export type FieldTaskStatus = 
  | "ASSIGNED" 
  | "ACCEPTED" 
  | "EN_ROUTE" 
  | "ON_SITE" 
  | "VERIFIED" 
  | "ACTION_STARTED" 
  | "RESOLUTION_SUBMITTED" 
  | "MUNICIPAL_REVIEW" 
  | "RETURN_TO_TEAM"
  | "RESOLVED" 
  | "CLOSED";

export type FieldVerificationResult = 
  | "VERIFIED"
  | "NOT_FOUND"
  | "DIFFERENT_ISSUE"
  | "NEEDS_ESCALATION"
  | "ISSUE_CONFIRMED" 
  | "ISSUE_NOT_FOUND" 
  | "PARTIALLY_VERIFIED" 
  | "NEEDS_FURTHER_INSPECTION";

export type TeamAvailabilityStatus = "AVAILABLE" | "ON_TASK" | "OFFLINE" | "EMERGENCY" | "UNAVAILABLE";

export interface ReassignmentRecord {
  id: string;
  previousTeamId: string;
  previousTeamName: string;
  newTeamId: string;
  newTeamName: string;
  changedBy: string;
  reason: string;
  notes?: string;
  timestamp: string;
}

export interface FieldAssignment {
  assignmentId?: string;
  reportId?: string;
  fieldTeamId?: string;
  teamId: string;
  teamName: string;
  assignedBy?: string;
  assignedAt: string;
  status?: string;
  priority?: Priority;
  dueAt?: string;
  acceptedAt?: string;
  acceptedBy?: string;
  completedAt?: string;
  notes?: string;
  enRouteAt?: string;
  arrivedAt?: string;
  slaDeadline?: string;
  slaHours?: number;
  reassignmentRequested?: boolean;
  reassignmentReason?: string;
  reassignmentNotes?: string;
  reassignmentRequestedAt?: string;
  reassignmentHistory?: ReassignmentRecord[];
}

export interface FieldVerification {
  result: FieldVerificationResult;
  notes: string;
  verifiedBy: string;
  verifiedAt: string;
  evidenceUrls: string[];
  location?: {
    latitude: number;
    longitude: number;
  };
  gpsVerified: boolean;
  gpsDistanceMeters?: number;
  fieldAIAnalysis?: {
    classification: "Confirmed hazard" | "Possible hazard" | "No visible hazard" | "Insufficient evidence";
    confidence: number;
    notes: string;
    analyzedAt?: string;
  };
}

export interface FieldResolution {
  action: string;
  notes: string;
  beforeEvidence: string[];
  afterEvidence: string[];
  submittedBy: string;
  submittedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  rejectionNotes?: string;
  rejectedAt?: string;
}

export interface UnsafeConditionReport {
  id: string;
  incidentId: string;
  teamId: string;
  teamName: string;
  reportedBy: string;
  conditionType: string;
  notes: string;
  latitude?: number;
  longitude?: number;
  reportedAt: string;
}

export interface FieldTeamMeta {
  id: string;
  name: string;
  lead: string;
  category: string;
  district: string;
  department?: string;
  serviceZone?: string;
  phone: string;
  availability: TeamAvailabilityStatus;
  activeTaskCount: number;
  currentIncidentId?: string | null;
  currentIncidentTitle?: string | null;
  lastOperationalStatus?: string;
  lastUpdate?: string;
  membersCount?: number;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuditLog {
  id: string;
  action: string;
  actorRole: UserRole | "system";
  actorEmail: string;
  targetId?: string;
  targetType?: "report" | "user" | "team" | "system";
  details: string;
  status?: string;
  timestamp: string;
}

// --- AI ANALYSIS TYPES ---

export interface AIAnalysis {
  category: string;
  severityScore: number;
  riskLevel: "Low" | "Medium" | "High";
  confidence: number;
  description: string;
  recommendedActions: string[];
}

export type AIAnalysisResult = AIAnalysis;

// --- REPORTS DATA MODEL ---

export type ReportCategory = 
  | "Pothole" 
  | "Road Crack"
  | "Damaged Road Surface"
  | "Waterlogging"
  | "Missing/Damaged Sign"
  | "Broken Streetlight" 
  | "Road Obstruction" 
  | "Garbage Overflow" 
  | "Vandals / Graffiti" 
  | "Other";

export type ReportStatus = "Pending" | "Assigned" | "In Progress" | "Resolved";

export type ReportSource = "MANUAL_REPORT" | "ROAD_SCANNER";

export type Priority = "Low" | "Medium" | "High" | "Critical";

export type RiskLevel = "Low" | "Medium" | "High";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Report {
  id: string;
  userId?: string;
  title: string;
  description: string;
  category: ReportCategory;
  issueType?: string;
  severity: number;
  riskLevel: RiskLevel;
  priority?: Priority;
  confidence: number;
  status: ReportStatus;
  location: string;
  latitude: number;
  longitude: number;
  image: string | null;
  evidenceUrl?: string | null;
  reporterEmail: string;
  assignedTo: string | null;
  source?: ReportSource;
  roadScanId?: string;
  clusterCount?: number;
  evidenceFrames?: string[];
  boundingBox?: { x: number, y: number, width: number, height: number };
  sourceCamera?: "Vehicle Dashcam" | "Phone Camera" | "Recorded Video" | "Demo Video";
  estimatedWidth?: string;
  estimatedLength?: string;
  estimatedArea?: string;
  sizeConfidence?: "High" | "Medium" | "Low" | "Unavailable";
  observationsCount?: number;
  lastSeen?: string;
  workflowState?: "AI DETECTED" | "AI VERIFIED" | "AUTO REPORTED" | "MUNICIPAL QUEUED" | "ASSIGNED" | "IN PROGRESS" | "RESOLVED";
  autoReported?: boolean;
  fieldStatus?: FieldTaskStatus;
  assignment?: FieldAssignment;
  fieldVerification?: FieldVerification;
  resolution?: FieldResolution;
  unsafeConditions?: UnsafeConditionReport[];
  isSOS?: boolean;
  sosType?: string;
  sosTriggeredAt?: string;
  gpsAccuracy?: number;
  gpsSource?: "browser-geolocation";
  emergencyContactRequested?: boolean;
  createdAt: string;
  updatedAt: string;
  aiAnalysis: AIAnalysis | null;
}

// --- MUNICIPAL ACTIONS & AUDIT TRAILS ---

export interface MunicipalAction {
  id: string;
  reportId: string;
  municipalUserId?: string;
  officerName?: string;
  action: string;
  status: ReportStatus;
  comment: string;
  createdAt: string;
  updatedAt?: string;
}

export interface StatusHistory {
  id: string;
  reportId: string;
  status: string;
  updatedBy: string;
  comment: string;
  createdAt: string;
}

// --- NOTIFICATIONS DATA MODEL ---

export type NotificationType = 
  | "report_status" 
  | "report_submitted" 
  | "alert_high_severity" 
  | "task_assigned"
  | "task_reassigned"
  | "task_returned"
  | "resolution_approved"
  | "resolution_rejected"
  | "safety_alert"
  | "system";

export interface Notification {
  id: string;
  userId?: string;
  recipientEmail: string;
  recipientRole: "citizen" | "admin" | "municipal" | "field_team" | "all";
  title: string;
  message: string;
  type: NotificationType;
  reportId: string;
  relatedReportId?: string;
  read: boolean;
  createdAt: string;
}

// --- FORECAST & EXECUTIVE METRICS ---

export interface ForecastData {
  environmental: {
    aqi: number;
    aqiStatus: string;
    heatIndex: string;
    floodRisk: string;
    healthScore: number;
    scoreTrending: "improving" | "stable" | "declining";
  };
  traffic: {
    congestionFactor: string;
    congestionScore: number;
    forecastLabel: string;
    blockedRoads: number;
    safetyIndex: number;
  };
  riskEngine: Array<{
    id: string;
    title: string;
    area: string;
    probability: number;
    threat: "Low" | "Medium" | "High" | "Critical";
    trend: "increasing" | "stable" | "decreasing";
  }>;
}

// --- ROAD SCANNER TELEMETRY & CLUSTERING TYPES ---

export interface GPSCoordinate {
  latitude: number;
  longitude: number;
  altitude?: number | null;
  accuracy?: number;
  speed?: number | null; // meters per second
  heading?: number | null;
  timestamp: number;
}

export type GPSPoint = GPSCoordinate;

export interface RawRoadDetection {
  id: string;
  frameIndex: number;
  timestamp: number;
  imageUrl: string; // base64 or blob URL
  gps: GPSCoordinate;
  category: "Pothole" | "Severe Pothole" | "Road Crack / Fissure" | "Manhole Issue" | "Road Obstruction" | "Waterlogging / Drainage" | "Garbage on Road" | "Faded Lane Marking" | "Other";
  severityScore: number; // 0 - 100
  confidence: number; // 0 - 100
  description: string;
  boundingBox?: {
    x: number; // 0 - 1
    y: number; // 0 - 1
    width: number; // 0 - 1
    height: number; // 0 - 1
  };
  hazardType?: string;
  sourceCamera?: "Vehicle Dashcam" | "Phone Camera" | "Recorded Video" | "Demo Video";
  estimatedWidth?: string;
  estimatedLength?: string;
  estimatedArea?: string;
  sizeConfidence?: "High" | "Medium" | "Low" | "Unavailable";
  sizeTier?: "Small" | "Medium" | "Large";
}

export interface RoadScanCandidate {
  id: string;
  sessionId: string;
  clusterId: string;
  category: ReportCategory;
  subCategory: string;
  hazardType?: string;
  sourceCamera?: "Vehicle Dashcam" | "Phone Camera" | "Recorded Video" | "Demo Video";
  severity: number; // 0 - 100
  riskLevel: RiskLevel;
  priority: Priority;
  confidence: number; // 0 - 100
  location: string;
  latitude: number;
  longitude: number;
  primaryImage: string;
  evidenceFrames: string[];
  detectionsCount: number;
  observationsCount?: number;
  boundingBox?: { x: number, y: number, width: number, height: number };
  estimatedWidth?: string;
  estimatedLength?: string;
  estimatedArea?: string;
  sizeConfidence?: "High" | "Medium" | "Low" | "Unavailable";
  sizeTier?: "Small" | "Medium" | "Large";
  lastSeen?: string;
  description: string;
  recommendedActions: string[];
  selected: boolean;
  submissionState: "READY" | "SUBMITTING" | "SUBMITTED" | "FAILED";
  errorMessage?: string;
  submittedReportId?: string;
  autoReported?: boolean;
}

export interface RoadScanSession {
  id: string;
  userId: string;
  startTime: number;
  endTime?: number;
  totalDistanceMeters: number;
  totalFramesAnalyzed: number;
  totalDetections: number;
  candidates: RoadScanCandidate[];
  routePath: GPSCoordinate[];
  status: "RECORDING" | "PROCESSING" | "REVIEW_READY" | "COMPLETED";
}

export interface RoadScan {
  id: string;
  userId: string;
  startedAt: string;
  endedAt?: string;
  frameCount: number;
  candidateCount: number;
  totalDistanceMeters?: number;
  totalDetections?: number;
  status: "RECORDING" | "PROCESSING" | "REVIEW_READY" | "COMPLETED";
  createdAt: string;
}

// --- SAFE ROUTE & NAVIGATION TYPES ---

export interface SafeRouteOption {
  id: string;
  name: string;
  distanceKm: number;
  durationMinutes: number;
  safetyScore: number; // 0 - 100
  hazardCountAvoided: number;
  roadQuality: "Optimal" | "Moderate" | "Caution Required";
  pathCoordinates: [number, number][];
  hazardsOnRoute: Array<{
    type: string;
    severity: number;
    lat: number;
    lng: number;
    description: string;
  }>;
}

// --- REWARDS & LEADERBOARD TYPES ---

export interface RewardItem {
  id: string;
  title: string;
  category: "Transport Discount" | "Civic Utility Voucher" | "EV Charging Credit" | "Eco Store Coupon";
  pointsRequired: number;
  partner: string;
  code: string;
  available: boolean;
  expiresInDays: number;
}

export interface RewardTransaction {
  id: string;
  userId: string;
  pointsAwarded: number;
  reason: string;
  reportId?: string;
  createdAt: string;
}

export interface LeaderboardUser {
  rank: number;
  name: string;
  email: string;
  points: number;
  scansCount: number;
  reportsCount: number;
  badge: string;
  isCurrentUser?: boolean;
}

// --- PHASE 9: GEOGRAPHIC & INTELLIGENCE DATA TYPES ---

export interface MapReportPoint {
  id: string;
  title: string;
  category: ReportCategory;
  issueType: string;
  severity: number;
  riskLevel: RiskLevel;
  priority: Priority;
  status: ReportStatus;
  source: ReportSource;
  location: string;
  latitude: number;
  longitude: number;
  clusterCount?: number;
  createdAt: string;
  image?: string | null;
  description: string;
  confidence?: number;
  estimatedWidth?: string;
  estimatedLength?: string;
  estimatedArea?: string;
  sourceCamera?: string;
  observationsCount?: number;
  isSOS?: boolean;
  sosType?: string;
  gpsAccuracy?: number;
  reporterEmail?: string;
}

export interface HeatmapPoint {
  latitude: number;
  longitude: number;
  weight: number; // 0.0 - 1.0 based on severity and cluster volume
  severity: number;
  title: string;
  category: string;
  source: ReportSource;
  id: string;
}

export interface ReportTrend {
  period: string;
  count: number;
  manualCount: number;
  scannerCount: number;
  resolvedCount: number;
}

export interface IssueDistribution {
  category: string;
  count: number;
  percentage: number;
  avgSeverity: number;
}

export interface SeverityDistribution {
  name: "Critical" | "High" | "Medium" | "Low";
  count: number;
  color: string;
}

export interface StatusDistribution {
  status: ReportStatus;
  count: number;
  percentage: number;
}

export interface WardRanking {
  rank: number;
  name: string;
  score: number; // 0 - 100
  scoreLabel: string;
  totalReports: number;
  activeHazards: number;
  resolvedCount: number;
  trend: "improving" | "stable" | "declining";
  note: string;
}

export interface DigitalTwinZoneIntelligence {
  id: string;
  name: string;
  cx: number;
  cy: number;
  totalReports: number;
  activeReports: number;
  criticalHazards: number;
  roadScannerReports: number;
  resolvedReports: number;
  calculatedRiskScore: number;
  status: string;
  simulatedTelemetry: {
    aqi: number;
    trafficSpeed: string;
    lightsActive: string;
  };
}

// --- ROAD RISK INTELLIGENCE LAYER TYPES ---

export type CorroborationState = 
  | "MULTI-SOURCE CORROBORATED" 
  | "AI OBSERVED" 
  | "CITIZEN REPORTED" 
  | "PERSISTENT OBSERVATION" 
  | "EMERGING / LOW EVIDENCE"
  | "STALE HAZARD RECORD"
  | "REMEDIATED ZONE";

export type CorridorRiskLevel = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export interface RiskContributingFactors {
  severityScore: number;         // 0 - 30 max (based strictly on active reports)
  activeIncidentsScore: number;  // 0 - 25 max (unresolved density)
  recencyScore: number;          // 0 - 15 max (recency of active hazard)
  corroborationScore: number;    // 0 - 15 max (independent verification bonus)
  persistenceScore: number;      // 0 - 15 max (repeated physical observations)
}

export interface IncidentAuditRecord {
  id: string;
  title: string;
  source: ReportSource;
  reporterEmail: string;
  severity: number;
  status: ReportStatus;
  createdAt: string;
  location: string;
  latitude: number;
  longitude: number;
}

export interface RoadRiskZone {
  id: string;
  corridorName: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  reports: Report[];
  contributingIncidentIds: string[];
  auditRecords: IncidentAuditRecord[];
  totalReportsCount: number;
  activeReportsCount: number;
  unresolvedCount: number;
  resolvedCount: number;
  roadScannerCount: number;
  citizenReportCount: number;
  totalObservationsCount: number;
  dominantCategory: ReportCategory;
  categoryCounts: Record<string, number>;
  severityDistribution: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    average: number;
  };
  corroborationState: CorroborationState;
  persistenceState: string;
  firstSeenTimestamp: string;
  lastSeenTimestamp: string;
  riskScore: number; // 0 - 100 deterministic
  riskLevel: CorridorRiskLevel;
  factors: RiskContributingFactors;
  evidenceConfidence: "High" | "Medium" | "Low";
  recommendedAction: {
    priority: "Immediate" | "Urgent" | "Standard" | "Routine";
    actionTitle: string;
    actionDescription: string;
    targetAuthority: string;
    suggestedTargetHours?: number;
    policyType: "PROTOTYPE_POLICY_RULE";
    policyDisclaimer: string;
  };
  reasonsList: string[];
}

// Backward-compatible alias
export type RoadRiskSegment = RoadRiskZone;



