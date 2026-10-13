import React from 'react';
import { useTheme } from '../../context/ThemeContext';
import { Sun, Moon } from 'lucide-react';

interface ThemeToggleProps {
  className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = '' }) => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      id="theme-toggle-button"
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      className={`relative inline-flex items-center justify-center p-2 rounded-xl transition-all duration-300 ${
        isDark
          ? 'bg-slate-800/80 hover:bg-slate-700/80 text-amber-400 border border-slate-700 shadow-sm'
          : 'bg-white hover:bg-slate-100 text-indigo-600 border border-slate-200 shadow-sm shadow-slate-200/50'
      } ${className}`}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <div className="relative w-5 h-5 flex items-center justify-center">
        {/* Sun Icon */}
        <Sun
          className={`w-4 h-4 absolute transition-all duration-300 transform ${
            isDark
              ? 'opacity-100 rotate-0 scale-100 text-amber-400'
              : 'opacity-0 -rotate-90 scale-50 pointer-events-none'
          }`}
        />
        {/* Moon Icon */}
        <Moon
          className={`w-4 h-4 absolute transition-all duration-300 transform ${
            isDark
              ? 'opacity-0 rotate-90 scale-50 pointer-events-none'
              : 'opacity-100 rotate-0 scale-100 text-indigo-600'
          }`}
        />
      </div>
      <span className="sr-only">Toggle theme</span>
    </button>
  );
};
