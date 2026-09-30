import { 
  Report, 
  MapReportPoint, 
  HeatmapPoint, 
  ReportTrend, 
  IssueDistribution, 
  SeverityDistribution, 
  StatusDistribution, 
  WardRanking,
  DigitalTwinZoneIntelligence,
  ReportCategory,
  ReportStatus,
  ReportSource
} from "../types";

/**
 * Validates whether GPS coordinates are mathematically and geographically valid.
 * - Latitude must be a finite number between -90 and 90.
 * - Longitude must be a finite number between -180 and 180.
 * - Rejects non-numeric, NaN, null, and empty coordinates.
 */
export function validateCoordinates(latitude: any, longitude: any): boolean {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
    return false;
  }
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (isNaN(lat) || isNaN(lng) || !isFinite(lat) || !isFinite(lng)) {
    return false;
  }

  // Check valid geographic bounds
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return false;
  }

  // Check against uninitialized placeholder (0, 0)
  if (lat === 0 && lng === 0) {
    return false;
  }

  return true;
}

/**
 * Normalizes a canonical Firestore report into a clean MapReportPoint.
 * Returns null if the report lacks valid GPS coordinates.
 */
export function normalizeMapReport(report: Report): MapReportPoint | null {
  if (!report) return null;
  if (!validateCoordinates(report.latitude, report.longitude)) {
    return null;
  }

  const severity = typeof report.severity === "number" && !isNaN(report.severity) 
    ? Math.max(0, Math.min(100, report.severity)) 
    : 50;

  const riskLevel = report.riskLevel || (severity >= 75 ? "High" : severity >= 45 ? "Medium" : "Low");
  const priority = report.priority || (severity >= 75 ? "High" : severity >= 45 ? "Medium" : "Low");
  const source: ReportSource = report.source === "ROAD_SCANNER" ? "ROAD_SCANNER" : "MANUAL_REPORT";
  const status: ReportStatus = report.status || "Pending";

  return {
    id: report.id,
    title: report.title || "Hazard Report",
    category: (report.category || report.issueType || "Pothole") as ReportCategory,
    issueType: report.issueType || report.category || "Pothole",
    severity,
    riskLevel,
    priority,
    status,
    source,
    location: report.location || "Delhi NCR Grid",
    latitude: Number(report.latitude),
    longitude: Number(report.longitude),
    clusterCount: report.clusterCount ?? (source === "ROAD_SCANNER" ? 1 : undefined),
    createdAt: report.createdAt || new Date().toISOString(),
    image: report.image || report.evidenceUrl || null,
    description: report.description || "",
    confidence: report.confidence,
    estimatedWidth: report.estimatedWidth,
    estimatedLength: report.estimatedLength,
    estimatedArea: report.estimatedArea,
    sourceCamera: report.sourceCamera,
    observationsCount: report.observationsCount,
    isSOS: report.isSOS,
    sosType: report.sosType,
    gpsAccuracy: report.gpsAccuracy,
    reporterEmail: report.reporterEmail
  };
}

/**
 * Filters and extracts all valid MapReportPoints from a list of Firestore reports.
 */
export function getValidMapPoints(
  reports: Report[],
  options?: {
    sourceFilter?: string;
    statusFilter?: string;
    riskLevelFilter?: string;
    categoryFilter?: string;
    searchQuery?: string;
  }
): MapReportPoint[] {
  if (!Array.isArray(reports)) return [];

  const sourceFilter = options?.sourceFilter || "All";
  const statusFilter = options?.statusFilter || "All";
  const riskLevelFilter = options?.riskLevelFilter || "All";
  const categoryFilter = options?.categoryFilter || "All";
  const query = (options?.searchQuery || "").trim().toLowerCase();

  const validPoints: MapReportPoint[] = [];

  for (const report of reports) {
    const point = normalizeMapReport(report);
    if (!point) continue;

    // Source Filter
    if (sourceFilter !== "All") {
      if (sourceFilter === "ROAD_SCANNER" && point.source !== "ROAD_SCANNER") continue;
      if (sourceFilter === "MANUAL_REPORT" && point.source !== "MANUAL_REPORT") continue;
    }

    // Threat-state filter used by the municipal heatmap. "Active" is an
    // operational group, not a stored Firestore status: it includes every
    // unresolved incident the city still needs to act on.
    if (statusFilter === "Active") {
      if (point.status === "Resolved") continue;
    } else if (statusFilter !== "All" && point.status !== statusFilter) {
      continue;
    }

    // Risk Level Filter
    if (riskLevelFilter !== "All" && point.riskLevel !== riskLevelFilter) {
      continue;
    }

    // Category Filter
    if (categoryFilter !== "All" && point.category !== categoryFilter) {
      continue;
    }

    // Search Query
    if (query) {
      const matchTitle = point.title.toLowerCase().includes(query);
      const matchLocation = point.location.toLowerCase().includes(query);
      const matchCategory = point.category.toLowerCase().includes(query);
      const matchId = point.id.toLowerCase().includes(query);
      if (!matchTitle && !matchLocation && !matchCategory && !matchId) {
        continue;
      }
    }

    validPoints.push(point);
  }

  return validPoints;
}

/**
 * Transforms real report data into geographic heatmap points.
 * Weights are calculated proportionally to real severity (0.0 - 1.0) and cluster multipliers.
 */
export function getHeatmapPoints(
  reports: Report[],
  options?: {
    sourceFilter?: string;
    statusFilter?: string;
  }
): HeatmapPoint[] {
  const mapPoints = getValidMapPoints(reports, options);

  return mapPoints.map(point => {
    // Weight calculation: severity / 100 with modest boost for AI Road Scanner multi-frame clusters
    const baseWeight = point.severity / 100;
    const clusterBoost = point.clusterCount && point.clusterCount > 1 
      ? Math.min(0.3, point.clusterCount * 0.05) 
      : 0;
    const weight = Math.max(0.15, Math.min(1.0, baseWeight + clusterBoost));

    return {
      id: point.id,
      latitude: point.latitude,
      longitude: point.longitude,
      weight,
      severity: point.severity,
      title: point.title,
      category: point.category,
      source: point.source
    };
  });
}

/**
 * Computes comprehensive real-time municipal executive analytics from canonical Firestore reports.
 * No Math.random() or fake numbers.
 */
export function computeExecutiveAnalytics(reports: Report[]) {
  const safeReports = Array.isArray(reports) ? reports : [];
  const totalCount = safeReports.length;

  // Status breakdown
  const pendingCount = safeReports.filter(r => r.status === "Pending").length;
  const assignedCount = safeReports.filter(r => r.status === "Assigned").length;
  const inProgressCount = safeReports.filter(r => r.status === "In Progress").length;
  const resolvedCount = safeReports.filter(r => r.status === "Resolved").length;
  const activeCount = totalCount - resolvedCount;

  // Risk / Severity breakdown
  const criticalCount = safeReports.filter(r => r.severity >= 75 && r.status !== "Resolved").length;
  const mediumRiskCount = safeReports.filter(r => r.severity >= 45 && r.severity < 75 && r.status !== "Resolved").length;
  const lowRiskCount = safeReports.filter(r => r.severity < 45 && r.status !== "Resolved").length;

  // Source breakdown (Citizen Manual vs AI Road Scanner)
  const scannerReports = safeReports.filter(r => r.source === "ROAD_SCANNER");
  const manualReports = safeReports.filter(r => r.source !== "ROAD_SCANNER");
  const scannerCount = scannerReports.length;
  const manualCount = manualReports.length;
  const scannerPercentage = totalCount > 0 ? Math.round((scannerCount / totalCount) * 100) : 0;
  const manualPercentage = totalCount > 0 ? 100 - scannerPercentage : 0;

  // Resolution efficiency rate
  const resolutionRate = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0;

  // Issue / Category distribution from actual values
  const categoryMap = new Map<string, { count: number; totalSeverity: number }>();
  for (const rep of safeReports) {
    const cat = rep.category || rep.issueType || "Pothole";
    const cur = categoryMap.get(cat) || { count: 0, totalSeverity: 0 };
    cur.count += 1;
    cur.totalSeverity += Number(rep.severity) || 50;
    categoryMap.set(cat, cur);
  }

  const issueDistribution: IssueDistribution[] = Array.from(categoryMap.entries()).map(([cat, data]) => ({
    category: cat,
    count: data.count,
    percentage: totalCount > 0 ? Math.round((data.count / totalCount) * 100) : 0,
    avgSeverity: data.count > 0 ? Math.round(data.totalSeverity / data.count) : 0
  })).sort((a, b) => b.count - a.count);

  // Severity Distribution List
  const severityDistribution: SeverityDistribution[] = [
    { name: "Critical", count: safeReports.filter(r => r.severity >= 75).length, color: "#dc2626" },
    { name: "High", count: safeReports.filter(r => r.severity >= 60 && r.severity < 75).length, color: "#ea580c" },
    { name: "Medium", count: safeReports.filter(r => r.severity >= 45 && r.severity < 60).length, color: "#d97706" },
    { name: "Low", count: safeReports.filter(r => r.severity < 45).length, color: "#16a34a" }
  ];

  // Status Distribution List
  const statusDistribution: StatusDistribution[] = [
    { status: "Pending", count: pendingCount, percentage: totalCount > 0 ? Math.round((pendingCount / totalCount) * 100) : 0 },
    { status: "Assigned", count: assignedCount, percentage: totalCount > 0 ? Math.round((assignedCount / totalCount) * 100) : 0 },
    { status: "In Progress", count: inProgressCount, percentage: totalCount > 0 ? Math.round((inProgressCount / totalCount) * 100) : 0 },
    { status: "Resolved", count: resolvedCount, percentage: totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0 }
  ];

  // Real chronological time trends derived from actual createdAt timestamps
  const timeTrendsMap = new Map<string, { total: number; manual: number; scanner: number; resolved: number }>();
  
  // Sort reports chronologically
  const sortedReports = [...safeReports].sort((a, b) => {
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  for (const rep of sortedReports) {
    const dateObj = new Date(rep.createdAt);
    // Format month or date bucket
    const monthName = isNaN(dateObj.getTime())
      ? "Recent"
      : dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    
    const cur = timeTrendsMap.get(monthName) || { total: 0, manual: 0, scanner: 0, resolved: 0 };
    cur.total += 1;
    if (rep.source === "ROAD_SCANNER") cur.scanner += 1;
    else cur.manual += 1;
    if (rep.status === "Resolved") cur.resolved += 1;
    timeTrendsMap.set(monthName, cur);
  }

  const timeTrends: ReportTrend[] = Array.from(timeTrendsMap.entries()).map(([period, data]) => ({
    period,
    count: data.total,
    manualCount: data.manual,
    scannerCount: data.scanner,
    resolvedCount: data.resolved
  }));

  // Real Ward / District groupings
  const wardMap = new Map<string, { total: number; active: number; resolved: number; critical: number; severities: number[] }>();
  for (const rep of safeReports) {
    // Extract ward/area prefix from location string (e.g., "Connaught Place, New Delhi" -> "Connaught Place")
    const wardName = rep.location ? rep.location.split(",")[0].trim() : "Sector 45 Core";
    const cur = wardMap.get(wardName) || { total: 0, active: 0, resolved: 0, critical: 0, severities: [] };
    cur.total += 1;
    if (rep.status === "Resolved") cur.resolved += 1;
    else {
      cur.active += 1;
      if (rep.severity >= 75) cur.critical += 1;
    }
    cur.severities.push(Number(rep.severity) || 50);
    wardMap.set(wardName, cur);
  }

  // Calculate real ward score: 100 - (active hazards * 12 + critical * 15) + resolved * 8
  const wardRankings: WardRanking[] = Array.from(wardMap.entries()).map(([name, data]) => {
    let score = 100 - (data.active * 10 + data.critical * 15) + (data.resolved * 6);
    score = Math.max(15, Math.min(98, score));
    const trend: "improving" | "stable" | "declining" = 
      data.resolved > data.active ? "improving" : data.active > 2 ? "declining" : "stable";

    return {
      rank: 0,
      name,
      score,
      scoreLabel: `${score}/100`,
      totalReports: data.total,
      activeHazards: data.active,
      resolvedCount: data.resolved,
      trend,
      note: trend === "improving" ? "↑ Improving" : trend === "declining" ? "↓ Attention" : "→ Stable"
    };
  }).sort((a, b) => b.score - a.score);

  // Assign sequential ranks
  wardRankings.forEach((w, idx) => {
    w.rank = idx + 1;
  });

  const safestWards = wardRankings.slice(0, 3);
  const highestRiskWards = [...wardRankings].reverse().slice(0, 3);

  // Deterministic, explainable City Health / Risk score:
  // Mathematical formula: Starts at 85 base, penalizes active unresolved critical & medium risks, rewards resolution efficiency
  let cityRiskScore = 80;
  if (totalCount > 0) {
    const penalty = (criticalCount * 8) + (mediumRiskCount * 4) + (lowRiskCount * 1.5);
    const reward = (resolvedCount / totalCount) * 20;
    cityRiskScore = Math.max(20, Math.min(95, Math.round(80 - penalty + reward)));
  }

  const riskTrendLabel: string = 
    resolvedCount >= activeCount && activeCount < 3 
      ? "Decreasing Risk" 
      : criticalCount > 2 
        ? "High Hazard Density" 
        : "Moderate Surveillance";

  return {
    totalCount,
    activeCount,
    pendingCount,
    assignedCount,
    inProgressCount,
    resolvedCount,
    criticalCount,
    mediumRiskCount,
    lowRiskCount,
    scannerCount,
    manualCount,
    scannerPercentage,
    manualPercentage,
    resolutionRate,
    issueDistribution,
    severityDistribution,
    statusDistribution,
    timeTrends,
    wardRankings,
    safestWards,
    highestRiskWards,
    cityRiskScore,
    riskTrendLabel
  };
}

/**
 * Aggregates real report data to city zones for the Smart City Digital Twin.
 */
export function computeDigitalTwinZones(reports: Report[]): DigitalTwinZoneIntelligence[] {
  const defaultZones = [
    { id: "cp", name: "Connaught Place (CP)", keyword: "connaught", cx: 180, cy: 120, aqi: 154, trafficSpeed: "22 km/h", lightsActive: "84%" },
    { id: "sec45", name: "Sector 45 Buffer Zone", keyword: "45", cx: 340, cy: 300, aqi: 242, trafficSpeed: "14 km/h", lightsActive: "41%" },
    { id: "cyber", name: "DLF Cyber City Hub", keyword: "cyber", cx: 80, cy: 260, aqi: 82, trafficSpeed: "48 km/h", lightsActive: "96%" },
    { id: "saket", name: "Saket District Gate", keyword: "saket", cx: 220, cy: 240, aqi: 120, trafficSpeed: "34 km/h", lightsActive: "88%" },
    { id: "sec62", name: "Noida Sector 62 Core", keyword: "62", cx: 420, cy: 110, aqi: 168, trafficSpeed: "28 km/h", lightsActive: "78%" },
    { id: "chandni", name: "Chandni Chowk Market", keyword: "chandni", cx: 200, cy: 60, aqi: 310, trafficSpeed: "8 km/h", lightsActive: "62%" },
    { id: "okhla", name: "Okhla Dev Zone", keyword: "okhla", cx: 300, cy: 190, aqi: 190, trafficSpeed: "41 km/h", lightsActive: "75%" }
  ];

  const safeReports = Array.isArray(reports) ? reports : [];

  return defaultZones.map(zone => {
    // Associate reports to this zone by location string or title
    const zoneReports = safeReports.filter(r => {
      const loc = (r.location || "").toLowerCase();
      const title = (r.title || "").toLowerCase();
      const desc = (r.description || "").toLowerCase();
      const kw = zone.keyword.toLowerCase();
      return loc.includes(kw) || title.includes(kw) || desc.includes(kw);
    });

    const totalReports = zoneReports.length;
    const resolvedReports = zoneReports.filter(r => r.status === "Resolved").length;
    const activeReports = totalReports - resolvedReports;
    const criticalHazards = zoneReports.filter(r => r.severity >= 75 && r.status !== "Resolved").length;
    const roadScannerReports = zoneReports.filter(r => r.source === "ROAD_SCANNER").length;

    // Explainable zone risk score:
    let calculatedRiskScore = 35; // default moderate-safe
    if (activeReports > 0) {
      calculatedRiskScore = Math.min(95, Math.max(25, 40 + (criticalHazards * 20) + ((activeReports - criticalHazards) * 8) - (resolvedReports * 4)));
    } else if (resolvedReports > 0) {
      calculatedRiskScore = 18; // optimal
    }

    let status = "Stable Operations";
    if (criticalHazards > 0) {
      status = "Critical Attention";
    } else if (activeReports > 1) {
      status = "Active Triage";
    } else if (activeReports === 0 && totalReports > 0) {
      status = "Regulated / Safe";
    }

    return {
      id: zone.id,
      name: zone.name,
      cx: zone.cx,
      cy: zone.cy,
      totalReports,
      activeReports,
      criticalHazards,
      roadScannerReports,
      resolvedReports,
      calculatedRiskScore,
      status,
      simulatedTelemetry: {
        aqi: zone.aqi,
        trafficSpeed: zone.trafficSpeed,
        lightsActive: zone.lightsActive
      }
    };
  });
}
