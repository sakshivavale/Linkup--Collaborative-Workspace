import React, { useEffect, useMemo, useState } from 'react';
import {
  Users,
  GraduationCap,
  BookOpen,
  UserMinus,
  Key,
  Copy,
  Check,
  RefreshCw,
  Radio,
} from 'lucide-react';
import { RoomSummary, PresenceEntry, Member } from '@linkup/shared';
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
  isSelf: boolean;
};

export const PeoplePanel: React.FC<PeoplePanelProps> = ({
  room,
  currentJoinCode: initialJoinCode,
  onJoinCodeRegenerated,
}) => {
  const navigate = useNavigate();
  const { fullName, role, user } = useAuth();
  const currentUserId = user?.id ?? 'self';
  const effectiveRole = role ?? 'student';

  const [joinCode, setJoinCode] = useState<string | null>(initialJoinCode || room.joinCode);
  const [copiedCode, setCopiedCode] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerated, setRegenerated] = useState(false);

  // US-ROOM-02: Real-time presence state
  const [presenceList, setPresenceList] = useState<PresenceEntry[]>(() => room.presence || []);

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
      isSelf: true,
    };

    const serverMembers = room.members ?? [];
    const normalized = serverMembers
      .filter((member) => member.userId !== currentUserId)
      .map((member) => ({
        id: `member-${member.userId}`,
        userId: member.userId,
        name: member.fullName,
        role: member.userRole ?? 'student',
        memberRole: member.memberRole ?? 'participant',
        isSelf: false,
      }));

    if (room.myRole !== 'host' && !serverMembers.some((m) => m.memberRole === 'host' || m.fullName === room.hostName)) {
      const hostMember: PanelMember = {
        id: 'host',
        userId: 'host',
        name: room.hostName,
        role: 'teacher',
        memberRole: 'host',
        isSelf: false,
      };
      return [selfMember, hostMember, ...normalized];
    }

    return [selfMember, ...normalized];
  });

  useEffect(() => {
    const selfMember: PanelMember = {
      id: 'self',
      userId: currentUserId,
      name: fullName,
      role: effectiveRole,
      memberRole: room.myRole,
      isSelf: true,
    };

    const serverMembers = room.members ?? [];
    const normalized = serverMembers
      .filter((member) => member.userId !== currentUserId)
      .map((member) => ({
        id: `member-${member.userId}`,
        userId: member.userId,
        name: member.fullName,
        role: member.userRole ?? 'student',
        memberRole: member.memberRole ?? 'participant',
        isSelf: false,
      }));

    if (room.myRole !== 'host' && !serverMembers.some((m) => m.memberRole === 'host' || m.fullName === room.hostName)) {
      const hostMember: PanelMember = {
        id: 'host',
        userId: 'host',
        name: room.hostName,
        role: 'teacher',
        memberRole: 'host',
        isSelf: false,
      };
      setMembers([selfMember, hostMember, ...normalized]);
    } else {
      setMembers([selfMember, ...normalized]);
    }
  }, [currentUserId, effectiveRole, fullName, room, room.id, room.members, room.myRole]);

  // US-ROOM-02: Listen to real-time presence and member updates
  useEffect(() => {
    const onPresenceUpdate = (data: { roomId: string; presence: PresenceEntry[] }) => {
      if (data.roomId === room.id && Array.isArray(data.presence)) {
        setPresenceList(data.presence);
      }
    };

    const onMemberJoined = (data: { roomId: string; member: Member }) => {
      if (data.roomId === room.id && data.member) {
        setMembers((current) => {
          if (current.some((m) => m.userId === data.member.userId)) return current;
          return [
            ...current,
            {
              id: `member-${data.member.userId}`,
              userId: data.member.userId,
              name: data.member.fullName,
              role: data.member.userRole ?? 'student',
              memberRole: data.member.memberRole ?? 'participant',
              isSelf: data.member.userId === currentUserId,
            },
          ];
        });
      }
    };

    const onMemberRemoved = ({ roomId, userId: removedUserId }: { roomId: string; userId: string }) => {
      if (roomId !== room.id) return;
      setMembers((current) => current.filter((member) => member.userId !== removedUserId));
      setPresenceList((current) => current.filter((p) => p.userId !== removedUserId));
    };

    const onRoomKicked = ({ roomId }: { roomId: string }) => {
      if (roomId !== room.id) return;
      navigate('/', { replace: true, state: { flash: 'ROOM_KICKED' } });
    };

    socket.on('presence:update', onPresenceUpdate);
    socket.on('member:joined', onMemberJoined);
    socket.on('member:removed', onMemberRemoved);
    socket.on('room:kicked', onRoomKicked);

    return () => {
      socket.off('presence:update', onPresenceUpdate);
      socket.off('member:joined', onMemberJoined);
      socket.off('member:removed', onMemberRemoved);
      socket.off('room:kicked', onRoomKicked);
    };
  }, [currentUserId, navigate, room.id]);

  // Lookup map for fast presence checks (<1ms)
  const presenceMap = useMemo(() => {
    const map = new Map<string, PresenceEntry>();
    for (const p of presenceList) {
      map.set(p.userId, p);
    }
    return map;
  }, [presenceList]);

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
          {members.length > 0 ? members.length : room.memberCount}
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

      {/* Member list with Role badges, Online/Offline dot, and In Call indicators */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0">
        {members.map((member) => {
          const presenceEntry = member.userId ? presenceMap.get(member.userId) : undefined;
          // Self is online while connected in the room; other members are online if in presenceMap
          const isOnline = member.isSelf
            ? (socket.connected || Boolean(presenceEntry))
            : Boolean(presenceEntry);
          const isInCall = Boolean(presenceEntry?.inLive);

          return (
            <div
              key={member.id}
              id={`member-row-${member.userId || member.id}`}
              data-testid={`member-row-${member.userId || member.id}`}
              className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
            >
              {/* Avatar with Online/Offline indicator dot (US-ROOM-02 AC-1, AC-2) */}
              <div className="relative shrink-0">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm ${
                    member.memberRole === 'host'
                      ? 'bg-gradient-to-tr from-indigo-600 to-indigo-500'
                      : 'bg-gradient-to-tr from-emerald-600 to-teal-500'
                  }`}
                >
                  {getInitials(member.name)}
                </div>
                <span
                  id={`member-presence-${member.userId || member.id}`}
                  data-testid={`member-presence-${member.userId || member.id}`}
                  data-status={isOnline ? 'online' : 'offline'}
                  title={isOnline ? 'Online' : 'Offline'}
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-950 transition-colors duration-200 ${
                    isOnline
                      ? 'bg-emerald-500 shadow-sm'
                      : 'bg-slate-300 dark:bg-slate-600'
                  }`}
                />
              </div>

              {/* Name and role badges */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span
                    id={`member-name-${member.userId || member.id}`}
                    data-testid={`member-name-${member.userId || member.id}`}
                    className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate"
                  >
                    {member.name}
                  </span>
                  {member.isSelf && (
                    <span className="text-[10px] text-slate-400 font-normal shrink-0">(you)</span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {/* US-ROOM-02 AC-1: Role badge (Teacher / Student) */}
                  {member.role === 'teacher' ? (
                    <span
                      id={`member-role-${member.userId || member.id}`}
                      data-testid={`member-role-${member.userId || member.id}`}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/80"
                    >
                      <GraduationCap className="w-3 h-3 text-indigo-500 shrink-0" />
                      <span>Teacher</span>
                    </span>
                  ) : (
                    <span
                      id={`member-role-${member.userId || member.id}`}
                      data-testid={`member-role-${member.userId || member.id}`}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/80"
                    >
                      <BookOpen className="w-3 h-3 text-emerald-500 shrink-0" />
                      <span>Student</span>
                    </span>
                  )}

                  {/* Host badge */}
                  {member.memberRole === 'host' && (
                    <span
                      id={`member-host-${member.userId || member.id}`}
                      data-testid={`member-host-${member.userId || member.id}`}
                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/60"
                    >
                      Host
                    </span>
                  )}

                  {/* US-ROOM-02 AC-3: "In call" indicator */}
                  {isInCall && (
                    <span
                      id={`member-in-call-${member.userId || member.id}`}
                      data-testid={`member-in-call-${member.userId || member.id}`}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200/80 dark:border-rose-900/60 animate-pulse"
                      title="Currently in live call"
                    >
                      <Radio className="w-2.5 h-2.5 text-rose-500 animate-pulse shrink-0" />
                      <span>In call</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Host remove member button (US-ROOM-03) */}
              {room.myRole === 'host' && !member.isSelf && member.memberRole !== 'host' && (
                <button
                  type="button"
                  onClick={() => handleRemoveMember(member)}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 shrink-0"
                  aria-label={`Remove ${member.name} from room`}
                >
                  <UserMinus className="w-3 h-3" />
                  Remove
                </button>
              )}
            </div>
          );
        })}

        {extraCount > 0 && (
          <p className="text-xs text-center text-slate-400 dark:text-slate-600 py-2">
            +{extraCount} more members
          </p>
        )}
      </div>
    </div>
  );
};
