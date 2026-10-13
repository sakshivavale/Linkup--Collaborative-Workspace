import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ThemeToggle } from '../../components/ui/ThemeToggle';
import { Logo } from '../../components/ui/Logo';
import { 
  LogOut, 
  GraduationCap, 
  BookOpen, 
  Sparkles, 
  PlusCircle, 
  DoorOpen, 
  Users,
  CheckCircle2
} from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate('/signup', { replace: true });
        return;
      }
      setUser(session.user);
      setLoading(false);
    };

    fetchUser();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setUser(session.user);
      }
    });

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, [navigate]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#080c14] flex items-center justify-center text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <span>Loading Dashboard...</span>
        </div>
      </div>
    );
  }

  const fullName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';
  const role = user?.user_metadata?.role || 'student';
  const isTeacher = role === 'teacher';

  return (
    <div className="min-h-screen ambient-bg flex flex-col transition-colors duration-300">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-[#090d16]/80 backdrop-blur-md sticky top-0 z-50 transition-colors duration-300">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Logo size="sm" showText={true} />

          <div className="flex items-center gap-3 sm:gap-4">
            {/* Theme Toggle Button */}
            <ThemeToggle />

            {/* User Badge */}
            <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800">
              <div className={`p-1 rounded-full ${
                isTeacher 
                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400' 
                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
              }`}>
                {isTeacher ? <GraduationCap className="w-3.5 h-3.5" /> : <BookOpen className="w-3.5 h-3.5" />}
              </div>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 capitalize">{role}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400 border-l border-slate-300 dark:border-slate-800 pl-2 max-w-[120px] truncate">{fullName}</span>
            </div>

            {/* Logout Button */}
            <button
              onClick={handleSignOut}
              className="p-2 rounded-xl text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all flex items-center gap-1.5 text-xs font-medium"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
        {/* Welcome Banner */}
        <div className="glass-panel rounded-3xl p-6 sm:p-8 mb-8 relative overflow-hidden">
          <div className="relative z-10 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-700 dark:text-indigo-400 text-xs font-medium mb-3">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Authentication Successful &bull; US-AUTH-01</span>
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
    </div>
  );
};
