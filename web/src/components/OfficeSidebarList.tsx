import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Employee, Team } from '../api/types';
import { Users, PlusCircle } from 'lucide-react';

/** Compact roster shown in the sidebar when the OFFICE tab is active. The
 * full management UI (create/edit/delete) lives in the Office view itself —
 * this is just a quick-glance list that deep-links there. Fetches its own
 * data rather than sharing state with the Office view: Phase 1 has no live
 * sync layer yet (that's Phase 3's SSE provider), so a light independent
 * fetch is simpler than plumbing shared state through two build entrypoints
 * for what is, for now, a read-only glance. */
export function OfficeSidebarList({ navigate }: { navigate: (hash: string) => void }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getEmployees(), api.getTeams()])
      .then(([emps, tms]) => {
        if (cancelled) return;
        setEmployees(emps);
        setTeams(tms);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="session-list-scroll">
      <button
        type="button"
        className="sidebar-action-item"
        onClick={() => navigate('#/office')}
        style={{ marginBottom: '4px' }}
      >
        <div className="action-item-left">
          <PlusCircle size={14} className="action-item-icon" />
          <span>Manage roster</span>
        </div>
      </button>

      {loading ? (
        <div style={{ padding: '8px 12px', color: 'var(--text-faint)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
          LOADING OFFICE...
        </div>
      ) : employees.length === 0 ? (
        <div style={{ padding: '8px 12px', color: 'var(--text-faint)', fontSize: '11px', fontStyle: 'italic' }}>
          No employees yet
        </div>
      ) : (
        <>
          {teams.map((team) => (
            <div
              key={team.team_id}
              className="session-row"
              onClick={() => navigate('#/office')}
            >
              <div className="session-row-left">
                <Users size={12} style={{ opacity: 0.7 }} />
                <span className="session-title-text">{team.name}</span>
              </div>
              <div className="session-row-right">
                <span className="session-time">{team.member_count}</span>
              </div>
            </div>
          ))}
          {employees.filter((e) => !e.team_id).map((emp) => (
            <div
              key={emp.employee_id}
              className="session-row"
              onClick={() => navigate('#/office')}
            >
              <div className="session-row-left">
                <span style={{ fontSize: '13px' }}>{emp.avatar || '🧑‍💻'}</span>
                <span className="session-title-text">{emp.name}</span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
