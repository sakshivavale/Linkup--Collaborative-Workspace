import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { api } from '../../lib/api';
import { socket } from '../../lib/socket';
import { SignUpFormData, SignUpFormErrors } from '../../types/auth';
import { ThemeToggle } from '../../components/ui/ThemeToggle';
import { Logo } from '../../components/ui/Logo';
import { 
  GraduationCap, 
  BookOpen, 
  Mail, 
  Lock, 
  User, 
  Eye, 
  EyeOff, 
  AlertCircle, 
  Loader2, 
  CheckCircle2
} from 'lucide-react';

export const SignupPage: React.FC = () => {
  const navigate = useNavigate();

  const [formData, setFormData] = useState<SignUpFormData>({
    fullName: '',
    email: '',
    password: '',
    role: '',
  });

  const [errors, setErrors] = useState<SignUpFormErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Email format validation regex
  const isValidEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validateForm = (): boolean => {
    const newErrors: SignUpFormErrors = {};

    // 1. Full Name validation (Reject empty or whitespace-only)
    if (!formData.fullName || formData.fullName.trim().length === 0) {
      newErrors.fullName = 'Full Name is required and cannot be whitespace only.';
    } else if (formData.fullName.trim().length > 100) {
      newErrors.fullName = 'Full Name must be less than 100 characters.';
    }

    // 2. Email format validation
    const trimmedEmail = formData.email.trim();
    if (!trimmedEmail) {
      newErrors.email = 'Email address is required.';
    } else if (!isValidEmail(trimmedEmail)) {
      newErrors.email = 'Please enter a valid email address.';
    }

    // 3. Password length validation (Must be at least 8 characters)
    if (!formData.password) {
      newErrors.password = 'Password is required.';
    } else if (formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters.';
    }

    // 4. Role selection validation (Cannot be blank)
    if (!formData.role) {
      newErrors.role = 'Please select your role (Teacher or Student).';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (field: keyof SignUpFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear field-specific error as user types
    if (errors[field] || errors.general) {
      setErrors((prev) => ({ ...prev, [field]: undefined, general: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setErrors({});

    try {
      const cleanFullName = formData.fullName.trim();
      const cleanEmail = formData.email.trim().toLowerCase();

      // Role and approval provisioning (US-1.1 AC 1.1.1 & AC 1.1.2)
      const isTeacherChoice = formData.role === 'teacher';
      const initialRole = isTeacherChoice ? 'TEACHER' : 'STUDENT';
      const isApproved = !isTeacherChoice;
      const initialStatus = isTeacherChoice ? 'PENDING_TEACHER' : 'APPROVED';
      const initialTeacherStatus = isTeacherChoice ? 'pending' : 'approved';

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: formData.password,
        options: {
          data: {
            full_name: cleanFullName,
            role: initialRole,
            requested_role: initialRole,
            status: initialStatus,
            isApproved,
            is_approved: isApproved,
            teacher_status: initialTeacherStatus,
            applied_at: new Date().toISOString(),
          },
        },
      });

      if (error) {
        const errorMsg = error.message.toLowerCase();
        // Check for already-registered email (AC 1.1.4)
        if (
          errorMsg.includes('already registered') ||
          errorMsg.includes('user already exists') ||
          errorMsg.includes('unique constraint') ||
          error.status === 422
        ) {
          setErrors({ general: 'An account with this email address already exists. Please sign in.' });
        } else {
          setErrors({ general: error.message });
        }
        setLoading(false);
        return;
      }

      // Check edge case where Supabase returns existing identity with empty identities array (AC 1.1.4)
      if (data?.user && data.user.identities && data.user.identities.length === 0) {
        setErrors({ general: 'An account with this email address already exists. Please sign in.' });
        setLoading(false);
        return;
      }

      // Ensure profile is synced to public.profiles
      if (data?.user) {
        try {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            full_name: cleanFullName,
            role: isTeacherChoice ? 'teacher' : 'student',
            isApproved,
            is_approved: isApproved,
            status: initialStatus,
          });
        } catch {
          // Handled by database triggers if profiles schema is locked
        }
      }

      // Notify backend via real-time WebSocket hook for instant admin dashboard alert
      if (isTeacherChoice) {
        try {
          await api.post('/api/auth/register-teacher', {
            id: data?.user?.id,
            fullName: cleanFullName,
            email: cleanEmail,
          });
        } catch (notifyErr) {
          console.warn('[Signup] Realtime teacher notify fallback:', notifyErr);
        }
      }

      // Signup successful! Redirect to Dashboard (/)
      navigate('/', { replace: true });
    } catch (err: any) {
      setErrors({ general: err.message || 'An unexpected error occurred during signup.' });
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen ambient-bg flex items-center justify-center p-4 sm:p-6 lg:p-8 relative transition-colors duration-300">
      {/* Top Bar Theme Toggle */}
      <div className="absolute top-5 right-5 sm:top-6 sm:right-6 z-20">
        <ThemeToggle />
      </div>

      {/* Background glow effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-500/15 dark:bg-indigo-500/15 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-purple-500/10 dark:bg-purple-500/15 rounded-full blur-3xl"></div>
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo and Brand Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <Logo size="lg" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight heading-gradient block">
            Create your account
          </h1>
          <p className="mt-2 text-sm brand-subtext">
            Join <span className="font-semibold text-slate-900 dark:text-slate-100">LinkUp</span> collaborative workspace
          </p>
        </div>

        {/* Signup Form Card */}
        <div className="glass-panel rounded-2xl p-6 sm:p-8">
          {/* General Error Banner */}
          {errors.general && (
            <div 
              id="signup-error-banner"
              className="mb-6 error-alert"
            >
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="leading-snug font-medium">{errors.general}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {/* 1. Full Name Field */}
            <div>
              <label htmlFor="fullName" className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                Full Name <span className="text-indigo-500 dark:text-indigo-400">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  id="fullName"
                  name="fullName"
                  type="text"
                  placeholder="e.g. Priya Sharma"
                  value={formData.fullName}
                  onChange={(e) => handleChange('fullName', e.target.value)}
                  className={`glass-input w-full pl-10 pr-4 py-2.5 rounded-xl text-sm placeholder-slate-400 dark:placeholder-slate-500 ${
                    errors.fullName ? 'border-red-500/70 focus:border-red-500 focus:ring-1 focus:ring-red-500' : ''
                  }`}
                />
              </div>
              {errors.fullName && (
                <p id="fullName-error" className="mt-1.5 text-xs text-red-500 dark:text-red-400 flex items-center gap-1 font-medium">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {errors.fullName}
                </p>
              )}
            </div>

            {/* 2. Email Address Field */}
            <div>
              <label htmlFor="email" className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                Email Address <span className="text-indigo-500 dark:text-indigo-400">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="name@university.edu"
                  value={formData.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  className={`glass-input w-full pl-10 pr-4 py-2.5 rounded-xl text-sm placeholder-slate-400 dark:placeholder-slate-500 ${
                    errors.email ? 'border-red-500/70 focus:border-red-500 focus:ring-1 focus:ring-red-500' : ''
                  }`}
                />
              </div>
              {errors.email && (
                <p id="email-error" className="mt-1.5 text-xs text-red-500 dark:text-red-400 flex items-center gap-1 font-medium">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {errors.email}
                </p>
              )}
            </div>

            {/* 3. Password Field */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Password <span className="text-indigo-500 dark:text-indigo-400">*</span>
                </label>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">Minimum 8 characters</span>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={(e) => handleChange('password', e.target.value)}
                  className={`glass-input w-full pl-10 pr-11 py-2.5 rounded-xl text-sm placeholder-slate-400 dark:placeholder-slate-500 ${
                    errors.password ? 'border-red-500/70 focus:border-red-500 focus:ring-1 focus:ring-red-500' : ''
                  }`}
                />
                <button
                  type="button"
                  id="toggle-password-visibility"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && (
                <p id="password-error" className="mt-1.5 text-xs text-red-500 dark:text-red-400 flex items-center gap-1 font-medium">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {errors.password}
                </p>
              )}
            </div>

            {/* 4. Role Selection (Teacher / Student Radio Buttons) */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                I am a: <span className="text-indigo-500 dark:text-indigo-400">*</span>
              </label>
              
              <div className="grid grid-cols-2 gap-3">
                {/* Teacher Option */}
                <label 
                  htmlFor="role-teacher"
                  className={`relative flex flex-col items-center justify-center p-3.5 rounded-xl cursor-pointer border transition-all duration-200 ${
                    formData.role === 'teacher'
                      ? 'bg-indigo-50 border-indigo-500 text-indigo-950 shadow-sm dark:bg-indigo-600/20 dark:border-indigo-500 dark:text-white dark:shadow-glow-indigo'
                      : 'bg-white/60 border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:bg-[#0f172a]/60 dark:border-slate-700/60 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-[#131d35]'
                  }`}
                >
                  <input
                    type="radio"
                    id="role-teacher"
                    name="role"
                    value="teacher"
                    checked={formData.role === 'teacher'}
                    onChange={() => handleChange('role', 'teacher')}
                    className="sr-only"
                  />
                  <div className={`p-2 rounded-lg mb-1.5 ${
                    formData.role === 'teacher' 
                      ? 'bg-indigo-600 text-white dark:bg-indigo-500' 
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                  }`}>
                    <GraduationCap className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-semibold">Teacher</span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 text-center">Host & guide rooms</span>
                  {formData.role === 'teacher' && (
                    <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 absolute top-2 right-2" />
                  )}
                </label>

                {/* Student Option */}
                <label 
                  htmlFor="role-student"
                  className={`relative flex flex-col items-center justify-center p-3.5 rounded-xl cursor-pointer border transition-all duration-200 ${
                    formData.role === 'student'
                      ? 'bg-indigo-50 border-indigo-500 text-indigo-950 shadow-sm dark:bg-indigo-600/20 dark:border-indigo-500 dark:text-white dark:shadow-glow-indigo'
                      : 'bg-white/60 border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:bg-[#0f172a]/60 dark:border-slate-700/60 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-[#131d35]'
                  }`}
                >
                  <input
                    type="radio"
                    id="role-student"
                    name="role"
                    value="student"
                    checked={formData.role === 'student'}
                    onChange={() => handleChange('role', 'student')}
                    className="sr-only"
                  />
                  <div className={`p-2 rounded-lg mb-1.5 ${
                    formData.role === 'student' 
                      ? 'bg-indigo-600 text-white dark:bg-indigo-500' 
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                  }`}>
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-semibold">Student</span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 text-center">Join & learn</span>
                  {formData.role === 'student' && (
                    <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 absolute top-2 right-2" />
                  )}
                </label>
              </div>

              {formData.role === 'teacher' && (
                <div className="mt-2.5 text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-1.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-2.5 rounded-xl">
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Teacher Pending Review:</strong> Your account will be created with status <em>PENDING_TEACHER</em>. Once reviewed and approved, Room Creation and Host Controls will unlock.
                  </span>
                </div>
              )}

              {/* Admin Registration Restriction Notice (AC 1.1.3) */}
              <div className="mt-2.5 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-800/60 p-2.5 rounded-xl">
                <span>
                  <strong>Admin Notice:</strong> Admin registration is disabled on the public signup page. Admins can only log in via the dedicated{' '}
                  <Link to="/signin" className="text-indigo-600 dark:text-indigo-400 underline font-semibold">
                    Sign In
                  </Link>{' '}
                  flow.
                </span>
              </div>

              {errors.role && (
                <p id="role-error" className="mt-2 text-xs text-red-500 dark:text-red-400 flex items-center gap-1 font-medium">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {errors.role}
                </p>
              )}
            </div>

            {/* Submit Button */}
            <button
              id="signup-submit"
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 px-4 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-indigo-600 via-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 active:scale-[0.99] transition-all shadow-md shadow-indigo-500/20 dark:shadow-glow-indigo disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Creating your account...</span>
                </>
              ) : (
                <span>Complete Sign Up</span>
              )}
            </button>
          </form>

          {/* Footer Navigation */}
          <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800/80 text-center text-xs text-slate-600 dark:text-slate-400">
            Already have an account?{' '}
            <Link 
              to="/login" 
              className="font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 transition-colors underline underline-offset-4"
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
