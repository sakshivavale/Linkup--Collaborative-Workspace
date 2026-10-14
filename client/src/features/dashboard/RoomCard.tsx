import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RoomSummary } from '@linkup/shared';
import { 
  Users, 
  UserCheck, 
  Video, 
  Copy, 
  Check, 
  ArrowRight
} from 'lucide-react';

interface RoomCardProps {
  room: RoomSummary;
}

export const RoomCard: React.FC<RoomCardProps> = ({ room }) => {
  const navigate = useNavigate();
  const [copiedCode, setCopiedCode] = useState(false);

  const isLive = Boolean(room.activeSessionId);
  const isHost = room.myRole === 'host';

  const handleCopyJoinCode = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (room.joinCode) {
      navigator.clipboard.writeText(room.joinCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const handleCardClick = () => {
    navigate(`/rooms/${room.id}`);
  };

  const handleJoinClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/rooms/${room.id}`);
  };

  return (
    <div
      id={`room-card-${room.id}`}
      data-testid="room-card"
      onClick={handleCardClick}
      className={`glass-panel rounded-3xl p-6 transition-all duration-300 cursor-pointer flex flex-col justify-between group relative overflow-hidden ${
        isLive
          ? 'border-rose-400/40 dark:border-rose-500/40 shadow-lg shadow-rose-500/5 dark:shadow-rose-500/10 hover:border-rose-500'
          : 'hover:border-indigo-400/50 dark:hover:border-indigo-500/50 hover:shadow-md'
      }`}
    >
      {/* Subtle background glow for live rooms */}
      {isLive && (
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-rose-500/10 dark:bg-rose-500/15 rounded-full blur-2xl pointer-events-none" />
      )}

      <div>
        {/* Header: Role tag & Live Badge + Join Button (US-DASH-02 Acceptance Criteria 1, 2 & 3) */}
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                isHost
                  ? 'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
              }`}
            >
              <UserCheck className="w-3 h-3" />
              <span>{isHost ? 'Host' : 'Participant'}</span>
            </span>
          </div>

          {/* US-DASH-02: Live Badge and Join Button appear ONLY when activeSessionId is not null */}
          {isLive ? (
            <div className="flex items-center gap-2" data-testid="live-actions-group">
              {/* Criterion 1: Live Badge */}
              <span
                id={`live-badge-${room.id}`}
                data-testid="live-badge"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-300 dark:border-rose-500/30 shadow-sm"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-600"></span>
                </span>
                Live
              </span>

              {/* Criterion 2: Join Button appearing alongside badge, navigating to room page */}
              <button
                id={`join-room-btn-${room.id}`}
                data-testid="join-button"
                type="button"
                onClick={handleJoinClick}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:scale-95 transition-all shadow-sm shadow-rose-600/30"
                title="Join active live session"
              >
                <Video className="w-3.5 h-3.5" />
                <span>Join</span>
              </button>
            </div>
          ) : (
            /* Criterion 3: Rooms without active session do NOT show badge or Join button */
            <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
              Not Live
            </span>
          )}
        </div>

        {/* Room Title */}
        <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight mb-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors line-clamp-1">
          {room.name}
        </h3>

        {/* Room Description */}
        {room.description && (
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 line-clamp-2 leading-relaxed">
            {room.description}
          </p>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800/80">
        {/* Host and Member stats */}
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-3">
          <div className="flex items-center gap-1.5 truncate mr-2" title={`Host: ${room.hostName}`}>
            <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-700 dark:text-slate-300">
              {room.hostName.charAt(0).toUpperCase()}
            </span>
            <span className="truncate">{room.hostName}</span>
          </div>

          <div className="flex items-center gap-1 shrink-0" title={`${room.memberCount} members`}>
            <Users className="w-3.5 h-3.5 text-slate-400" />
            <span>{room.memberCount} {room.memberCount === 1 ? 'member' : 'members'}</span>
          </div>
        </div>

        {/* Footer actions: Join code (for host) or regular room link */}
        <div className="flex items-center justify-between gap-2">
          {isHost && room.joinCode ? (
            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/60 rounded-xl px-2.5 py-1 text-xs">
              <span className="text-[11px] font-mono font-bold text-indigo-600 dark:text-indigo-400">
                {room.joinCode}
              </span>
              <button
                type="button"
                onClick={handleCopyJoinCode}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                title="Copy Join Code"
              >
                {copiedCode ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          ) : (
            <span className="text-[11px] text-slate-400">
              Created {new Date(room.createdAt).toLocaleDateString()}
            </span>
          )}

          {!isLive && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 group-hover:text-indigo-600 dark:text-slate-400 dark:group-hover:text-indigo-400 transition-colors ml-auto">
              <span>Enter</span>
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
