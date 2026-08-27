import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Employee, OfficeSession } from '../api/types';
import { Users, X } from 'lucide-react';

function formatRelativeTime(unixSeconds: number | undefined): string {
  if (!unixSeconds) return '';
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - unixSeconds);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

/** The OFFICE tab's sidebar: a "Manage roster" link plus every employee chat
 * session, newest-active first — the session-list-in-the-sidebar UX the main
 * SESSIONS tab already has, just scoped to Office. Fetches its own data
 * (no shared live layer yet for sessions) so it stays simple; a session row
 * click navigates straight into that conversation. */
export function OfficeSidebarList({ navigate, activeSessionId }: { navigate: (hash: string) => void; activeSessionId?: string }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [sessions, setSessions] = useState<OfficeSession[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    Promise.all([api.getEmployees(), api.getOfficeSessions()])
      .then(([emps, sess]) => {
        setEmployees(emps);
        setSessions(sess);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const employeeById = new Map(employees.map((e) => [e.employee_id, e]));

  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    try {
      await api.deleteOfficeSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
      if (activeSessionId === sessionId) navigate('#/office');
    } catch {
      // best-effort; the row just stays if the delete failed
    }
  };

  return (
    <div className="session-list-scroll">
      <button
        type="button"
        className="sidebar-action-item"
        onClick={() => navigate('#/office')}
        style={{ marginBottom: '4px' }}
      >
        <div className="action-item-left">
          <Users size={14} className="action-item-icon" />
          <span>Manage roster</span>
        </div>
      </button>

      {loading ? (
        <div style={{ padding: '8px 12px', color: 'var(--text-faint)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
          LOADING SESSIONS...
        </div>
      ) : sessions.length === 0 ? (
        <div style={{ padding: '8px 12px', color: 'var(--text-faint)', fontSize: '11px', fontStyle: 'italic' }}>
          No chats yet — click an employee to start one
        </div>
      ) : (
        sessions.map((s) => {
          const emp = employeeById.get(s.employee_id);
          return (
            <div
              key={s.session_id}
              className={`session-row ${activeSessionId === s.session_id ? 'active' : ''}`}
              onClick={() => navigate(`#/office/session/${s.session_id}`)}
              title={s.project ? `Project: ${s.project}` : 'Chat'}
            >
              <div className="session-row-left">
                <span style={{ fontSize: '13px' }}>{emp?.avatar || '🧑‍💻'}</span>
                <span className="session-title-text">{s.title}</span>
              </div>
              <div className="session-row-right">
                <span className="session-time">{formatRelativeTime(s.updated)}</span>
                <button
                  type="button"
                  className="session-action-btn"
                  onClick={(e) => handleDelete(e, s.session_id)}
                  title="Delete session"
                >
                  <X size={11} />
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
