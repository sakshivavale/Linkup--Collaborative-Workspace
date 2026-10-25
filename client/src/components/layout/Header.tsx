import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ThemeToggle } from '../ui/ThemeToggle';
import { Logo } from '../ui/Logo';
import { 
  LogOut, 
  GraduationCap, 
  BookOpen, 
  ChevronDown,
  UserCog,
  Code2,
  Clock
} from 'lucide-react';
import { ProfileSettingsModal } from '../profile/ProfileSettingsModal';

export const Header: React.FC = () => {
  const { user, fullName, role, status, logout } = useAuth();
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isTeacher = (role || '').toLowerCase() === 'teacher';
  const isPendingTeacher = status === 'PENDING_TEACHER';

  // Get initials for avatar fallback (e.g., "SV" or "U")
  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase() || 'U';
  };

  const initials = getInitials(fullName);

  // Close dropdown on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDropdownOpen(false);
      }
    };

    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [dropdownOpen]);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      console.error('[LinkUp] Logout failed:', error);
    } finally {
      setLoggingOut(false);
      setDropdownOpen(false);
    }
  };

  return (
    <header className="border-b border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-[#090d16]/80 backdrop-blur-md sticky top-0 z-50 transition-colors duration-300">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Brand / Logo */}
        <Link to="/" className="flex items-center gap-2 group focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-lg">
          <Logo size="sm" showText={true} />
        </Link>

        {/* Right side controls */}
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Playground Navigation Link */}
          <Link
            to="/playground"
            id="header-nav-playground"
            data-testid="header-nav-playground"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-slate-700 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400 bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-900/90 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <Code2 className="w-3.5 h-3.5 text-indigo-500" />
            <span className="hidden sm:inline">Playground</span>
          </Link>

          {/* Theme Toggle */}
          <ThemeToggle />

          {/* User Avatar Menu Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              id="user-avatar-menu-button"
              type="button"
              onClick={() => setDropdownOpen((prev) => !prev)}
              aria-expanded={dropdownOpen}
              aria-haspopup="true"
              className="flex items-center gap-2 p-1.5 sm:px-3 sm:py-1.5 rounded-full bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-900/90 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {/* Avatar circle */}
              <div 
                className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shadow-sm ${
                  isTeacher
                  ? 'bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white'
                  : isPendingTeacher
                  ? 'bg-gradient-to-tr from-amber-600 to-amber-500 text-white'
                  : 'bg-gradient-to-tr from-emerald-600 to-teal-500 text-white'
              }`}
              >
                {initials}
              </div>

              {/* User details (hidden on small screens) */}
              <div className="hidden sm:flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 max-w-[120px] truncate">
                  {fullName}
                </span>
                <span 
                  className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${
                    isTeacher 
                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300' 
                    : isPendingTeacher
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                  }`}
                >
                  {isPendingTeacher ? 'Pending Teacher' : role}
                </span>
              </div>

              <ChevronDown 
                className={`w-3.5 h-3.5 text-slate-500 dark:text-slate-400 transition-transform duration-200 ${
                  dropdownOpen ? 'rotate-180' : ''
                }`} 
              />
            </button>

            {/* Dropdown Menu */}
            {dropdownOpen && (
              <div 
                id="user-avatar-dropdown"
                role="menu"
                className="absolute right-0 mt-2 w-64 glass-panel rounded-2xl shadow-xl py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150 border border-slate-200 dark:border-slate-800"
              >
                {/* User info card */}
                <div className="px-4 py-3 border-b border-slate-200/70 dark:border-slate-800/70">
                  <p className="text-xs font-medium text-slate-400 dark:text-slate-500">Signed in as</p>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate mt-0.5">
                    {fullName}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {user?.email}
                  </p>
                  <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300">
                    {isPendingTeacher ? (
                      <Clock className="w-3.5 h-3.5 text-amber-500" />
                    ) : isTeacher ? (
                      <GraduationCap className="w-3.5 h-3.5 text-indigo-500" />
                    ) : (
                      <BookOpen className="w-3.5 h-3.5 text-emerald-500" />
                    )}
                    <span className="capitalize">
                      {isPendingTeacher ? 'Teacher (Approval Pending)' : `${role} Account`}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="p-1.5 space-y-1">
                  <Link
                    to="/playground"
                    id="header-dropdown-playground"
                    role="menuitem"
                    onClick={() => setDropdownOpen(false)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <Code2 className="w-4 h-4 text-indigo-500 shrink-0" />
                    <span>Personal Playground</span>
                  </Link>

                  <button
                    id="header-profile-settings-button"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setDropdownOpen(false);
                      setIsSettingsOpen(true);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <UserCog className="w-4 h-4 text-indigo-500 shrink-0" />
                    <span>Profile Settings</span>
                  </button>

                  <button
                    id="header-logout-button"
                    type="button"
                    role="menuitem"
                    onClick={handleLogout}
                    disabled={loggingOut}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 dark:hover:bg-rose-500/20 transition-all focus:outline-none focus:ring-2 focus:ring-rose-500"
                  >
                    <LogOut className="w-4 h-4 shrink-0" />
                    <span>{loggingOut ? 'Signing out...' : 'Sign Out'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Quick Direct Logout Button (Desktop) */}
          <button
            id="quick-logout-button"
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-all focus:outline-none focus:ring-2 focus:ring-rose-500"
            title="Log out of your session"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* Profile Settings Modal (US-AUTH-06) */}
      <ProfileSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </header>
  );
};
