import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { 
  ClipboardList, 
  ArrowLeft, 
  Download, 
  DoorOpen, 
  Clock, 
  UserCheck, 
  ShieldCheck,
  Calendar
} from 'lucide-react';

export const AttendancePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  return (
    <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
      {/* Navigation breadcrumbs */}
      <div className="mb-6 flex items-center gap-4">
        <Link
          to={`/rooms/${id}`}
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition-colors"
        >
          <DoorOpen className="w-3.5 h-3.5" />
          <span>Back to Room {id}</span>
        </Link>
        <span className="text-slate-300 dark:text-slate-700">&bull;</span>
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Dashboard</span>
        </Link>
      </div>

      {/* Hero Header Banner */}
      <div className="glass-panel rounded-3xl p-6 sm:p-8 mb-8 relative overflow-hidden">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-medium mb-3">
            <ClipboardList className="w-3.5 h-3.5" />
            <span>Attendance Tracking &bull; US-ATT-04</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Attendance: Room <span className="font-mono text-indigo-600 dark:text-indigo-400">{id}</span>
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Automated session presence tracking. Accurately tracks first join time, last leave time, total participation duration, and reconnects with grace periods.
          </p>
          <div className="mt-4">
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-not-allowed"
              title="CSV export available in US-ATT-06"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download CSV (P1)</span>
            </button>
          </div>
        </div>

        <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-10 dark:opacity-10 pointer-events-none flex items-center justify-center">
          <Calendar className="w-64 h-64 text-emerald-600 dark:text-emerald-400" />
        </div>
      </div>

      {/* Attendance Records Table Preview */}
      <div className="glass-panel rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-emerald-500" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Active Session Participants</h2>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">Live summary</span>
        </div>

        <div className="p-8 text-center">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 mx-auto flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-3">
            <Clock className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Session Attendance Roster</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
            Real-time presence tracking activates automatically when a live meeting starts in room <span className="font-mono font-medium text-slate-700 dark:text-slate-300">{id}</span>.
          </p>
          <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>Protected Route Verified &bull; FR-1.4 / US-AUTH-04</span>
          </div>
        </div>
      </div>
    </main>
  );
};

export default AttendancePage;
