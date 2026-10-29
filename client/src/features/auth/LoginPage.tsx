import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ThemeToggle } from '../../components/ui/ThemeToggle';
import { Logo } from '../../components/ui/Logo';
import { 
  Mail, 
  Lock, 
  Eye, 
  EyeOff, 
  AlertCircle, 
  CheckCircle2,
  Loader2, 
  ArrowRight, 
  UserPlus 
} from 'lucide-react';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn } = useAuth();

  // If redirected from ResetPasswordPage or other routes with state
  const stateData = location.state as { from?: any; successMessage?: string; email?: string } | undefined;
  const successMessage = stateData?.successMessage;

  const [email, setEmail] = useState(stateData?.email || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Where to redirect after login (default to '/', respects ?redirect= query param for AC 2.2.2 or location.state?.from)
  const searchParams = new URLSearchParams(location.search);
  const redirectParam = searchParams.get('redirect');
  const fromState = (location.state as { from?: any })?.from;
  let from = redirectParam || '/';

  if (!redirectParam) {
    if (typeof fromState === 'string') {
      from = fromState;
    } else if (fromState && typeof fromState === 'object' && fromState.pathname) {
      from = `${fromState.pathname}${fromState.search || ''}${fromState.hash || ''}`;
    }
  }

  // Safety check: Avoid redirect loop if from points to auth pages
  if (from === '/login' || from === '/signup' || from === '/signin') {
    from = '/';
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedEmail = email.trim();
    if (!trimmedEmail && !password) {
      setError('Please enter both your email address and password.');
      return;
    }
    if (!trimmedEmail) {
      setError('Please enter your email address.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: signInError } = await signIn(trimmedEmail, password);

      if (signInError) {
        // Acceptance Criteria: Incorrect credentials show: "Incorrect email or password."
        const msg = signInError.message?.toLowerCase() || '';
        if (
          msg.includes('invalid') || 
          msg.includes('credential') || 
          msg.includes('grant') || 
          msg.includes('password') || 
          msg.includes('not found') ||
          msg.includes('unconfirmed') ||
          signInError.status === 400
        ) {
          setError('Incorrect email or password.');
        } else if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('fetch')) {
          setError('Unable to connect to the authentication server. Please check your network connection.');
        } else {
          setError(signInError.message || 'Incorrect email or password.');
        }
        setLoading(false);
        return;
      }

      // Successful login -> Redirect to requested page or Dashboard / Admin (AC 1.1.3)
      const isAdminLogin = trimmedEmail.toLowerCase() === 'support@gmail.com';
      const destination = from === '/' && isAdminLogin ? '/admin' : from;
      navigate(destination, { replace: true });
    } catch (err: any) {
      const msg = err?.message?.toLowerCase() || '';
      if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('fetch')) {
        setError('Unable to connect to the authentication server. Please check your network connection.');
      } else {
        setError(err?.message || 'Incorrect email or password.');
      }
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen ambient-bg flex items-center justify-center p-4 sm:p-6 lg:p-8 relative transition-colors duration-300">
      {/* Top Bar Theme Toggle */}
      <div className="absolute top-5 right-5 sm:top-6 sm:right-6 z-20">
        <ThemeToggle />
      </div>

      {/* Ambient background glow effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-500/15 dark:bg-indigo-500/15 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-purple-500/10 dark:bg-purple-500/15 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <Logo size="lg" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight heading-gradient block">
            Welcome back
          </h1>
          <p className="mt-2 text-sm brand-subtext">
            Sign in to continue to <span className="font-semibold text-slate-900 dark:text-slate-100">LinkUp</span>
          </p>
        </div>

        {/* Card */}
        <div className="glass-panel rounded-2xl p-6 sm:p-8 shadow-xl">
          {/* Success Alert (e.g. from password reset) */}
          {successMessage && (
            <div 
              role="status" 
              className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 flex items-start gap-3 animate-fadeIn"
              data-testid="login-success-alert"
            >
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-500 dark:text-emerald-400" />
              <div className="text-sm font-medium leading-snug">{successMessage}</div>
            </div>
          )}

          {/* Error Alert */}
          {error && (
            <div 
              role="alert" 
              className="mb-6 error-alert animate-fadeIn"
              data-testid="login-error-alert"
            >
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-500 dark:text-red-400" />
              <div className="leading-snug">
                <div className="text-sm font-medium">{error}</div>
                {error === 'Incorrect email or password.' && (
                  <div className="mt-2 pt-2 border-t border-red-200/50 dark:border-red-900/50">
                    <Link 
                      to="/signup" 
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-300 hover:underline underline-offset-2"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      Don't have an account? Sign up here &rarr;
                    </Link>
                  </div>
                )}
              </div>
            </div>
          )}

          <form onSubmit={handleLogin} noValidate className="space-y-5">
            {/* Email Field */}
            <div>
              <label 
                htmlFor="login-email" 
                className="block text-xs font-semibold uppercase tracking-wider form-label mb-1.5"
              >
                Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="name@university.edu"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError(null);
                  }}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none bg-inputBg border border-inputBorder focus:border-primary focus:ring-primary/20"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label 
                  htmlFor="login-password" 
                  className="block text-xs font-semibold uppercase tracking-wider form-label"
                >
                  Password
                </label>
                <Link
                  to="/forgot-password"
                  state={email ? { email: email.trim() } : undefined}
                  id="forgot-password-link"
                  data-testid="forgot-password-link"
                  className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 hover:underline underline-offset-2 transition-colors cursor-pointer"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError(null);
                  }}
                  className="w-full pl-10 pr-11 py-2.5 rounded-xl text-sm outline-none bg-inputBg border border-inputBorder focus:border-primary focus:ring-primary/20"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              id="login-submit"
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 px-4 rounded-xl font-semibold text-sm text-white bg-primary-500 hover:bg-primary-600 active:scale-[0.99] transition-all shadow-md shadow-primary-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Link to Sign Up */}
          <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800 text-center text-xs brand-subtext">
            Don't have an account yet?{' '}
            <Link 
              to="/signup" 
              className="font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 transition-colors underline underline-offset-4"
            >
              Sign up
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
