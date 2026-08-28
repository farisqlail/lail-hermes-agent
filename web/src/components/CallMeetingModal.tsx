import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Field } from './Field';
import { Button } from './Button';
import { Employee } from '../api/types';

interface CallMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCall: (data: { participant_ids: string[]; topic: string; project?: string }) => Promise<void>;
  /** The lead calling the meeting — always included as a participant. */
  lead: Employee | null;
  /** The lead's teammates (same team_id, excluding the lead). */
  teamMembers: Employee[];
}

export function CallMeetingModal({ isOpen, onClose, onCall, lead, teamMembers }: CallMeetingModalProps) {
  const [topic, setTopic] = useState('');
  const [project, setProject] = useState('');
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [calling, setCalling] = useState(false);
  // Leaving Project blank is easy to do by accident, and the result looks
  // identical either way until you go looking for files that were never
  // written — this makes the tradeoff impossible to miss instead of silent.
  const [noProjectConfirmed, setNoProjectConfirmed] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setTopic('');
    setProject('');
    setNoProjectConfirmed(false);
    setParticipantIds(teamMembers.map((m) => m.employee_id));
  }, [isOpen, teamMembers]);

  const toggleMember = (id: string) => {
    setParticipantIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  };

  const handleCall = async () => {
    if (!lead || !topic.trim()) return;
    if (!project.trim() && !noProjectConfirmed) {
      setNoProjectConfirmed(true);
      return;
    }
    setCalling(true);
    try {
      await onCall({
        participant_ids: [lead.employee_id, ...participantIds],
        topic: topic.trim(),
        project: project.trim() || undefined,
      });
      onClose();
    } finally {
      setCalling(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Call meeting — ${lead?.name || ''}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Field label="Topic">
          <input
            className="field-input"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Sprint planning for the new launch"
            autoFocus
          />
        </Field>

        <Field label="Attendees" helpText={`${lead?.name || 'The lead'} always attends.`}>
          {teamMembers.length === 0 ? (
            <div style={{ fontSize: '11px', color: 'var(--text-faint)', fontStyle: 'italic' }}>
              No other teammates to invite.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: 160, overflowY: 'auto' }}>
              {teamMembers.map((m) => (
                <label
                  key={m.employee_id}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={participantIds.includes(m.employee_id)}
                    onChange={() => toggleMember(m.employee_id)}
                  />
                  <span>{m.name} <span style={{ color: 'var(--text-faint)' }}>({m.role || 'team member'})</span></span>
                </label>
              ))}
            </div>
          )}
        </Field>

        <Field
          label="Project (optional)"
          helpText="Leave blank for knowledge work only. Set a registered project name to have any action items this meeting produces run as real coding tasks that actually write files."
        >
          <input
            className="field-input"
            value={project}
            onChange={(e) => { setProject(e.target.value); setNoProjectConfirmed(false); }}
            placeholder="e.g. my-app"
          />
        </Field>

        {!project.trim() && noProjectConfirmed && (
          <div style={{ fontSize: '11px', color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b', borderRadius: '6px', padding: '8px 10px' }}>
            No project set — any action items will only produce text, no files get written. Click Call meeting again to confirm, or set a project above.
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '4px' }}>
          <Button variant="secondary" type="button" onClick={onClose} disabled={calling}>Cancel</Button>
          <Button variant="primary" type="button" loading={calling} disabled={!topic.trim()} onClick={handleCall}>
            {!project.trim() && noProjectConfirmed ? 'Call anyway (text only)' : 'Call meeting'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
