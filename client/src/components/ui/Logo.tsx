import React from 'react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({ size = 'md', showText = false, className = '' }) => {
  const sizeClasses = {
    sm: 'w-9 h-9 p-0.5 rounded-xl',
    md: 'w-14 h-14 p-1 rounded-2xl',
    lg: 'w-20 h-20 p-1.5 rounded-2xl',
    xl: 'w-24 h-24 p-2 rounded-3xl',
  };

  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      <div 
        className={`relative ${sizeClasses[size]} overflow-hidden shadow-sm border border-slate-200 dark:border-white/10 bg-white dark:bg-white flex items-center justify-center transition-all hover:scale-105 duration-200`}
      >
        <img 
          src="/logo.png" 
          alt="LinkUp Logo" 
          className="w-full h-full object-contain"
        />
      </div>
      {showText && (
        <div className="flex flex-col text-left">
          <span className="font-extrabold text-xl tracking-tight text-slate-900 dark:text-white leading-tight">
            Link<span className="text-indigo-600 dark:text-indigo-400">Up</span>
          </span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium tracking-wide">
            Learn &bull; Meet &bull; Work &bull; Create
          </span>
        </div>
      )}
    </div>
  );
};
