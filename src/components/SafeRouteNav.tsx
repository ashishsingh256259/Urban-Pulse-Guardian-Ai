import React, { useState, useEffect, useRef } from "react";
import L from "leaflet";
import { createOsmTileLayer, DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from "../utils/mapConfig";
import { 
  Navigation, ShieldCheck, AlertTriangle, MapPin, 
  Sparkles, Compass, Info, Route, Car, Bike, Footprints, Activity
} from "lucide-react";
import { Report, SafeRouteOption } from "../types";
import { calculateHaversineDistanceMeters } from "../services/spatialClustering";

interface SafeRouteNavProps {
  reports: Report[];
}

function computeRouteRisk(routeCoordinates: [number, number][], reports: Report[]) {
  const PROXIMITY_METERS = 60;
  let totalRisk = 0;
  const hazardsOnRoute: any[] = [];

  reports.forEach(report => {
    if (!report.latitude || !report.longitude) return;
    if (report.status === "Resolved") return; 

    let statusWeight = 1.0; 
    if (report.status === "In Progress" || report.status === "Assigned") {
      statusWeight = 0.5;
    }

    let priorityWeight = 1.0;
    if (report.priority === "Critical") priorityWeight = 2.0;
    else if (report.priority === "High") priorityWeight = 1.5;
    else if (report.priority === "Low") priorityWeight = 0.5;

    let severityWeight = (report.severity || 50) / 100;

    let minDistance = Infinity;
    // Step size 1 for maximum accuracy
    for (let i = 0; i < routeCoordinates.length; i++) {
      const coord = routeCoordinates[i];
      const dist = calculateHaversineDistanceMeters(report.latitude, report.longitude, coord[0], coord[1]);
      if (dist < minDistance) {
        minDistance = dist;
      }
    }

    if (minDistance <= PROXIMITY_METERS) {
      const risk = statusWeight * priorityWeight * severityWeight;
      totalRisk += risk;
      hazardsOnRoute.push({
        type: report.category,
        severity: report.severity,
        lat: report.latitude,
        lng: report.longitude,
        description: report.description || "Reported hazard",
        source: report.source || "MANUAL_REPORT",
        status: report.status,
        priority: report.priority || "Medium"
      });
    }
  });

  return { totalRisk, hazardsOnRoute };
}

export default function SafeRouteNav({ reports }: SafeRouteNavProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.Polyline[]>([]);
  const originMarkerRef = useRef<L.Marker | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);
  const hazardMarkersRef = useRef<L.Marker[]>([]);

  const [originStr, setOriginStr] = useState("");
  const [destinationStr, setDestinationStr] = useState("");
  
  const [originCoord, setOriginCoord] = useState<[number, number] | null>(null);
  const [destCoord, setDestCoord] = useState<[number, number] | null>(null);

  const [travelMode, setTravelMode] = useState<"driving" | "cycling" | "foot">("driving");
  const [calculating, setCalculating] = useState(false);
  
  const [computedRoutes, setComputedRoutes] = useState<SafeRouteOption[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string>("");
  
  const [statusMsg, setStatusMsg] = useState("IDLE");

  // Initialize Map with OpenStreetMap canonical tile layer
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: DEFAULT_MAP_CENTER,
      zoom: DEFAULT_MAP_ZOOM,
      zoomControl: false,
      attributionControl: true
    });

    const osmLayer = createOsmTileLayer();
    osmLayer.addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);
    mapInstanceRef.current = map;

    // Invalidate map size on layout/panel changes
    setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  const clearMapRoutes = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    routeLayerRef.current.forEach(layer => map.removeLayer(layer));
    routeLayerRef.current = [];
  };

  const clearHazardMarkers = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    hazardMarkersRef.current.forEach(marker => map.removeLayer(marker));
    hazardMarkersRef.current = [];
  };

  const drawRoutesAndHazards = (routes: SafeRouteOption[], selectedId: string) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    
    clearMapRoutes();
    clearHazardMarkers();

    const unselected = routes.filter(r => r.id !== selectedId);
    const selected = routes.find(r => r.id === selectedId);

    const allDraw = [...unselected, selected].filter(Boolean) as SafeRouteOption[];

    allDraw.forEach(rt => {
      const isSelected = rt.id === selectedId;
      const polyline = L.polyline(rt.pathCoordinates, {
        color: isSelected ? (rt.id.includes("safe") ? "#10B981" : "#3B82F6") : "#94A3B8",
        weight: isSelected ? 6 : 4,
        opacity: isSelected ? 0.9 : 0.6,
        dashArray: isSelected ? undefined : "5, 10"
      }).addTo(map);
      routeLayerRef.current.push(polyline);
    });

    if (selected) {
      map.fitBounds(L.polyline(selected.pathCoordinates).getBounds(), { padding: [50, 50] });

      // Draw hazards for selected route
      selected.hazardsOnRoute.forEach((hz: any) => {
        const color = hz.severity >= 75 ? "#EF4444" : hz.severity >= 45 ? "#F59E0B" : "#3B82F6";
        const iconHtml = `<div style="background-color: ${color}; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`;
        
        const marker = L.marker([hz.lat, hz.lng], {
          icon: L.divIcon({
            className: "custom-div-icon",
            html: iconHtml,
            iconSize: [14, 14],
            iconAnchor: [7, 7]
          })
        }).bindPopup(`
          <div style="font-family: monospace; font-size: 11px;">
            <strong>${hz.type}</strong><br/>
            Sev: ${hz.severity} | Pri: ${hz.priority}<br/>
            Status: ${hz.status}<br/>
            Source: ${hz.source}
          </div>
        `).addTo(map);
        hazardMarkersRef.current.push(marker);
      });
    }
  };

  useEffect(() => {
    if (computedRoutes.length > 0 && selectedRouteId) {
      drawRoutesAndHazards(computedRoutes, selectedRouteId);
    }
  }, [computedRoutes, selectedRouteId]);

  const updateMarkers = (orig: [number, number] | null, dest: [number, number] | null) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (originMarkerRef.current) map.removeLayer(originMarkerRef.current);
    if (destMarkerRef.current) map.removeLayer(destMarkerRef.current);

    const createIcon = (color: string) => L.divIcon({
      className: "custom-div-icon",
      html: `<div style="background-color: ${color}; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    if (orig) {
      originMarkerRef.current = L.marker(orig, { icon: createIcon("#10B981") }).addTo(map);
      originMarkerRef.current.bindPopup("Origin");
    }
    if (dest) {
      destMarkerRef.current = L.marker(dest, { icon: createIcon("#3B82F6") }).addTo(map);
      destMarkerRef.current.bindPopup("Destination");
    }

    if (orig && !dest) map.setView(orig, 14);
    if (dest && !orig) map.setView(dest, 14);
  };

  useEffect(() => {
    updateMarkers(originCoord, destCoord);
  }, [originCoord, destCoord]);

  const useCurrentLocation = () => {
    setStatusMsg("LOCATING");
    if (!navigator.geolocation) {
      setStatusMsg("ERROR: Geolocation not supported");
      alert("Location permission is required to calculate a route from your current location.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOriginCoord([pos.coords.latitude, pos.coords.longitude]);
        setOriginStr("My Current Location");
        setStatusMsg("LOCATION_READY");
      },
      (err) => {
        setStatusMsg("ERROR: Location denied");
        alert("Location permission is required to calculate a route from your current location.");
      }
    );
  };

  const geocode = async (query: string): Promise<[number, number] | null> => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`, {
        headers: { "User-Agent": "UrbanPulse/1.0" }
      });
      const data = await res.json();
      if (data && data.length > 0) {
        return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
      }
    } catch (e) {
      console.error(e);
    }
    return null;
  };

  const handleCalculateRoute = async () => {
    if (!originStr || !destinationStr) return;
    setCalculating(true);
    setStatusMsg("CALCULATING_ROUTE");

    let orig = originCoord;
    if (!orig || originStr !== "My Current Location") {
      orig = await geocode(originStr);
      if (orig) setOriginCoord(orig);
    }

    let dest = destCoord;
    dest = await geocode(destinationStr);
    if (dest) setDestCoord(dest);

    if (!orig || !dest) {
      setStatusMsg("ERROR: Invalid destination or origin");
      setCalculating(false);
      return;
    }

    try {
      const osrmMode = travelMode;
      const url = `https://router.project-osrm.org/route/v1/${osrmMode}/${orig[1]},${orig[0]};${dest[1]},${dest[0]}?overview=full&geometries=geojson&alternatives=true`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
        setStatusMsg("NO_ROUTE");
        setComputedRoutes([]);
        setCalculating(false);
        return;
      }

      const analyzedRoutes = data.routes.map((r: any, idx: number) => {
        const coords: [number, number][] = r.geometry.coordinates.map((c: any) => [c[1], c[0]]);
        
        // Hazard awareness analysis based on actual reports
        const { totalRisk, hazardsOnRoute } = computeRouteRisk(coords, reports);
        
        // Convert risk to a 0-100 safety score (Deterministic)
        // 0 risk -> 100 score. Each risk point drops score by 15. Floor at 0.
        const safetyScore = Math.max(0, Math.round(100 - (totalRisk * 15)));
        
        const roadQual = safetyScore >= 80 ? "Optimal" : safetyScore >= 50 ? "Moderate" : "Caution Required";

        return {
          _rawRisk: totalRisk, // temporary field for sorting
          id: `alt_route_${idx}`,
          name: `Route Option ${idx + 1}`,
          distanceKm: parseFloat((r.distance / 1000).toFixed(1)),
          durationMinutes: Math.round(r.duration / 60),
          safetyScore,
          hazardCountAvoided: 0, 
          roadQuality: roadQual,
          pathCoordinates: coords,
          hazardsOnRoute
        };
      });

      // Find the best route based on safety score and duration balance
      analyzedRoutes.sort((a: any, b: any) => {
        // Higher safety is better, shorter duration is better.
        // Balance formula: (B's safety - A's safety) + (A's duration - B's duration) / 2
        const safetyDiff = b.safetyScore - a.safetyScore;
        const durDiff = (a.durationMinutes - b.durationMinutes) * 0.5; 
        return safetyDiff + durDiff;
      });

      // Best route gets special naming
      if (analyzedRoutes.length > 0) {
        analyzedRoutes[0].id = "safe_route_0";
        analyzedRoutes[0].name = "Recommended Route";
        
        // Compare with worst route to calculate avoided hazards
        const worstRoute = [...analyzedRoutes].sort((a: any, b: any) => b.hazardsOnRoute.length - a.hazardsOnRoute.length)[0];
        if (worstRoute && worstRoute.id !== analyzedRoutes[0].id) {
          analyzedRoutes[0].hazardCountAvoided = Math.max(0, worstRoute.hazardsOnRoute.length - analyzedRoutes[0].hazardsOnRoute.length);
        }
      }

      setComputedRoutes(analyzedRoutes);
      setSelectedRouteId(analyzedRoutes[0].id);
      setStatusMsg("ROUTE_READY");
    } catch (err) {
      setStatusMsg("ERROR: Routing API failure");
      console.error(err);
    }
    setCalculating(false);
  };

  const currentSelectedRoute = computedRoutes.find(r => r.id === selectedRouteId) || computedRoutes[0];
  
  // Calculate Live Hazard Index for current map area (rough estimation based on all reports)
  const activeReportsCount = reports.filter(r => r.status !== "Resolved" && r.latitude && r.longitude).length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="bg-gradient-to-r from-blue-50 to-white dark:from-slate-900 dark:to-slate-950 border border-[#DBEAFE] rounded-2xl p-5 md:p-6 text-slate-900 dark:text-white shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-[#DBEAFE] flex items-center justify-center text-slate-900 dark:text-white shrink-0 shadow-2xs">
            <Compass className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-black tracking-tight text-slate-900 dark:text-white uppercase">
                SAFE ROUTE NAVIGATOR
              </h1>
              <span className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 rounded text-[9.5px] font-mono font-bold uppercase tracking-wider">
                Hazard-Aware Routing Engine
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-300 mt-0.5">
              Dynamically evaluates road surface degradation, active potholes, and lighting outages to calculate safer commuter corridors.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2 text-xs font-mono bg-white dark:bg-slate-900 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xs">
            <Activity className="w-4 h-4 text-green-600 dark:text-green-400" />
            <span className="text-slate-500 dark:text-slate-300">Status:</span>
            <span className="text-green-600 dark:text-green-400 font-bold">{statusMsg}</span>
          </div>
          <span className="text-[9px] text-slate-400 dark:text-slate-400 font-mono">
            {activeReportsCount > 0 ? `${activeReportsCount} Live Hazards Tracked Globally` : "No active UrbanPulse hazards detected."}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">        
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 space-y-3 text-slate-900 dark:text-white shadow-xs">
            <div className="space-y-2">
              <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700">
                <MapPin className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />
                <div className="w-full flex items-center gap-2">
                  <div className="flex-1">
                    <span className="text-[9.5px] text-slate-500 dark:text-slate-300 uppercase font-mono block">Origin</span>
                    <input
                      type="text"
                      value={originStr}
                      onChange={(e) => setOriginStr(e.target.value)}
                      placeholder="Origin Address / Landmark"
                      className="bg-transparent text-xs text-slate-900 dark:text-white w-full focus:outline-hidden font-medium"
                    />
                  </div>
                  <button 
                    onClick={useCurrentLocation}
                    title="Use My Current Location"
                    className="p-1.5 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:text-white rounded-lg transition-colors cursor-pointer shadow-2xs"
                  >
                    <Compass className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700">
                <Navigation className="w-4 h-4 text-slate-900 dark:text-white shrink-0" />
                <div className="w-full">
                  <span className="text-[9.5px] text-slate-500 dark:text-slate-300 uppercase font-mono block">Destination</span>
                  <input
                    type="text"
                    value={destinationStr}
                    onChange={(e) => setDestinationStr(e.target.value)}
                    placeholder="Destination Address / Hub"
                    className="bg-transparent text-xs text-slate-900 dark:text-white w-full focus:outline-hidden font-medium"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-slate-500 dark:text-slate-300 font-mono uppercase">Travel Mode:</span>
              <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-800/50 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setTravelMode("driving")}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    travelMode === "driving" ? "bg-[#2563EB] text-white shadow-2xs" : "text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:text-white"
                  }`}
                >
                  <Car className="w-3.5 h-3.5" />
                  <span>Car</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTravelMode("cycling")}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    travelMode === "cycling" ? "bg-[#2563EB] text-white shadow-2xs" : "text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:text-white"
                  }`}
                >
                  <Bike className="w-3.5 h-3.5" />
                  <span>Bike</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTravelMode("foot")}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    travelMode === "foot" ? "bg-[#2563EB] text-white shadow-2xs" : "text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:text-white"
                  }`}
                >
                  <Footprints className="w-3.5 h-3.5" />
                  <span>Walk</span>
                </button>
              </div>
            </div>

            <button
              onClick={handleCalculateRoute}
              disabled={calculating || !originStr || !destinationStr}
              className="w-full py-2.5 bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {calculating ? (
                <span>Calculating Route...</span>
              ) : (
                <>
                  <Route className="w-3.5 h-3.5" />
                  <span>Find Route</span>
                </>
              )}
            </button>
          </div>

          <div className="space-y-2.5">
            {computedRoutes.length === 0 && statusMsg !== "IDLE" && !calculating && (
              <div className="p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-center">
                <AlertTriangle className="w-6 h-6 text-slate-400 mx-auto mb-2" />
                <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">No route data available</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Safe route unavailable for the given locations. Please try a different origin or destination.</p>
              </div>
            )}
            {computedRoutes.map((rt) => {
              const isSelected = rt.id === selectedRouteId;
              const isRecommended = rt.id === "safe_route_0";
              return (
                <div
                  key={rt.id}
                  onClick={() => setSelectedRouteId(rt.id)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                    isSelected
                      ? (isRecommended ? "bg-[#F0FDF4] border-[#16A34A] shadow-xs ring-2 ring-[#16A34A]/20" : "bg-blue-50 dark:bg-blue-900/20 border-[#2563EB] shadow-xs ring-2 ring-[#2563EB]/20")
                      : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:border-slate-700 shadow-2xs"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 border rounded text-[9px] font-mono font-bold ${
                          isRecommended && isSelected ? "bg-green-100 dark:bg-green-900/30 text-[#15803D] border-green-200 dark:border-green-800" 
                          : isSelected ? "bg-[#DBEAFE] text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800" 
                          : "bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                        }`}>
                          {isRecommended ? "RECOMMENDED" : "ALTERNATIVE"}
                        </span>
                        <h4 className={`text-xs font-bold ${isSelected ? "text-slate-900 dark:text-white" : "text-slate-600 dark:text-slate-400"}`}>{rt.name}</h4>
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-xs font-mono">
                        <span className={`font-bold ${isSelected ? "text-slate-900 dark:text-white" : "text-slate-600 dark:text-slate-400"}`}>{rt.durationMinutes} min</span>
                        <span className="text-[#CBD5E1]">•</span>
                        <span className="text-slate-500">{rt.distanceKm} km</span>
                        <span className="text-slate-400">•</span>
                        <span className={rt.safetyScore >= 80 ? "text-emerald-500 font-bold" : rt.safetyScore >= 50 ? "text-amber-500 font-bold" : "text-rose-500 font-bold"}>
                          Score: {rt.safetyScore}/100
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-7 space-y-4">          
          <div className="bg-[#0D1322] border border-slate-800 rounded-2xl p-4 text-white space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-xs">
              <div className="flex items-center gap-2">
                <Compass className="w-4 h-4 text-blue-400" />
                <span className="font-bold text-slate-200">Real-time Map</span>
              </div>
              <span className="font-mono text-[10.5px] text-slate-400">OSRM + UrbanPulse Hazard Data</span>
            </div>
            
            <div 
              ref={mapContainerRef} 
              className="relative h-64 sm:h-80 w-full bg-slate-950 rounded-xl border border-slate-800 overflow-hidden" 
              style={{ minHeight: "320px", zIndex: 0 }}
            />
          </div>

          {currentSelectedRoute && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Route Recommendation</span>
                </h3>
              </div>
              
              <div className="space-y-3">
                <p className="text-xs text-slate-700 font-medium">
                  {currentSelectedRoute.id === "safe_route_0" 
                    ? currentSelectedRoute.hazardsOnRoute.length === 0 
                        ? "Low reported hazard exposure based on available UrbanPulse data." 
                        : `Safer route based on available UrbanPulse data. Recommended because it provides the best balance of travel time and safety, avoiding ${currentSelectedRoute.hazardCountAvoided} more hazards than alternatives.`
                    : "Alternative route selected. This route may have a different hazard profile or travel duration."
                  }
                </p>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <span className="block text-[10px] text-slate-500 uppercase font-mono mb-1">Safety Score</span>
                    <span className={`text-sm font-black ${currentSelectedRoute.safetyScore >= 80 ? 'text-emerald-600' : currentSelectedRoute.safetyScore >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>
                      {currentSelectedRoute.safetyScore}
                    </span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <span className="block text-[10px] text-slate-500 uppercase font-mono mb-1">Active Hazards</span>
                    <span className="text-sm font-black text-slate-800">{currentSelectedRoute.hazardsOnRoute.length}</span>
                  </div>
                  {currentSelectedRoute.hazardCountAvoided > 0 && (
                    <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                      <span className="block text-[10px] text-slate-500 uppercase font-mono mb-1">Avoided</span>
                      <span className="text-sm font-black text-emerald-600">{currentSelectedRoute.hazardCountAvoided} Known</span>
                    </div>
                  )}
                </div>

                <div className="p-3 bg-slate-100 border border-slate-200 rounded-xl flex items-start gap-2.5 text-xs text-slate-600 mt-2">
                  <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] leading-relaxed text-slate-500">
                    <strong>Disclaimer:</strong> Safety score is based on available UrbanPulse reports and may not reflect all real-world conditions. UrbanPulse does not guarantee road or travel safety.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
