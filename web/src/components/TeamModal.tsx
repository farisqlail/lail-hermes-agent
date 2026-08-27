import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Field } from './Field';
import { Button } from './Button';
import { Team } from '../api/types';

interface TeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { name: string; description?: string }) => Promise<void>;
  team?: Team | null;
}

export function TeamModal({ isOpen, onClose, onSave, team }: TeamModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(team?.name || '');
    setDescription(team?.description || '');
  }, [isOpen, team]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), description: description.trim() });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={team ? 'Edit Team' : 'New Team'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Field label="Team name" helpText="Any name — dev, marketing, management, or something custom.">
          <input
            className="field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Marketing"
            autoFocus
          />
        </Field>

        <Field label="Description">
          <textarea
            className="field-input"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this team is responsible for"
          />
        </Field>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '4px' }}>
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" type="button" loading={saving} disabled={!name.trim()} onClick={handleSave}>
            {team ? 'Save' : 'Create'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
