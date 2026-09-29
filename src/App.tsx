import React, { useState, useEffect, useMemo } from "react";
import { User, Report, Notification, RoadScanCandidate, RoadScanSession } from "./types";
import { subscribeToReports, updateReportStatus as dbUpdateReportStatus, bulkUpdateReportStatus, deleteReport, createReport } from "./lib/firestore_reports";
import { subscribeToNotifications, markNotificationAsRead, markAllNotificationsAsRead } from "./services/notificationsService";
import { useAuth } from "./context/AuthContext";
import { RoleGuard } from "./components/RoleGuard";
import DashboardStats from "./components/DashboardStats";
import AIInsightsPanel from "./components/AIInsightsPanel";
import SimpleMap from "./components/SimpleMap";
import CitizenUpload from "./components/CitizenUpload";
import ReportDetailsModal from "./components/ReportDetailsModal";
import FutureModules from "./components/FutureModules";
import AICopilotChat from "./components/AICopilotChat";
import CityCommandCenter from "./components/CityCommandCenter";
import ExecutiveAnalytics from "./components/ExecutiveAnalytics";
import SmartCityDigitalTwin from "./components/SmartCityDigitalTwin";
import AreaProfilePages from "./components/AreaProfilePages";
import CityHealthReport from "./components/CityHealthReport";
import SovereignErrorFallback from "./components/SovereignErrorFallbacks";
import RoadScanner from "./components/RoadScanner";
import RoadAiCandidateReview from "./components/RoadAiCandidateReview";
import SafeRouteNav from "./components/SafeRouteNav";
import RewardsPortal from "./components/RewardsPortal";
import CitizenEmergencySOS from "./components/CitizenEmergencySOS";
import CitizenCopilot from "./components/CitizenCopilot";
import CitizenHome from "./components/CitizenHome";
import MunicipalHome from "./components/MunicipalHome";
import MunicipalCopilot from "./components/MunicipalCopilot";
import FooterEmergencyButton from "./components/FooterEmergencyButton";
import FieldTeamDashboard from "./components/FieldTeamDashboard";
import AdminPanel from "./components/AdminPanel";
import { DispatchManagement } from "./components/DispatchManagement";
import { 
  ShieldAlert, Layers, Search, Filter, Trash2, Eye, 
  MapPin, AlertOctagon, CheckSquare, Clock, ArrowRight, Save, User as UserIcon, Lock, Landmark, Sparkles, AlertCircle, Loader2, LogIn, UserPlus, Mail,
  Terminal, Activity, Columns, Bell, LogOut, RefreshCw, Menu, X, Check, Laptop, ChevronRight, ChevronDown, Compass, Wind, LayoutDashboard, BarChart3,
  Camera, Navigation, Award, AlertTriangle, ShieldCheck, FileText, Wrench, Shield,
  Users, Briefcase, Server, Settings, Radio, Send, Moon, Sun
} from "lucide-react";


function getRelativeTime(dateString: string) {
  const now = new Date();
  const date = new Date(dateString);
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  
  if (diffInSeconds < 60) return "Just now";
  
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes} min ago`;
  
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
  
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays === 1) return "Yesterday";
  
  return `${diffInDays} days ago`;
}

export default function App() {
  const { 
    user: firebaseUser, 
    userProfile, 
    role, 
    isAuthenticated, 
    loading: authLoading, 
    login, 
    signup, 
    loginWithGoogle,
    logout, 
    authError: contextAuthError,
    clearAuthError,
  } = useAuth();

  // Map to internal user model for compatibility with stable memoization
  const currentUser: User | null = useMemo(() => {
    if (!userProfile) return null;
    return {
      id: userProfile.uid,
      email: userProfile.email,
      fullName: userProfile.name || userProfile.fullName || "Urban Citizen",
      role: (userProfile.role as any) || "citizen",
      teamId: userProfile.teamId,
      teamName: userProfile.teamName,
      teamLead: userProfile.teamLead,
      availability: userProfile.availability,
      createdAt: userProfile.createdAt
    };
  }, [userProfile?.uid, userProfile?.email, userProfile?.name, userProfile?.fullName, userProfile?.role, userProfile?.teamId, userProfile?.teamName, userProfile?.teamLead, userProfile?.availability, userProfile?.createdAt]);

  const [reports, setReports] = useState<Report[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  
  // Road Scanner & Civic Rewards State
  const [activeScanSession, setActiveScanSession] = useState<RoadScanSession | null>(null);
  const [userCivicPoints, setUserCivicPoints] = useState<number>(userProfile?.points ?? 0);

  // Dashboard Filtering states
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [riskLevelFilter, setRiskLevelFilter] = useState("All");
  const [areaFilter, setAreaFilter] = useState("All");
  const [sourceFilter, setSourceFilter] = useState("All");

  // Sorting & Selected item states for Tables
  const [sortBy, setSortBy] = useState<"severity" | "id" | "createdAt" | "status">("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([]);

  // Registration/Auth States
  const [isLoginView, setIsLoginView] = useState(true);
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [fullNameInput, setFullNameInput] = useState("");
  const [authRoleInput, setAuthRoleInput] = useState<"citizen" | "admin" | "field_team" | "municipal">("citizen");
  const [localAuthError, setLocalAuthError] = useState("");
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);

  const [loadingReports, setLoadingReports] = useState(true);
  const [appOnline, setAppOnline] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem("urbanpulse_theme") === "dark");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDarkMode);
    localStorage.setItem("urbanpulse_theme", isDarkMode ? "dark" : "light");
  }, [isDarkMode]);
  
  // Sovereign Multi-City ready states
  const [selectedCityName, setSelectedCityName] = useState("New Delhi (NCR)");
  
  // High-fidelity sidebar terminal states
  const [activeTerminal, setActiveTerminal] = useState<"citizen" | "admin" | "field_team" | "split">("citizen");
  const [activeSubTab, setActiveSubTab] = useState<
    "citizen-home" | "my-reports" | "municipal-home" | "command-center" | "infrastructure" | "dispatch-management" | "road-scanner" | "candidate-review" | "safe-route" | "rewards" | "emergency-sos" | "copilot" | "analytics" | "digital-twin" | "safety" | "traffic" | "environmental" | "emergency" | "field-operations" | "admin-panel" | "admin-users" | "admin-teams" | "admin-system" | "admin-audit" | "admin-settings" | "audit-logs"
  >("citizen-home");

  // On mount and role change, reset to correct home
  useEffect(() => {
    if (currentUser?.role === "field_team") {
      setActiveSubTab("field-operations");
      setActiveTerminal("field_team");
    } else if (currentUser?.role === "admin") {
      setActiveSubTab("admin-panel");
      setActiveTerminal("admin");
    } else if (currentUser?.role === "municipal") {
      setActiveSubTab("municipal-home");
      setActiveTerminal("admin");
    } else {
      setActiveSubTab("citizen-home");
      setActiveTerminal("citizen");
    }
  }, [currentUser?.role]);

  // Strict Role Route Guards & Boundary Protection
  useEffect(() => {
    if (!currentUser) return;

    if (currentUser.role === "admin") {
      // Admin must NEVER access Field Operations Deck
      if (activeSubTab === "field-operations") {
        setActiveSubTab("admin-panel");
      }
    } else if (currentUser.role === "citizen") {
      const forbiddenForCitizen = [
        "field-operations", "command-center", "municipal-home", "dispatch-management", "admin-panel", 
        "admin-users", "admin-teams", "admin-system", "admin-audit", "admin-settings", "audit-logs",
        "rewards", "copilot"
      ];
      if (forbiddenForCitizen.includes(activeSubTab)) {
        setActiveSubTab("citizen-home");
      }
    } else if (currentUser.role === "field_team") {
      const forbiddenForFieldTeam = [
        "admin-panel", "admin-users", "admin-teams", "admin-system", 
        "admin-audit", "admin-settings", "audit-logs", "command-center", "municipal-home", "dispatch-management"
      ];
      if (forbiddenForFieldTeam.includes(activeSubTab)) {
        setActiveSubTab("field-operations");
      }
    } else if (currentUser.role === "municipal") {
      const forbiddenForMunicipal = [
        "admin-panel", "admin-users", "admin-teams", "admin-system", "admin-audit", "admin-settings", "audit-logs", "field-operations"
      ];
      if (forbiddenForMunicipal.includes(activeSubTab)) {
        setActiveSubTab(activeSubTab === "field-operations" ? "dispatch-management" : "municipal-home");
      }
    }
  }, [currentUser?.role, activeSubTab]);
  const [isSidebarMobileOpen, setIsSidebarMobileOpen] = useState(false);
  const [showNotificationsList, setShowNotificationsList] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [isJurisdictionMenuOpen, setIsJurisdictionMenuOpen] = useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const jurisdictionMenuRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (jurisdictionMenuRef.current && !jurisdictionMenuRef.current.contains(event.target as Node)) {
        setIsJurisdictionMenuOpen(false);
      }
    };
    if (isJurisdictionMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isJurisdictionMenuOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Sync userCivicPoints when profile changes
  useEffect(() => {
    if (userProfile?.points !== undefined) {
      setUserCivicPoints(userProfile.points);
    }
  }, [userProfile?.points]);

  // Initial load / sync when user logs in via Firebase Auth
  useEffect(() => {
    if (currentUser) {
      syncOperationalDatasets(currentUser.email, currentUser.role);
    }
  }, [currentUser?.id, currentUser?.role]);

  // Subscribe to real-time reports from Firestore
  useEffect(() => {
    if (!currentUser) return;
    setLoadingReports(true);
    const unsubReports = subscribeToReports((fetchedReports) => {
      setReports(fetchedReports);
      setLoadingReports(false);
    });
    const unsubNotifs = subscribeToNotifications(currentUser.email, currentUser.role as any, (fetchedNotifs) => {
      setNotifications(fetchedNotifs);
    });
    return () => {
      unsubReports();
      unsubNotifs();
    };
  }, [currentUser?.id, currentUser?.email, currentUser?.role]);

  const syncOperationalDatasets = (email: string, role: string) => {
    // Left empty deliberately if components still call it, as subscription is moved to useEffect
  };
  // Auth Submit Action with Firebase Authentication
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalAuthError("");
    clearAuthError();
    setIsSubmittingAuth(true);

    if (isLoginView) {
      if (!emailInput || !passwordInput) {
        setLocalAuthError("Email and password are required.");
        setIsSubmittingAuth(false);
        return;
      }
      try {
        await login(emailInput, passwordInput);
      } catch (err: any) {
        setLocalAuthError(err.message || "Authentication declined.");
      } finally {
        setIsSubmittingAuth(false);
      }
    } else {
      if (!emailInput || !fullNameInput || !passwordInput) {
        setLocalAuthError("Name, email, and password are required.");
        setIsSubmittingAuth(false);
        return;
      }
      try {
        const targetRole = authRoleInput === "field_team" 
          ? "field_team" 
          : (authRoleInput === "admin" ? "municipal" : "citizen");
        await signup(emailInput, passwordInput, fullNameInput, targetRole);
      } catch (err: any) {
        setLocalAuthError(err.message || "Registration validation failed.");
      } finally {
        setIsSubmittingAuth(false);
      }
    }
  };

  // Google Sign-In handler (Firebase Auth Google Provider)
  const handleGoogleLogin = async () => {
    setLocalAuthError("");
    clearAuthError();
    setIsSubmittingAuth(true);
    try {
      const targetRole = authRoleInput === "field_team" 
        ? "field_team" 
        : (authRoleInput === "admin" ? "municipal" : "citizen");
      await loginWithGoogle(targetRole);
    } catch (err: any) {
      setLocalAuthError(err.message || "Google sign-in could not be completed.");
    } finally {
      setIsSubmittingAuth(false);
    }
  };
  // Status transition applied and dispatched
  const handleUpdateStatus = async (payload: {
    id: string;
    status: Report["status"];
    assignedTo: string | null;
    comment: string;
    officerName: string;
  }) => {
    try {
      await dbUpdateReportStatus(payload.id, payload.status, payload.comment);
        if (selectedReport && selectedReport.id === payload.id) {
          setSelectedReport({
            ...selectedReport,
            status: payload.status,
            assignedTo: payload.assignedTo
          });
        }
        if (currentUser) {
          syncOperationalDatasets(currentUser.email, currentUser.role);
        }
    } catch (e) {
      console.error("Failed to post status modifications:", e);
    }
  };

  // Log Out clear with Firebase Auth
  const handleLogout = async () => {
    try {
      await logout();
      setReports([]);
      setNotifications([]);
      setSelectedReport(null);
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  // Mark notifications read
  const handleMarkNotificationsRead = () => {
    if (!currentUser) return;
    markAllNotificationsAsRead(notifications).catch(e => console.error(e));
  };
  
  // Triggering notification clicks
  const handleNotificationClick = async (notif: Notification) => {
    if (!notif.read) {
      try {
        await markNotificationAsRead(notif.id);
      } catch (e) {
        console.error("Could not mark as read", e);
      }
    }
    // Find matching report and open it
    const found = reports.find(r => r.id === notif.reportId || r.id === notif.relatedReportId);
    if (found) {
      setSelectedReport(found);
    }
  };

  // Deleting tickets (Cleanup administration tool)
  const handleDeleteReport = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Warning: Are you absolutely sure you want to scrub and delete Ticket ${id} from operational city datasets?`)) return;

    try {
      await deleteReport(id, currentUser);
      setReports(prev => prev.filter(r => r.id !== id));
      setSelectedReport(null);
    } catch (e: any) {
      console.error("Delete report clearance failed:", e);
      alert(e.message || "Delete report failed due to authorization restriction.");
    }
  };
  // Filtering & Sorting Logic
  const filteredReports = reports.filter((r) => {
    const matchesSearch = 
      r.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.location.toLowerCase().includes(searchQuery.toLowerCase());
      
    const matchesCategory = categoryFilter === "All" || r.category === categoryFilter;
    const matchesStatus = statusFilter === "All" || r.status === statusFilter;
    const matchesRiskLevel = riskLevelFilter === "All" || r.riskLevel === riskLevelFilter;
    const matchesArea = areaFilter === "All" || r.location.toLowerCase().includes(areaFilter.toLowerCase());
    const matchesSource = 
      sourceFilter === "All" || 
      (sourceFilter === "ROAD_SCANNER" ? r.source === "ROAD_SCANNER" : r.source !== "ROAD_SCANNER");

    return matchesSearch && matchesCategory && matchesStatus && matchesRiskLevel && matchesArea && matchesSource;
  });

  const sortedReports = [...filteredReports].sort((a, b) => {
    let aVal: any;
    let bVal: any;

    if (sortBy === "severity") {
      aVal = a.severity;
      bVal = b.severity;
    } else if (sortBy === "id") {
      aVal = a.id;
      bVal = b.id;
    } else if (sortBy === "status") {
      aVal = a.status;
      bVal = b.status;
    } else {
      aVal = a.createdAt || "";
      bVal = b.createdAt || "";
    }

    if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
    if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
    return 0;
  });

  return (
    <div className="min-h-screen bg-[#F5F7FB] flex flex-col md:flex-row font-sans transition-colors overflow-x-hidden text-[#172033]">
      
      {/* LEFT SIDEBAR (Premium light civic-tech / smart city operations platform sidebar) */}
      {currentUser && (
        <aside id="system-sidebar" className={`w-72 bg-gradient-to-b from-[#F0F5FD] via-[#F4F8FD] to-[#F8FAFD] border-r border-[#D9E3F0] text-[#475569] md:flex flex-col h-full fixed top-0 bottom-0 left-0 shrink-0 select-none z-[1100] transition-transform duration-300 overflow-y-auto shadow-[0_2px_12px_rgba(15,23,42,0.03)] ${
          isSidebarMobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full md:translate-x-0"
        }`}>
          {/* Logo & Branding Grid */}
          <div className="p-5 border-b border-[#D9E3F0] flex items-center justify-between bg-white/80 backdrop-blur-xs">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#2563EB] flex items-center justify-center text-white shadow-xs">
                <ShieldAlert className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="font-sans font-extrabold text-sm tracking-normal text-[#172033] leading-tight">URBANPULSE</h1>
                <p className="text-[9.5px] font-extrabold text-[#2563EB] font-mono tracking-wider uppercase -mt-0.5">
                  {currentUser.role === "admin" ? "MUNICIPAL DECK" : "CITIZEN NODE"}
                </p>
              </div>
            </div>
            {/* Close button for Mobile */}
            <button 
              onClick={() => setIsSidebarMobileOpen(false)}
              className="md:hidden p-1.5 rounded-lg text-[#64748B] hover:text-[#2563EB] hover:bg-[#E8F0FA] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          
          {/* SECTION HEADER */}
          <div className="px-5 mb-2 mt-3.5">
            <span className="text-[9.5px] font-extrabold tracking-wider text-[#64748B] uppercase block">
              {currentUser.role === "admin"
                ? "ADMINISTRATIVE GOVERNANCE"
                : currentUser.role === "municipal"
                ? "MUNICIPAL COMMAND CONTROL"
                : currentUser.role === "field_team" 
                ? "FIELD OPERATIONS SQUAD" 
                : "CITIZEN CIVIC PORTAL"}
            </span>
          </div>

          {/* NAVIGATION MULTI-MODULE SUITE */}
          <div className="px-3 flex-1 flex flex-col gap-1 overflow-y-auto pr-1">
            {(() => {
  const citizenGroups = [
    {
      title: "OVERVIEW",
      items: [
        { id: "citizen-home", label: "Overview", desc: "Citizen civic portal", icon: LayoutDashboard },
        { id: "my-reports", label: "My Reports", desc: "Track filed issues", icon: FileText },
      ]
    },
    {
      title: "SAFETY",
      items: [
        { id: "infrastructure", label: "Report Issue", desc: "Log urban hazards", icon: Activity },
        { id: "road-scanner", label: "AI Road Scanner", desc: "Dashcam hazard detection", icon: Camera },
        ...(activeScanSession && activeScanSession.candidates.length > 0 ? [{ id: "candidate-review", label: `Review Scans (${activeScanSession.candidates.length})`, desc: "Review & submit", icon: ShieldCheck }] : []),
        { id: "safe-route", label: "Safe Route", desc: "Hazard-free navigation", icon: Navigation },
        { id: "emergency-sos", label: "Emergency SOS", desc: "Critical infrastructure beacon", icon: AlertTriangle },
      ]
    }
  ];

  const municipalGroups = [
    {
      title: "OVERVIEW",
      items: [
        { id: "municipal-home", label: "City Overview", desc: "City Command Dashboard", icon: LayoutDashboard },
        { id: "command-center", label: "Command Center", desc: "AI Command & Control", icon: ShieldAlert },
      ]
    },
    {
      title: "OPERATIONS",
      items: [
        { id: "infrastructure", label: "Incident Triage", desc: "Active Triage Desk", icon: Columns },
        { id: "dispatch-management", label: "Dispatch Management", desc: "Squad dispatch & SLA control", icon: Radio },
      ]
    },
    {
      title: "CITY INTELLIGENCE",
      items: [
        { id: "safety", label: "Map & Heatmap", desc: "GIS risk overlay maps", icon: MapPin },
        { id: "analytics", label: "City Analytics", desc: "City Health & Ward standings", icon: BarChart3 },
        { id: "digital-twin", label: "Digital Twin", desc: "5-Layer vector city hologram", icon: Layers },
      ]
    },
    {
      title: "AI",
      items: [
        { id: "copilot", label: "Municipal Copilot", desc: "Fleet triage strategy", icon: Sparkles },
        { id: "road-scanner", label: "Road Scanner Feed", desc: "Live dashcam telemetry", icon: Camera },
      ]
    }
  ];

  const adminGroups = [
    {
      title: "ADMINISTRATIVE GOVERNANCE",
      items: [
        { id: "admin-panel", label: "Admin Console", desc: "Platform governance console", icon: Shield },
      ]
    },
    {
      title: "USER & TEAM GOVERNANCE",
      items: [
        { id: "admin-users", label: "User Management", desc: "User credentials & role clearances", icon: Users },
        { id: "admin-teams", label: "Team Management", desc: "Field squad roster & zones", icon: Briefcase },
      ]
    },
    {
      title: "MUNICIPAL OVERSIGHT",
      items: [
        { id: "municipal-home", label: "City Overview", desc: "Command Dashboard", icon: LayoutDashboard },
        { id: "command-center", label: "Command Center", desc: "AI Incident Command", icon: ShieldAlert },
        { id: "infrastructure", label: "Incident Triage", desc: "All City Reports", icon: Columns },
      ]
    },
    {
      title: "INTELLIGENCE & PLATFORM",
      items: [
        { id: "safety", label: "Map & Heatmap", desc: "GIS risk overlay maps", icon: MapPin },
        { id: "analytics", label: "City Analytics", desc: "City Health standings", icon: BarChart3 },
        { id: "copilot", label: "Copilot Engine", desc: "Fleet triage strategy", icon: Sparkles },
        { id: "admin-system", label: "System Health", desc: "Platform runtime metrics", icon: Server },
      ]
    },
    {
      title: "SECURITY & GOVERNANCE",
      items: [
        { id: "admin-audit", label: "Audit Trail", desc: "Immutable security ledger", icon: FileText },
        { id: "admin-settings", label: "Platform Settings", desc: "Global system policies", icon: Settings },
      ]
    }
  ];

  const fieldTeamGroups = [
    {
      title: "FIELD OPERATIONS",
      items: [
        { id: "field-operations", label: "Field Operations Deck", desc: "Assigned repair queue & SLA", icon: Wrench },
        { id: "road-scanner", label: "AI Road Scanner", desc: "Mobile hazard scanner", icon: Camera },
      ]
    },
    {
      title: "MAP & ROUTE",
      items: [
        { id: "safety", label: "Incident Map", desc: "GIS hazard overlay", icon: MapPin },
        { id: "safe-route", label: "Safe Navigation", desc: "Route hazard guidance", icon: Navigation },
        { id: "emergency-sos", label: "Field Emergency SOS", desc: "Alert dispatch desk", icon: AlertTriangle },
      ]
    },
    {
      title: "AI COPILOT",
      items: [
        { id: "copilot", label: "Field Copilot AI", desc: "Field tactical assistant", icon: Sparkles },
      ]
    }
  ];

  const activeGroups = currentUser.role === "admin"
    ? adminGroups
    : currentUser.role === "municipal"
    ? municipalGroups
    : currentUser.role === "field_team"
    ? fieldTeamGroups
    : citizenGroups;

  return (
    <div className="flex flex-col gap-4">
      {activeGroups.map((group, groupIdx) => (
        <div key={groupIdx}>
          <div className="text-[9.5px] font-bold text-[#64748B] uppercase tracking-wider mb-1.5 px-3">{group.title}</div>
          <div className="flex flex-col gap-1">
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = activeSubTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveSubTab(item.id as any);
                    setIsSidebarMobileOpen(false);
                  }}
                  className={`w-full px-3.5 py-2.5 rounded-[12px] flex items-center justify-between text-left transition-all duration-150 cursor-pointer group border-l-[3.5px] ${
                    isActive
                      ? "bg-[#E1EDFF] text-[#1D4ED8] border-[#2563EB] font-bold shadow-2xs"
                      : "bg-transparent text-[#334155] hover:text-[#1D4ED8] hover:bg-[#E4EEFA] border-transparent font-medium"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon className={`w-4 h-4 shrink-0 transition-colors ${
                      isActive ? "text-[#2563EB]" : "text-[#64748B] group-hover:text-[#2563EB]"
                    }`} />
                    <div className="min-w-0 truncate">
                      <div className={`text-[12px] truncate ${isActive ? "text-[#1D4ED8] font-bold" : "text-[#334155] group-hover:text-[#1D4ED8]"}`}>
                        {item.label}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
})()}

            {/* REAL-TIME OVERLAY ALERTS FEED */}
            <div className="mt-4 pt-3.5 border-t border-[#D9E3F0]">
              <div className="flex items-center justify-between px-2 mb-2">
                <span className="text-[9.5px] font-bold uppercase text-[#64748B] tracking-wider flex items-center gap-1.5">
                  <Bell className="w-3.5 h-3.5 text-[#2563EB]" />
                  <span>Real-Time Alerts</span>
                </span>
                {notifications.filter(n => !n.read).length > 0 && (
                  <button 
                    onClick={handleMarkNotificationsRead}
                    className="text-[9px] text-[#2563EB] hover:underline font-extrabold cursor-pointer"
                  >
                    Clear All
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-1.5 max-h-[140px] overflow-y-auto pr-1">
                {notifications.length === 0 ? (
                  <div className="px-2.5 py-3 text-center text-[#94A3B8] font-mono text-[9.5px] border border-[#D9E3F0] rounded-[12px] bg-[#F8FAFC]">
                    You're all caught up.
                  </div>
                ) : (
                  notifications.slice(0, 3).map((notif) => {
                    const isCritical = notif.type === "alert_high_severity" || (notif as any).severity >= 80;
                    return (
                      <div
                        key={notif.id}
                        onClick={() => handleNotificationClick(notif)}
                        className={`p-2.5 rounded-[12px] text-left cursor-pointer transition-all border ${
                          isCritical
                            ? "bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]"
                            : !notif.read
                            ? "bg-[#EFF6FF] border-[#BFDBFE] text-[#1E293B]"
                            : "bg-[#F8FAFC] border-[#D9E3F0] text-[#64748B] hover:border-[#CBD5E1]"
                        }`}
                      >
                        <div className="flex items-center justify-between text-[8.5px] font-mono">
                          <span className={`font-bold uppercase flex items-center gap-1 ${isCritical ? "text-[#DC2626]" : "text-[#2563EB]"}`}>
                            {isCritical ? <AlertTriangle className="w-2.5 h-2.5" /> : <Bell className="w-2.5 h-2.5 text-[#2563EB]" />}
                            {isCritical ? "CRITICAL RISK" : "UPDATED"}
                          </span>
                          <span className="text-[#94A3B8]">
                            {getRelativeTime(notif.createdAt)}
                          </span>
                        </div>
                        <p className="text-[10.5px] font-semibold text-[#172033] truncate mt-0.5">{notif.title}</p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* ACTIVE ACCOUNT PROFILE TRAY */}
          <div className="p-3.5 border-t border-[#D9E3F0] bg-[#EAF1FA] flex flex-col gap-2 shrink-0">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={`w-8 h-8 rounded-xl ${
                  currentUser.role === "field_team" 
                    ? "bg-[#16A34A]" 
                    : currentUser.role === "admin" 
                    ? "bg-[#7C3AED]" 
                    : currentUser.role === "municipal" 
                    ? "bg-[#F59E0B]" 
                    : "bg-[#2563EB]"
                } text-white flex items-center justify-center font-bold text-xs shadow-xs shrink-0 select-none uppercase`}>
                  {currentUser.fullName.split(" ").map(w => w[0]).join("").substring(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11.5px] font-extrabold text-[#172033] truncate leading-tight">{currentUser.fullName}</div>
                  <div className="text-[9px] text-[#64748B] font-mono truncate flex items-center gap-1 mt-0.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      currentUser.role === "field_team" 
                        ? "bg-[#16A34A]" 
                        : currentUser.role === "admin" 
                        ? "bg-[#7C3AED]" 
                        : currentUser.role === "municipal" 
                        ? "bg-[#F59E0B]" 
                        : "bg-[#2563EB]"
                    }`} />
                    <span className="uppercase font-bold tracking-wider">
                      {currentUser.role === "field_team" 
                        ? "Field Squad" 
                        : currentUser.role === "admin" 
                        ? "Super Admin" 
                        : currentUser.role === "municipal" 
                        ? "Municipal Dispatch" 
                        : "Citizen"}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="p-1.5 text-[#64748B] hover:text-[#DC2626] hover:bg-[#DCE4EE]/70 rounded-lg transition-all cursor-pointer shrink-0"
                title="Logout Session"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* MOBILE BACKDROP FOR SIDENAV */}
      {isSidebarMobileOpen && (
        <div 
          onClick={() => setIsSidebarMobileOpen(false)}
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs md:hidden z-[1050]"
        ></div>
      )}

      {/* CORE WORKSPACE PANEL */}
      {currentUser ? (
        <div className="flex-1 flex flex-col min-h-screen md:pl-72 bg-[#F5F7FB]">
          
          {/* TOP HORIZONTAL COMMAND HEADER (Desktop & Mobile) */}
          <header className="bg-white/95 backdrop-blur-md border-b border-[#E2E8F0] px-4 sm:px-6 py-2.5 sticky top-0 z-[1000] flex items-center justify-between gap-4 shadow-2xs">
            {/* Mobile Hamburger & Logo */}
            <div className="flex items-center gap-2.5 md:hidden">
              <button 
                onClick={() => setIsSidebarMobileOpen(true)}
                className="p-1.5 focus:outline-hidden hover:bg-[#F1F5F9] rounded-lg text-[#475569] cursor-pointer"
                title="Open navigation menu"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="w-7 h-7 bg-[#2563EB] rounded-lg flex items-center justify-center text-white shadow-2xs">
                <ShieldAlert className="w-4 h-4 text-white" />
              </div>
              <span className="font-sans font-extrabold text-xs tracking-tight uppercase text-[#172033]">URBANPULSE</span>
            </div>

            {/* Desktop / Tablet Search Field */}
            <div className="flex-1 max-w-xl hidden sm:block relative">
              <div className="relative flex items-center">
                <Search className="w-4 h-4 text-[#94A3B8] absolute left-3.5 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search reports, locations, citizens, or commands..."
                  className="w-full bg-[#F8FAFC] hover:bg-[#F1F5F9] focus:bg-white text-xs text-[#0F172A] placeholder-[#94A3B8] font-medium pl-10 pr-20 py-2 rounded-xl border border-[#E2E8F0] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/10 transition-all outline-hidden"
                />
                <div className="absolute right-2.5 flex items-center gap-1 pointer-events-none">
                  <kbd className="px-1.5 py-0.5 text-[9.5px] font-mono font-bold text-[#64748B] bg-white border border-[#CBD5E1] rounded shadow-2xs">
                    Ctrl + K
                  </kbd>
                </div>
              </div>

              {/* Search results dropdown if user searches */}
              {searchQuery.trim().length > 1 && (
                <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-[#E2E8F0] rounded-xl shadow-xl p-2 z-50 max-h-72 overflow-y-auto">
                  <div className="text-[10px] font-bold text-[#94A3B8] uppercase px-2 py-1 font-mono">
                    Matching System Records ({reports.filter(r => r.title.toLowerCase().includes(searchQuery.toLowerCase()) || r.address.toLowerCase().includes(searchQuery.toLowerCase()) || r.category.toLowerCase().includes(searchQuery.toLowerCase())).length})
                  </div>
                  {reports
                    .filter(r => r.title.toLowerCase().includes(searchQuery.toLowerCase()) || r.address.toLowerCase().includes(searchQuery.toLowerCase()) || r.category.toLowerCase().includes(searchQuery.toLowerCase()))
                    .slice(0, 5)
                    .map(r => (
                      <div
                        key={r.id}
                        onClick={() => {
                          setSelectedReport(r);
                          setSearchQuery("");
                        }}
                        className="p-2 hover:bg-[#EFF6FF] rounded-lg cursor-pointer transition text-left flex items-center justify-between text-xs"
                      >
                        <div className="min-w-0 pr-2">
                          <p className="font-semibold text-[#0F172A] truncate">{r.title}</p>
                          <p className="text-[11px] text-[#64748B] truncate">{r.address}</p>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-[#F1F5F9] text-[#2563EB] shrink-0">
                          {r.category}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Header Right Controls */}
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => setIsDarkMode((enabled) => !enabled)}
                className="theme-toggle p-2 rounded-xl border border-[#CBD5E1] bg-white/80 hover:bg-[#EFF6FF] text-[#475569] transition-all cursor-pointer"
                title={isDarkMode ? "Use light mode" : "Use dark mode"}
                aria-label={isDarkMode ? "Use light mode" : "Use dark mode"}
              >
                {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              {/* Unified Sovereign Jurisdiction Selector in Top Header */}
              <div ref={jurisdictionMenuRef} className="relative flex flex-col items-end text-right">
                <span className="text-[7.5px] sm:text-[8px] font-mono font-bold text-[#64748B] uppercase tracking-wider leading-none mb-0.5 sm:mb-1">
                  SOVEREIGN JURISDICTION
                </span>
                <button
                  type="button"
                  id="global-jurisdiction-switcher"
                  onClick={() => setIsJurisdictionMenuOpen(prev => !prev)}
                  className="flex items-center gap-1.5 sm:gap-2 bg-[#F0F6FE] hover:bg-[#E3EFFF] border border-[#CBD5E1] hover:border-[#93C5FD] px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl transition-all cursor-pointer shadow-2xs group text-left"
                  title="Sovereign Jurisdiction: URBANPULSE CIVIC NETWORK"
                  aria-expanded={isJurisdictionMenuOpen}
                  aria-haspopup="true"
                >
                  <div className="w-5 h-5 rounded-lg bg-[#2563EB]/10 flex items-center justify-center shrink-0">
                    <Compass className="w-3.5 h-3.5 text-[#2563EB]" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-[#0F172A] group-hover:text-[#2563EB] transition-colors leading-tight">
                      URBANPULSE CIVIC NETWORK
                    </span>
                    <span className="text-[9px] font-mono text-[#64748B] leading-none mt-0.5 hidden xs:block sm:block">
                      Multi-City Operations
                    </span>
                  </div>
                  <ChevronDown className={`w-3.5 h-3.5 text-[#64748B] transition-transform duration-200 ml-0.5 ${isJurisdictionMenuOpen ? "rotate-180 text-[#2563EB]" : ""}`} />
                </button>

                {/* Unified Operational Network Dropdown Popover */}
                {isJurisdictionMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-76 sm:w-80 bg-white rounded-2xl shadow-xl border border-[#CBD5E1] p-3.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150 text-left">
                    <div className="text-[9.5px] font-mono font-bold text-[#64748B] uppercase tracking-wider px-1 mb-2 flex items-center justify-between">
                      <span>Operational Network</span>
                      <div className="flex items-center gap-1.5 text-[9px] text-[#16A34A] font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A] animate-pulse"></span>
                        <span>ONLINE</span>
                      </div>
                    </div>

                    <div className="p-3 bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl flex items-start gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-[#2563EB] text-white flex items-center justify-center shrink-0 shadow-2xs font-bold">
                        <ShieldAlert className="w-4 h-4 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-[#0F172A]">URBANPULSE CIVIC NETWORK</span>
                          <span className="text-[8.5px] font-mono font-bold text-[#16A34A] bg-[#DCFCE7] border border-[#BBF7D0] px-1.5 py-0.5 rounded">ACTIVE</span>
                        </div>
                        <div className="text-[10.5px] text-[#2563EB] font-bold mt-0.5">Multi-City / Multi-Jurisdiction Operations</div>
                        <div className="text-[9.5px] text-[#64748B] font-mono mt-1.5 pt-1.5 border-t border-[#DBEAFE] leading-relaxed">
                          Unified civic intelligence authority consolidating live sensor feeds, citizen incident reports, and squad dispatches across all metropolitan zones.
                        </div>
                      </div>
                    </div>

                    <div className="mt-2.5 pt-2 border-t border-[#F1F5F9] px-1 flex items-center justify-between text-[9px] font-mono text-[#64748B]">
                      <span>Operational Scope:</span>
                      <span className="font-bold text-[#2563EB]">National Unified Network</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="h-5 w-px bg-[#E2E8F0] hidden sm:block"></div>

              {/* Notification icon */}
              <button
                onClick={() => {
                  const unread = notifications.filter(n => !n.read);
                  if (unread.length > 0) handleMarkNotificationsRead();
                }}
                className="relative p-2 rounded-xl text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] border border-transparent hover:border-[#E2E8F0] transition-colors cursor-pointer"
                title="System Notifications"
              >
                <Bell className="w-4 h-4" />
                {notifications.filter(n => !n.read).length > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#DC2626] ring-2 ring-white"></span>
                )}
              </button>

              <div className="h-5 w-px bg-[#E2E8F0] hidden sm:block"></div>

              {/* Administrator Avatar & Profile Chip with Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setShowUserDropdown(prev => !prev)}
                  className="flex items-center gap-2.5 p-1 sm:px-2 rounded-xl hover:bg-[#F8FAFC] border border-transparent hover:border-[#E2E8F0] transition-all cursor-pointer group"
                >
                  <div className={`w-8 h-8 rounded-xl ${
                    currentUser.role === "admin" 
                      ? "bg-gradient-to-tr from-[#6366F1] to-[#7C3AED]" 
                      : currentUser.role === "municipal" 
                      ? "bg-[#F59E0B]" 
                      : currentUser.role === "field_team" 
                      ? "bg-[#16A34A]" 
                      : "bg-[#2563EB]"
                  } text-white flex items-center justify-center font-bold text-xs shadow-xs shrink-0 select-none uppercase`}>
                    {currentUser.fullName.split(" ").map(w => w[0]).join("").substring(0, 2)}
                  </div>
                  <div className="text-left hidden md:block">
                    <div className="text-xs font-bold text-[#0F172A] group-hover:text-[#2563EB] transition-colors leading-tight">
                      {currentUser.fullName}
                    </div>
                    <div className="text-[9.5px] font-mono font-bold text-[#6D28D9] tracking-wider uppercase">
                      {currentUser.role === "admin" ? "SUPER ADMIN" : currentUser.role.toUpperCase()}
                    </div>
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-[#94A3B8] group-hover:text-[#0F172A] transition-colors hidden md:block" />
                </button>

                {/* User Dropdown */}
                {showUserDropdown && (
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-[#E2E8F0] p-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                    <div className="px-3 py-2 border-b border-[#F1F5F9]">
                      <p className="text-xs font-bold text-[#0F172A] truncate">{currentUser.fullName}</p>
                      <p className="text-[11px] text-[#64748B] font-mono truncate">{currentUser.email}</p>
                      <span className="inline-block mt-1 px-2 py-0.5 bg-[#F5F3FF] text-[#6D28D9] text-[9.5px] font-mono font-bold rounded border border-[#DDD6FE]">
                        {currentUser.role === "admin" ? "SUPER ADMIN CLEARANCE" : currentUser.role.toUpperCase()}
                      </span>
                    </div>

                    <div className="py-1">
                      {currentUser.role === "admin" && (
                        <>
                          <button
                            onClick={() => {
                              setActiveSubTab("admin-panel");
                              setShowUserDropdown(false);
                            }}
                            className="w-full text-left px-3 py-2 text-xs font-semibold text-[#334155] hover:bg-[#F8FAFC] hover:text-[#2563EB] rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                          >
                            <Shield className="w-3.5 h-3.5 text-[#2563EB]" />
                            <span>Admin Console</span>
                          </button>
                          <button
                            onClick={() => {
                              setActiveSubTab("admin-users");
                              setShowUserDropdown(false);
                            }}
                            className="w-full text-left px-3 py-2 text-xs font-semibold text-[#334155] hover:bg-[#F8FAFC] hover:text-[#2563EB] rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                          >
                            <Users className="w-3.5 h-3.5 text-[#64748B]" />
                            <span>User Management</span>
                          </button>
                        </>
                      )}
                      {currentUser.role === "municipal" && (
                        <>
                          <button
                            onClick={() => {
                              setActiveSubTab("municipal-home");
                              setShowUserDropdown(false);
                            }}
                            className="w-full text-left px-3 py-2 text-xs font-semibold text-[#334155] hover:bg-[#F8FAFC] hover:text-[#2563EB] rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                          >
                            <LayoutDashboard className="w-3.5 h-3.5 text-[#2563EB]" />
                            <span>City Overview</span>
                          </button>
                          <button
                            onClick={() => {
                              setActiveSubTab("dispatch-management");
                              setShowUserDropdown(false);
                            }}
                            className="w-full text-left px-3 py-2 text-xs font-semibold text-[#334155] hover:bg-[#F8FAFC] hover:text-[#2563EB] rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                          >
                            <Radio className="w-3.5 h-3.5 text-[#2563EB]" />
                            <span>Dispatch Management</span>
                          </button>
                          <button
                            onClick={() => {
                              setActiveSubTab("command-center");
                              setShowUserDropdown(false);
                            }}
                            className="w-full text-left px-3 py-2 text-xs font-semibold text-[#334155] hover:bg-[#F8FAFC] hover:text-[#2563EB] rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                          >
                            <ShieldAlert className="w-3.5 h-3.5 text-[#F59E0B]" />
                            <span>Command Center</span>
                          </button>
                        </>
                      )}
                      {currentUser.role === "field_team" && (
                        <>
                          <button
                            onClick={() => {
                              setActiveSubTab("field-operations");
                              setShowUserDropdown(false);
                            }}
                            className="w-full text-left px-3 py-2 text-xs font-semibold text-[#334155] hover:bg-[#F8FAFC] hover:text-[#2563EB] rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                          >
                            <Wrench className="w-3.5 h-3.5 text-[#16A34A]" />
                            <span>Field Operations Deck</span>
                          </button>
                          <button
                            onClick={() => {
                              setActiveSubTab("copilot");
                              setShowUserDropdown(false);
                            }}
                            className="w-full text-left px-3 py-2 text-xs font-semibold text-[#334155] hover:bg-[#F8FAFC] hover:text-[#2563EB] rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-[#6366F1]" />
                            <span>Field Copilot AI</span>
                          </button>
                        </>
                      )}
                      {currentUser.role === "citizen" && (
                        <>
                          <button
                            onClick={() => {
                              setActiveSubTab("citizen-home");
                              setShowUserDropdown(false);
                            }}
                            className="w-full text-left px-3 py-2 text-xs font-semibold text-[#334155] hover:bg-[#F8FAFC] hover:text-[#2563EB] rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                          >
                            <LayoutDashboard className="w-3.5 h-3.5 text-[#2563EB]" />
                            <span>Citizen Overview</span>
                          </button>
                          <button
                            onClick={() => {
                              setActiveSubTab("my-reports");
                              setShowUserDropdown(false);
                            }}
                            className="w-full text-left px-3 py-2 text-xs font-semibold text-[#334155] hover:bg-[#F8FAFC] hover:text-[#2563EB] rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5 text-[#64748B]" />
                            <span>My Reports</span>
                          </button>
                        </>
                      )}
                    </div>

                    <div className="pt-1 border-t border-[#F1F5F9]">
                      <button
                        onClick={() => {
                          setShowUserDropdown(false);
                          handleLogout();
                        }}
                        className="w-full text-left px-3 py-2 text-xs font-semibold text-[#DC2626] hover:bg-[#FEF2F2] rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* Workspace Area */}
          <main className="flex-1 p-4 sm:p-6 lg:p-7 flex flex-col gap-6">
            <div className="bg-white border border-[#E2E8F0] p-5 rounded-2xl shadow-xs flex flex-col xl:flex-row xl:items-center justify-between gap-5 text-left transition-colors">
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${
                    activeSubTab !== "infrastructure"
                      ? "bg-[#2563EB] animate-pulse"
                      : activeTerminal === 'split' ? 'bg-[#7C3AED]' : activeTerminal === 'admin' ? 'bg-[#F59E0B]' : 'bg-[#2563EB]'
                  }`}></span>
                  <h1 className="text-xl font-sans font-extrabold text-[#172033] tracking-tight flex items-center gap-2 flex-wrap">
                    <span>
                      {activeSubTab === "citizen-home" && "Citizen Safety Dashboard"}
                      {activeSubTab === "my-reports" && "My Submitted Reports"}
                      {activeSubTab === "municipal-home" && "Municipal Command Overview"}
                      {activeSubTab === "dispatch-management" && "Municipal Dispatch & Work Order Control"}
                      {activeSubTab === "command-center" && "AI City Command & Control Center"}
                      {activeSubTab === "analytics" && "Executive City Analytics Dashboard"}
                      {activeSubTab === "digital-twin" && "Smart City Digital Twin Hologram"}
                      {activeSubTab === "admin-panel" && "Administration & Platform Governance"}
                      {activeSubTab === "admin-users" && "User Governance & Access Clearances"}
                      {activeSubTab === "admin-teams" && "Field Squad & Team Management"}
                      {activeSubTab === "admin-system" && "Platform System Health & Runtime Metrics"}
                      {activeSubTab === "admin-audit" && "Platform Audit Trail & Security Ledger"}
                      {activeSubTab === "admin-settings" && "Platform Settings & Governance Policies"}
                      {activeSubTab === "audit-logs" && "Platform Audit Log Ledger"}
                      {activeSubTab === "infrastructure" && (
                        activeTerminal === "citizen" ? "Citizen Volunteer Dashboard" :
                        activeTerminal === "admin" ? "Municipal Commander Terminal" : ""
                      )}
                      {activeSubTab === "copilot" && "AI Guardian Command Advisor"}
                      {activeSubTab === "safety" && "Urban Heatmap Grid & AI Risk Diagnostics"}
                      {activeSubTab === "traffic" && "Smart Traffic Control Center"}
                      {activeSubTab === "environmental" && "Clean Air Control Centre"}
                      {activeSubTab === "emergency" && "Emergency Services Control Center"}
                      {activeSubTab === "field-operations" && "Field Operations & Maintenance Deck"}
                    </span>
                    <span className="text-xs bg-[#EFF6FF] text-[#2563EB] px-2.5 py-0.5 rounded-full font-bold border border-[#DBEAFE] font-mono">
                      Civic Network Active
                    </span>
                  </h1>
                </div>
                <p className="text-[12px] text-[#64748B] mt-1.5 max-w-3xl leading-relaxed font-sans">
                  {activeSubTab === "citizen-home" && `Welcome to your UrbanPulse safety and reporting dashboard for municipal operations.`}
                  {activeSubTab === "my-reports" && `Track the real-time remediation status, dispatch assignments, and resolution notes for your submitted issues.`}
                  {activeSubTab === "municipal-home" && `High-level command overview for UrbanPulse municipal operations across active metropolitan domains.`}
                  {activeSubTab === "dispatch-management" && `Coordinate field squad assignments, set SLA response windows, inspect resolution evidence, and approve work orders.`}
                  {activeSubTab === "admin-panel" && `Enterprise administration console for user provisioning, team management, role authorizations, and platform telemetry.`}
                  {activeSubTab === "admin-users" && `Manage registered users, inspect identity credentials, and grant role-based security clearances.`}
                  {activeSubTab === "admin-teams" && `Manage municipal field response teams, squad leads, assigned operational zones, and active statuses.`}
                  {activeSubTab === "admin-system" && `Monitor real-time system performance, Gemini inference status, cache metrics, and server runtime health.`}
                  {activeSubTab === "admin-audit" && `Cryptographically immutable audit log tracking all administrative, dispatch, and field operational events.`}
                  {activeSubTab === "admin-settings" && `Configure platform parameters, dispatch SLA limits, GPS verification thresholds, and global security policies.`}
                  {activeSubTab === "audit-logs" && `Cryptographically immutable audit log tracking all administrative, dispatch, and field operational events.`}
                  {activeSubTab === "field-operations" && `Mobile field operations deck for utility & road maintenance squads. Manage assigned incidents, execute GPS site verification, capture repair evidence, and submit resolutions.`}
                  {activeSubTab === "command-center" && `Sovereign intelligence workspace providing overarching metrics of active complaints, city operational safety ratings, and direct dispatcher planning tools across the municipal grid.`}
                  {activeSubTab === "analytics" && `Advanced telemetry logs tracking issue growth percentages, department performance indices, and specific ward standings across metropolitan sectors.`}
                  {activeSubTab === "digital-twin" && `Interactive 5-Layer vector city hologram displaying real-time infrastructure, traffic speed, safety, AQI smog, and composite risk parameters mapped live.`}
                  {activeSubTab === "infrastructure" && (
                    activeTerminal === "citizen" ? `Take photos, input hazard parameters, and witness instant AI categorization mapped across active metropolitan sectors.` :
                    activeTerminal === "admin" ? `Filter municipal reports down to wards, examine high confidence diagnostic scores, and assign utility dispatch fleets.` :
                    ""
                  )}
                  {activeSubTab === "copilot" && `Chat live with UrbanPulse's real-time AI co-pilot. Obtain diagnostics, ask questions about regional hazards, or request simulated response priorities.`}
                  {activeSubTab === "safety" && `GIS mapping system with localized micro-overlays, assessing probabilities of structural faults, dark streets, and water retention across municipal domains.`}
                  {activeSubTab === "traffic" && `Volume telemetry capturing traffic flow speeds, road obstructions, and proposing lane adjustments and dynamic speed controls.`}
                  {activeSubTab === "environmental" && `Monitoring atmospherics and smog indicators, with real-time AQI feedback and particulate density tracking across sectors.`}
                  {activeSubTab === "emergency" && `Continuous transit routing, determining hazard bypass coordinates and dispatcher assignment priorities for hospital responder lanes.`}
                </p>

                {/* TRUST & TRANSPARENCY DECK (AI parameters, data sources, last updated) */}
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 pt-2 text-[10px] font-mono font-medium text-[#64748B] border-t border-[#F1F5F9] items-center">
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
                    <span>AI Engine: <strong className="text-[#172033]">Gemini 3.5-Flash Verified</strong> (98.4% Confidence Threshold)</span>
                  </div>
                  <span className="text-[#CBD5E1]">|</span>
                  <div>
                    <span>Data Streams: <strong className="text-[#172033]">GPS Lock, Municipal GIS & Citizen Mesh</strong></span>
                  </div>
                  <span className="text-[#CBD5E1]">|</span>
                  <div>
                    <span>Telemetry Sync: <strong className="text-[#2563EB] font-bold">Consolidated</strong></span>
                  </div>
                </div>
              </div>

              {/* Controls and Selectors panel */}
              <div className="flex flex-row xl:flex-col items-end gap-2.5 shrink-0 self-start sm:self-auto flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold p-1 px-2.5 bg-[#EFF6FF] border border-[#BFDBFE] text-[#1E40AF] rounded-lg shrink-0 select-none uppercase tracking-wide">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A] animate-pulse"></span>
                    <span>Unified Network Active</span>
                  </div>

                  <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold p-1 px-2.5 bg-[#F8FAFC] border border-[#E2E8F0] text-[#475569] rounded-lg shrink-0 select-none uppercase tracking-wide">
                    <span>Deck:</span>
                    <span className="text-[#2563EB] font-bold">
                      {activeSubTab === "infrastructure" ? `${activeTerminal} suite` : activeSubTab}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* ROAD SCANNER DASHCAM & VISION ANALYSIS */}
            
            {activeSubTab === "citizen-home" && (
              <CitizenHome 
                onNavigate={setActiveSubTab}
                reportsCount={reports.filter(r => r.reporterEmail === currentUser.email).length}
                userName={currentUser.fullName}
              />
            )}
            {activeSubTab === "municipal-home" && (
              <MunicipalHome
                onNavigate={setActiveSubTab}
                activeCriticalCount={reports.filter(r => r.severity >= 80 && (r.status === "Pending" || r.status === "Assigned")).length}
                pendingCount={reports.filter(r => r.status === "Pending").length}
                cityName={selectedCityName}
              />
            )}

            {activeSubTab === "road-scanner" && (
              <div className="w-full">
                <RoadScanner
                  currentUserEmail={currentUser.email}
                  onIncidentAutoReported={(newRep) => {
                    setReports((prev) => [newRep, ...prev]);
                  }}
                  onCandidatesReady={(session) => {
                    setActiveScanSession(session);
                    setActiveSubTab("candidate-review");
                  }}
                  onSwitchToManual={() => {
                    setActiveSubTab("infrastructure");
                  }}
                />
              </div>
            )}

            {/* ROAD SCANNER CANDIDATE REVIEW & BATCH SUBMIT */}
            {activeSubTab === "candidate-review" && activeScanSession && (
              <div className="w-full">
                <RoadAiCandidateReview
                  session={activeScanSession}
                  currentUserEmail={currentUser.email}
                  onReportsSubmitted={(submittedReports, awardedPoints) => {
                    setReports((prev) => [...submittedReports, ...prev]);
                    setUserCivicPoints((pts) => pts + awardedPoints);
                    setActiveScanSession(null);
                    syncOperationalDatasets(currentUser.email, currentUser.role);
                    setActiveSubTab("my-reports");
                  }}
                  onDiscardSession={() => {
                    setActiveScanSession(null);
                    setActiveSubTab("road-scanner");
                  }}
                />
              </div>
            )}

            {/* SAFE ROUTE & HAZARD-AWARE NAVIGATION */}
            {activeSubTab === "safe-route" && (
              <div className="w-full">
                <SafeRouteNav
                  reports={reports}
                />
              </div>
            )}

            {/* CIVIC REWARDS & VOUCHERS PORTAL */}
            {activeSubTab === "rewards" && (
              <div className="w-full">
                <RewardsPortal
                  currentUser={currentUser}
                  userPoints={userCivicPoints}
                />
              </div>
            )}

            {/* CITIZEN EMERGENCY SOS BEACON */}
            {activeSubTab === "emergency-sos" && (
              <div className="w-full">
                <CitizenEmergencySOS
                  currentUser={currentUser}
                />
              </div>
            )}

            {/* CITIZEN MY REPORTS WORKSPACE */}
            {activeSubTab === "my-reports" && (
              <RoleGuard allowedRoles={["citizen"]}>
                <div className="w-full">
                  <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 shadow-xs text-left">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-[#E2E8F0] gap-3 mb-6">
                      <div>
                        <h2 className="text-lg font-bold text-[#172033] font-sans">My Submitted Reports</h2>
                        <p className="text-xs text-[#64748B] mt-0.5">Track real-time status and remediation progress for all civic hazards you have logged.</p>
                      </div>
                      <span className="text-xs font-bold font-mono px-3 py-1.5 bg-[#EFF6FF] text-[#2563EB] border border-[#DBEAFE] rounded-full self-start sm:self-auto">
                        {reports.filter(r => r.reporterEmail === currentUser.email).length} Total Submissions
                      </span>
                    </div>

                    {reports.filter(r => r.reporterEmail === currentUser.email).length === 0 ? (
                      <div className="p-12 text-center border-2 border-dashed border-[#E2E8F0] rounded-2xl">
                        <div className="w-12 h-12 rounded-2xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center mx-auto mb-3">
                          <FileText className="w-6 h-6" />
                        </div>
                        <h3 className="text-sm font-bold text-[#172033] mb-1">No reports lodged yet</h3>
                        <p className="text-xs text-[#64748B] mb-4 max-w-sm mx-auto">You have not submitted any infrastructure incidents. Use the Report Issue desk or AI Road Scanner to file hazards.</p>
                        <button
                          onClick={() => setActiveSubTab("infrastructure")}
                          className="px-4 py-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer"
                        >
                          Report a Problem
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {reports.filter(r => r.reporterEmail === currentUser.email).map((rep) => (
                          <div
                            key={rep.id}
                            onClick={() => setSelectedReport(rep)}
                            className="bg-[#F8FAFC] hover:bg-white border border-[#E2E8F0] hover:border-[#2563EB] p-4.5 rounded-2xl transition-all cursor-pointer shadow-3xs hover:shadow-xs flex flex-col justify-between gap-3 group"
                          >
                            <div>
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                                  rep.status === "Resolved" ? "bg-[#F0FDF4] text-[#16A34A] border-[#DCFCE7]" :
                                  rep.status === "In Progress" ? "bg-[#EFF6FF] text-[#2563EB] border-[#DBEAFE]" :
                                  "bg-[#FFFBEB] text-[#D97706] border-[#FEF3C7]"
                                }`}>
                                  ● {rep.status}
                                </span>
                                <span className="text-[10px] font-mono text-[#94A3B8]">
                                  {getRelativeTime(rep.createdAt)}
                                </span>
                              </div>
                              <h4 className="text-xs font-bold text-[#172033] group-hover:text-[#2563EB] transition-colors line-clamp-1">
                                {rep.title}
                              </h4>
                              <p className="text-[11px] text-[#64748B] mt-1 line-clamp-2 leading-relaxed">
                                {rep.description}
                              </p>
                            </div>
                            <div className="pt-2.5 border-t border-[#E2E8F0] flex items-center justify-between text-[10.5px] text-[#64748B]">
                              <span className="truncate max-w-[150px] font-medium">{rep.location}</span>
                              <span className="font-bold text-[#2563EB] flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                                Details →
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </RoleGuard>
            )}

            {/* CENTRAL ADMINISTRATIVE CONSOLE & GOVERNANCE SUITE */}
            {(["admin-panel", "admin-users", "admin-teams", "admin-system", "admin-audit", "admin-settings", "audit-logs"].includes(activeSubTab)) && (
              <RoleGuard allowedRoles={["admin"]}>
                <div className="w-full">
                  <AdminPanel
                    currentUserEmail={currentUser.email}
                    currentUserName={currentUser.fullName}
                    initialTab={
                      activeSubTab === "admin-users" ? "users" :
                      activeSubTab === "admin-teams" ? "teams" :
                      activeSubTab === "admin-system" ? "system" :
                      (activeSubTab === "admin-audit" || activeSubTab === "audit-logs") ? "audit" :
                      activeSubTab === "admin-settings" ? "settings" :
                      "overview"
                    }
                    onTabChange={(newTab) => {
                      if (newTab === "users") setActiveSubTab("admin-users");
                      else if (newTab === "teams") setActiveSubTab("admin-teams");
                      else if (newTab === "system") setActiveSubTab("admin-system");
                      else if (newTab === "audit") setActiveSubTab("admin-audit");
                      else if (newTab === "settings") setActiveSubTab("admin-settings");
                      else setActiveSubTab("admin-panel");
                    }}
                    onUserUpdated={() => syncOperationalDatasets(currentUser.email, currentUser.role)}
                  />
                </div>
              </RoleGuard>
            )}

            {/* MUNICIPAL DISPATCH MANAGEMENT (MUNICIPAL FLEET & SLA CONTROL) */}
            {activeSubTab === "dispatch-management" && (
              <RoleGuard 
                allowedRoles={["municipal", "admin"]}
                fallback={
                  <div className="min-h-[420px] w-full flex flex-col items-center justify-center p-8 bg-red-50/70 border border-red-200 rounded-3xl text-center max-w-xl mx-auto my-8 shadow-xs">
                    <div className="w-16 h-16 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mb-4 shadow-2xs border border-red-200/60">
                      <ShieldAlert className="w-8 h-8" />
                    </div>
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-100/90 text-red-800 text-[11px] font-mono font-bold tracking-wider uppercase mb-2.5">
                      403 Forbidden • Access Denied
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 mb-2 font-sans">
                      Municipal Dispatch Control Restricted
                    </h3>
                    <p className="text-xs text-slate-600 max-w-md mb-6 leading-relaxed">
                      Dispatch management is reserved for municipal command officers. Citizens and field squad operatives do not possess fleet dispatch permissions.
                    </p>
                    <button
                      onClick={() => setActiveSubTab(currentUser.role === "field_team" ? "field-operations" : "citizen-home")}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all shadow-2xs cursor-pointer flex items-center gap-2"
                    >
                      <Shield className="w-4 h-4" />
                      <span>Return to Authorized Dashboard</span>
                    </button>
                  </div>
                }
              >
                <div className="w-full">
                  <DispatchManagement
                    reports={reports}
                    currentUserName={currentUser.fullName}
                    currentUserEmail={currentUser.email}
                    onSelectReport={(rep) => setSelectedReport(rep)}
                    onRefreshReports={() => syncOperationalDatasets(currentUser.email, currentUser.role)}
                  />
                </div>
              </RoleGuard>
            )}

            {/* FIELD OPERATIONS & REPAIR DECK (STRICTLY FOR FIELD SQUADS ONLY) */}
            {activeSubTab === "field-operations" && (
              <RoleGuard 
                allowedRoles={["field_team"]}
                fallback={
                  <div className="min-h-[420px] w-full flex flex-col items-center justify-center p-8 bg-red-50/70 border border-red-200 rounded-3xl text-center max-w-xl mx-auto my-8 shadow-xs">
                    <div className="w-16 h-16 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mb-4 shadow-2xs border border-red-200/60">
                      <ShieldAlert className="w-8 h-8" />
                    </div>
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-100/90 text-red-800 text-[11px] font-mono font-bold tracking-wider uppercase mb-2.5">
                      403 Forbidden • Access Denied
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 mb-2 font-sans">
                      Field Execution Workspace Restricted
                    </h3>
                    <p className="text-xs text-slate-600 max-w-md mb-6 leading-relaxed">
                      The <strong>Field Operations Deck</strong> is reserved exclusively for on-site field maintenance squads. Municipal officers should use <strong>Dispatch Management</strong> for fleet dispatch and work order sign-off.
                    </p>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setActiveSubTab(currentUser.role === "admin" ? "admin-panel" : currentUser.role === "municipal" ? "dispatch-management" : "citizen-home")}
                        className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all shadow-2xs cursor-pointer flex items-center gap-2"
                      >
                        <Shield className="w-4 h-4" />
                        <span>Return to Authorized Dashboard</span>
                      </button>
                    </div>
                  </div>
                }
              >
                <div className="w-full">
                  <FieldTeamDashboard
                    reports={reports}
                    currentUserEmail={currentUser.email}
                    currentUserName={currentUser.fullName}
                    currentUserRole={currentUser.role}
                    teamId={userProfile?.teamId || "RT-014"}
                    teamName={userProfile?.teamName || "Road Maintenance Team Alpha"}
                    teamLead={userProfile?.teamLead || currentUser.fullName}
                    onRefreshReports={() => syncOperationalDatasets(currentUser.email, currentUser.role)}
                  />
                </div>
              </RoleGuard>
            )}

            {/* DYNAMIC SUBTABS RENDER NODES */}
            {activeSubTab === "command-center" && (
              <RoleGuard allowedRoles={["municipal", "admin"]}>
                <div className="space-y-6 flex flex-col">
                  <CityCommandCenter 
                    reports={reports}
                    onSelectReport={(rep) => setSelectedReport(rep)}
                    onSelectSubTab={(tab) => {
                      setActiveSubTab(tab as any);
                    }}
                  />
                  
                  {/* SOVEREIGN SMART CITY PROFILES & REPORT GENERATOR MODULE */}
                  <div className="space-y-6">
                    <AreaProfilePages 
                      reports={reports} 
                      selectedCityName={selectedCityName} 
                    />
                    
                    <CityHealthReport 
                      reports={reports} 
                      selectedCityName={selectedCityName} 
                    />
                  </div>
                </div>
              </RoleGuard>
            )}

            {activeSubTab === "analytics" && (
              <RoleGuard allowedRoles={["municipal", "admin"]}>
                <ExecutiveAnalytics 
                  reports={reports}
                />
              </RoleGuard>
            )}

            {activeSubTab === "digital-twin" && (
              <RoleGuard allowedRoles={["municipal", "admin"]}>
                <SmartCityDigitalTwin 
                  reports={reports}
                />
              </RoleGuard>
            )}

            {activeSubTab === "copilot" && (
              currentUser.role === "admin" || currentUser.role === "municipal" ? (
                <RoleGuard allowedRoles={["municipal", "admin"]}>
                  <MunicipalCopilot 
                    currentUserName={currentUser.fullName}
                    currentUserEmail={currentUser.email}
                    currentUserRole={currentUser.role}
                    reports={reports}
                    onNavigateToCommandCenter={() => setActiveSubTab("command-center")}
                  />
                </RoleGuard>
              ) : (
                <CitizenCopilot 
                  currentUserName={currentUser.fullName}
                  currentUserEmail={currentUser.email}
                  userReports={reports.filter(r => r.reporterEmail === currentUser.email || r.userId === (currentUser as any).uid || r.userId === currentUser.id)}
                  allReports={reports}
                />
              )
            )}

            {activeSubTab === "safety" && (
              <FutureModules 
                forcedTab="predictive" 
                reports={reports} 
                onReportUpdated={() => syncOperationalDatasets(currentUser!.email, currentUser!.role)}
              />
            )}

            {activeSubTab === "traffic" && (
              <FutureModules 
                forcedTab="traffic" 
                reports={reports} 
                onReportUpdated={() => syncOperationalDatasets(currentUser!.email, currentUser!.role)}
              />
            )}

            {activeSubTab === "environmental" && (
              <FutureModules 
                forcedTab="environmental" 
                reports={reports} 
                onReportUpdated={() => syncOperationalDatasets(currentUser!.email, currentUser!.role)}
              />
            )}

            {activeSubTab === "emergency" && (
              <FutureModules 
                forcedTab="emergency" 
                reports={reports} 
                onReportUpdated={() => syncOperationalDatasets(currentUser!.email, currentUser!.role)}
              />
            )}

            {/* DEFAULT CORE WORKSPACE PANELS */}
            {activeSubTab === "infrastructure" && (
              <div className="flex flex-col gap-6 w-full">
                <AIInsightsPanel reports={reports} />
                {activeTerminal === "split" ? (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start h-full">
                
                {/* SPLIT COLUMN 1: Citizen Volunteer Simulator Console */}
                <div className="flex flex-col gap-5 border border-dashed border-slate-300 bg-slate-50 p-4.5 rounded-2xl relative">
                  <div className="absolute top-2.5 right-3.5 flex items-center gap-1.5 text-[9px] font-bold text-blue-500 uppercase">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-ping"></span>
                    <span>CITIZEN CORRIDOR CHANNEL</span>
                  </div>
                  
                  <div className="border-b border-slate-200 pb-2 mb-1">
                    <h2 className="font-display font-bold text-sm tracking-tight text-slate-800">1. Citizen Volunteer View</h2>
                    <p className="text-[10px] text-slate-400 mt-0.5">Front-end components designed strictly for public reporting and self-made logs.</p>
                  </div>

                  <CitizenUpload
                    onReportCreated={(newRep) => {
                      setReports(prev => [newRep, ...prev]);
                      setSelectedReport(newRep);
                      syncOperationalDatasets(currentUser.email, currentUser.role);
                    }}
                    onViewReportDetails={(rep) => setSelectedReport(rep)}
                    currentUserEmail={currentUser.email}
                  />

                  {/* Citizen Map specifically styled */}
                  <div className="bg-white p-4.5 border border-slate-200 shadow-3xs rounded-xl flex flex-col gap-3">
                    <div>
                      <h4 className="font-display font-bold text-xs text-slate-800">Visual Wards overlay</h4>
                      <p className="text-[10px] text-slate-400">Delhi NCR volunteer submission tracking.</p>
                    </div>
                    <div className="h-[260px] rounded-lg overflow-hidden border border-slate-200">
                      <SimpleMap
                        reports={reports}
                        selectedReport={selectedReport}
                        onSelectReport={(rep) => setSelectedReport(rep)}
                      />
                    </div>
                  </div>

                  {/* Citizen submitted table */}
                  <div className="bg-white p-4.5 border border-slate-200 shadow-3xs rounded-xl">
                    <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-100">
                      <h4 className="font-display font-bold text-xs text-slate-800">Self Reported Submissions</h4>
                      <span className="text-[9px] font-bold bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">
                        Total: {reports.filter(r => r.reporterEmail === currentUser.email).length}
                      </span>
                    </div>

                    <div className="flex flex-col gap-2 max-h-[160px] overflow-y-auto pr-1">
                      {reports.filter(r => r.reporterEmail === currentUser.email).length === 0 ? (
                        <div className="p-6 text-center text-slate-400 border border-dashed border-slate-150 rounded-lg text-[10.5px]">
                          No self-reported cases lodged.
                        </div>
                      ) : (
                        reports.filter(r => r.reporterEmail === currentUser.email).map((rep) => (
                          <div
                            key={rep.id}
                            onClick={() => setSelectedReport(rep)}
                            className="p-2.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200 rounded-lg flex items-center justify-between gap-3 cursor-pointer transition-all"
                          >
                            <div className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${
                                rep.severity >= 75 ? "bg-red-500 animate-pulse" : rep.severity >= 45 ? "bg-amber-400" : "bg-emerald-400"
                              }`}></span>
                              <div>
                                <h5 className="font-bold text-[11px] text-slate-800 line-clamp-1">{rep.title}</h5>
                                <p className="text-[9px] text-slate-400 mt-0.5 truncate">{rep.category} • {rep.location}</p>
                              </div>
                            </div>
                            <span className="text-[9px] font-bold text-slate-600 bg-slate-150 px-1.5 py-0.5 rounded-full">{rep.status}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                </div>

                {/* SPLIT COLUMN 2: Municipal Commander Command Center */}
                <div className="flex flex-col gap-5 border border-dashed border-slate-300 bg-slate-50 p-4.5 rounded-2xl relative">
                  <div className="absolute top-2.5 right-3.5 flex items-center gap-1.5 text-[9px] font-bold text-amber-500 uppercase">
                    <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-ping"></span>
                    <span>MUNICIPAL COMMAND CHANNEL</span>
                  </div>

                  <div className="border-b border-slate-200 pb-2 mb-1">
                    <h2 className="font-display font-bold text-sm tracking-tight text-slate-800">2. Municipal Administration View</h2>
                    <p className="text-[10px] text-slate-400 mt-0.5">High-impact dashboard widgets useful for fleet managers and safety officers.</p>
                  </div>

                  {/* Miniature stats specifically designed to fit nicely */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-3xs">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Admin Registry Count</span>
                      <span className="text-xl font-display font-bold text-slate-800 mt-1 block">{reports.length}</span>
                    </div>
                    <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-3xs">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Crisis Risks Level</span>
                      <span className="text-xl font-display font-bold text-red-600 mt-1 block">
                        {reports.filter(r => r.severity >= 75 && r.status !== 'Resolved').length} Active
                      </span>
                    </div>
                  </div>

                  {/* Dispatch Incident database */}
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-3xs">
                    <div className="mb-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-2 border-b border-slate-100">
                      <div>
                        <h4 className="font-display font-bold text-xs text-slate-800">Operational Dispatch Queue</h4>
                        <p className="text-[9px] text-slate-400 mt-0.5">Select and assign workers immediately.</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            const titleRow = "Ticket ID,Title,Ward,Category,Severity,Risk Precedence,Lifecycle Status,Created At\n";
                            const dataRow = filteredReports.map((r) => 
                              `"${r.id}","${r.title}","${r.location}","${r.category}",${r.severity},"${r.riskLevel || 'Medium'}","${r.status}","${r.createdAt}"`
                            ).join("\n");
                            const blob = new Blob([titleRow + dataRow], { type: "text/csv;charset=utf-8;" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `UrbanPulse_Filtered_Export_${new Date().toISOString().slice(0,10)}.csv`;
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                          className="text-[9px] bg-slate-800 hover:bg-slate-700 text-white font-bold py-1 px-2 rounded flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <FileText className="w-2.5 h-2.5" />
                          CSV
                        </button>
                        {/* Mini Category Filter dropdown */}
                        <select
                          id="split-category-select"
                          value={categoryFilter}
                          onChange={(e) => setCategoryFilter(e.target.value)}
                          className="bg-slate-50 border border-slate-150 rounded px-1.5 py-1 text-[10px] focus:outline-hidden text-slate-700"
                        >
                        <option value="All">All Categories</option>
                        <option value="Pothole">Potholes</option>
                        <option value="Garbage Overflow">Garbage Overflow</option>
                        <option value="Broken Streetlight">Broken Power-grid</option>
                      </select>
                      </div>
                    </div>

                    {/* Compact Registry Table */}
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-left border-collapse text-[10.5px]">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold font-sans">
                            <th className="p-2">ID</th>
                            <th className="p-2">Incident Title</th>
                            <th className="p-2">Ward Location</th>
                            <th className="p-2">Status</th>
                            <th className="p-2 text-right">Dispatch</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-medium">
                          {filteredReports.slice(0, 5).map((rep) => (
                            <tr
                              key={rep.id}
                              onClick={() => setSelectedReport(rep)}
                              className="hover:bg-slate-50 cursor-pointer"
                            >
                              <td className="p-2 font-mono text-[9px] font-bold text-slate-500">{rep.id}</td>
                              <td className="p-2 font-bold text-slate-850">
                                <div className="line-clamp-1">{rep.title}</div>
                                <div className="mt-0.5">
                                  {rep.source === "ROAD_SCANNER" ? (
                                    <span className="text-[7.5px] font-bold bg-purple-100 text-purple-800 px-1 py-0.2 rounded inline-flex items-center gap-0.5">
                                      <Camera className="w-2 h-2 text-purple-700" />
                                      AI Scanner
                                    </span>
                                  ) : (
                                    <span className="text-[7.5px] font-bold bg-blue-50 text-blue-700 px-1 py-0.2 rounded inline-flex items-center gap-0.5">
                                      <FileText className="w-2 h-2 text-blue-600" />
                                      Citizen
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="p-2 text-slate-400 truncate max-w-[100px]">{rep.location}</td>
                              <td className="p-2 text-center">
                                <span className="text-[8px] font-extrabold px-1.5 py-0.2 rounded-full border bg-slate-100 text-slate-600">
                                  {rep.status}
                                </span>
                              </td>
                              <td className="p-2 text-right" onClick={(e) => e.stopPropagation()}>
                                <button
                                  id={`split-inspect-${rep.id}`}
                                  onClick={() => setSelectedReport(rep)}
                                  className="p-1 px-1.5 rounded bg-blue-50 text-blue-600 font-bold hover:bg-blue-100 transition-colors text-[9px]"
                                >
                                  Inspect
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <p className="text-[9px] text-slate-400 mt-2 text-center italic">
                      Showing latest filtered incidents. Select any Row to trigger dispatch rule comments.
                    </p>
                  </div>

                  {/* Comprehensive Dispatch map */}
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-3xs flex flex-col gap-2">
                    <div>
                      <h4 className="font-display font-medium text-xs text-slate-800">Dispatch GIS Heatmap Network</h4>
                      <p className="text-[9px] text-slate-400">Centers automatically on selected markers.</p>
                    </div>
                    <div className="h-[250px] rounded-lg overflow-hidden border border-slate-200">
                      <SimpleMap
                        reports={reports}
                        selectedReport={selectedReport}
                        onSelectReport={(rep) => setSelectedReport(rep)}
                      />
                    </div>
                  </div>

                </div>

              </div>
            ) : activeTerminal === "citizen" ? (
              
              /* SINGLE VIEW WORKSPACE: Citizen Volunteer Dashboard */
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                
                {/* Left Column: Citizen upload forms and samples (Span 5) */}
                <div className="lg:col-span-5 flex flex-col gap-6">
                  <CitizenUpload
                    onReportCreated={(newRep) => {
                      setReports(prev => [newRep, ...prev]);
                      setSelectedReport(newRep);
                      syncOperationalDatasets(currentUser.email, currentUser.role);
                    }}
                    onViewReportDetails={(rep) => setSelectedReport(rep)}
                    currentUserEmail={currentUser.email}
                  />
                </div>

                {/* Right Column: Delhi NCR Citizen Map & Recent submissions (Span 7) */}
                <div className="lg:col-span-7 flex flex-col gap-6">
                  
                  {/* Map overlay Card */}
                  <div className="bg-white border border-slate-200 shadow-xs rounded-2xl p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-display font-semibold text-base text-slate-800 tracking-tight">Active Delhi NCR Incident Map</h3>
                        <p className="text-[11px] text-gray-400 mt-0.5">Centers automatically on your coordinates. Single markers trigger floating popups.</p>
                      </div>
                    </div>

                    <div className="h-[380px] w-full rounded-xl border border-slate-150 overflow-hidden shadow-inner">
                      <SimpleMap
                        reports={reports}
                        selectedReport={selectedReport}
                        onSelectReport={(rep) => setSelectedReport(rep)}
                      />
                    </div>
                  </div>

                  {/* Volunteer submissions history list */}
                  <div className="bg-white border border-slate-200 shadow-xs rounded-2xl p-5">
                    <div className="flex items-center justify-between mb-4 pb-2 border-b border-light-100">
                      <div>
                        <h4 className="font-display font-medium text-sm text-slate-800">Your Action Incident Trackers</h4>
                        <p className="text-[10px] text-gray-500 mt-0.5">Real-time status queues syncing progress with East, South, and North Delhi utility preservation crews.</p>
                      </div>
                      <span className="text-[10.5px] font-mono font-bold bg-blue-50 text-blue-600 px-2.5 py-0.5 rounded-md border border-blue-100">
                        Incident Count: {reports.filter(r => r.reporterEmail === currentUser.email).length}
                      </span>
                    </div>

                    <div className="flex flex-col gap-2 max-h-[260px] overflow-y-auto pr-1">
                      {reports.filter(r => r.reporterEmail === currentUser.email).length === 0 ? (
                        <div className="p-8 text-center text-gray-400 font-mono text-xs border border-dashed border-slate-200 rounded-xl">
                          No active reported incident submissions linked to your citizen profile in Delhi NCR. Try reporting an issue using the form above!
                        </div>
                      ) : (
                        reports.filter(r => r.reporterEmail === currentUser.email).map((rep) => (
                          <div
                            key={rep.id}
                            onClick={() => setSelectedReport(rep)}
                            className="p-3 bg-slate-50 hover:bg-slate-100/70 border border-slate-200/80 rounded-xl flex items-center justify-between gap-4 cursor-pointer transition-all"
                          >
                            <div className="flex items-center gap-3.5">
                              <div className={`w-2 h-2 rounded-full ${
                                rep.severity >= 75 ? "bg-red-500 animate-pulse" : rep.severity >= 45 ? "bg-amber-400" : "bg-emerald-400"
                              }`}></div>
                              <div>
                                <h5 className="font-semibold text-xs text-slate-800 tracking-tight">{rep.title}</h5>
                                <p className="text-[10.5px] text-gray-400 flex items-center gap-1.5 mt-0.5 max-w-md truncate">
                                  <span className="font-bold text-slate-500">{rep.category}</span>
                                  <span>•</span>
                                  <span className="truncate">{rep.location}</span>
                                </p>
                              </div>
                            </div>
                            
                            <div className="text-right shrink-0">
                              <span className={`text-[9.5px] font-bold px-2 py-0.5 rounded-full border ${
                                rep.status === "Pending" ? "bg-red-50 text-red-800 border-red-200" :
                                rep.status === "Assigned" ? "bg-blue-50 text-blue-800 border-blue-200" :
                                rep.status === "In Progress" ? "bg-amber-50 text-amber-800 border-amber-200" :
                                "bg-emerald-50 text-emerald-800 border-emerald-200"
                              }`}>
                                {rep.status}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                </div>

              </div>
            ) : (
              
              /* SINGLE VIEW WORKSPACE: Municipal Officer Command Center */
              <div className="flex flex-col gap-6">
                
                {/* Advanced Counters widget */}
                <DashboardStats reports={reports} />

                {/* Split list and full MAP indicators */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  
                  {/* Left Column (span 7): Command Incident queue list */}
                  <div className="lg:col-span-7 flex flex-col gap-4">
                    
                    <div className="bg-white border border-gray-200 shadow-xs rounded-2xl p-5">
                      
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 border-b border-slate-100 pb-4">
                        <div>
                          <h3 className="font-display font-medium text-base text-slate-800 tracking-tight leading-4">Incident Dispatch Registry Database</h3>
                          <p className="text-[11px] text-gray-400 mt-1">Complete administrator command grid to filter citizen complaints, sort AI risk scores, and execute bulk actions.</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              const titleRow = "Ticket ID,Title,Ward,Category,Severity,Risk Precedence,Lifecycle Status,Created At\n";
                              const dataRow = sortedReports.map((r) => 
                                `"${r.id}","${r.title}","${r.location}","${r.category}",${r.severity},"${r.riskLevel || 'Medium'}","${r.status}","${r.createdAt}"`
                              ).join("\n");
                              const blob = new Blob([titleRow + dataRow], { type: "text/csv;charset=utf-8;" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `UrbanPulse_Filtered_Export_${new Date().toISOString().slice(0,10)}.csv`;
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                            className="text-[10px] font-mono uppercase bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 px-3 py-1.5 text-white rounded-md font-bold flex items-center gap-1.5 shadow-3xs transition-all cursor-pointer"
                          >
                            <FileText className="w-3 h-3" />
                            Export Filtered CSV
                          </button>
                          <span className="text-[10px] font-mono uppercase bg-blue-50 border border-blue-100 px-2 py-1 text-blue-700 rounded-md font-bold flex items-center gap-1.5 shadow-3xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                            Live Sync Active
                          </span>
                        </div>
                      </div>

                      {/* Filter inputs header */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 bg-slate-50 p-4 border border-slate-200/60 rounded-xl mb-4 text-left">
                        {/* Searching */}
                        <div className="relative">
                          <label className="text-[9px] font-mono font-black text-slate-400 block mb-1 uppercase">Search Keyword</label>
                          <div className="relative">
                            <input
                              id="admin-search-input"
                              type="text"
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="w-full bg-white border border-gray-200 rounded-lg pl-8.5 pr-3 py-1.5 text-xs text-slate-800 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-150 focus:outline-hidden"
                              placeholder="ID, Title, Ward..."
                            />
                            <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-gray-400" />
                          </div>
                        </div>

                        {/* Source Filter Selection */}
                        <div>
                          <label className="text-[9px] font-mono font-black text-slate-400 block mb-1 uppercase">Data Ingest Source</label>
                          <select
                            id="source-filter-select"
                            value={sourceFilter}
                            onChange={(e) => setSourceFilter(e.target.value)}
                            className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-500 focus:outline-hidden font-medium"
                          >
                            <option value="All">🌐 All Sources</option>
                            <option value="ROAD_SCANNER">📷 AI Road Scanner</option>
                            <option value="MANUAL_REPORT">📝 Citizen Reports</option>
                          </select>
                        </div>

                        {/* Category Selection */}
                        <div>
                          <label className="text-[9px] font-mono font-black text-slate-400 block mb-1 uppercase">Incident Category</label>
                          <select
                            id="category-filter-select"
                            value={categoryFilter}
                            onChange={(e) => setCategoryFilter(e.target.value)}
                            className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-500 focus:outline-hidden font-medium"
                          >
                            <option value="All">🛡️ All Categories</option>
                            <option value="Pothole">🚧 Potholes</option>
                            <option value="Garbage Overflow">🚮 Garbage Overflows</option>
                            <option value="Broken Streetlight">💡 Broken Streetlights</option>
                            <option value="Road Obstruction">🛑 Road Obstructions</option>
                            <option value="Vandals / Graffiti">🎨 Vandals / Graffiti</option>
                            <option value="Other">❓ Others</option>
                          </select>
                        </div>

                        {/* Status Selection */}
                        <div>
                          <label className="text-[9px] font-mono font-black text-slate-400 block mb-1 uppercase">Lifecycle Status</label>
                          <select
                            id="status-filter-select"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-500 focus:outline-hidden font-medium"
                          >
                            <option value="All">🚦 All Statuses</option>
                            <option value="Pending">🔴 Pending</option>
                            <option value="Assigned">🔵 Assigned</option>
                            <option value="In Progress">🟡 In Progress</option>
                            <option value="Resolved">🟢 Resolved</option>
                          </select>
                        </div>

                        {/* Risk Level Selection */}
                        <div>
                          <label className="text-[9px] font-mono font-black text-slate-400 block mb-1 uppercase">AI Risk Priority</label>
                          <select
                            id="risk-filter-select"
                            value={riskLevelFilter}
                            onChange={(e) => setRiskLevelFilter(e.target.value)}
                            className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-500 focus:outline-hidden font-medium"
                          >
                            <option value="All">⚡ All Risk Levels</option>
                            <option value="Low">🟢 Low Risk</option>
                            <option value="Medium">🟡 Medium Risk</option>
                            <option value="High">🔴 High Risk</option>
                          </select>
                        </div>

                        {/* Area Ward Selection */}
                        <div>
                          <label className="text-[9px] font-mono font-black text-slate-400 block mb-1 uppercase">Delhi NCR Ward</label>
                          <select
                            id="area-filter-select"
                            value={areaFilter}
                            onChange={(e) => setAreaFilter(e.target.value)}
                            className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-500 focus:outline-hidden font-medium"
                          >
                            <option value="All">📍 All Wards</option>
                            <option value="Saket">Saket District</option>
                            <option value="Connaught">Connaught Place</option>
                            <option value="Noida">Noida Sector 62</option>
                            <option value="Cyber">DLF Cyber City</option>
                            <option value="Okhla">Okhla Phase 3</option>
                            <option value="Vasant">Vasant Kunj</option>
                          </select>
                        </div>
                      </div>

                      {/* Micro Bulk Actions Context Toolbar Ribbon */}
                      {selectedReportIds.length > 0 && (
                        <div id="bulk-actions-ribbon" className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-blue-900 text-white rounded-xl p-3 px-4 mb-4 select-none animate-in fade-in slide-in-from-top-1 duration-200">
                          <div className="flex items-center gap-2">
                            <span className="p-1 px-2 rounded-md bg-blue-800 text-[10px] font-mono font-extrabold uppercase">{selectedReportIds.length} Selected</span>
                            <span className="text-xs text-blue-100 font-medium">Bulk supervisory routines queued.</span>
                          </div>
                          
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => {
                                // Mark Chosen resolved
                                const status = "Resolved";
                                setReports((prev) => 
                                  prev.map((r) => selectedReportIds.includes(r.id) ? { ...r, status, updatedAt: new Date().toISOString() } : r)
                                );
                                bulkUpdateReportStatus(
                                  selectedReportIds, 
                                  status, 
                                  "Bulk Action: Resolving target batch on operations deck.",
                                  currentUser
                                ).then(() => {
                                  if (currentUser) syncOperationalDatasets(currentUser.email, currentUser.role);
                                  setSelectedReportIds([]);
                                }).catch((err) => {
                                  alert(err.message || "Bulk resolve failed.");
                                });
                              }}
                              className="text-[10px] bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 transition-all font-sans font-bold text-white px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-3xs"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Resolve Selected</span>
                            </button>

                            <button
                              onClick={() => {
                                // Mark chosen In Progress
                                const status = "In Progress";
                                setReports((prev) => 
                                  prev.map((r) => selectedReportIds.includes(r.id) ? { ...r, status, updatedAt: new Date().toISOString() } : r)
                                );
                                bulkUpdateReportStatus(
                                  selectedReportIds, 
                                  status, 
                                  "Bulk Action: Slating target batch for In-Progress fieldwork.",
                                  currentUser
                                ).then(() => {
                                  if (currentUser) syncOperationalDatasets(currentUser.email, currentUser.role);
                                  setSelectedReportIds([]);
                                }).catch((err) => {
                                  alert(err.message || "Bulk status update failed.");
                                });
                              }}
                              className="text-[10px] bg-amber-500 hover:bg-amber-400 active:bg-amber-600 transition-all font-sans font-bold text-slate-900 px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-3xs"
                            >
                              <Clock className="w-3.5 h-3.5 text-slate-900" />
                              <span>Set In Progress</span>
                            </button>

                            <button
                              onClick={() => {
                                // Dynamic CSV Export
                                const list = reports.filter((r) => selectedReportIds.includes(r.id));
                                const titleRow = "Ticket ID,Title,Ward,Category,Severity,Risk Precedence,Lifecycle Status,Created At\n";
                                const dataRow = list.map((r) => 
                                  `"${r.id}","${r.title}","${r.location}","${r.category}",${r.severity},"${r.riskLevel || 'Medium'}","${r.status}","${r.createdAt}"`
                                ).join("\n");
                                const blob = new Blob([titleRow + dataRow], { type: "text/csv;charset=utf-8;" });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = `UrbanPulse_Export_${new Date().toISOString().slice(0,10)}.csv`;
                                a.click();
                                URL.revokeObjectURL(url);
                              }}
                              className="text-[10px] bg-slate-800 hover:bg-slate-700 active:bg-slate-900 transition-all font-sans font-bold text-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-3xs"
                            >
                              <span>Export Dataset (.csv)</span>
                            </button>

                            <button
                              onClick={() => setSelectedReportIds([])}
                              className="text-[10px] bg-blue-950 hover:bg-blue-900 transition-all font-sans font-bold text-blue-300 px-2.5 py-1.5 rounded-lg"
                            >
                              Deselect All
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Main dispatch Table database */}
                      <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white shadow-3xs">
                        <table className="w-full text-left border-collapse text-[11px]">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold font-sans">
                              {/* Bulk selection column header */}
                              <th className="p-3 w-10">
                                <input
                                  type="checkbox"
                                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer"
                                  checked={sortedReports.length > 0 && selectedReportIds.length === sortedReports.length}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedReportIds(sortedReports.map((r) => r.id));
                                    } else {
                                      setSelectedReportIds([]);
                                    }
                                  }}
                                />
                              </th>
                              <th className="p-3 w-28 cursor-pointer select-none group" onClick={() => {
                                setSortBy("id");
                                setSortOrder(prev => prev === "asc" ? "desc" : "asc");
                              }}>
                                <div className="flex items-center gap-1">
                                  <span>Report ID</span>
                                  <span className="text-gray-400 group-hover:text-blue-500">
                                    {sortBy === "id" ? (sortOrder === "asc" ? "▲" : "▼") : "↕"}
                                  </span>
                                </div>
                              </th>
                              <th className="p-3">Overview Incident</th>
                              <th className="p-3 w-24 cursor-pointer select-none group" onClick={() => {
                                setSortBy("severity");
                                setSortOrder(prev => prev === "asc" ? "desc" : "asc");
                              }}>
                                <div className="flex items-center gap-1">
                                  <span>Severity Score</span>
                                  <span className="text-gray-400 group-hover:text-blue-500">
                                    {sortBy === "severity" ? (sortOrder === "asc" ? "▲" : "▼") : "↕"}
                                  </span>
                                </div>
                              </th>
                              <th className="p-3">Delhi NCR Ward</th>
                              <th className="p-3 w-28 text-center cursor-pointer select-none group" onClick={() => {
                                setSortBy("status");
                                setSortOrder(prev => prev === "asc" ? "desc" : "asc");
                              }}>
                                <div className="flex items-center gap-1 justify-center">
                                  <span>Status</span>
                                  <span className="text-gray-400 group-hover:text-blue-500">
                                    {sortBy === "status" ? (sortOrder === "asc" ? "▲" : "▼") : "↕"}
                                  </span>
                                </div>
                              </th>
                              <th className="p-3 text-right">Dispatch Rules</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {loadingReports ? (
                              <tr>
                                <td colSpan={7} className="p-10 text-center text-gray-400 text-xs">
                                  <Loader2 className="w-5 h-5 mx-auto animate-spin text-amber-500 mb-1" />
                                  <span>Loading incident directories...</span>
                                </td>
                              </tr>
                            ) : sortedReports.length === 0 ? (
                              <tr>
                                <td colSpan={7} className="p-12 text-center text-slate-400">
                                  <div className="flex flex-col items-center justify-center gap-3">
                                    <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                                      🛡️
                                    </div>
                                    <div className="text-sm font-bold text-slate-700">No active incidents matching criteria!</div>
                                    <div className="text-xs text-slate-400 max-w-xs px-4">
                                      The smart grid reports no active risks or hazardous infrastructure blockages matching filters. City operating normally.
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ) : (
                              sortedReports.map((rep) => {
                                const isChecked = selectedReportIds.includes(rep.id);
                                return (
                                  <tr
                                    key={rep.id}
                                    onClick={() => setSelectedReport(rep)}
                                    className={`hover:bg-slate-50 border-transparent transition-all cursor-pointer ${
                                      selectedReport?.id === rep.id ? "bg-amber-50/15" : ""
                                    } ${isChecked ? "bg-blue-50/10" : ""}`}
                                  >
                                    <td className="p-3 w-10" onClick={(e) => e.stopPropagation()}>
                                      <input
                                        type="checkbox"
                                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer"
                                        checked={isChecked}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setSelectedReportIds((prev) => [...prev, rep.id]);
                                          } else {
                                            setSelectedReportIds((prev) => prev.filter((id) => id !== rep.id));
                                          }
                                        }}
                                      />
                                    </td>
                                    <td className="p-3 font-mono font-bold text-slate-500 truncate max-w-[110px]">
                                      {rep.id}
                                    </td>
                                    <td className="p-3 max-w-[220px]">
                                      <div className="font-bold text-slate-800 line-clamp-1">{rep.title}</div>
                                      <div className="text-[9.5px] text-gray-450 mt-0.5 flex flex-wrap items-center gap-1.5 font-mono">
                                        {rep.source === "ROAD_SCANNER" ? (
                                          <span className="bg-purple-100 text-purple-800 px-1.5 py-0.2 rounded font-extrabold text-[8px] flex items-center gap-1 border border-purple-200">
                                            <Camera className="w-2.5 h-2.5 text-purple-700" />
                                            <span>AI Scanner</span>
                                            {rep.clusterCount && rep.clusterCount > 1 ? (
                                              <span className="bg-purple-200 text-purple-900 px-1 rounded-xs">
                                                x{rep.clusterCount}
                                              </span>
                                            ) : null}
                                          </span>
                                        ) : (
                                          <span className="bg-blue-50 text-blue-700 px-1.5 py-0.2 rounded font-bold text-[8px] flex items-center gap-1 border border-blue-200">
                                            <FileText className="w-2.5 h-2.5 text-blue-600" />
                                            <span>Citizen</span>
                                          </span>
                                        )}
                                        <span className="font-semibold px-1 rounded bg-slate-100 text-slate-600">{rep.category}</span>
                                        {rep.riskLevel && (
                                          <span className={`px-1 rounded font-extrabold font-sans text-[8.5px] ${
                                            rep.riskLevel === "High" ? "bg-red-50 text-red-700" :
                                            rep.riskLevel === "Medium" ? "bg-amber-50 text-amber-700" :
                                            "bg-emerald-50 text-emerald-700"
                                          }`}>
                                            Risk: {rep.riskLevel}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="p-3">
                                      <div className="flex items-center gap-1.5 font-mono">
                                        <span className={`w-1.5 h-1.5 rounded-full ${
                                          rep.severity >= 75 ? "bg-red-500 animate-pulse" : rep.severity >= 45 ? "bg-amber-400" : "bg-emerald-400"
                                        }`}></span>
                                        <span className="font-bold text-slate-700">{rep.severity}%</span>
                                      </div>
                                    </td>
                                    <td className="p-3 truncate text-slate-500 max-w-[130px]" title={rep.location}>
                                      {rep.location}
                                    </td>
                                    <td className="p-3 text-center whitespace-nowrap">
                                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                                        rep.status === "Pending" ? "bg-red-50 text-red-800 border-red-200" :
                                        rep.status === "Assigned" ? "bg-blue-50 text-blue-800 border-blue-200" :
                                        rep.status === "In Progress" ? "bg-amber-50 text-amber-800 border-amber-200" :
                                        "bg-emerald-50 text-emerald-800 border-emerald-200"
                                      }`}>
                                        {rep.status}
                                      </span>
                                    </td>
                                    <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                                      <div className="flex items-center justify-end gap-1.5">
                                        <button
                                          id={`view-rep-btn-${rep.id}`}
                                          onClick={() => setSelectedReport(rep)}
                                          className="p-1 px-2.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold transition-all flex items-center gap-1 text-[9.5px] border border-blue-100/50"
                                          title="View dispatch details"
                                        >
                                          <Eye className="w-3.5 h-3.5" />
                                          <span>Dispatch</span>
                                        </button>
                                        <button
                                          id={`delete-rep-btn-${rep.id}`}
                                          onClick={(e) => handleDeleteReport(rep.id, e)}
                                          className="p-1 px-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                          title="Scrub record"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>

                    </div>

                  </div>

                  {/* Right Column (span 5): Geographic dispatch overlays */}
                  <div className="lg:col-span-5 flex flex-col gap-4">
                    
                    <div className="bg-white border border-gray-200 shadow-xs rounded-2xl p-5">
                      <div className="mb-3.5">
                        <h4 className="font-display font-semibold text-base text-slate-800">Operational Geographic Dispatch Overlay</h4>
                        <p className="text-[11px] text-gray-400 mt-0.5">Live map with auto-adjusting telemetry positioning. Centering is updated automatically upon registry selections.</p>
                      </div>

                      <div className="h-[440px] rounded-xl overflow-hidden border border-slate-150 shadow-inner">
                        <SimpleMap
                          reports={reports}
                          selectedReport={selectedReport}
                          onSelectReport={(rep) => setSelectedReport(rep)}
                        />
                      </div>
                    </div>

                  </div>

                </div>

              </div>
              )}
              </div>
            )}

            {/* SHARED AI EXTRAPOLATION MODULE */}
            {activeSubTab === "infrastructure" && (
              <div className="mt-2 border-t border-slate-200/60 pt-5">
                <FutureModules 
                  reports={reports} 
                  onReportUpdated={() => syncOperationalDatasets(currentUser!.email, currentUser!.role)}
                />
              </div>
            )}

          </main>

          {/* SYSTEM OPERATIONS FOOTER WITH QUICK-ACTION EMERGENCY BUTTON */}
          <footer id="footer-system" className="bg-white border-t border-[#E2E8F0] py-5 text-[#64748B] text-[10.5px] font-medium leading-relaxed z-10 shrink-0">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#EFF6FF] border border-[#DBEAFE] flex items-center justify-center text-[#2563EB] shrink-0">
                  <ShieldAlert className="w-4.5 h-4.5" />
                </div>
                <div className="text-left">
                  <span className="font-sans font-bold text-[#172033] tracking-widest uppercase block">URBANPULSE GUARDIAN NET</span>
                  <span className="text-[9.5px] text-[#64748B]">NCR Delhi Hub: WGS-84 / Ind Core System • <strong className="text-[#16A34A]">ACTIVE</strong></span>
                </div>
              </div>

              {/* QUICK-ACTION EMERGENCY SOS BUTTON */}
              <div className="flex items-center gap-3">
                <FooterEmergencyButton 
                  currentUser={currentUser}
                  onReportCreated={(newRep) => {
                    setSelectedReport(newRep);
                    if (currentUser) {
                      syncOperationalDatasets(currentUser.email, currentUser.role);
                    }
                  }}
                  onOpenReportDetails={(rep) => setSelectedReport(rep)}
                />
              </div>

              <div className="text-[9.5px] text-[#94A3B8] text-center md:text-right">
                <p className="text-[#64748B]">AI Operating System Build v4.2.0 • 24/7 Dispatch</p>
                <p className="text-[#94A3B8]">National Emergency Response (112) Integrated</p>
              </div>
            </div>
          </footer>

        </div>
      ) : (
        /* BACKEND AUTHENTICATION PORT SCREEN (If logged out) */
        <div className="flex-1 flex items-center justify-center p-6 bg-slate-50 relative overflow-hidden min-h-screen">
          
          {/* Subtle grid elements */}
          <div className="absolute inset-0 opacity-[0.03] bg-slate-900" style={{ backgroundImage: "radial-gradient(#0f172a 1px, transparent 1px)", backgroundSize: "24px 24px" }}></div>
          <div className="absolute top-0 inset-x-0 h-96 bg-gradient-to-b from-blue-100/40 to-transparent"></div>

          <div className="bg-white rounded-3xl shadow-2xl shadow-slate-200/80 border border-slate-200/80 w-full max-w-[460px] p-6 sm:p-8 relative z-10 flex flex-col items-center">
            
            {/* Branding launcher icon & header */}
            <div className="flex items-center gap-3 mb-6 w-full justify-center">
              <div className={`w-11 h-11 ${authRoleInput === "admin" ? "bg-amber-500 shadow-amber-500/30" : "bg-blue-600 shadow-blue-600/30"} text-white rounded-xl flex items-center justify-center shadow-lg transition-all duration-300 shrink-0`}>
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div className="text-left">
                <h2 className="font-display font-black text-xl text-slate-900 tracking-tight leading-none uppercase">
                  UrbanPulse AI
                </h2>
                <p className="text-[11px] font-semibold text-slate-500 mt-1">
                  Smart City Diagnostic & Command Portal
                </p>
              </div>
            </div>

            {/* 1. PRIMARY MODE SWITCHER: SIGN IN vs SIGN UP */}
            <div id="auth-mode-toggle" className="flex w-full p-1.5 bg-slate-100/80 rounded-2xl mb-5 border border-slate-200 shadow-inner">
              <button
                type="button"
                id="tab-mode-signin"
                onClick={() => {
                  setIsLoginView(true);
                  setLocalAuthError("");
                  clearAuthError();
                }}
                className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  isLoginView
                    ? "bg-white text-slate-900 shadow-md border border-slate-200/80 font-black"
                    : "bg-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                <LogIn className={`w-4 h-4 ${isLoginView ? "text-blue-600" : ""}`} />
                <span>Sign In</span>
              </button>
              <button
                type="button"
                id="tab-mode-signup"
                onClick={() => {
                  setIsLoginView(false);
                  setAuthRoleInput("citizen");
                  setLocalAuthError("");
                  clearAuthError();
                }}
                className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  !isLoginView
                    ? "bg-blue-600 text-white shadow-md shadow-blue-600/25 font-black"
                    : "bg-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                <UserPlus className="w-4 h-4" />
                <span>Sign Up (New)</span>
              </button>
            </div>

            {/* 2. ROLE SELECTOR TABS (Sign In: Citizen, Municipal, Admin) */}
            {isLoginView ? (
              <div className="flex w-full gap-2 mb-5">
                <button
                  type="button"
                  id="tab-btn-citizen"
                  onClick={() => {
                    setAuthRoleInput("citizen");
                    setLocalAuthError("");
                    clearAuthError();
                  }}
                  className={`flex-1 py-2 px-2 text-[10.5px] font-bold uppercase tracking-wider rounded-xl border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    authRoleInput === "citizen"
                      ? "bg-blue-50 border-blue-300 text-blue-900 ring-2 ring-blue-500/20 shadow-xs"
                      : "bg-slate-50/60 border-slate-200 text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  <UserIcon className="w-3.5 h-3.5 text-blue-600" />
                  <span>Citizen</span>
                </button>
                <button
                  type="button"
                  id="tab-btn-field-team"
                  onClick={() => {
                    setAuthRoleInput("field_team");
                    setLocalAuthError("");
                    clearAuthError();
                  }}
                  className={`flex-1 py-2 px-2 text-[10.5px] font-bold uppercase tracking-wider rounded-xl border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    authRoleInput === "field_team"
                      ? "bg-emerald-50 border-emerald-300 text-emerald-900 ring-2 ring-emerald-500/20 shadow-xs"
                      : "bg-slate-50/60 border-slate-200 text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  <Wrench className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Municipal</span>
                </button>
                <button
                  type="button"
                  id="tab-btn-municipal"
                  onClick={() => {
                    setAuthRoleInput("admin");
                    setLocalAuthError("");
                    clearAuthError();
                  }}
                  className={`flex-1 py-2 px-2 text-[10.5px] font-bold uppercase tracking-wider rounded-xl border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    authRoleInput === "admin"
                      ? "bg-amber-50 border-amber-300 text-amber-900 ring-2 ring-amber-500/20 shadow-xs"
                      : "bg-slate-50/60 border-slate-200 text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  <Landmark className="w-3.5 h-3.5 text-amber-600" />
                  <span>Admin</span>
                </button>
              </div>
            ) : (
              <div className="flex w-full gap-2 mb-5">
                <button
                  type="button"
                  onClick={() => setAuthRoleInput("citizen")}
                  className={`flex-1 py-2 px-2 text-[10.5px] font-bold uppercase tracking-wider rounded-xl border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    authRoleInput === "citizen"
                      ? "bg-blue-50 border-blue-300 text-blue-900 ring-2 ring-blue-500/20"
                      : "bg-slate-50/60 border-slate-200 text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  <UserIcon className="w-3.5 h-3.5 text-blue-600" />
                  <span>Citizen Registration</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAuthRoleInput("field_team")}
                  className={`flex-1 py-2 px-2 text-[10.5px] font-bold uppercase tracking-wider rounded-xl border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    authRoleInput === "field_team"
                      ? "bg-emerald-50 border-emerald-300 text-emerald-900 ring-2 ring-emerald-500/20"
                      : "bg-slate-50/60 border-slate-200 text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  <Wrench className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Field Team Crew</span>
                </button>
              </div>
            )}

            {/* MODE SUMMARY BANNER */}
            <div className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200/60 mb-5 flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">
                {isLoginView ? "🔑 Returning User Login" : "📝 Create New Account"}
              </span>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider ${
                authRoleInput === "field_team" 
                  ? "bg-emerald-100 text-emerald-800"
                  : authRoleInput === "admin" 
                    ? "bg-amber-100 text-amber-800" 
                    : "bg-blue-100 text-blue-800"
              }`}>
                Role: {authRoleInput === "field_team" ? "Field Ops Crew" : authRoleInput === "admin" ? "Municipal Admin" : "Citizen"}
              </span>
            </div>

            {(localAuthError || contextAuthError) && (
              <div className="self-stretch p-3 bg-red-50 border border-red-200 rounded-xl text-red-900 text-xs flex items-center gap-2 mb-4">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                <span className="font-medium">{localAuthError || contextAuthError}</span>
              </div>
            )}

            {/* FORM FIELDS */}
            <form onSubmit={handleAuthSubmit} className="self-stretch flex flex-col gap-3.5 text-xs text-slate-700">
              
              {!isLoginView && (
                <div>
                  <label className="text-[10.5px] font-black text-slate-600 uppercase tracking-wide block mb-1">
                    Your Full Name *
                  </label>
                  <div className="relative">
                    <input
                      id="auth-name-input"
                      type="text"
                      value={fullNameInput}
                      onChange={(e) => setFullNameInput(e.target.value)}
                      className="w-full bg-white border border-slate-300 pl-3.5 pr-10 py-2.5 rounded-xl text-slate-900 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 focus:outline-hidden transition-all placeholder:text-slate-400 font-semibold"
                      placeholder={authRoleInput === "field_team" ? "Vikram Singh (Crew Lead)" : authRoleInput === "admin" ? "Officer Rachel Chen" : "Ashish Singh"}
                      required
                    />
                    <UserIcon className="absolute right-3.5 top-3 w-4 h-4 text-slate-400" />
                  </div>
                </div>
              )}

              <div>
                <label className="text-[10.5px] font-black text-slate-600 uppercase tracking-wide block mb-1">
                  {authRoleInput === "field_team" ? "Field Crew Email *" : authRoleInput === "admin" ? "Official Government / Admin Email *" : "Email Address *"}
                </label>
                <div className="relative">
                  <input
                    id="auth-email-input"
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="w-full bg-white border border-slate-300 pl-3.5 pr-10 py-2.5 rounded-xl text-slate-900 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 focus:outline-hidden transition-all placeholder:text-slate-400 font-semibold"
                    placeholder={authRoleInput === "field_team" ? "fieldteam@urbanpulse.gov" : authRoleInput === "admin" ? "officer@urbanpulse.gov" : "yourname@gmail.com"}
                    required
                  />
                  <Mail className="absolute right-3.5 top-3 w-4 h-4 text-slate-400" />
                </div>
              </div>

              <div>
                <label className="text-[10.5px] font-black text-slate-600 uppercase tracking-wide block mb-1">
                  Password *
                </label>
                <div className="relative">
                  <input
                    id="auth-password-input"
                    type="password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    className="w-full bg-white border border-slate-300 pl-3.5 pr-10 py-2.5 rounded-xl text-slate-900 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 focus:outline-hidden transition-all placeholder:text-slate-400 font-medium tracking-widest"
                    placeholder="••••••••"
                  />
                  <Lock className="absolute right-3.5 top-3 w-4 h-4 text-slate-400" />
                </div>
              </div>

              <button
                id="auth-submit-btn"
                type="submit"
                disabled={isSubmittingAuth}
                className={`w-full ${
                  authRoleInput === "field_team"
                    ? "bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 shadow-emerald-600/20"
                    : authRoleInput === "admin" 
                      ? "bg-amber-600 hover:bg-amber-700 active:bg-amber-800 shadow-amber-600/20" 
                      : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shadow-blue-600/20"
                } text-white font-black py-3 rounded-xl shadow-lg hover:shadow-xl transition-all mt-1 font-sans text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50`}
              >
                {isSubmittingAuth ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isLoginView ? (
                  <LogIn className="w-4 h-4" />
                ) : (
                  <UserPlus className="w-4 h-4" />
                )}
                <span>
                  {isLoginView 
                    ? (authRoleInput === "field_team" ? "Sign In to Field Team Deck" : authRoleInput === "admin" ? "Sign In to Command Deck" : "Sign In to Citizen Node") 
                    : (authRoleInput === "field_team" ? "Register Field Crew Account" : authRoleInput === "admin" ? "Register Municipal Account" : "Create Citizen Account")}
                </span>
              </button>
            </form>

            {/* QUICK DEMO CREDENTIAL BUTTONS */}
            <div className="mt-4 pt-3 border-t border-slate-200/70 flex flex-col gap-1.5">
              <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-widest text-center">Quick Demo Preset Logins:</span>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setAuthRoleInput("citizen");
                    setEmailInput("citizen@urbanpulse.org");
                    setPasswordInput("citizen123456");
                  }}
                  className="py-1 px-1.5 bg-blue-50 hover:bg-blue-100 text-blue-800 text-[9.5px] font-bold rounded-lg transition-colors border border-blue-200/80 cursor-pointer"
                >
                  Citizen
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthRoleInput("field_team");
                    setEmailInput("fieldteam@urbanpulse.gov");
                    setPasswordInput("field123456");
                  }}
                  className="py-1 px-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[9.5px] font-bold rounded-lg transition-colors border border-emerald-200/80 cursor-pointer"
                >
                  Field Crew
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthRoleInput("admin");
                    setEmailInput("officer@urbanpulse.gov");
                    setPasswordInput("admin123456");
                  }}
                  className="py-1 px-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 text-[9.5px] font-bold rounded-lg transition-colors border border-amber-200/80 cursor-pointer"
                >
                  Municipal
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 w-full my-4 text-slate-400">
              <div className="flex-1 h-px bg-slate-200"></div>
              <span className="text-[10px] uppercase font-black tracking-widest text-slate-400">
                Alternative Sign In Methods
              </span>
              <div className="flex-1 h-px bg-slate-200"></div>
            </div>

            {/* GOOGLE SIGN-IN */}
            <button
              id="google-signin-btn"
              type="button"
              onClick={handleGoogleLogin}
              disabled={isSubmittingAuth}
              className="w-full bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-800 font-bold py-2.5 px-4 rounded-xl border border-slate-300 shadow-3xs hover:shadow-sm transition-all flex items-center justify-center gap-3 text-xs cursor-pointer disabled:opacity-50 mb-3"
            >
              {isSubmittingAuth ? (
                <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
              ) : (
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
              )}
              <span className="font-sans font-bold text-xs">Sign In with Google</span>
            </button>
          </div>
        </div>
      )}

      {/* CORE INSPECTOR DIALOG MODAL PANEL */}
      {selectedReport && (
        <ReportDetailsModal
          report={selectedReport}
          onClose={() => setSelectedReport(null)}
          isAdmin={currentUser?.role === "admin" || currentUser?.role === "municipal"}
          userRole={currentUser?.role}
          onUpdateStatus={handleUpdateStatus}
        />
      )}

    </div>
  );
}
