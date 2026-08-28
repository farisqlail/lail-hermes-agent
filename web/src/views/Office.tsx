import React, { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Employee, Team } from '../api/types';
import { useOfficeEvents } from '../api/officeEvents';
import { useRoute } from '../router';
import { Button } from '../components/Button';
import { EmployeeModal } from '../components/EmployeeModal';
import { TeamModal } from '../components/TeamModal';
import { ConfirmModal } from '../components/ConfirmModal';
import { AssignTaskModal } from '../components/AssignTaskModal';
import { CallMeetingModal } from '../components/CallMeetingModal';
import { OfficeSessionChat } from '../components/OfficeSessionChat';
import { WorkOutputFeed } from '../components/WorkOutputFeed';
import { OfficeCanvas } from '../components/OfficeCanvas';
import { useToast } from '../components/Toast';
import { Plus, Users, Trash2, Pencil, Briefcase, Send, Wifi, WifiOff, Crown, Users2 } from 'lucide-react';

// Individual employees can be assigned a task directly (a lead fans it out
// to their team; anyone else just does it) alongside their chat session —
// clicking the card still opens chat, the Send button opens this instead.
type AssignTarget = { type: 'employee' | 'team'; id: string; label: string };

const STATUS_LABEL: Record<Employee['status'], string> = {
  idle: 'Idle',
  working: 'Working',
  on_break: 'On break',
  in_meeting: 'In meeting',
};

const STATUS_COLOR: Record<Employee['status'], string> = {
  idle: 'var(--text-faint)',
  working: 'var(--accent)',
  on_break: '#f59e0b',
  in_meeting: '#8b5cf6',
};

export function Office() {
  const { toast } = useToast();
  const { officeSessionId, navigate } = useRoute();
  const { employees, teams, loading, isConnected, refresh, lastEvent } = useOfficeEvents();

  useEffect(() => {
    if (lastEvent?.type === 'office_meeting_done') {
      const topic = typeof lastEvent.topic === 'string' ? lastEvent.topic : 'a team meeting';
      toast(`Meeting held: ${topic}`, 'ok');
    } else if (lastEvent?.type === 'office_decision_made') {
      const decision = typeof lastEvent.decision === 'string' ? lastEvent.decision : 'made a call';
      toast(`Lead decided: ${decision}`, 'ok');
    }
  }, [lastEvent, toast]);

  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);

  const [deleteEmployeeTarget, setDeleteEmployeeTarget] = useState<Employee | null>(null);
  const [deleteTeamTarget, setDeleteTeamTarget] = useState<Team | null>(null);
  const [assignTarget, setAssignTarget] = useState<AssignTarget | null>(null);
  const [callMeetingTarget, setCallMeetingTarget] = useState<Employee | null>(null);
  const [feedKey, setFeedKey] = useState(0);
  const [speakingEmployeeId, setSpeakingEmployeeId] = useState<string | null>(null);
  const handleStreamingChange = useCallback((id: string | null) => setSpeakingEmployeeId(id), []);

  // Clicking an employee (card or 3D character) resumes their most recent
  // chat session, or creates one — then navigates into it. Sessions live in
  // the URL/sidebar now, not a modal, so there is no "open chat" state here.
  const openChatFor = async (emp: Employee) => {
    try {
      const existing = await api.getOfficeSessions(emp.employee_id);
      const session = existing[0] || await api.createOfficeSession({ employee_id: emp.employee_id });
      navigate(`#/office/session/${session.session_id}`);
    } catch (err) {
      toast(errorMessage(err, 'Failed to open chat'), 'err');
    }
  };

  const saveEmployee = async (data: Partial<Employee>) => {
    try {
      if (editingEmployee) {
        await api.updateEmployee(editingEmployee.employee_id, data);
        toast('Employee updated', 'ok');
      } else {
        await api.createEmployee(data);
        toast('Employee hired', 'ok');
      }
      await refresh();
    } catch (err) {
      toast(errorMessage(err, 'Failed to save employee'), 'err');
      throw err;
    }
  };

  const saveTeam = async (data: { name: string; description?: string }) => {
    try {
      if (editingTeam) {
        await api.updateTeam(editingTeam.team_id, data);
        toast('Team updated', 'ok');
      } else {
        await api.createTeam(data);
        toast('Team created', 'ok');
      }
      await refresh();
    } catch (err) {
      toast(errorMessage(err, 'Failed to save team'), 'err');
      throw err;
    }
  };

  const confirmDeleteEmployee = async () => {
    if (!deleteEmployeeTarget) return;
    try {
      await api.deleteEmployee(deleteEmployeeTarget.employee_id);
      toast('Employee removed', 'ok');
      setDeleteEmployeeTarget(null);
      await refresh();
    } catch (err) {
      toast(errorMessage(err, 'Failed to remove employee'), 'err');
    }
  };

  const confirmDeleteTeam = async () => {
    if (!deleteTeamTarget) return;
    try {
      await api.deleteTeam(deleteTeamTarget.team_id);
      toast('Team deleted', 'ok');
      setDeleteTeamTarget(null);
      await refresh();
    } catch (err) {
      toast(errorMessage(err, 'Failed to delete team'), 'err');
    }
  };

  const handleAssign = async (data: { prompt: string; project?: string }) => {
    if (!assignTarget) return;
    try {
      if (assignTarget.type === 'employee') {
        await api.assignEmployeeTask(assignTarget.id, data);
      } else {
        await api.assignTeamTask(assignTarget.id, data);
      }
      toast(`Task assigned to ${assignTarget.label}`, 'ok');
      setFeedKey((k) => k + 1);
    } catch (err) {
      toast(errorMessage(err, 'Failed to assign task'), 'err');
      throw err;
    }
  };

  const handleCallMeeting = async (data: { participant_ids: string[]; topic: string; project?: string }) => {
    if (!callMeetingTarget?.team_id) return;
    try {
      await api.createMeeting({ team_id: callMeetingTarget.team_id, ...data });
      setFeedKey((k) => k + 1);
    } catch (err) {
      toast(errorMessage(err, 'Failed to call meeting'), 'err');
      throw err;
    }
  };

  const unassigned = employees.filter((e) => !e.team_id);
  const byTeam = (teamId: string) => employees.filter((e) => e.team_id === teamId);

  const renderEmployeeCard = (emp: Employee) => (
    <div
      key={emp.employee_id}
      className="office-employee-card"
      onClick={() => openChatFor(emp)}
      style={{ cursor: 'pointer' }}
      title={`Chat or assign a task to ${emp.name}`}
    >
      <div style={{ fontSize: '26px', lineHeight: 1 }}>{emp.avatar || '🧑‍💻'}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '5px' }}>
          {emp.name}
          {emp.is_lead && (
            <span title="Team Lead" style={{ display: 'inline-flex' }}>
              <Crown size={12} style={{ color: '#f59e0b' }} />
            </span>
          )}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>{emp.role || 'No role set'}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[emp.status] }} />
          <span style={{ fontSize: '10px', color: 'var(--text-faint)' }}>{STATUS_LABEL[emp.status]}</span>
        </div>
        <div
          title={`Energy: ${Math.round(emp.energy)}%`}
          style={{ width: '100%', height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.08)', marginTop: '6px', overflow: 'hidden' }}
        >
          <div
            style={{
              width: `${Math.max(0, Math.min(100, emp.energy))}%`,
              height: '100%',
              background: emp.energy <= 20 ? '#ef4444' : emp.energy <= 50 ? '#f59e0b' : '#22c55e',
              transition: 'width 0.4s ease',
            }}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '4px' }}>
        <button
          type="button"
          className="session-action-btn"
          title={`Assign task to ${emp.name}`}
          onClick={(e) => { e.stopPropagation(); setAssignTarget({ type: 'employee', id: emp.employee_id, label: emp.name }); }}
        >
          <Send size={12} />
        </button>
        {emp.is_lead && (
          <button
            type="button"
            className="session-action-btn"
            title={`Call a team meeting with ${emp.name}`}
            onClick={(e) => { e.stopPropagation(); setCallMeetingTarget(emp); }}
          >
            <Users2 size={12} />
          </button>
        )}
        <button
          type="button"
          className="session-action-btn"
          title="Edit"
          onClick={(e) => { e.stopPropagation(); setEditingEmployee(emp); setEmployeeModalOpen(true); }}
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          className="session-action-btn"
          title="Remove"
          onClick={(e) => { e.stopPropagation(); setDeleteEmployeeTarget(emp); }}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="office-view-container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h3 className="settings-section-heading" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px' }}>
            <Briefcase size={18} style={{ color: 'var(--accent)' }} /> 3D Virtual Office
          </h3>
          <p className="settings-panel-desc" style={{ fontSize: '12px', marginTop: '2px' }}>
            Hire AI employees, organize autonomous teams, and observe them collaborate in real-time.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            title={isConnected ? 'Live updates connected' : 'Reconnecting…'}
            style={{ display: 'flex', alignItems: 'center', color: isConnected ? '#22c55e' : 'var(--text-faint)' }}
          >
            {isConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
          </span>
          <Button variant="secondary" size="small" onClick={() => { setEditingTeam(null); setTeamModalOpen(true); }}>
            <Users size={13} style={{ marginRight: 6 }} /> New team
          </Button>
          <Button variant="primary" size="small" onClick={() => { setEditingEmployee(null); setEmployeeModalOpen(true); }}>
            <Plus size={13} style={{ marginRight: 6 }} /> New employee
          </Button>
        </div>
      </div>

      <div style={{ marginBottom: '24px' }}>
        <OfficeCanvas
          employees={employees}
          onSelectEmployee={openChatFor}
          speakingEmployeeId={speakingEmployeeId}
        />
      </div>

      {loading ? (
        <div style={{ padding: '24px', color: 'var(--text-faint)', fontSize: '12px' }}>Loading office…</div>
      ) : employees.length === 0 && teams.length === 0 ? (
        <div style={{ padding: '24px', color: 'var(--text-faint)', fontSize: '12px', textAlign: 'center' }}>
          No employees yet. Hire your first one to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {teams.map((team) => (
            <div key={team.team_id}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {team.name}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>({team.member_count})</span>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    type="button"
                    className="session-action-btn"
                    title="Assign task to team"
                    onClick={(e) => { e.stopPropagation(); setAssignTarget({ type: 'team', id: team.team_id, label: `${team.name} team` }); }}
                  >
                    <Send size={12} />
                  </button>
                  <button
                    type="button"
                    className="session-action-btn"
                    title="Edit team"
                    onClick={() => { setEditingTeam(team); setTeamModalOpen(true); }}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="session-action-btn"
                    title="Delete team"
                    onClick={() => setDeleteTeamTarget(team)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              {team.description && (
                <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '0 0 8px' }}>{team.description}</p>
              )}
              <div className="office-employee-grid">
                {byTeam(team.team_id).length === 0 ? (
                  <div style={{ fontSize: '11px', color: 'var(--text-faint)', fontStyle: 'italic' }}>No members yet</div>
                ) : (
                  byTeam(team.team_id).map(renderEmployeeCard)
                )}
              </div>
            </div>
          ))}

          {unassigned.length > 0 && (
            <div>
              <div style={{ fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
                Unassigned
              </div>
              <div className="office-employee-grid">
                {unassigned.map(renderEmployeeCard)}
              </div>
            </div>
          )}
        </div>
      )}

      {employees.length > 0 && (
        <div style={{ marginTop: '28px' }}>
          <div style={{ fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
            Recent Work
          </div>
          <WorkOutputFeed key={feedKey} />
        </div>
      )}

      <EmployeeModal
        isOpen={employeeModalOpen}
        onClose={() => setEmployeeModalOpen(false)}
        onSave={saveEmployee}
        teams={teams}
        employee={editingEmployee}
      />
      <TeamModal
        isOpen={teamModalOpen}
        onClose={() => setTeamModalOpen(false)}
        onSave={saveTeam}
        team={editingTeam}
      />
      <ConfirmModal
        isOpen={!!deleteEmployeeTarget}
        onClose={() => setDeleteEmployeeTarget(null)}
        onConfirm={confirmDeleteEmployee}
        title="Remove employee"
        message={`Remove ${deleteEmployeeTarget?.name || 'this employee'}? Their past work stays on record.`}
        confirmText="Remove"
      />
      <ConfirmModal
        isOpen={!!deleteTeamTarget}
        onClose={() => setDeleteTeamTarget(null)}
        onConfirm={confirmDeleteTeam}
        title="Delete team"
        message={`Delete ${deleteTeamTarget?.name || 'this team'}? Members become unassigned, not removed.`}
        confirmText="Delete"
      />
      <AssignTaskModal
        isOpen={!!assignTarget}
        onClose={() => setAssignTarget(null)}
        onAssign={handleAssign}
        targetLabel={assignTarget?.label || ''}
      />
      <CallMeetingModal
        isOpen={!!callMeetingTarget}
        onClose={() => setCallMeetingTarget(null)}
        onCall={handleCallMeeting}
        lead={callMeetingTarget}
        teamMembers={employees.filter(
          (e) => e.team_id === callMeetingTarget?.team_id && e.employee_id !== callMeetingTarget?.employee_id
        )}
      />

      {officeSessionId && (
        <div
          className="modal-overlay"
          onClick={() => navigate('#/office')}
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.25)', backdropFilter: 'none' }}
        >
          <div
            className="modal-container"
            style={{ maxWidth: '640px', width: '90vw', height: '82vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ flex: 1, minHeight: 0, padding: 'var(--s4)', display: 'flex' }}>
              <OfficeSessionChat
                sessionId={officeSessionId}
                employees={employees}
                onBack={() => navigate('#/office')}
                onDeleted={() => navigate('#/office')}
                onStreamingChange={handleStreamingChange}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
