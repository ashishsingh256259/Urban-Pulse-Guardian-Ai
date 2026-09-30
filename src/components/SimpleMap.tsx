import React, { useState, useEffect, useRef } from "react";
import L from "../utils/initLeaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { Report, MapReportPoint } from "../types";
import { getValidMapPoints, getHeatmapPoints } from "../utils/geoAnalytics";
import { createOsmTileLayer, DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from "../utils/mapConfig";
import { 
  Sparkles, X, AlertTriangle, ShieldCheck, Layers, Filter, 
  Flame, MapPin, Camera, FileText, CheckCircle, Clock, Eye, AlertCircle,
  Navigation, Loader2, Info
} from "lucide-react";

interface SimpleMapProps {
  reports: Report[];
  selectedReport: Report | null;
  onSelectReport: (report: Report | null) => void;
  centerLatitude?: number;
  centerLongitude?: number;
  initialViewMode?: "markers" | "heatmap" | "both";
}

export default function SimpleMap({
  reports,
  selectedReport,
  onSelectReport,
  centerLatitude = 0,
  centerLongitude = 0,
  initialViewMode = "both"
}: SimpleMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ [key: string]: L.Marker }>({});
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
  const heatCirclesRef = useRef<L.Circle[]>([]);
  const userLocationMarkerRef = useRef<L.Marker | null>(null);

  // Filter & Display States
  const [viewMode, setViewMode] = useState<"markers" | "heatmap" | "both">(initialViewMode);
  const [clusteringEnabled, setClusteringEnabled] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<string>("All");
  const [statusFilter, setStatusFilter] = useState<string>("All");

  // Geolocation state
  const [isLocating, setIsLocating] = useState(false);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);

  // Normalized valid points
  const validMapPoints = getValidMapPoints(reports, {
    sourceFilter,
    statusFilter
  });

  const heatmapPoints = getHeatmapPoints(reports, {
    sourceFilter,
    statusFilter
  });

  // Determine fallback center: prefer props, then first valid report, then DEFAULT_MAP_CENTER
  const initialCenter: [number, number] =
    centerLatitude && centerLongitude && centerLatitude !== 0 && centerLongitude !== 0
      ? [centerLatitude, centerLongitude]
      : validMapPoints.length > 0 && validMapPoints[0].latitude && validMapPoints[0].longitude
      ? [validMapPoints[0].latitude, validMapPoints[0].longitude]
      : DEFAULT_MAP_CENTER;

  // Initialize Map with OpenStreetMap canonical tile layer
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: DEFAULT_MAP_ZOOM,
      zoomControl: false,
      attributionControl: true
    });

    // Official OpenStreetMap tile layer with compliant attribution & error handling
    const osmLayer = createOsmTileLayer();
    osmLayer.addTo(map);

    L.control.zoom({
      position: "bottomright"
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      if (clusterGroupRef.current) {
        clusterGroupRef.current.clearLayers();
        clusterGroupRef.current = null;
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Responsive container resize observer to prevent grey/blank tiles
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    });

    resizeObserver.observe(container);

    const timer = setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    }, 200);

    return () => {
      resizeObserver.disconnect();
      clearTimeout(timer);
    };
  }, []);

  // Handle "My Location" geolocation request
  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      setLocationNotice("Geolocation is not supported by your browser.");
      setTimeout(() => setLocationNotice(null), 4000);
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const { latitude, longitude } = pos.coords;
        const map = mapInstanceRef.current;
        if (!map) return;

        map.flyTo([latitude, longitude], 15, { animate: true, duration: 1.2 });

        if (userLocationMarkerRef.current) {
          userLocationMarkerRef.current.remove();
        }

        const userLocIcon = L.divIcon({
          className: "user-loc-marker",
          html: `
            <div class="relative flex items-center justify-center">
              <div class="w-8 h-8 rounded-full bg-blue-500/30 animate-ping absolute"></div>
              <div class="w-4 h-4 rounded-full bg-blue-600 border-2 border-white shadow-lg"></div>
            </div>
          `,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });

        const marker = L.marker([latitude, longitude], { icon: userLocIcon }).addTo(map);
        marker.bindPopup(`
          <div class="p-1 text-center font-sans">
            <div class="text-[11px] font-bold text-slate-800">Your Current Location</div>
            <div class="text-[9.5px] font-mono text-slate-500 mt-0.5">${latitude.toFixed(4)}, ${longitude.toFixed(4)}</div>
          </div>
        `).openPopup();

        userLocationMarkerRef.current = marker;
      },
      (err) => {
        setIsLocating(false);
        let message = "Could not obtain device location.";
        if (err.code === err.PERMISSION_DENIED) {
          message = "Location permission denied in browser.";
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          message = "Location information is unavailable.";
        } else if (err.code === err.TIMEOUT) {
          message = "Location request timed out.";
        }
        setLocationNotice(message);
        setTimeout(() => setLocationNotice(null), 4000);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  // Sync center coordinates or fly to selectedReport with cluster support
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (selectedReport && typeof selectedReport.latitude === "number" && typeof selectedReport.longitude === "number") {
      map.flyTo([selectedReport.latitude, selectedReport.longitude], 15, {
        animate: true,
        duration: 0.9
      });

      const marker = markersRef.current[selectedReport.id];
      if (marker) {
        if (clusterGroupRef.current && clusteringEnabled) {
          // If marker is in a cluster, uncluster and zoom to show it
          clusterGroupRef.current.zoomToShowLayer(marker, () => {
            marker.openPopup();
          });
        } else {
          marker.openPopup();
        }
      }
    }
  }, [selectedReport, clusteringEnabled]);

  // Sync Layers (MarkerClusterGroup & Heatmap Circles)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear old standalone markers if any
    Object.keys(markersRef.current).forEach(key => {
      markersRef.current[key].remove();
    });
    markersRef.current = {};

    // Clear old cluster group from map
    if (clusterGroupRef.current) {
      clusterGroupRef.current.clearLayers();
      map.removeLayer(clusterGroupRef.current);
      clusterGroupRef.current = null;
    }

    // Clear old heatmap circles
    heatCirclesRef.current.forEach(circle => circle.remove());
    heatCirclesRef.current = [];

    // Render Heatmap Layer if enabled
    if (viewMode === "heatmap" || viewMode === "both") {
      heatmapPoints.forEach(hp => {
        // Color gradient based on real severity
        const isCritical = hp.severity >= 75;
        const isMedium = hp.severity >= 45 && hp.severity < 75;
        const fillColor = isCritical ? "#ef4444" : isMedium ? "#f59e0b" : "#10b981";
        const strokeColor = isCritical ? "#dc2626" : isMedium ? "#d97706" : "#059669";
        const radius = Math.max(300, Math.min(1200, hp.weight * 1000));

        // Outer soft glow circle
        const outerCircle = L.circle([hp.latitude, hp.longitude], {
          radius: radius * 1.5,
          color: strokeColor,
          fillColor: fillColor,
          fillOpacity: 0.12,
          weight: 0.5,
          interactive: false
        }).addTo(map);

        // Core intensity heat circle
        const innerCircle = L.circle([hp.latitude, hp.longitude], {
          radius: radius,
          color: strokeColor,
          fillColor: fillColor,
          fillOpacity: 0.35 * hp.weight + 0.15,
          weight: 1.2
        }).addTo(map);

        innerCircle.bindTooltip(`
          <div class="font-sans text-[11px] p-1 text-left">
            <div class="font-bold text-slate-850">${hp.title}</div>
            <div class="text-[9.5px] text-slate-500 font-mono mt-0.5">
              Severity: <strong>${hp.severity}%</strong> • Source: <strong>${hp.source === "ROAD_SCANNER" ? "AI Scanner" : "Citizen"}</strong>
            </div>
            <div class="text-[9px] text-blue-600 font-bold mt-1">Click marker for triage details</div>
          </div>
        `, { direction: "top", offset: [0, -10] });

        heatCirclesRef.current.push(outerCircle, innerCircle);
      });
    }

    // Render Markers Layer with Leaflet.markercluster if enabled
    if (viewMode === "markers" || viewMode === "both") {
      // Create cluster group if clustering is enabled
      const clusterGroup = clusteringEnabled
        ? (L as any).markerClusterGroup({
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            spiderfyOnMaxZoom: true,
            removeOutsideVisibleBounds: true,
            maxClusterRadius: 45,
            iconCreateFunction: (cluster: any) => {
              const count = cluster.getChildCount();
              const children = cluster.getAllChildMarkers();
              
              let maxSeverity = 0;
              let hasRoadScan = false;
              children.forEach((childMarker: any) => {
                const sev = childMarker.options?.severity ?? 0;
                if (sev > maxSeverity) maxSeverity = sev;
                if (childMarker.options?.isRoadScan) hasRoadScan = true;
              });

              const isCritical = maxSeverity >= 75;
              const isMedium = maxSeverity >= 45 && maxSeverity < 75;
              const primaryColor = isCritical ? "#dc2626" : isMedium ? "#ea580c" : "#2563EB";
              const pingClass = isCritical ? "animate-ping" : "";

              return L.divIcon({
                html: `
                  <div class="relative flex items-center justify-center w-11 h-11 -translate-x-1.5 -translate-y-1.5 cursor-pointer group" title="${count} clustered incidents (Max severity: ${maxSeverity}%)">
                    <div class="absolute inset-0 rounded-full ${pingClass} opacity-30" style="background-color: ${primaryColor};"></div>
                    <div class="w-10 h-10 rounded-full border-2 bg-white dark:bg-slate-900/95 dark:bg-slate-900/95 shadow-md flex flex-col items-center justify-center font-mono transition-transform group-hover:scale-110" style="border-color: ${primaryColor};">
                      <div class="text-[12px] font-black leading-none" style="color: ${primaryColor};">${count}</div>
                      <div class="text-[7.5px] uppercase font-sans font-extrabold tracking-tighter text-slate-500 leading-none mt-0.5">
                        ${hasRoadScan ? "📷 scan" : "incidents"}
                      </div>
                    </div>
                    <div class="absolute -top-1 -right-1 px-1 py-0.2 bg-slate-900 text-white font-mono text-[7px] font-extrabold rounded-full shadow-xs">
                      ${maxSeverity}%
                    </div>
                  </div>
                `,
                className: "custom-cluster-marker",
                iconSize: [36, 36],
                iconAnchor: [18, 18]
              });
            }
          })
        : null;

      validMapPoints.forEach(point => {
        const isRoadScan = point.source === "ROAD_SCANNER";
        const isSOS = Boolean(point.isSOS || (point.title && point.title.toLowerCase().includes("sos")));
        const isCritical = point.severity >= 75 || isSOS;
        const isMedium = point.severity >= 45 && point.severity < 75;

        // Visual Marker Pin styling: 🚨 Emergency SOS, 🔴 High severity, 🟠 Medium, 🟡 Low
        const primaryColor = isSOS ? "#b91c1c" : isCritical ? "#dc2626" : isMedium ? "#ea580c" : "#eab308";
        const pingClass = isSOS ? "animate-ping" : isCritical ? "animate-ping" : isMedium ? "animate-pulse" : "";
        const badgeIcon = isSOS ? "🚨" : isRoadScan ? "📷" : "📝";

        const customIcon = L.divIcon({
          className: "custom-div-icon-container",
          html: `
            <div class="relative flex items-center justify-center w-11 h-11 -translate-x-1.5 -translate-y-1.5 group cursor-pointer" title="${point.title}">
              <div class="absolute w-8 h-8 rounded-full border-2 ${pingClass} ${isSOS ? "bg-red-600/30" : "opacity-40"}" style="border-color: ${primaryColor};"></div>
              <div class="w-7 h-7 rounded-full border-2 border-white shadow-lg flex items-center justify-center text-[12px] font-bold text-white transition-transform group-hover:scale-125" style="background-color: ${primaryColor};">
                <span>${badgeIcon}</span>
              </div>
              <div class="absolute -top-1 -right-1 px-1.5 bg-slate-900 text-white font-mono text-[7px] font-black rounded-full shadow-xs ${isSOS ? "border border-red-500 text-red-400" : ""}">
                ${isSOS ? "SOS" : `${point.severity}%`}
              </div>
            </div>
          `,
          iconSize: [36, 36],
          iconAnchor: [18, 18]
        });

        const marker = L.marker([point.latitude, point.longitude], { 
          icon: customIcon,
          severity: point.severity,
          isRoadScan,
          isSOS
        } as any);

        // Rich Interactive Popup UI matching requirements
        const sourceBadge = isSOS
          ? `<span class="bg-red-100 text-red-800 text-[9px] font-extrabold px-1.5 py-0.5 rounded border border-red-300 animate-pulse">🚨 LIVE SOS ALERT</span>`
          : isRoadScan
          ? `<span class="bg-purple-100 text-purple-800 text-[9px] font-bold px-1.5 py-0.5 rounded border border-purple-200">📷 ${point.sourceCamera || "Vehicle Dashcam"}</span>`
          : `<span class="bg-blue-100 text-blue-800 text-[9px] font-bold px-1.5 py-0.5 rounded border border-blue-200">📝 Citizen Report</span>`;

        const statusBadge = point.status === "Resolved"
          ? `<span class="bg-emerald-100 text-emerald-800 text-[9px] font-bold px-1.5 py-0.5 rounded border border-emerald-200">${point.status}</span>`
          : point.status === "In Progress"
            ? `<span class="bg-amber-100 text-amber-800 text-[9px] font-bold px-1.5 py-0.5 rounded border border-amber-200">${point.status}</span>`
            : `<span class="bg-red-100 text-red-800 text-[9px] font-bold px-1.5 py-0.5 rounded border border-red-200">${point.status}</span>`;

        const detectedTime = point.createdAt
          ? new Date(point.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : "Recently";

        const popupContent = `
          <div class="p-2 max-w-[280px] font-sans text-left">
            <div class="flex items-center justify-between gap-1.5 mb-1.5 pb-1 border-b border-slate-100">
              <span class="text-[9px] font-mono font-bold text-slate-500 uppercase tracking-wider">ID: ${point.id.slice(0, 10)}</span>
              <span class="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded ${
                isSOS ? 'bg-red-600 text-white font-black' : isCritical ? 'bg-red-100 text-red-700' : isMedium ? 'bg-orange-100 text-orange-700' : 'bg-yellow-100 text-yellow-800'
              }">${isSOS ? 'CRITICAL SOS' : `${point.severity}% Severity`}</span>
            </div>
            
            <div class="flex items-center gap-1.5 mb-1.5 flex-wrap">
              ${sourceBadge}
              ${statusBadge}
              ${point.confidence ? `<span class="bg-emerald-50 text-emerald-700 text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border border-emerald-200">${point.confidence}% Conf</span>` : ''}
              ${point.gpsAccuracy ? `<span class="bg-slate-100 text-slate-700 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded">±${Math.round(point.gpsAccuracy)}m GPS</span>` : ''}
            </div>

            ${point.image ? `
              <div class="w-full h-24 rounded-lg overflow-hidden my-1.5 border border-slate-200 bg-slate-900">
                <img src="${point.image}" alt="${point.title}" class="w-full h-full object-cover" />
              </div>
            ` : ''}

            <h4 class="font-bold text-xs text-slate-900 line-clamp-2 mt-1 leading-snug">${point.title}</h4>
            
            <div class="mt-2 pt-1.5 border-t border-slate-100 space-y-0.5 text-[9.5px] text-slate-500">
              <div class="flex justify-between">
                <span>Location:</span>
                <span class="text-slate-700 font-semibold truncate max-w-[150px]">${point.location}</span>
              </div>
              <div class="flex justify-between font-mono">
                <span>Exact GPS:</span>
                <span class="text-slate-900 font-bold">${point.latitude.toFixed(6)}°, ${point.longitude.toFixed(6)}°</span>
              </div>
              <div class="flex justify-between">
                <span>Reporter:</span>
                <span class="text-slate-700 font-mono truncate max-w-[140px]">${point.reporterEmail || "Citizen"}</span>
              </div>
              <div class="flex justify-between">
                <span>Time:</span>
                <span class="text-slate-700 font-mono">${detectedTime}</span>
              </div>
            </div>

            <div class="mt-2 pt-1 text-right">
              <span class="text-blue-600 font-bold text-[9.5px] hover:underline cursor-pointer">Inspect Incident Details ↗</span>
            </div>
          </div>
        `;

        marker.bindPopup(popupContent, {
          className: "custom-leaflet-popup",
          closeButton: true,
          offset: [0, -4]
        });

        marker.on("click", () => {
          const original = reports.find(r => r.id === point.id) || null;
          onSelectReport(original);
        });

        markersRef.current[point.id] = marker;

        if (clusterGroup) {
          clusterGroup.addLayer(marker);
        } else {
          marker.addTo(map);
        }
      });

      if (clusterGroup) {
        map.addLayer(clusterGroup);
        clusterGroupRef.current = clusterGroup;
      }
    }

  }, [validMapPoints, heatmapPoints, viewMode, clusteringEnabled, reports, onSelectReport]);

  return (
    <div className="relative w-full h-full min-h-[380px] border border-gray-200 shadow-inner rounded-xl overflow-hidden bg-slate-100 flex flex-col">
      
      {/* Dynamic Map Container */}
      <div id="leaflet-urban-pulse-map" ref={mapContainerRef} className="w-full flex-1" style={{ minHeight: "380px" }} />

      {/* TOP CONTROL BAR: Mode Toggles, Clustering & Source Filters */}
      <div className="absolute top-3 left-3 z-[1000] flex flex-wrap items-center gap-2 max-w-[calc(100%-24px)]">
        
        {/* Layer Mode Toggle (Markers / Heatmap / Both) */}
        <div className="bg-white dark:bg-slate-900/95 dark:bg-slate-900/95 backdrop-blur-md px-2 py-1.5 rounded-lg border border-slate-200 shadow-md flex items-center gap-1 text-[11px] font-bold text-slate-700">
          <Layers className="w-3.5 h-3.5 text-blue-600 mr-1" />
          <button
            onClick={() => setViewMode("both")}
            className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
              viewMode === "both" ? "bg-zinc-50 text-zinc-800 border border-zinc-200 dark:bg-slate-800 dark:text-white dark:border-slate-700 shadow-3xs" : "hover:bg-slate-100 text-slate-600"
            }`}
          >
            Combined
          </button>
          <button
            onClick={() => setViewMode("markers")}
            className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
              viewMode === "markers" ? "bg-zinc-50 text-zinc-800 border border-zinc-200 dark:bg-slate-800 dark:text-white dark:border-slate-700 shadow-3xs" : "hover:bg-slate-100 text-slate-600"
            }`}
          >
            Markers ({validMapPoints.length})
          </button>
          <button
            onClick={() => setViewMode("heatmap")}
            className={`px-2 py-0.5 rounded transition-all cursor-pointer flex items-center gap-1 ${
              viewMode === "heatmap" ? "bg-amber-600 text-white shadow-3xs" : "hover:bg-slate-100 text-slate-600"
            }`}
          >
            <Flame className="w-3 h-3 text-amber-300" />
            Heatmap
          </button>
        </div>

        {/* Marker Clustering Toggle */}
        {(viewMode === "markers" || viewMode === "both") && (
          <button
            onClick={() => setClusteringEnabled(prev => !prev)}
            className={`bg-white dark:bg-slate-900/95 dark:bg-slate-900/95 backdrop-blur-md px-2.5 py-1.5 rounded-lg border shadow-md flex items-center gap-1.5 text-[11px] font-bold transition-all cursor-pointer ${
              clusteringEnabled
                ? "border-blue-300 text-blue-700 bg-blue-50/80"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
            title="Toggle Leaflet.markercluster grouping"
          >
            <Layers className={`w-3.5 h-3.5 ${clusteringEnabled ? "text-blue-600" : "text-slate-400"}`} />
            <span>Clusters:</span>
            <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-extrabold ${clusteringEnabled ? "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 border-none shadow-md dark:text-white dark:border-slate-700" : "bg-slate-200 text-slate-600"}`}>
              {clusteringEnabled ? "ON" : "OFF"}
            </span>
          </button>
        )}

        {/* Source Filter Dropdown */}
        <div className="bg-white dark:bg-slate-900/95 dark:bg-slate-900/95 backdrop-blur-md px-2 py-1 rounded-lg border border-slate-200 shadow-md flex items-center gap-1.5">
          <Filter className="w-3 h-3 text-slate-400" />
          <select
            id="map-source-filter"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="bg-transparent text-[10.5px] font-bold text-slate-700 focus:outline-hidden cursor-pointer"
          >
            <option value="All">All Sources</option>
            <option value="ROAD_SCANNER">AI Road Scanner (📷)</option>
            <option value="MANUAL_REPORT">Citizen Manual (📝)</option>
          </select>
        </div>

        {/* Municipal threat-state dropdown: filters both incident markers and
            heat zones from the same live Firestore report stream. */}
        <div className="bg-white dark:bg-slate-900/95 dark:bg-slate-900/95 backdrop-blur-md px-2 py-1 rounded-lg border border-slate-200 shadow-md flex items-center gap-1.5 w-full sm:w-auto">
          <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
          <select
            id="map-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter map by threat status"
            className="bg-transparent text-[10.5px] font-bold text-slate-700 focus:outline-hidden cursor-pointer min-w-0 flex-1 sm:flex-none"
          >
            <option value="All">All Threats</option>
            <option value="Active">Active Threats</option>
            <option value="Pending">Pending Threats</option>
            <option value="In Progress">In-Progress Threats</option>
            <option value="Resolved">Resolved Threats</option>
          </select>
        </div>

        {/* My Location Geolocation Button */}
        <button
          onClick={handleLocateMe}
          disabled={isLocating}
          className="bg-white/95 backdrop-blur-md px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-md flex items-center gap-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 transition-all cursor-pointer"
          title="Locate my current position via GPS"
        >
          {isLocating ? (
            <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" />
          ) : (
            <Navigation className="w-3.5 h-3.5 text-blue-600" />
          )}
          <span>{isLocating ? "Locating..." : "My Location"}</span>
        </button>

      </div>

      {/* Geolocation Notification Toast */}
      {locationNotice && (
        <div className="absolute top-16 left-3 z-[1001] bg-slate-900/95 text-white text-[11px] font-medium px-3 py-1.5 rounded-lg shadow-lg border border-slate-700 flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-150">
          <Info className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>{locationNotice}</span>
          <button onClick={() => setLocationNotice(null)} className="ml-1 text-slate-400 hover:text-white cursor-pointer">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* TOP RIGHT: Active Telemetry Badge with OpenStreetMap Attribution Indicator */}
      <div className="absolute top-3 right-3 z-[1000] hidden sm:flex items-center gap-2 bg-slate-900/90 backdrop-blur-md text-white px-3 py-1.5 rounded-lg shadow-md border border-slate-800 text-[10.5px] font-mono">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        <span className="text-emerald-400 font-bold">OpenStreetMap</span>
        <span className="text-slate-500">|</span>
        <span>Delhi NCR Core</span>
        <span className="text-slate-500">|</span>
        <span className="text-blue-300 font-bold">{validMapPoints.length} Points</span>
        {clusteringEnabled && (viewMode === "markers" || viewMode === "both") && (
          <>
            <span className="text-slate-500">|</span>
            <span className="text-emerald-300 font-bold">Clustering Active</span>
          </>
        )}
      </div>

      {/* EMPTY STATE OVERLAY (When 0 valid GPS points match) */}
      {validMapPoints.length === 0 && (
        <div className="absolute inset-0 z-[900] bg-slate-50/80 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center">
          <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 mb-3 shadow-xs">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-bold text-slate-800 font-display">No Reports with Valid Locations</h4>
          <p className="text-xs text-slate-500 max-w-sm mt-1 leading-normal">
            No geographic data available matching current filters. New reports filed with Delhi NCR coordinates or scanned via AI Road Scanner will plot live.
          </p>
          {(sourceFilter !== "All" || statusFilter !== "All") && (
            <button
              onClick={() => {
                setSourceFilter("All");
                setStatusFilter("All");
              }}
              className="mt-3 px-3 py-1 bg-zinc-50 text-zinc-800 border border-zinc-200 dark:bg-slate-800 dark:text-white dark:border-slate-700 text-[11px] font-bold rounded-lg shadow-xs hover:bg-blue-700 transition-colors cursor-pointer"
            >
              Reset Map Filters
            </button>
          )}
        </div>
      )}

      {/* BOTTOM RIGHT: SELECTED REPORT INSPECTION PANEL */}
      {selectedReport && (
        <div className="absolute bottom-3 right-3 left-3 sm:left-auto sm:max-w-[360px] bg-white dark:bg-slate-900/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 rounded-xl p-4 shadow-xl z-[1000] animate-in fade-in slide-in-from-bottom-3 duration-200 text-left">
          
          <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2.5">
            <div className="flex items-center gap-1.5 text-blue-600">
              <Sparkles className="w-4 h-4 animate-pulse text-blue-500" />
              <span className="text-[10px] font-mono font-extrabold uppercase tracking-wide">GIS Incident Inspector</span>
            </div>
            <button
              onClick={() => onSelectReport(null)}
              className="p-1 hover:bg-slate-100 rounded-md text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2 text-left">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-gray-450 font-bold uppercase tracking-wider">Location / Ward</span>
                <span className="text-[9px] font-mono font-bold text-slate-400">{selectedReport.latitude?.toFixed(4)}, {selectedReport.longitude?.toFixed(4)}</span>
              </div>
              <span className="text-xs font-bold text-slate-800 line-clamp-1 mt-0.5">{selectedReport.location}</span>
            </div>

            {/* Urban Risk Score Indicator */}
            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200">
              <div>
                <span className="text-[10px] font-bold text-slate-600 block">Urban Risk Score</span>
                <span className="text-[8.5px] text-slate-400">Deterministic Hazard Index</span>
              </div>
              <div className="flex items-center gap-1">
                <span className={`text-base font-extrabold font-mono ${
                  selectedReport.severity >= 75 ? "text-red-600 animate-pulse" : selectedReport.severity >= 45 ? "text-amber-600" : "text-emerald-600"
                }`}>
                  {selectedReport.severity}/100
                </span>
                <span className={`text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded ${
                  selectedReport.severity >= 75 ? "bg-red-100 text-red-700" : selectedReport.severity >= 45 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                }`}>
                  {selectedReport.severity >= 75 ? "Critical" : selectedReport.severity >= 45 ? "Medium" : "Low"}
                </span>
              </div>
            </div>

            {/* Active Incident details */}
            <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
              <div className="flex items-start gap-2">
                {selectedReport.severity >= 75 ? (
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                )}
                <div>
                  <h5 className="text-[11.5px] font-bold text-slate-800 line-clamp-1">{selectedReport.title}</h5>
                  <p className="text-[10px] text-slate-500 line-clamp-2 mt-0.5">{selectedReport.description || "Active municipal hazard."}</p>
                </div>
              </div>

              <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-200/60 text-[9.5px]">
                <span className="font-semibold text-slate-600">{selectedReport.category}</span>
                <span className="font-bold text-blue-600">Status: {selectedReport.status}</span>
              </div>
            </div>

            {/* AI Safety Insight */}
            {selectedReport.aiAnalysis?.description && (
              <div className="pt-1.5 border-t border-slate-100">
                <span className="text-[8.5px] text-blue-600 font-extrabold uppercase block tracking-wider">AI Safety Extrapolation</span>
                <p className="text-[10px] text-slate-600 italic mt-0.5 leading-normal">
                  "{selectedReport.aiAnalysis.description}"
                </p>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => onSelectReport(selectedReport)}
                className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-[10.5px] shadow-3xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Open Full Triage View</span>
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

