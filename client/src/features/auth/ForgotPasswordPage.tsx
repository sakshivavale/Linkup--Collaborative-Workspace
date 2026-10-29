import React, { useState, useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ThemeToggle } from '../../components/ui/ThemeToggle';
import { Logo } from '../../components/ui/Logo';
import {
  Mail,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
} from 'lucide-react';

export const ForgotPasswordPage: React.FC = () => {
  const location = useLocation();
  const { resetPasswordForEmail } = useAuth();

  // If redirected from LoginPage with email in state
  const initialEmail = (location.state as { email?: string })?.email || '';

  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (cooldown > 0) {
      timer = setTimeout(() => setCooldown((prev) => prev - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [cooldown]);

  const isValidEmail = (emailStr: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(emailStr);
  };

  const handleResetRequest = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Please enter your email address.');
      return;
    }

    if (!isValidEmail(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: resetError } = await resetPasswordForEmail(trimmedEmail);

      if (resetError) {
        setError(resetError.message || 'Failed to send reset email. Please try again.');
        setLoading(false);
        return;
      }

      setIsSubmitted(true);
      setCooldown(60); // 60 seconds cooldown for resending
      setLoading(false);
    } catch (err: any) {
      setError(err?.message || 'An unexpected error occurred. Please try again.');
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
            {isSubmitted ? 'Check your email' : 'Forgot password?'}
          </h1>
          <p className="mt-2 text-sm brand-subtext">
            {isSubmitted
              ? "We've sent a password reset link to your email."
              : 'Enter your email address and we will send you a link to reset your password.'}
          </p>
        </div>

        {/* Card */}
        <div className="glass-panel rounded-2xl p-6 sm:p-8 shadow-xl">
          {error && (
            <div
              role="alert"
              className="mb-6 error-alert animate-fadeIn"
              data-testid="forgot-password-error-alert"
            >
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-500 dark:text-red-400" />
              <div className="text-sm font-medium leading-snug">{error}</div>
            </div>
          )}

          {!isSubmitted ? (
            <form onSubmit={handleResetRequest} noValidate className="space-y-5">
              {/* Email Field */}
              <div>
                <label
                  htmlFor="forgot-email"
                  className="block text-xs font-semibold uppercase tracking-wider form-label mb-1.5"
                >
                  Email Address
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    id="forgot-email"
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
                    data-testid="forgot-email-input"
                  />
                </div>
              </div>

              {/* Submit Button */}
              <button
                id="forgot-submit"
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-3 px-4 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-indigo-600 via-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 active:scale-[0.99] transition-all shadow-md shadow-indigo-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                data-testid="forgot-submit-button"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Sending reset link...</span>
                  </>
                ) : (
                  <>
                    <span>Send Reset Link</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          ) : (
            <div className="text-center space-y-5 animate-fadeIn">
              <div className="mx-auto w-14 h-14 rounded-full bg-emerald-500/10 dark:bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-2">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <div className="text-sm brand-subtext leading-relaxed">
                We've sent a password reset link to{' '}
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {email}
                </span>
                . Please follow the instructions in the email to regain access.
              </div>

              <div className="p-3.5 rounded-xl bg-slate-100/70 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400">
                Didn't receive an email? Check your spam/junk folder or request another link.
              </div>

              <div className="pt-2 flex flex-col gap-3">
                <button
                  type="button"
                  disabled={loading || cooldown > 0}
                  onClick={() => handleResetRequest()}
                  className="w-full py-2.5 px-4 rounded-xl font-medium text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 cursor-pointer"
                  data-testid="resend-reset-button"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span>
                    {cooldown > 0 ? `Resend email in ${cooldown}s` : 'Resend reset link'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Return to Login Link */}
          <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800 text-center text-xs brand-subtext">
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 transition-colors underline underline-offset-4 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
