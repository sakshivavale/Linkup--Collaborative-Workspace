import React, { useEffect, useState } from 'react';
import { Users, GraduationCap, BookOpen, UserMinus } from 'lucide-react';
import { RoomSummary } from '@linkup/shared';
import { useAuth } from '../../context/AuthContext';
import { socket } from '../../lib/socket';
import { api, HttpError } from '../../lib/api';
import { useNavigate } from 'react-router-dom';

interface PeoplePanelProps {
  room: RoomSummary;
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

export const PeoplePanel: React.FC<PeoplePanelProps> = ({ room }) => {
  const navigate = useNavigate();
  const { fullName, role, user } = useAuth();
  const currentUserId = user?.id ?? 'self';
  const effectiveRole = role ?? 'student';

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
