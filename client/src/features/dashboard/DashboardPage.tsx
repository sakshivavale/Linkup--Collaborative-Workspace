import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { 
  GraduationCap, 
  BookOpen, 
  PlusCircle, 
  DoorOpen, 
  Users,
  CheckCircle2
} from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const { fullName, role } = useAuth();
  const isTeacher = role === 'teacher';

  return (
    <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
      {/* Welcome Banner */}
      <div className="glass-panel rounded-3xl p-6 sm:p-8 mb-8 relative overflow-hidden">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-700 dark:text-indigo-400 text-xs font-medium mb-3">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Authentication Active &bull; US-AUTH-03</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Welcome back, {fullName}!
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            You are signed in as a <span className="font-semibold text-indigo-600 dark:text-indigo-300 capitalize">{role}</span>. 
            {isTeacher 
              ? ' You have full host controls to create classroom rooms and grant per-student permissions for media, code, and whiteboard.' 
              : ' You can join interactive classrooms with a 6-character room code to collaborate with your teachers and peers.'}
          </p>
        </div>

        <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-10 dark:opacity-10 pointer-events-none flex items-center justify-center">
          {isTeacher 
            ? <GraduationCap className="w-64 h-64 text-indigo-600 dark:text-indigo-400" /> 
            : <BookOpen className="w-64 h-64 text-emerald-600 dark:text-emerald-400" />}
        </div>
      </div>

      {/* Action Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {isTeacher ? (
          <div className="glass-panel p-6 rounded-2xl hover:border-indigo-500/40 transition-all cursor-pointer group">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-4 group-hover:scale-110 transition-transform">
              <PlusCircle className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Create a Room</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Launch a new classroom session with live video, editor, and whiteboard</p>
          </div>
        ) : null}

        <div className="glass-panel p-6 rounded-2xl hover:border-indigo-500/40 transition-all cursor-pointer group">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-4 group-hover:scale-110 transition-transform">
            <DoorOpen className="w-5 h-5" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Join with Code</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Enter a 6-character room code shared by your teacher</p>
        </div>
      </div>

      {/* Empty state for rooms */}
      <div className="glass-panel rounded-2xl p-10 text-center border-dashed border-slate-300 dark:border-slate-800">
        <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800/80 mx-auto flex items-center justify-center text-slate-500 dark:text-slate-400 mb-3">
          <Users className="w-6 h-6" />
        </div>
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">No rooms active yet</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
          Your classrooms and active sessions will appear here as soon as they are created or joined.
        </p>
      </div>
    </main>
  );
};
