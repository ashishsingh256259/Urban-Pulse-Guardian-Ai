import React, { useState, useEffect } from "react";
import {
  ShieldAlert,
  Users,
  Briefcase,
  Activity,
  Server,
  FileText,
  Settings,
  UserCheck,
  UserX,
  Plus,
  Edit2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Search,
  Filter,
  Layers,
  Cpu,
  Lock,
  Phone,
  MapPin,
  Clock,
  ChevronRight,
  BarChart2,
  X,
  ArrowRight
} from "lucide-react";
import { User, UserRole, FieldTeamMeta, AuditLog } from "../types";
import {
  getAdminUsers,
  toggleUserStatus,
  updateUserRole,
  getPlatformTeams,
  createPlatformTeam,
  updatePlatformTeam,
  toggleTeamStatus,
  getSystemAuditLogs,
  getDepartmentForCategory
} from "../services/adminService";

interface AdminPanelProps {
  currentAdminEmail?: string;
  currentUserEmail?: string;
  currentUserName?: string;
  initialTab?: AdminTab;
  onTabChange?: (tab: AdminTab) => void;
  onUserUpdated?: () => void;
}

type AdminTab = "overview" | "users" | "teams" | "system" | "audit" | "settings";

export const AdminPanel: React.FC<AdminPanelProps> = ({ 
  currentAdminEmail, 
  currentUserEmail, 
  currentUserName, 
  initialTab,
  onTabChange,
  onUserUpdated 
}) => {
  const adminEmail = currentAdminEmail || currentUserEmail || "admin@urbanpulse.gov";
  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab || "overview");

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const handleTabSelect = (tab: AdminTab) => {
    setActiveTab(tab);
    if (onTabChange) {
      onTabChange(tab);
    }
  };
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<FieldTeamMeta[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showMatrixModal, setShowMatrixModal] = useState(false);

  // Search & Filters
  const [userSearch, setUserSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("ALL");
  const [teamSearch, setTeamSearch] = useState("");

  // Modals state
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [newRoleInput, setNewRoleInput] = useState<UserRole>("citizen");
  const [newDeptInput, setNewDeptInput] = useState("");

  const [showCreateTeamModal, setShowCreateTeamModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamLead, setNewTeamLead] = useState("");
  const [newTeamCategory, setNewTeamCategory] = useState("Pothole");
  const [newTeamDistrict, setNewTeamDistrict] = useState("Central Zone");
  const [newTeamDepartment, setNewTeamDepartment] = useState("Roads & Highway Authority (PWD)");
  const [newTeamPhone, setNewTeamPhone] = useState("+91 98110 ");
  const [newTeamMembers, setNewTeamMembers] = useState(4);

  const [editingTeam, setEditingTeam] = useState<FieldTeamMeta | null>(null);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  // Load Admin Data
  const loadData = async () => {
    setLoading(true);
    try {
      const [uList, tList, aLogs] = await Promise.all([
        getAdminUsers(),
        getPlatformTeams(),
        getSystemAuditLogs()
      ]);
      setUsers(uList);
      setTeams(tList);
      setAuditLogs(aLogs);
    } catch (err) {
      console.error("Failed to load admin data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const showNotification = (msg: string) => {
    setActionSuccessMsg(msg);
    setTimeout(() => setActionSuccessMsg(null), 3500);
  };

  // User Actions
  const handleToggleUser = async (user: User) => {
    const nextStatus = !user.active;
    await toggleUserStatus(user.id, nextStatus, currentAdminEmail);
    setUsers(prev => prev.map(u => u.id === user.id ? { ...u, active: nextStatus } : u));
    onUserUpdated?.();
    showNotification(`User ${user.fullName} has been ${nextStatus ? "activated" : "deactivated"}.`);
  };

  const handleSaveUserRole = async () => {
    if (!editingUser) return;
    await updateUserRole(editingUser.id, newRoleInput, newDeptInput, currentAdminEmail);
    setUsers(prev => prev.map(u => u.id === editingUser.id ? { ...u, role: newRoleInput, department: newDeptInput } : u));
    onUserUpdated?.();
    setEditingUser(null);
    showNotification(`Updated role for ${editingUser.fullName} to ${newRoleInput.toUpperCase()}.`);
  };

  // Team Actions
  const handleToggleTeam = async (team: FieldTeamMeta) => {
    const nextStatus = !team.active;
    await toggleTeamStatus(team.id, nextStatus, currentAdminEmail);
    setTeams(prev => prev.map(t => t.id === team.id ? { ...t, active: nextStatus } : t));
    onUserUpdated?.();
    showNotification(`Team ${team.name} has been ${nextStatus ? "activated" : "deactivated"}.`);
  };

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim() || !newTeamLead.trim()) return;

    const created = await createPlatformTeam(
      {
        name: newTeamName.trim(),
        lead: newTeamLead.trim(),
        category: newTeamCategory,
        district: newTeamDistrict,
        department: newTeamDepartment,
        phone: newTeamPhone.trim(),
        membersCount: Number(newTeamMembers) || 4
      },
      currentAdminEmail
    );

    setTeams(prev => [created, ...prev]);
    onUserUpdated?.();
    setShowCreateTeamModal(false);
    setNewTeamName("");
    setNewTeamLead("");
    showNotification(`Created new Field Team squad: ${created.name}.`);
  };

  const handleSaveTeamEdit = async () => {
    if (!editingTeam) return;
    await updatePlatformTeam(editingTeam.id, editingTeam, currentAdminEmail);
    setTeams(prev => prev.map(t => t.id === editingTeam.id ? editingTeam : t));
    onUserUpdated?.();
    setEditingTeam(null);
    showNotification(`Updated configuration for ${editingTeam.name}.`);
  };

  // Filtered lists
  const filteredUsers = users.filter(u => {
    const matchesSearch = u.fullName.toLowerCase().includes(userSearch.toLowerCase()) ||
                          u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
                          (u.department && u.department.toLowerCase().includes(userSearch.toLowerCase()));
    const matchesRole = roleFilter === "ALL" || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const filteredTeams = teams.filter(t =>
    t.name.toLowerCase().includes(teamSearch.toLowerCase()) ||
    t.lead.toLowerCase().includes(teamSearch.toLowerCase()) ||
    t.district.toLowerCase().includes(teamSearch.toLowerCase()) ||
    t.category.toLowerCase().includes(teamSearch.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {actionSuccessMsg && (
        <div className="fixed top-20 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 border border-slate-700 animate-in fade-in slide-in-from-top-4 duration-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold">{actionSuccessMsg}</span>
        </div>
      )}

      {/* Admin Header Banner / Hero Registry Card */}
      <div className="bg-gradient-to-r from-[#EFF6FF] via-[#F0F7FF] to-[#E6F0FA] text-[#0F172A] rounded-2xl p-6 sm:p-7 shadow-xs border border-[#BFDBFE] relative overflow-hidden">
        {/* Subtle Civic / Delhi Cityscape Illustration on Right */}
        <div className="absolute right-0 top-0 bottom-0 w-[420px] md:w-[500px] lg:w-[560px] pointer-events-none overflow-hidden select-none opacity-85">
          <svg
            viewBox="0 0 560 220"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-full object-cover object-right"
            preserveAspectRatio="xMaxYMid slice"
          >
            <defs>
              <linearGradient id="fadeMaskGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
                <stop offset="35%" stopColor="#FFFFFF" stopOpacity="0.45" />
                <stop offset="70%" stopColor="#FFFFFF" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#FFFFFF" stopOpacity="1" />
              </linearGradient>
              <mask id="fadeMask">
                <rect x="0" y="0" width="560" height="220" fill="url(#fadeMaskGrad)" />
              </mask>
              <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#93C5FD" stopOpacity="0.35" />
                <stop offset="50%" stopColor="#DBEAFE" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#FEF3C7" stopOpacity="0.2" />
              </linearGradient>
              <linearGradient id="monumentGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#93C5FD" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#60A5FA" stopOpacity="0.75" />
              </linearGradient>
              <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#FEF08A" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#FDE047" stopOpacity="0" />
              </radialGradient>
            </defs>
            
            <g mask="url(#fadeMask)">
              <rect x="0" y="0" width="560" height="220" fill="url(#skyGrad)" />
              <circle cx="280" cy="110" r="140" fill="url(#sunGlow)" />
              
              {/* Background City Towers */}
              <rect x="420" y="55" width="28" height="165" fill="#BFDBFE" opacity="0.4" rx="2" />
              <rect x="455" y="40" width="36" height="180" fill="#93C5FD" opacity="0.45" rx="3" />
              <polygon points="473,15 465,40 481,40" fill="#93C5FD" opacity="0.45" />
              <rect x="498" y="70" width="40" height="150" fill="#BFDBFE" opacity="0.4" rx="2" />
              <rect x="545" y="45" width="30" height="175" fill="#93C5FD" opacity="0.35" rx="2" />
              
              {/* Midground Skyline */}
              <rect x="70" y="90" width="32" height="130" fill="#BFDBFE" opacity="0.35" rx="2" />
              <rect x="110" y="70" width="38" height="150" fill="#93C5FD" opacity="0.4" rx="2" />
              <rect x="155" y="95" width="44" height="125" fill="#BFDBFE" opacity="0.4" rx="2" />
              <polygon points="129,48 122,70 136,70" fill="#93C5FD" opacity="0.4" />

              {/* Tower Windows */}
              <line x1="465" y1="60" x2="485" y2="60" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="1" />
              <line x1="465" y1="80" x2="485" y2="80" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="1" />
              <line x1="465" y1="100" x2="485" y2="100" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="1" />
              <line x1="465" y1="120" x2="485" y2="120" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="1" />

              {/* Architectural India Gate Monument */}
              <rect x="200" y="200" width="160" height="8" fill="#93C5FD" opacity="0.8" rx="1" />
              <rect x="210" y="194" width="140" height="6" fill="#60A5FA" opacity="0.85" rx="1" />
              <rect x="218" y="190" width="124" height="4" fill="#3B82F6" opacity="0.75" />

              <rect x="224" y="90" width="32" height="100" fill="url(#monumentGrad)" />
              <rect x="304" y="90" width="32" height="100" fill="url(#monumentGrad)" />

              <rect x="232" y="110" width="16" height="45" fill="#60A5FA" opacity="0.6" rx="8" />
              <rect x="312" y="110" width="16" height="45" fill="#60A5FA" opacity="0.6" rx="8" />

              <path
                d="M256,190 L256,130 Q280,105 304,130 L304,190 Z"
                fill="#EEF5FF"
                opacity="0.95"
              />
              <path
                d="M256,190 L256,130 Q280,105 304,130 L304,190"
                stroke="#3B82F6"
                strokeWidth="2.5"
                strokeOpacity="0.7"
                fill="none"
              />

              <rect x="216" y="80" width="128" height="10" fill="#3B82F6" opacity="0.85" rx="1" />
              <rect x="222" y="62" width="116" height="18" fill="url(#monumentGrad)" rx="1" />
              <rect x="228" y="52" width="104" height="10" fill="#2563EB" opacity="0.75" rx="1" />
              <rect x="236" y="44" width="88" height="8" fill="#1D4ED8" opacity="0.8" rx="1" />
              <path d="M258,44 Q280,36 302,44 Z" fill="#2563EB" opacity="0.85" />

              {/* Park Foliage & Trees */}
              <circle cx="190" cy="180" r="22" fill="#6EE7B7" opacity="0.6" />
              <circle cx="175" cy="185" r="18" fill="#34D399" opacity="0.5" />
              <circle cx="205" cy="188" r="16" fill="#10B981" opacity="0.5" />
              <rect x="188" y="195" width="4" height="15" fill="#065F46" opacity="0.6" rx="1" />

              <circle cx="360" cy="180" r="22" fill="#6EE7B7" opacity="0.6" />
              <circle cx="375" cy="185" r="18" fill="#34D399" opacity="0.5" />
              <circle cx="345" cy="188" r="16" fill="#10B981" opacity="0.5" />
              <rect x="358" y="195" width="4" height="15" fill="#065F46" opacity="0.6" rx="1" />

              <circle cx="140" cy="192" r="14" fill="#A7F3D0" opacity="0.45" />
              <circle cx="410" cy="192" r="15" fill="#A7F3D0" opacity="0.45" />

              <rect x="0" y="208" width="560" height="12" fill="#E2E8F0" opacity="0.5" />
              <line x1="0" y1="208" x2="560" y2="208" stroke="#CBD5E1" strokeWidth="1" strokeOpacity="0.6" />

              <path d="M380,60 Q385,55 390,60 Q395,55 400,60" stroke="#3B82F6" strokeWidth="1.5" strokeOpacity="0.4" fill="none" />
              <path d="M410,75 Q414,71 418,75 Q422,71 426,75" stroke="#3B82F6" strokeWidth="1.2" strokeOpacity="0.35" fill="none" />
            </g>
          </svg>
        </div>

        {/* Hero Card Content */}
        <div className="relative z-10">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2.5 flex-wrap mb-2">
                <span className="text-[#2563EB] text-[11px] font-bold tracking-wider uppercase flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-[#2563EB]" />
                  <span>URBANPULSE PLATFORM GOVERNANCE</span>
                </span>
                <span className="bg-[#EDE9FE] text-[#6D28D9] border border-[#DDD6FE] px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono tracking-wide">
                  SUPER ADMIN CLEARANCE
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#0F172A] font-display">
                Platform Administration & System Registry
              </h1>
              <p className="text-[#475569] text-xs sm:text-sm mt-1.5 leading-relaxed font-sans max-w-xl">
                Centralized authority for user roles, squad provisioning, security boundaries, and platform health telemetry.
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0 self-start md:self-auto">
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-2 bg-white hover:bg-[#F8FAFC] text-[#0F172A] px-4 py-2 rounded-xl text-xs font-bold transition-all border border-[#CBD5E1] shadow-2xs cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#2563EB] ${refreshing ? "animate-spin" : ""}`} />
                <span>{refreshing ? "Syncing..." : "Sync Registry"}</span>
              </button>
            </div>
          </div>

          {/* Horizontal Tab / Navigation Row directly under Hero */}
          <div className="flex items-center gap-2 overflow-x-auto pt-6 mt-6 border-t border-[#BFDBFE]/60 text-xs font-semibold scrollbar-none">
            <button
              onClick={() => handleTabSelect("overview")}
              className={`px-4 py-2.5 rounded-xl transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                activeTab === "overview"
                  ? "bg-[#2563EB] text-white shadow-xs font-bold"
                  : "text-[#334155] hover:text-[#0F172A] hover:bg-white/60 font-semibold"
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Platform Overview</span>
            </button>
            <button
              onClick={() => handleTabSelect("users")}
              className={`px-4 py-2.5 rounded-xl transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                activeTab === "users"
                  ? "bg-[#2563EB] text-white shadow-xs font-bold"
                  : "text-[#334155] hover:text-[#0F172A] hover:bg-white/60 font-semibold"
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>User Management ({users.length || 21})</span>
            </button>
            <button
              onClick={() => handleTabSelect("teams")}
              className={`px-4 py-2.5 rounded-xl transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                activeTab === "teams"
                  ? "bg-[#2563EB] text-white shadow-xs font-bold"
                  : "text-[#334155] hover:text-[#0F172A] hover:bg-white/60 font-semibold"
              }`}
            >
              <Briefcase className="w-3.5 h-3.5" />
              <span>Team Management ({teams.length || 5})</span>
            </button>
            <button
              onClick={() => handleTabSelect("system")}
              className={`px-4 py-2.5 rounded-xl transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                activeTab === "system"
                  ? "bg-[#2563EB] text-white shadow-xs font-bold"
                  : "text-[#334155] hover:text-[#0F172A] hover:bg-white/60 font-semibold"
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>System Health</span>
            </button>
            <button
              onClick={() => handleTabSelect("audit")}
              className={`px-4 py-2.5 rounded-xl transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                activeTab === "audit"
                  ? "bg-[#2563EB] text-white shadow-xs font-bold"
                  : "text-[#334155] hover:text-[#0F172A] hover:bg-white/60 font-semibold"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Audit Trail</span>
            </button>
            <button
              onClick={() => handleTabSelect("settings")}
              className={`px-4 py-2.5 rounded-xl transition flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                activeTab === "settings"
                  ? "bg-[#2563EB] text-white shadow-xs font-bold"
                  : "text-[#334155] hover:text-[#0F172A] hover:bg-white/60 font-semibold"
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Platform Settings</span>
            </button>
          </div>
        </div>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* High-Level Metric Tiles (Row of 4 Pastel-Tinted Cards) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* Card 1: Registered Citizens -> Soft Blue */}
            <div className="bg-[#EEF5FF] border border-[#D6E6FE] p-5 rounded-2xl shadow-xs flex flex-col justify-between min-h-[140px] transition-all hover:border-[#BFDBFE]">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-blue-100 text-[#2563EB] flex items-center justify-center font-bold shadow-2xs">
                      <Users className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-bold text-[#1E293B]">Registered Citizens</span>
                  </div>
                  <BarChart2 className="w-4 h-4 text-[#2563EB]" />
                </div>
                <p className="text-3xl font-black text-[#0F172A] mt-3 font-display">
                  {users.filter(u => u.role === "citizen").length || 13}
                </p>
              </div>
              <div className="text-[11px] text-[#64748B] mt-2 flex items-center gap-1.5 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
                <span className="text-[#16A34A] font-bold">100% Active</span>
                <span>• Civic mobile & web</span>
              </div>
            </div>

            {/* Card 2: Municipal Officers -> Soft Lavender */}
            <div className="bg-[#F5F1FF] border border-[#E5DEFF] p-5 rounded-2xl shadow-xs flex flex-col justify-between min-h-[140px] transition-all hover:border-[#DDD6FE]">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-purple-100 text-[#7C3AED] flex items-center justify-center font-bold shadow-2xs">
                      <ShieldAlert className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-bold text-[#1E293B]">Municipal Officers</span>
                  </div>
                  <BarChart2 className="w-4 h-4 text-[#7C3AED]" />
                </div>
                <p className="text-3xl font-black text-[#0F172A] mt-3 font-display">
                  {users.filter(u => u.role === "municipal").length || 3}
                </p>
              </div>
              <div className="text-[11px] text-[#64748B] mt-2 flex items-center gap-1.5 font-medium">
                <span>PWD, Power Grid & Sanitation</span>
              </div>
            </div>

            {/* Card 3: Operational Field Squads -> Soft Warm Cream/Orange */}
            <div className="bg-[#FFF8EC] border border-[#FEDCB0] p-5 rounded-2xl shadow-xs flex flex-col justify-between min-h-[140px] transition-all hover:border-[#FDE68A]">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-amber-100 text-[#D97706] flex items-center justify-center font-bold shadow-2xs">
                      <Briefcase className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-bold text-[#1E293B]">Operational Field Squads</span>
                  </div>
                  <BarChart2 className="w-4 h-4 text-[#D97706]" />
                </div>
                <p className="text-3xl font-black text-[#0F172A] mt-3 font-display">
                  {teams.filter(t => t.active !== false).length || 5}
                </p>
              </div>
              <div className="text-[11px] text-[#64748B] mt-2 flex items-center gap-1.5 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
                <span className="text-[#16A34A] font-bold">{teams.filter(t => t.availability === "AVAILABLE").length || 5} Ready</span>
                <span>• Rapid response fleet</span>
              </div>
            </div>

            {/* Card 4: AI Neural Engine -> Soft Mint/Green */}
            <div className="bg-[#EFFAF5] border border-[#CFEFE1] p-5 rounded-2xl shadow-xs flex flex-col justify-between min-h-[140px] transition-all hover:border-[#A7F3D0]">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-emerald-100 text-[#059669] flex items-center justify-center font-bold shadow-2xs">
                      <Cpu className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-bold text-[#1E293B]">AI Neural Engine</span>
                  </div>
                  <BarChart2 className="w-4 h-4 text-[#059669]" />
                </div>
                <p className="text-3xl font-black text-[#0F172A] mt-3 font-display">Gemini 2.5</p>
              </div>
              <div className="text-[11px] text-[#16A34A] font-medium mt-2 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" />
                <span className="font-bold">99.8% Availability</span>
                <span className="text-[#64748B]">• 640ms Avg</span>
              </div>
            </div>
          </div>

          {/* Lower Two-Column Section: Role Separation Matrix (8 cols) & Governance Actions (4 cols) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left 8 Cols: Strict Architectural Role Separation Matrix */}
            <div className="lg:col-span-8 bg-white border border-[#E2E8F0] rounded-2xl p-6 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#EEF5FF] text-[#2563EB] flex items-center justify-center font-bold">
                    <Lock className="w-4 h-4 text-[#2563EB]" />
                  </div>
                  <h2 className="text-sm font-bold text-[#0F172A]">
                    Strict Architectural Role Separation Matrix
                  </h2>
                </div>
                
                <button
                  type="button"
                  onClick={() => setShowMatrixModal(true)}
                  className="px-3 py-1 bg-[#EEF5FF] hover:bg-[#DBEAFE] text-[#2563EB] border border-[#BFDBFE] rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors self-start sm:self-auto cursor-pointer"
                >
                  <span>VIEW MATRIX</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <p className="text-xs text-[#64748B] leading-relaxed">
                UrbanPulse Guardian enforces four mutually exclusive operational domains. Role crossing is blocked at both client route guards and backend database rules.
              </p>

              {/* 4 Pastel Role Cards in 2x2 Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
                
                {/* 1. Citizen Role */}
                <div className="p-4 bg-[#EEF5FF]/70 border border-[#D6E6FE] rounded-xl text-xs space-y-2">
                  <div className="flex items-center justify-between font-bold text-[#0F172A]">
                    <div className="flex items-center gap-2">
                      <Users className="w-3.5 h-3.5 text-[#2563EB]" />
                      <span>1. Citizen Role</span>
                    </div>
                    <span className="bg-[#DBEAFE] text-[#1D4ED8] text-[9.5px] px-2 py-0.5 rounded font-mono font-bold tracking-wider">
                      CLIENT
                    </span>
                  </div>
                  <p className="text-[11px] text-[#475569] leading-relaxed">
                    Report civic hazards, track own submission timelines, view verified resolution evidence, earn civic points. Cannot access municipal triage or field tools.
                  </p>
                </div>

                {/* 2. Municipal Role */}
                <div className="p-4 bg-[#F5F1FF]/70 border border-[#E5DEFF] rounded-xl text-xs space-y-2">
                  <div className="flex items-center justify-between font-bold text-[#0F172A]">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="w-3.5 h-3.5 text-[#7C3AED]" />
                      <span>2. Municipal Role</span>
                    </div>
                    <span className="bg-[#EDE9FE] text-[#6D28D9] text-[9.5px] px-2 py-0.5 rounded font-mono font-bold tracking-wider">
                      OPERATIONS
                    </span>
                  </div>
                  <p className="text-[11px] text-[#475569] leading-relaxed">
                    Review city reports, confirm priority, assign registered Field Teams, monitor SLAs, and approve/reject submitted field repairs.
                  </p>
                </div>

                {/* 3. Field Team Role */}
                <div className="p-4 bg-[#FFF8EC]/70 border border-[#FEDCB0] rounded-xl text-xs space-y-2">
                  <div className="flex items-center justify-between font-bold text-[#0F172A]">
                    <div className="flex items-center gap-2">
                      <Briefcase className="w-3.5 h-3.5 text-[#D97706]" />
                      <span>3. Field Team Role</span>
                    </div>
                    <span className="bg-[#FEF3C7] text-[#B45309] text-[9.5px] px-2 py-0.5 rounded font-mono font-bold tracking-wider">
                      FIELD OPERATIONS
                    </span>
                  </div>
                  <p className="text-[11px] text-[#475569] leading-relaxed">
                    View assigned tasks, transition workflow (Accept → En Route → On Site), submit ground verification, upload before/after photos, request resolution. Cannot approve own work.
                  </p>
                </div>

                {/* 4. Admin Role */}
                <div className="p-4 bg-[#EFFAF5]/70 border border-[#CFEFE1] rounded-xl text-xs space-y-2">
                  <div className="flex items-center justify-between font-bold text-[#0F172A]">
                    <div className="flex items-center gap-2">
                      <Lock className="w-3.5 h-3.5 text-[#059669]" />
                      <span>4. Admin Role</span>
                    </div>
                    <span className="bg-[#D1FAE5] text-[#047857] text-[9.5px] px-2 py-0.5 rounded font-mono font-bold tracking-wider">
                      SUPER ADMIN
                    </span>
                  </div>
                  <p className="text-[11px] text-[#475569] leading-relaxed">
                    Platform user management, squad creation and configuration, system health monitoring, audit trail inspection, and global security policies.
                  </p>
                </div>
              </div>
            </div>

            {/* Right 4 Cols: Governance Actions */}
            <div className="lg:col-span-4 bg-white border border-[#E2E8F0] rounded-2xl p-6 shadow-xs space-y-4 flex flex-col justify-between">
              <div>
                <h2 className="text-sm font-bold text-[#0F172A] flex items-center gap-2 mb-3.5">
                  <Settings className="w-4 h-4 text-[#2563EB]" />
                  <span>Governance Actions</span>
                </h2>

                <div className="space-y-2.5">
                  {/* Action 1 */}
                  <button
                    type="button"
                    onClick={() => setActiveTab("users")}
                    className="w-full flex items-center justify-between p-3 rounded-xl border border-[#E2E8F0] hover:border-[#2563EB] hover:bg-[#EEF5FF]/40 transition text-left group cursor-pointer shadow-2xs"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-[#EEF5FF] text-[#2563EB] flex items-center justify-center font-bold text-xs shrink-0">
                        <Users className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-[#0F172A] group-hover:text-[#2563EB] transition-colors">
                          Manage User Access
                        </h4>
                        <p className="text-[11px] text-[#64748B]">Promote roles or deactivate accounts</p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#94A3B8] group-hover:text-[#2563EB] transition-transform group-hover:translate-x-0.5" />
                  </button>

                  {/* Action 2 */}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab("teams");
                      setShowCreateTeamModal(true);
                    }}
                    className="w-full flex items-center justify-between p-3 rounded-xl border border-[#E2E8F0] hover:border-[#059669] hover:bg-[#EFFAF5]/40 transition text-left group cursor-pointer shadow-2xs"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-[#EFFAF5] text-[#059669] flex items-center justify-center font-bold text-xs shrink-0">
                        <Plus className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-[#0F172A] group-hover:text-[#059669] transition-colors">
                          Register Field Squad
                        </h4>
                        <p className="text-[11px] text-[#64748B]">Add new dispatch crew to city fleet</p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#94A3B8] group-hover:text-[#059669] transition-transform group-hover:translate-x-0.5" />
                  </button>

                  {/* Action 3 */}
                  <button
                    type="button"
                    onClick={() => setActiveTab("audit")}
                    className="w-full flex items-center justify-between p-3 rounded-xl border border-[#E2E8F0] hover:border-[#D97706] hover:bg-[#FFF8EC]/40 transition text-left group cursor-pointer shadow-2xs"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-[#FFF8EC] text-[#D97706] flex items-center justify-center font-bold text-xs shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-[#0F172A] group-hover:text-[#D97706] transition-colors">
                          System Audit Logs
                        </h4>
                        <p className="text-[11px] text-[#64748B]">View platform activity and security logs</p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#94A3B8] group-hover:text-[#D97706] transition-transform group-hover:translate-x-0.5" />
                  </button>

                  {/* Action 4 */}
                  <button
                    type="button"
                    onClick={() => setActiveTab("settings")}
                    className="w-full flex items-center justify-between p-3 rounded-xl border border-[#E2E8F0] hover:border-[#7C3AED] hover:bg-[#F5F1FF]/40 transition text-left group cursor-pointer shadow-2xs"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-[#F5F1FF] text-[#7C3AED] flex items-center justify-center font-bold text-xs shrink-0">
                        <Settings className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-[#0F172A] group-hover:text-[#7C3AED] transition-colors">
                          Platform Settings
                        </h4>
                        <p className="text-[11px] text-[#64748B]">Configure thresholds and integrations</p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#94A3B8] group-hover:text-[#7C3AED] transition-transform group-hover:translate-x-0.5" />
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-[#E2E8F0] flex items-center justify-between text-[11px] text-[#64748B] font-mono">
                <span>Current Administrator:</span>
                <span className="font-semibold text-[#0F172A]">{adminEmail}</span>
              </div>
            </div>
          </div>

          {/* Live Platform Telemetry & Recent Activity Row */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Recent Administrative Events (8 cols) */}
            <div className="lg:col-span-8 bg-white border border-[#E2E8F0] rounded-2xl p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#F1F5F9] text-[#2563EB] flex items-center justify-center font-bold">
                    <FileText className="w-4 h-4 text-[#2563EB]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#0F172A]">Recent Administrative Audit Events</h3>
                    <p className="text-[11px] text-[#64748B]">Real-time immutable ledger of platform access & security boundaries</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab("audit")}
                  className="text-xs font-bold text-[#2563EB] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <span>View All Logs</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="divide-y divide-[#F1F5F9] border border-[#E2E8F0] rounded-xl overflow-hidden bg-[#FAFCFF]">
                {auditLogs.slice(0, 4).map((log) => (
                  <div key={log.id} className="p-3 hover:bg-white transition flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-2 h-2 rounded-full bg-[#2563EB] shrink-0" />
                      <div className="min-w-0">
                        <span className="font-semibold text-[#0F172A]">{log.action}</span>
                        <span className="text-[11px] text-[#64748B] block truncate font-mono">Actor: {log.adminEmail || "system_governance"}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-[11px] font-mono">
                      <span className="text-[#94A3B8]">{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="px-2 py-0.5 rounded-full font-bold bg-[#EFF6FF] text-[#2563EB] border border-[#DBEAFE] text-[10px]">
                        VERIFIED
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Operational Squad SLA & Readiness Status (4 cols) */}
            <div className="lg:col-span-4 bg-white border border-[#E2E8F0] rounded-2xl p-6 shadow-xs space-y-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-[#F0FDF4] text-[#16A34A] flex items-center justify-center font-bold">
                      <Briefcase className="w-4 h-4 text-[#16A34A]" />
                    </div>
                    <h3 className="text-sm font-bold text-[#0F172A]">Squad Fleet Readiness</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab("teams")}
                    className="text-xs font-bold text-[#2563EB] hover:underline cursor-pointer"
                  >
                    View All
                  </button>
                </div>

                <div className="space-y-2.5">
                  {teams.slice(0, 3).map((t) => (
                    <div key={t.id} className="p-2.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl flex items-center justify-between text-xs">
                      <div>
                        <div className="font-bold text-[#0F172A]">{t.name}</div>
                        <div className="text-[10px] text-[#64748B]">{t.district} • {t.membersCount} crew members</div>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#F0FDF4] text-[#16A34A] border border-[#BBF7D0]">
                        READY
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-[#E2E8F0] flex items-center justify-between text-[11px] font-mono text-[#64748B]">
                <span>Dispatch SLA Target:</span>
                <span className="font-bold text-[#16A34A]">&lt; 45 Mins Ground Response</span>
              </div>
            </div>
          </div>

          {/* Modal for View Matrix */}
          {showMatrixModal && (
            <div className="fixed inset-0 z-50 bg-[#0F172A]/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-[#E2E8F0] space-y-4 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
                  <div className="flex items-center gap-2">
                    <Lock className="w-5 h-5 text-[#2563EB]" />
                    <h3 className="font-bold text-base text-[#0F172A]">Security Domain & Route Separation Matrix</h3>
                  </div>
                  <button
                    onClick={() => setShowMatrixModal(false)}
                    className="p-1 rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-3 text-xs text-[#475569]">
                  <p>
                    All routes in UrbanPulse Guardian strictly validate role claims directly from Firebase Authentication tokens before mounting views.
                  </p>
                  <div className="border border-[#E2E8F0] rounded-xl overflow-hidden">
                    <table className="w-full text-left">
                      <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[10px] font-bold text-[#64748B] uppercase">
                        <tr>
                          <th className="p-2.5">Domain</th>
                          <th className="p-2.5">Allowed Role</th>
                          <th className="p-2.5">Route Guard</th>
                          <th className="p-2.5">Write Boundary</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E2E8F0] font-mono text-[11px]">
                        <tr>
                          <td className="p-2.5 font-sans font-semibold text-[#0F172A]">Citizen Civic Portal</td>
                          <td className="p-2.5 text-[#2563EB]">citizen</td>
                          <td className="p-2.5 text-[#16A34A]">Active</td>
                          <td className="p-2.5">Reports creation only</td>
                        </tr>
                        <tr>
                          <td className="p-2.5 font-sans font-semibold text-[#0F172A]">Municipal Operations Deck</td>
                          <td className="p-2.5 text-[#7C3AED]">municipal, admin</td>
                          <td className="p-2.5 text-[#16A34A]">Active</td>
                          <td className="p-2.5">Incident triage & dispatch</td>
                        </tr>
                        <tr>
                          <td className="p-2.5 font-sans font-semibold text-[#0F172A]">Field Squad Operations</td>
                          <td className="p-2.5 text-[#D97706]">field_team, admin</td>
                          <td className="p-2.5 text-[#16A34A]">Active</td>
                          <td className="p-2.5">Status & repair proof uploads</td>
                        </tr>
                        <tr>
                          <td className="p-2.5 font-sans font-semibold text-[#0F172A]">Platform Governance</td>
                          <td className="p-2.5 text-[#DC2626]">admin</td>
                          <td className="p-2.5 text-[#16A34A]">Active</td>
                          <td className="p-2.5">Global registry & credentials</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setShowMatrixModal(false)}
                    className="px-4 py-2 bg-[#2563EB] text-white font-bold text-xs rounded-xl shadow-xs hover:bg-[#1D4ED8]"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: USER MANAGEMENT */}
      {activeTab === "users" && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">User Access Control & Identity</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Manage credentials, assign department affiliations, and toggle account activation.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* Role filter */}
              <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg text-xs font-semibold">
                <button
                  onClick={() => setRoleFilter("ALL")}
                  className={`px-2.5 py-1 rounded ${roleFilter === "ALL" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600"}`}
                >
                  All
                </button>
                <button
                  onClick={() => setRoleFilter("citizen")}
                  className={`px-2.5 py-1 rounded ${roleFilter === "citizen" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600"}`}
                >
                  Citizens
                </button>
                <button
                  onClick={() => setRoleFilter("municipal")}
                  className={`px-2.5 py-1 rounded ${roleFilter === "municipal" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600"}`}
                >
                  Municipal
                </button>
                <button
                  onClick={() => setRoleFilter("field_team")}
                  className={`px-2.5 py-1 rounded ${roleFilter === "field_team" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600"}`}
                >
                  Field Team
                </button>
                <button
                  onClick={() => setRoleFilter("admin")}
                  className={`px-2.5 py-1 rounded ${roleFilter === "admin" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600"}`}
                >
                  Admin
                </button>
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search user or email..."
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  className="pl-8.5 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-blue-500 w-48 sm:w-56"
                />
              </div>
            </div>
          </div>

          {/* Users Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider font-bold text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Department / Affiliation</th>
                  <th className="py-3 px-4">Activity & Points</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      No users match the search criteria.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map(u => (
                    <tr key={u.id} className="hover:bg-slate-50/75 transition">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{u.fullName}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{u.email}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${
                          u.role === "admin"
                            ? "bg-rose-50 text-rose-700 border border-rose-200"
                            : u.role === "municipal"
                            ? "bg-purple-50 text-purple-700 border border-purple-200"
                            : u.role === "field_team"
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : "bg-blue-50 text-blue-700 border border-blue-200"
                        }`}>
                          {u.role.toUpperCase().replace("_", " ")}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {u.role === "field_team" && u.teamName ? (
                          <div className="font-medium text-slate-800">{u.teamName}</div>
                        ) : (
                          <div className="text-slate-700">{u.department || "General Public"}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-[11px]">
                        {u.role === "citizen" ? (
                          <span className="font-semibold text-emerald-600">{u.points || 0} Points</span>
                        ) : u.role === "field_team" ? (
                          <span className="font-mono text-slate-700">{u.availability || "AVAILABLE"}</span>
                        ) : (
                          <span className="text-slate-400">System Staff</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {u.active !== false ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            <span>Active</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                            <span>Deactivated</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right space-x-2">
                        <button
                          onClick={() => {
                            setEditingUser(u);
                            setNewRoleInput(u.role);
                            setNewDeptInput(u.department || "");
                          }}
                          className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition"
                        >
                          Edit Role
                        </button>
                        <button
                          onClick={() => handleToggleUser(u)}
                          className={`px-2.5 py-1 text-[11px] font-semibold rounded transition ${
                            u.active !== false
                              ? "text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200"
                              : "text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200"
                          }`}
                        >
                          {u.active !== false ? "Deactivate" : "Activate"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: TEAM MANAGEMENT */}
      {activeTab === "teams" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-slate-200 p-5 rounded-xl shadow-xs">
            <div>
              <h2 className="text-base font-bold text-slate-900">Platform Field Squad Registry</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Admin defines and provisions teams. Municipal officers assign incidents to these teams.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search squads..."
                  value={teamSearch}
                  onChange={e => setTeamSearch(e.target.value)}
                  className="pl-8.5 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-blue-500 w-44 sm:w-56"
                />
              </div>

              <button
                onClick={() => setShowCreateTeamModal(true)}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Team</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTeams.map(t => (
              <div
                key={t.id}
                className={`bg-white border rounded-xl p-5 shadow-xs transition relative flex flex-col justify-between ${
                  t.active !== false ? "border-slate-200" : "border-slate-300 opacity-60 bg-slate-50"
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-mono font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">
                        {t.id}
                      </span>
                      <h3 className="text-sm font-bold text-slate-900 mt-1.5 leading-snug">{t.name}</h3>
                    </div>

                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      t.availability === "AVAILABLE"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : t.availability === "BUSY"
                        ? "bg-amber-50 text-amber-700 border border-amber-200"
                        : "bg-slate-100 text-slate-600 border border-slate-200"
                    }`}>
                      {t.availability}
                    </span>
                  </div>

                  <div className="space-y-2 mt-4 text-xs text-slate-600">
                    <div className="flex items-center gap-2">
                      <Briefcase className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-semibold text-slate-700">Category:</span>
                      <span className="truncate">{t.category}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Layers className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-semibold text-slate-700">Department:</span>
                      <span className="truncate">{t.department || getDepartmentForCategory(t.category)}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-semibold text-slate-700">Service Zone:</span>
                      <span>{t.district || t.serviceZone}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-semibold text-slate-700">Supervisor:</span>
                      <span>{t.lead}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-semibold text-slate-700">Emergency Line:</span>
                      <span className="font-mono text-[11px]">{t.phone}</span>
                    </div>
                  </div>
                </div>

                <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500 font-semibold">
                    {t.membersCount || 4} crew members
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditingTeam(t)}
                      className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition flex items-center gap-1"
                    >
                      <Edit2 className="w-3 h-3" />
                      <span>Configure</span>
                    </button>
                    <button
                      onClick={() => handleToggleTeam(t)}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded transition ${
                        t.active !== false
                          ? "text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200"
                          : "text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200"
                      }`}
                    >
                      {t.active !== false ? "Disable" : "Activate"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: SYSTEM HEALTH */}
      {activeTab === "system" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Service 1: Firebase Auth */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
                  <Lock className="w-4 h-4 text-blue-600" />
                  <span>Firebase Authentication</span>
                </div>
                <span className="bg-emerald-50 text-emerald-700 font-bold text-[10px] px-2 py-0.5 rounded border border-emerald-200">
                  HEALTHY
                </span>
              </div>
              <p className="text-xs text-slate-500">
                JWT token issuance, email verification, Google OAuth provider and session lifecycle.
              </p>
              <div className="text-[11px] font-mono text-slate-600 space-y-1 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                <div className="flex justify-between"><span>Provider:</span><span>Identity Platform</span></div>
                <div className="flex justify-between"><span>Latency:</span><span>45ms</span></div>
                <div className="flex justify-between"><span>Security:</span><span>Strict RBAC</span></div>
              </div>
            </div>

            {/* Service 2: Cloud Firestore */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
                  <Server className="w-4 h-4 text-purple-600" />
                  <span>Cloud Firestore NoSQL</span>
                </div>
                <span className="bg-emerald-50 text-emerald-700 font-bold text-[10px] px-2 py-0.5 rounded border border-emerald-200">
                  HEALTHY
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Real-time snapshots, incident reports index, spatial documents, and immutable history log.
              </p>
              <div className="text-[11px] font-mono text-slate-600 space-y-1 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                <div className="flex justify-between"><span>Database:</span><span>Default (eur3)</span></div>
                <div className="flex justify-between"><span>Write Avg:</span><span>110ms</span></div>
                <div className="flex justify-between"><span>Listeners:</span><span>Active (Live Sync)</span></div>
              </div>
            </div>

            {/* Service 3: Gemini Vision AI */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
                  <Cpu className="w-4 h-4 text-emerald-600" />
                  <span>Gemini 2.5 / 3.5 Engine</span>
                </div>
                <span className="bg-emerald-50 text-emerald-700 font-bold text-[10px] px-2 py-0.5 rounded border border-emerald-200">
                  HEALTHY
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Hazard detection, spatial deduplication (<span className="font-mono">r &lt; 5m</span>), and repair severity scoring.
              </p>
              <div className="text-[11px] font-mono text-slate-600 space-y-1 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                <div className="flex justify-between"><span>Model:</span><span>gemini-2.5-flash</span></div>
                <div className="flex justify-between"><span>Inference:</span><span>640ms</span></div>
                <div className="flex justify-between"><span>Status:</span><span>Operational</span></div>
              </div>
            </div>
          </div>

          {/* System Rate Limits & SLA Config */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-600" />
              <span>SLA Target Parameters by Priority Tier</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg">
                <span className="font-bold text-rose-800">Critical Priority</span>
                <p className="text-xl font-extrabold text-rose-900 mt-1">4 Hours</p>
                <p className="text-[11px] text-rose-700 mt-0.5">Highways, main arteries, sinkholes</p>
              </div>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <span className="font-bold text-amber-800">High Priority</span>
                <p className="text-xl font-extrabold text-amber-900 mt-1">12 Hours</p>
                <p className="text-[11px] text-amber-700 mt-0.5">Traffic corridor obstacles, deep potholes</p>
              </div>
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <span className="font-bold text-blue-800">Medium Priority</span>
                <p className="text-xl font-extrabold text-blue-900 mt-1">24 Hours</p>
                <p className="text-[11px] text-blue-700 mt-0.5">Secondary street surfaces, streetlights</p>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="font-bold text-slate-800">Low Priority</span>
                <p className="text-xl font-extrabold text-slate-900 mt-1">48 Hours</p>
                <p className="text-[11px] text-slate-700 mt-0.5">Surface cracks, cosmetic graffiti</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: AUDIT TRAIL */}
      {activeTab === "audit" && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Platform Security & Governance Ledger</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Audited timeline of administrative decisions, role modifications, and system triggers.
              </p>
            </div>
            <span className="text-[11px] font-mono bg-slate-100 text-slate-600 px-2 py-1 rounded border border-slate-200">
              IMMUTABLE FIRESTORE AUDIT
            </span>
          </div>

          <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
            {auditLogs.map(log => (
              <div key={log.id} className="p-4 hover:bg-slate-50/75 transition flex items-start gap-3">
                <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                <div className="space-y-1 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 font-mono">{log.action}</span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">{log.details}</p>
                  <div className="flex items-center gap-2 text-[10px] text-slate-400">
                    <span>Actor: <strong className="text-slate-700">{log.actorEmail}</strong></span>
                    <span>•</span>
                    <span className="uppercase font-mono font-bold text-blue-600">{log.actorRole}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 6: SETTINGS */}
      {activeTab === "settings" && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6">
          <div>
            <h2 className="text-base font-bold text-slate-900">Global City Configuration</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Tune automated hazard deduplication radii, AI confidence threshold, and notifications.
            </p>
          </div>

          <div className="space-y-4 max-w-xl text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                AI Deduplication Proximity Threshold (meters)
              </label>
              <input
                type="number"
                defaultValue={5}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Submissions within 5 meters of an existing active incident are automatically grouped into a single cluster.
              </p>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Emergency SOS Dispatch Escalation
              </label>
              <select className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800">
                <option value="AUTO_ALL">Broadcast to All Online Squads Immediately</option>
                <option value="MUNICIPAL_FIRST">Alert Municipal Command Center First</option>
              </select>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => showNotification("Platform configuration successfully saved.")}
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-lg transition"
              >
                Save Global Configuration
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDIT USER ROLE */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xl max-w-md w-full space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Edit User Role & Clearance: {editingUser.fullName}
            </h3>
            <p className="text-xs text-slate-500">
              Select the appropriate authority domain for <span className="font-mono text-slate-700">{editingUser.email}</span>.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">System Role</label>
                <select
                  value={newRoleInput}
                  onChange={e => setNewRoleInput(e.target.value as UserRole)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 font-semibold"
                >
                  <option value="citizen">CITIZEN (Report & Track)</option>
                  <option value="municipal">MUNICIPAL (Command Center & Dispatch)</option>
                  <option value="field_team">FIELD TEAM (Ground Crew & Execution)</option>
                  <option value="admin">ADMIN (Platform Governance)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Department / Division</label>
                <input
                  type="text"
                  placeholder="e.g. Roads & Highway Authority (PWD)"
                  value={newDeptInput}
                  onChange={e => setNewDeptInput(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setEditingUser(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveUserRole}
                className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CREATE SQUAD */}
      {showCreateTeamModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xl max-w-lg w-full space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Provision New Field Operations Squad</h3>
            <p className="text-xs text-slate-500">
              Register a new operational crew into the city fleet registry.
            </p>

            <form onSubmit={handleCreateTeam} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Squad Name</label>
                <input
                  type="text"
                  placeholder="e.g. Rapid Asphalt Recovery Unit"
                  value={newTeamName}
                  onChange={e => setNewTeamName(e.target.value)}
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Lead Supervisor</label>
                  <input
                    type="text"
                    placeholder="Supervisor Name"
                    value={newTeamLead}
                    onChange={e => setNewTeamLead(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Category</label>
                  <select
                    value={newTeamCategory}
                    onChange={e => {
                      setNewTeamCategory(e.target.value);
                      setNewTeamDepartment(getDepartmentForCategory(e.target.value));
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800"
                  >
                    <option value="Pothole">Pothole & Surface Repair</option>
                    <option value="Broken Streetlight">Electrical & Streetlights</option>
                    <option value="Garbage Overflow">Sanitation & Drainage</option>
                    <option value="Road Obstruction">Road Obstruction Response</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Service Zone</label>
                  <input
                    type="text"
                    placeholder="e.g. Central Zone"
                    value={newTeamDistrict}
                    onChange={e => setNewTeamDistrict(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Emergency Phone</label>
                  <input
                    type="text"
                    value={newTeamPhone}
                    onChange={e => setNewTeamPhone(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateTeamModal(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
                >
                  Create Squad
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDIT TEAM */}
      {editingTeam && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xl max-w-md w-full space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Configure Squad: {editingTeam.name}</h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Squad Name</label>
                <input
                  type="text"
                  value={editingTeam.name}
                  onChange={e => setEditingTeam({ ...editingTeam, name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Supervisor Lead</label>
                <input
                  type="text"
                  value={editingTeam.lead}
                  onChange={e => setEditingTeam({ ...editingTeam, lead: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Service Zone</label>
                <input
                  type="text"
                  value={editingTeam.district}
                  onChange={e => setEditingTeam({ ...editingTeam, district: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Availability</label>
                <select
                  value={editingTeam.availability}
                  onChange={e => setEditingTeam({ ...editingTeam, availability: e.target.value as any })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800"
                >
                  <option value="AVAILABLE">AVAILABLE</option>
                  <option value="BUSY">BUSY</option>
                  <option value="OFFLINE">OFFLINE</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setEditingTeam(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTeamEdit}
                className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
              >
                Save Squad Config
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
