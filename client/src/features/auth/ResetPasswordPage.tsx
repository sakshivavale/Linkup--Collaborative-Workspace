import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { ThemeToggle } from '../../components/ui/ThemeToggle';
import { Logo } from '../../components/ui/Logo';
import {
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
  ArrowRight,
  ArrowLeft,
  KeyRound,
  Check,
} from 'lucide-react';

// Module-level cache to preserve tokens across React 18 StrictMode mount/unmount cycles
let initialUrlCapture: {
  hash: string;
  search: string;
  errorDesc: string | null;
  code: string | null;
  hasTokens: boolean;
} | null = null;

function getOrCaptureInitialUrl() {
  if (typeof window === 'undefined') {
    return { hash: '', search: '', errorDesc: null, code: null, hasTokens: false };
  }
  if (!initialUrlCapture) {
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    const searchParams = new URLSearchParams(search);
    const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.substring(1) : hash);

    const errorDesc =
      hashParams.get('error_description') ||
      searchParams.get('error_description') ||
      hashParams.get('error') ||
      searchParams.get('error');

    const code = searchParams.get('code');
    const hasTokens =
      Boolean(code) ||
      hash.includes('access_token') ||
      hash.includes('type=recovery');

    initialUrlCapture = {
      hash,
      search,
      errorDesc: errorDesc ? decodeURIComponent(errorDesc.replace(/\+/g, ' ')) : null,
      code,
      hasTokens,
    };
  }
  return initialUrlCapture;
}

export const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const { session: contextSession, updatePassword } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionChecking, setSessionChecking] = useState(true);
  const [hasValidSession, setHasValidSession] = useState(false);
  const [invalidLinkMessage, setInvalidLinkMessage] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;
    const captured = getOrCaptureInitialUrl();

    // Helper to safely strip sensitive tokens/code from browser URL once session is verified
    const sanitizeUrl = () => {
      try {
        if (typeof window !== 'undefined' && (window.location.hash || window.location.search)) {
          window.history.replaceState(null, '', window.location.pathname);
        }
      } catch {
        // Ignore if history state cannot be replaced
      }
    };

    // Helper to confirm session and unlock form
    const confirmValidSession = () => {
      if (isCancelled) return;
      setHasValidSession(true);
      setInvalidLinkMessage(null);
      setSessionChecking(false);
      sanitizeUrl();
    };

    // 1. Check if the URL came with an explicit error from Supabase (e.g. expired or invalid OTP)
    if (captured.errorDesc) {
      setInvalidLinkMessage(
        captured.errorDesc || 'Your password reset link is invalid or has expired. Please request a new one.'
      );
      setSessionChecking(false);
      sanitizeUrl();
      return;
    }

    // 2. If AuthContext already has an active authenticated session, confirm immediately
    if (contextSession) {
      confirmValidSession();
      return;
    }

    // 3. Handle PKCE code exchange if ?code= was present in the incoming URL
    if (captured.code) {
      (async () => {
        try {
          const { data, error: exchangeErr } = await supabase.auth.exchangeCodeForSession(captured.code!);
          if (isCancelled) return;

          if (data?.session) {
            confirmValidSession();
            return;
          }

          if (exchangeErr) {
            // Check if Supabase client auto-exchange already resolved the session
            const { data: { session: existingSession } } = await supabase.auth.getSession();
            if (existingSession) {
              confirmValidSession();
              return;
            }
          }
        } catch {
          const { data: { session: existingSession } } = await supabase.auth.getSession();
          if (existingSession) {
            confirmValidSession();
            return;
          }
        }
      })();
    }

    // 4. Real-time auth listener for recovery, initial session, or sign in events
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, currentSession) => {
      if (isCancelled) return;
      if (
        event === 'PASSWORD_RECOVERY' ||
        (currentSession && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION'))
      ) {
        confirmValidSession();
      }
    });

    // 5. Polling check to handle asynchronous token extraction from hash or background exchange
    let attempts = 0;
    const maxAttempts = 20; // 20 attempts * 200ms = 4 seconds total
    const pollInterval = setInterval(async () => {
      attempts++;
      if (isCancelled) {
        clearInterval(pollInterval);
        return;
      }

      try {
        const { data: { session: polledSession } } = await supabase.auth.getSession();
        if (polledSession) {
          clearInterval(pollInterval);
          confirmValidSession();
          return;
        }
      } catch {
        // Continue polling until maxAttempts
      }

      if (attempts >= maxAttempts) {
        clearInterval(pollInterval);
        if (isCancelled) return;

        // If recovery tokens were present in URL but session failed to establish after 4s:
        if (captured.hasTokens) {
          setInvalidLinkMessage(
            'Your password reset link is invalid or has expired. Please request a new link.'
          );
        } else {
          setInvalidLinkMessage(
            'No active password reset session was found. Please request a new password reset link.'
          );
        }
        setSessionChecking(false);
      }
    }, 200);

    return () => {
      isCancelled = true;
      clearInterval(pollInterval);
      subscription.unsubscribe();
    };
  }, [contextSession]);

  // Validation rules
  const isLengthValid = password.length >= 8;
  const doPasswordsMatch = password.length > 0 && password === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!password) {
      setError('Please enter your new password.');
      return;
    }

    if (!isLengthValid) {
      setError('Password must be at least 8 characters.');
      return;
    }

    if (!confirmPassword) {
      setError('Please confirm your new password.');
      return;
    }

    if (!doPasswordsMatch) {
      setError('Passwords do not match. Please check and try again.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Confirm we have a valid session before attempting updateUser
      const { data: { session: activeSession } } = await supabase.auth.getSession();
      if (!activeSession) {
        setError('Your password reset session has expired or is invalid. Please request a new link.');
        setHasValidSession(false);
        setLoading(false);
        return;
      }

      const { error: updateError } = await updatePassword(password);

      if (updateError) {
        setError(updateError.message || 'Failed to update password. Please try again.');
        setLoading(false);
        return;
      }

      // After updating password, reset initial URL capture and sign out of recovery session
      initialUrlCapture = null;
      try {
        await supabase.auth.signOut();
      } catch (signOutErr) {
        console.warn('[LinkUp Auth] Sign out after password reset notice:', signOutErr);
      }

      // Acceptance Criteria: After setting a new password, the user is redirected to /login
      navigate('/login', {
        replace: true,
        state: {
          successMessage: 'Your password has been reset successfully! Please sign in with your new password.',
        },
      });
    } catch (err: any) {
      setError(err?.message || 'An unexpected error occurred while updating your password.');
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
            Set new password
          </h1>
          <p className="mt-2 text-sm brand-subtext">
            Please choose a secure new password for your account.
          </p>
        </div>

        {/* Card */}
        <div className="glass-panel rounded-2xl p-6 sm:p-8 shadow-xl">
          {sessionChecking ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-600 dark:text-slate-300">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-600 dark:text-indigo-400" />
              <span className="text-sm font-medium">Verifying reset authorization...</span>
            </div>
          ) : invalidLinkMessage && !hasValidSession ? (
            <div className="space-y-6 text-center animate-fadeIn">
              <div className="mx-auto w-14 h-14 rounded-full bg-red-500/10 dark:bg-red-500/20 flex items-center justify-center text-red-600 dark:text-red-400">
                <AlertCircle className="w-8 h-8" />
              </div>

              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">
                  Link Expired or Invalid
                </h2>
                <p className="text-sm brand-subtext leading-relaxed">
                  {invalidLinkMessage}
                </p>
              </div>

              <div className="pt-2 flex flex-col gap-3">
                <Link
                  to="/forgot-password"
                  className="w-full py-3 px-4 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-indigo-600 via-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 transition-all shadow-md shadow-indigo-500/25 flex items-center justify-center gap-2 cursor-pointer"
                  data-testid="request-new-link-button"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>Request a New Reset Link</span>
                </Link>

                <Link
                  to="/login"
                  className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors py-2 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Return to Sign In
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="space-y-5 animate-fadeIn">
              {error && (
                <div
                  role="alert"
                  className="mb-4 error-alert animate-fadeIn"
                  data-testid="reset-password-error-alert"
                >
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-500 dark:text-red-400" />
                  <div className="text-sm font-medium leading-snug">{error}</div>
                </div>
              )}

              {/* New Password Field */}
              <div>
                <label
                  htmlFor="new-password"
                  className="block text-xs font-semibold uppercase tracking-wider form-label mb-1.5"
                >
                  New Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="new-password"
                    name="newPassword"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError(null);
                    }}
                    className="glass-input w-full pl-10 pr-11 py-2.5 rounded-xl text-sm outline-none"
                    data-testid="new-password-input"
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

              {/* Confirm Password Field */}
              <div>
                <label
                  htmlFor="confirm-new-password"
                  className="block text-xs font-semibold uppercase tracking-wider form-label mb-1.5"
                >
                  Confirm New Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="confirm-new-password"
                    name="confirmNewPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    placeholder="Repeat new password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (error) setError(null);
                    }}
                    className="glass-input w-full pl-10 pr-11 py-2.5 rounded-xl text-sm outline-none"
                    data-testid="confirm-new-password-input"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Validation Badges */}
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 text-xs space-y-1.5">
                <div
                  className={`flex items-center gap-2 transition-colors ${
                    isLengthValid
                      ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {isLengthValid ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border border-slate-400 dark:border-slate-500" />
                  )}
                  <span>At least 8 characters in length</span>
                </div>

                <div
                  className={`flex items-center gap-2 transition-colors ${
                    doPasswordsMatch
                      ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {doPasswordsMatch ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border border-slate-400 dark:border-slate-500" />
                  )}
                  <span>Passwords match</span>
                </div>
              </div>

              {/* Submit Button */}
              <button
                id="reset-password-submit"
                type="submit"
                disabled={loading || !isLengthValid || !doPasswordsMatch}
                className="w-full mt-2 py-3 px-4 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-indigo-600 via-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 active:scale-[0.99] transition-all shadow-md shadow-indigo-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                data-testid="reset-password-submit-button"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Updating password...</span>
                  </>
                ) : (
                  <>
                    <span>Set New Password</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <div className="mt-4 text-center">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
                >
                  <ArrowLeft className="w-3 h-3" />
                  Cancel and return to Sign In
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
