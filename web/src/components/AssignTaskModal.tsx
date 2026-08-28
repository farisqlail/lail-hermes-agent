import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Field } from './Field';
import { Button } from './Button';

interface AssignTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAssign: (data: { prompt: string; project?: string }) => Promise<void>;
  /** e.g. "Sarah" or "Marketing team" — shown in the title/description. */
  targetLabel: string;
}

export function AssignTaskModal({ isOpen, onClose, onAssign, targetLabel }: AssignTaskModalProps) {
  const [prompt, setPrompt] = useState('');
  const [project, setProject] = useState('');
  const [assigning, setAssigning] = useState(false);
  // Leaving Project blank is easy to do by accident, and the result looks
  // identical either way until you go looking for files that were never
  // written — this makes the tradeoff impossible to miss instead of silent.
  const [noProjectConfirmed, setNoProjectConfirmed] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setPrompt('');
    setProject('');
    setNoProjectConfirmed(false);
  }, [isOpen]);

  const handleAssign = async () => {
    if (!prompt.trim()) return;
    if (!project.trim() && !noProjectConfirmed) {
      setNoProjectConfirmed(true);
      return;
    }
    setAssigning(true);
    try {
      await onAssign({ prompt: prompt.trim(), project: project.trim() || undefined });
      onClose();
    } finally {
      setAssigning(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Assign task — ${targetLabel}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Field label="Task">
          <textarea
            className="field-input"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Write three tagline options for the new product launch"
            autoFocus
          />
        </Field>

        <Field
          label="Project (optional)"
          helpText="Leave blank for knowledge work (writing, planning). Set a registered project name to have this run as a real coding task that actually writes files."
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
            No project set — this will only produce text, no files get written. Click Assign again to confirm, or set a project above.
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '4px' }}>
          <Button variant="secondary" type="button" onClick={onClose} disabled={assigning}>Cancel</Button>
          <Button variant="primary" type="button" loading={assigning} disabled={!prompt.trim()} onClick={handleAssign}>
            {!project.trim() && noProjectConfirmed ? 'Assign anyway (text only)' : 'Assign'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
