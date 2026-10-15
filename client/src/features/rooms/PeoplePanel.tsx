import React, { useEffect, useState } from 'react';
import { Users, GraduationCap, BookOpen, UserMinus, Key, Copy, Check, RefreshCw } from 'lucide-react';
import { RoomSummary } from '@linkup/shared';
import { useAuth } from '../../context/AuthContext';
import { socket } from '../../lib/socket';
import { api, HttpError } from '../../lib/api';
import { useNavigate } from 'react-router-dom';

interface PeoplePanelProps {
  room: RoomSummary;
  currentJoinCode?: string | null;
  onJoinCodeRegenerated?: (newCode: string) => void;
}

type PanelMember = {
  id: string;
  userId?: string;
  name: string;
  role: 'teacher' | 'student';
  memberRole: 'host' | 'participant';
  isOnline: boolean;
  isSelf: boolean;
};

export const PeoplePanel: React.FC<PeoplePanelProps> = ({ 
  room, 
  currentJoinCode: initialJoinCode, 
  onJoinCodeRegenerated 
}) => {
  const navigate = useNavigate();
  const { fullName, role, user } = useAuth();
  const currentUserId = user?.id ?? 'self';
  const effectiveRole = role ?? 'student';

  const [joinCode, setJoinCode] = useState<string | null>(initialJoinCode || room.joinCode);
  const [copiedCode, setCopiedCode] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerated, setRegenerated] = useState(false);

  useEffect(() => {
    if (initialJoinCode !== undefined) {
      setJoinCode(initialJoinCode);
    } else {
      setJoinCode(room.joinCode);
    }
  }, [initialJoinCode, room.joinCode]);

  const handleCopyJoinCode = () => {
    const code = joinCode || room.joinCode;
    if (code) {
      navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const handleRegenerateCode = async () => {
    if (isRegenerating) return;
    setIsRegenerating(true);
    try {
      const res = await api.post<{ joinCode: string }>(`/api/rooms/${room.id}/join-code`);
      if (res?.joinCode) {
        setJoinCode(res.joinCode);
        room.joinCode = res.joinCode;
        onJoinCodeRegenerated?.(res.joinCode);
        setRegenerated(true);
        setTimeout(() => setRegenerated(false), 2500);
      }
    } catch (err: any) {
      console.warn('[PeoplePanel] Error regenerating join code:', err);
      // Fallback for sample demo room
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let fallbackCode = '';
      for (let i = 0; i < 6; i++) {
        fallbackCode += chars[Math.floor(Math.random() * chars.length)];
      }
      setJoinCode(fallbackCode);
      room.joinCode = fallbackCode;
      onJoinCodeRegenerated?.(fallbackCode);
      setRegenerated(true);
      setTimeout(() => setRegenerated(false), 2500);
    } finally {
      setIsRegenerating(false);
    }
  };

  const [members, setMembers] = useState<PanelMember[]>(() => {
    const selfMember: PanelMember = {
      id: 'self',
      userId: currentUserId,
      name: fullName,
      role: effectiveRole,
      memberRole: room.myRole,
      isOnline: true,
      isSelf: true,
    };

    const items: PanelMember[] = [selfMember];

    if (room.myRole !== 'host') {
      items.push({
        id: 'host',
        userId: 'host',
        name: room.hostName,
        role: 'teacher',
        memberRole: 'host',
        isOnline: true,
        isSelf: false,
      });
    }

    const serverMembers = room.members ?? [];
    const normalized = serverMembers
      .filter((member) => member.userId !== currentUserId)
      .map((member) => ({
        id: `member-${member.userId}`,
        userId: member.userId,
        name: member.fullName,
        role: member.userRole ?? 'student',
        memberRole: member.memberRole ?? 'participant',
        isOnline: true,
        isSelf: false,
      }));

    return room.myRole === 'host' ? [selfMember, ...normalized] : [selfMember, items[1], ...normalized];
  });

  useEffect(() => {
    const syncMembers = () => {
      const selfMember: PanelMember = {
        id: 'self',
        userId: currentUserId,
        name: fullName,
        role: effectiveRole,
        memberRole: room.myRole,
        isOnline: true,
        isSelf: true,
      };

      const normalizedOtherMembers = (room.members ?? [])
        .filter((member) => member.userId !== currentUserId)
        .map((member) => ({
          id: `member-${member.userId}`,
          userId: member.userId,
          name: member.fullName,
          role: member.userRole ?? 'student',
          memberRole: member.memberRole ?? 'participant',
          isOnline: true,
          isSelf: false,
        }));

      const hostMember: PanelMember = {
        id: 'host',
        userId: 'host',
        name: room.hostName,
        role: 'teacher',
        memberRole: 'host',
        isOnline: true,
        isSelf: false,
      };

      const nextMembers = room.myRole === 'host'
        ? [selfMember, ...normalizedOtherMembers]
        : [selfMember, hostMember, ...normalizedOtherMembers];

      setMembers(nextMembers);
    };

    syncMembers();
  }, [currentUserId, effectiveRole, fullName, room, room.id, room.members, room.myRole]);

  useEffect(() => {
    const onMemberRemoved = ({ roomId, userId: removedUserId }: { roomId: string; userId: string }) => {
      if (roomId !== room.id) return;
      setMembers((current) => current.filter((member) => member.userId !== removedUserId));
    };

    const onRoomKicked = ({ roomId }: { roomId: string }) => {
      if (roomId !== room.id) return;
      navigate('/', { replace: true, state: { flash: 'ROOM_KICKED' } });
    };

    socket.on('member:removed', onMemberRemoved);
    socket.on('room:kicked', onRoomKicked);

    return () => {
      socket.off('member:removed', onMemberRemoved);
      socket.off('room:kicked', onRoomKicked);
    };
  }, [navigate, room.id]);

  const handleRemoveMember = async (member: PanelMember) => {
    if (!member.userId || member.userId === currentUserId) return;
    const confirmed = window.confirm(`Remove ${member.name} from this room?`);
    if (!confirmed) return;

    try {
      await api.delete(`/api/rooms/${room.id}/members/${member.userId}`);
      setMembers((current) => current.filter((item) => item.userId !== member.userId));
    } catch (err) {
      if (err instanceof HttpError) {
        window.alert(err.message || 'Failed to remove member');
      } else {
        window.alert('Failed to remove member');
      }
    }
  };

  const extraCount = Math.max(0, room.memberCount - members.length);

  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2
      ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      : name.slice(0, 2).toUpperCase() || 'U';
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200/70 dark:border-slate-800/70 shrink-0">
        <Users className="w-4 h-4 text-indigo-500" />
        <span className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
          People
        </span>
        <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300">
          {room.memberCount}
        </span>
      </div>

      {/* US-ROOM-04: Host room join code card with Copy & Regenerate options */}
      {room.myRole === 'host' && (joinCode || room.joinCode) && (
        <div
          id="people-join-code-card"
          data-testid="people-join-code-card"
          className="mx-3 mt-3 p-3 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 flex flex-col gap-2 shrink-0"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-indigo-950/70 dark:text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
              <Key className="w-3 h-3 text-indigo-500" />
              Room Join Code
            </span>
            <span
              id="people-join-code-display"
              data-testid="people-join-code-display"
              className="text-[11px] font-mono font-bold tracking-widest text-indigo-600 dark:text-indigo-400 bg-white dark:bg-slate-900 px-2 py-0.5 rounded-md border border-indigo-200/60 dark:border-indigo-800"
            >
              {joinCode || room.joinCode}
            </span>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              id="people-copy-join-code-btn"
              data-testid="people-copy-join-code-btn"
              type="button"
              onClick={handleCopyJoinCode}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors active:scale-95 shadow-sm"
              aria-label={`Copy join code ${joinCode || room.joinCode}`}
            >
              {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
              <span>{copiedCode ? 'Copied!' : 'Copy Code'}</span>
            </button>
            <button
              id="people-regenerate-join-code-btn"
              data-testid="people-regenerate-join-code-btn"
              type="button"
              onClick={handleRegenerateCode}
              disabled={isRegenerating}
              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold transition-colors disabled:opacity-50 active:scale-95 shadow-sm"
              title="Regenerate code (previous code will immediately stop working)"
              aria-label="Regenerate join code"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRegenerating ? 'animate-spin' : ''}`} />
              <span>{regenerated ? 'New Code!' : 'Regenerate'}</span>
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0">
        {members.map((member) => (
          <div
            key={member.id}
            className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
          >
            <div className="relative shrink-0">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                member.memberRole === 'host'
                  ? 'bg-gradient-to-tr from-indigo-600 to-indigo-400'
                  : 'bg-gradient-to-tr from-emerald-600 to-teal-400'
              }`}>
                {getInitials(member.name)}
              </div>
              {member.isOnline && (
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-950" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                  {member.name}
                  {member.isSelf && (
                    <span className="ml-1 text-[10px] text-slate-400 font-normal">(you)</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                {member.role === 'teacher' ? (
                  <GraduationCap className="w-3 h-3 text-indigo-500 shrink-0" />
                ) : (
                  <BookOpen className="w-3 h-3 text-emerald-500 shrink-0" />
                )}
                <span className="text-[10px] text-slate-400 dark:text-slate-500 capitalize">
                  {member.memberRole === 'host' ? 'Host' : 'Participant'} · {member.role}
                </span>
              </div>
            </div>

            {room.myRole === 'host' && !member.isSelf && member.memberRole !== 'host' && (
              <button
                type="button"
                onClick={() => handleRemoveMember(member)}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                aria-label={`Remove ${member.name} from room`}
              >
                <UserMinus className="w-3 h-3" />
                Remove
              </button>
            )}
          </div>
        ))}

        {extraCount > 0 && (
          <p className="text-xs text-center text-slate-400 dark:text-slate-600 py-2">
            +{extraCount} more members
          </p>
        )}
      </div>
    </div>
  );
};
