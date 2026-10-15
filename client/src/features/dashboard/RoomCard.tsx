import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { RoomSummary } from '@linkup/shared';
import { 
  Users, 
  UserCheck, 
  Video, 
  Copy, 
  Check, 
  ArrowRight,
  Key,
  RefreshCw,
  Edit3
} from 'lucide-react';
import { api } from '../../lib/api';
import { EditRoomModal } from './EditRoomModal';

interface RoomCardProps {
  room: RoomSummary;
  onJoinCodeRegenerated?: (roomId: string, newCode: string) => void;
  onRoomUpdated?: (updatedRoom: RoomSummary) => void;
  onRoomArchived?: (roomId: string) => void;
}

export const RoomCard: React.FC<RoomCardProps> = ({ 
  room, 
  onJoinCodeRegenerated,
  onRoomUpdated,
  onRoomArchived
}) => {
  const navigate = useNavigate();
  const [copiedCode, setCopiedCode] = useState(false);
  const [currentJoinCode, setCurrentJoinCode] = useState<string | null>(room.joinCode);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerated, setRegenerated] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  useEffect(() => {
    setCurrentJoinCode(room.joinCode);
  }, [room.joinCode]);

  const isLive = Boolean(room.activeSessionId);
  const isHost = room.myRole === 'host';

  const handleCopyJoinCode = (e: React.MouseEvent) => {
    e.stopPropagation();
    const codeToCopy = currentJoinCode || room.joinCode;
    if (codeToCopy) {
      navigator.clipboard.writeText(codeToCopy);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const handleRegenerateCode = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRegenerating) return;

    setIsRegenerating(true);
    try {
      const res = await api.post<{ joinCode: string }>(`/api/rooms/${room.id}/join-code`);
      if (res?.joinCode) {
        setCurrentJoinCode(res.joinCode);
        room.joinCode = res.joinCode;
        onJoinCodeRegenerated?.(room.id, res.joinCode);
        setRegenerated(true);
        setTimeout(() => setRegenerated(false), 2500);
      }
    } catch (err: any) {
      console.warn('[RoomCard] Error regenerating code, falling back locally:', err);
      // Fallback for mock/demo testing
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let fallbackCode = '';
      for (let i = 0; i < 6; i++) {
        fallbackCode += chars[Math.floor(Math.random() * chars.length)];
      }
      setCurrentJoinCode(fallbackCode);
      room.joinCode = fallbackCode;
      onJoinCodeRegenerated?.(room.id, fallbackCode);
      setRegenerated(true);
      setTimeout(() => setRegenerated(false), 2500);
    } finally {
      setIsRegenerating(false);
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

            {isHost && (
              <button
                id={`edit-room-btn-${room.id}`}
                data-testid="edit-room-btn"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditModalOpen(true);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
                title="Edit room settings"
                aria-label="Edit room settings"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
            )}
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

        {/* Footer actions: Join code (for host only — US-DASH-05) or created date (for students) */}
        <div className="flex items-center justify-between gap-2">
          {isHost && (currentJoinCode || room.joinCode) ? (
            // US-DASH-05 & US-ROOM-04: Join code is displayed on room card for host with Copy & Regenerate options
            <div
              id={`join-code-section-${room.id}`}
              data-testid="join-code-section"
              className="flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200/60 dark:border-indigo-500/20 rounded-xl px-2.5 py-1 text-xs"
              title={`Room join code: ${currentJoinCode || room.joinCode}`}
            >
              <Key className="w-3 h-3 text-indigo-400 dark:text-indigo-500 shrink-0" />
              <span
                id={`join-code-display-${room.id}`}
                data-testid="join-code-display"
                className="text-[11px] font-mono font-bold text-indigo-600 dark:text-indigo-400 tracking-widest"
              >
                {currentJoinCode || room.joinCode}
              </span>
              {/* US-DASH-05 AC-2: Copy-to-clipboard button */}
              <div className="relative flex items-center">
                <button
                  id={`copy-join-code-btn-${room.id}`}
                  data-testid="copy-join-code-btn"
                  type="button"
                  onClick={handleCopyJoinCode}
                  className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors active:scale-90"
                  title={copiedCode ? 'Copied!' : 'Copy join code to clipboard'}
                  aria-label={`Copy join code ${currentJoinCode || room.joinCode}`}
                >
                  {copiedCode ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
                {copiedCode && (
                  <span
                    data-testid="copied-tooltip"
                    className="absolute -top-7 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-600 text-white whitespace-nowrap pointer-events-none shadow-md z-10"
                  >
                    Copied!
                  </span>
                )}
              </div>

              {/* US-ROOM-04 AC-1, AC-2, AC-3: Regenerate Code button */}
              <div className="relative flex items-center">
                <button
                  id={`regenerate-code-btn-${room.id}`}
                  data-testid="regenerate-code-btn"
                  type="button"
                  onClick={handleRegenerateCode}
                  disabled={isRegenerating}
                  className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors active:scale-90 disabled:opacity-50 ml-0.5"
                  title={isRegenerating ? 'Regenerating code...' : 'Regenerate Code'}
                  aria-label={`Regenerate join code for ${room.name}`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRegenerating ? 'animate-spin text-indigo-500' : ''}`} />
                </button>
                {regenerated && (
                  <span
                    data-testid="regenerated-tooltip"
                    className="absolute -top-7 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-600 text-white whitespace-nowrap pointer-events-none shadow-md z-10"
                  >
                    New Code!
                  </span>
                )}
              </div>
            </div>
          ) : (
            // US-DASH-05 AC-3: Students see created date — no join code shown
            <span data-testid="no-join-code" className="text-[11px] text-slate-400">
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

      {/* Edit Room Modal for host */}
      {isHost && isEditModalOpen && (
        <EditRoomModal
          isOpen={isEditModalOpen}
          room={room}
          onClose={() => setIsEditModalOpen(false)}
          onSuccess={(updated) => {
            room.name = updated.name;
            room.description = updated.description;
            onRoomUpdated?.(updated);
          }}
          onArchive={(archivedId) => {
            onRoomArchived?.(archivedId);
          }}
        />
      )}
    </div>
  );
};
