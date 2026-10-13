import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { 
  DoorOpen, 
  ArrowLeft, 
  ClipboardList, 
  Code2, 
  Users, 
  ShieldCheck,
  Video
} from 'lucide-react';

export const RoomPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  return (
    <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
      {/* Navigation breadcrumb */}
      <div className="mb-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Dashboard</span>
        </Link>
      </div>

      {/* Room Hero Banner */}
      <div className="glass-panel rounded-3xl p-6 sm:p-8 mb-8 relative overflow-hidden">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-700 dark:text-indigo-400 text-xs font-medium mb-3">
            <DoorOpen className="w-3.5 h-3.5" />
            <span>Classroom Session &bull; Protected Route</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Classroom: <span className="font-mono text-indigo-600 dark:text-indigo-400">{id}</span>
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Welcome to room <span className="font-semibold">{id}</span>. This collaborative workspace features real-time audio/video, synchronized code editor, interactive whiteboard, and chat.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              to={`/rooms/${id}/attendance`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-sm"
            >
              <ClipboardList className="w-3.5 h-3.5" />
              <span>View Attendance</span>
            </Link>
            <Link
              to="/playground"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Personal Playground</span>
            </Link>
          </div>
        </div>

        <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-10 dark:opacity-10 pointer-events-none flex items-center justify-center">
          <Video className="w-64 h-64 text-indigo-600 dark:text-indigo-400" />
        </div>
      </div>

      {/* Feature Preview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-panel p-6 rounded-2xl">
          <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-3">
            <Users className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Participants & Presence</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Live roster, host controls, and per-student media and code permissions.</p>
        </div>

        <div className="glass-panel p-6 rounded-2xl">
          <div className="w-9 h-9 rounded-xl bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400 mb-3">
            <Code2 className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Collaborative Editor</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Multi-language Monaco editor with remote execution powered by Piston.</p>
        </div>

        <div className="glass-panel p-6 rounded-2xl">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-3">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Access Control Active</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Authenticated visitor verified. Route protection working as expected (FR-1.4).</p>
        </div>
      </div>
    </main>
  );
};

export default RoomPage;
