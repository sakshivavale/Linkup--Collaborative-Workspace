import React, { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { ShieldAlert, X } from 'lucide-react';

export const AppLayout: React.FC = () => {
  const location = useLocation();
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    // 1. Check navigation flash state (e.g. from AdminRouteGuard redirect)
    const flash = (location.state as { flash?: string; message?: string } | null)?.flash;
    if (flash === 'ADMIN_ACCESS_DENIED' || flash === 'ACCESS_DENIED') {
      const msg =
        (location.state as { message?: string })?.message ||
        'Access Denied: Administrator privileges required.';
      setToastMessage(msg);
      const timer = window.setTimeout(() => setToastMessage(null), 5000);
      return () => window.clearTimeout(timer);
    }
  }, [location.state]);

  useEffect(() => {
    // 2. Listen to linkup:toast custom event
    const handleToastEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ message: string; type?: string }>;
      if (customEvent.detail?.message) {
        setToastMessage(customEvent.detail.message);
        const timer = window.setTimeout(() => setToastMessage(null), 5000);
        return () => window.clearTimeout(timer);
      }
    };

    window.addEventListener('linkup:toast', handleToastEvent);
    return () => {
      window.removeEventListener('linkup:toast', handleToastEvent);
    };
  }, []);

  return (
    <div className="h-screen overflow-hidden ambient-bg flex flex-col transition-colors duration-300">
      <Header />
      <div className="flex-1 flex flex-col overflow-y-auto min-h-0">
        <Outlet />
      </div>

      {/* Security & Access Denied Toast Notification (US-2.2 AC 2.2.1) */}
      {toastMessage && (
        <div
          id="admin-access-denied-toast"
          data-testid="admin-access-denied-toast"
          role="alert"
          aria-live="assertive"
          className="fixed bottom-6 right-6 z-50 p-4 rounded-2xl bg-rose-600 text-white shadow-xl shadow-rose-600/30 flex items-center gap-3 animate-fade-in border border-rose-500"
        >
          <ShieldAlert className="w-5 h-5 shrink-0 text-white" />
          <span
            id="admin-access-denied-toast-text"
            data-testid="admin-access-denied-toast-text"
            className="text-xs font-semibold"
          >
            {toastMessage}
          </span>
          <button
            type="button"
            id="dismiss-admin-toast-btn"
            data-testid="dismiss-admin-toast-btn"
            onClick={() => setToastMessage(null)}
            className="ml-2 text-white/80 hover:text-white transition-colors"
            aria-label="Dismiss toast"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};

