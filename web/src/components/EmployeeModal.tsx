import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Field } from './Field';
import { Button } from './Button';
import { api } from '../api/client';
import { Employee, Team, Skill } from '../api/types';
import { Shuffle, Search } from 'lucide-react';

interface EmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Partial<Employee>) => Promise<void>;
  teams: Team[];
  employee?: Employee | null;
}

const AVATAR_CHOICES = ['🧑‍💻', '👩‍💻', '🧑‍💼', '👩‍💼', '🧑‍🎨', '👩‍🎨', '🧑‍🔬', '👨‍💻'];

const FIRST_NAMES = [
  'Sarah', 'James', 'Aisha', 'Wei', 'Diego', 'Elena', 'Noah', 'Priya',
  'Kenji', 'Fatima', 'Lucas', 'Mei', 'Omar', 'Ingrid', 'Tariq', 'Chloe',
  'Arjun', 'Zoe', 'Hassan', 'Freya', 'Kwame', 'Nadia', 'Felix', 'Amara',
];
const LAST_NAMES = [
  'Chen', 'Patel', 'Garcia', 'Nakamura', 'Johansson', 'Okafor', 'Kim',
  'Rossi', 'Novak', 'Silva', 'Andersen', 'Haddad', 'Larsen', 'Fischer',
  'Costa', 'Sato', 'Dubois', 'Ivanov', 'Reyes', 'Berg',
];

function randomName(): string {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${first} ${last}`;
}

export function EmployeeModal({ isOpen, onClose, onSave, teams, employee }: EmployeeModalProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [avatar, setAvatar] = useState(AVATAR_CHOICES[0]);
  const [personality, setPersonality] = useState('');
  const [model, setModel] = useState('');
  const [teamId, setTeamId] = useState('');
  const [isLead, setIsLead] = useState(false);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillSearch, setSkillSearch] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(employee?.name || '');
    setRole(employee?.role || '');
    setAvatar(employee?.avatar || AVATAR_CHOICES[0]);
    setPersonality(employee?.personality || '');
    setModel(employee?.model || '');
    setTeamId(employee?.team_id || '');
    setIsLead(employee?.is_lead || false);
    setSkillIds(employee?.skill_ids || []);
    setSkillSearch('');
    api.getSkills().then(setSkills).catch(() => setSkills([]));
  }, [isOpen, employee]);

  const toggleSkill = (id: string) => {
    setSkillIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const filteredSkills = skillSearch.trim()
    ? skills.filter((s) => {
        const q = skillSearch.trim().toLowerCase();
        return (s.name || s.id).toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q);
      })
    : skills;

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        role: role.trim(),
        avatar,
        personality: personality.trim(),
        model: model.trim(),
        team_id: teamId || null,
        is_lead: isLead,
        skill_ids: skillIds,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={employee ? 'Edit Employee' : 'New Employee'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Field label="Avatar">
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {AVATAR_CHOICES.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAvatar(a)}
                style={{
                  fontSize: '20px',
                  padding: '6px 10px',
                  borderRadius: '8px',
                  border: a === avatar ? '2px solid var(--accent)' : '1px solid var(--border)',
                  background: 'var(--bg-secondary, transparent)',
                  cursor: 'pointer',
                }}
              >
                {a}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Name">
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              className="field-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sarah"
              autoFocus
              style={{ flex: 1 }}
            />
            <Button
              type="button"
              variant="secondary"
              title="Random name"
              onClick={() => setName(randomName())}
            >
              <Shuffle size={14} />
            </Button>
          </div>
        </Field>

        <Field label="Role" helpText="Free text — Backend Dev, Marketing Lead, anything.">
          <input
            className="field-input"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. Backend Developer"
          />
        </Field>

        <Field label="Team">
          <select className="field-select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">(unassigned)</option>
            {teams.map((t) => (
              <option key={t.team_id} value={t.team_id}>{t.name}</option>
            ))}
          </select>
        </Field>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={isLead}
            onChange={(e) => setIsLead(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            <div style={{ fontWeight: 600 }}>Team Lead</div>
            <div style={{ color: 'var(--text-faint)', fontSize: '11px' }}>
              Tasks assigned to this employee get broken down and delegated to their team instead of done solo. They can also call team meetings.
            </div>
          </span>
        </label>

        <Field label="Personality / persona prompt" helpText="Shapes how this employee works — injected as their system prompt.">
          <textarea
            className="field-input"
            rows={3}
            value={personality}
            onChange={(e) => setPersonality(e.target.value)}
            placeholder="e.g. Meticulous, prefers concise code, always writes tests first."
          />
        </Field>

        <Field label="Model override" helpText="Leave blank to use the default chat model.">
          <input
            className="field-input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="(default)"
          />
        </Field>

        <Field label="Skills" helpText="Injected into this employee's system prompt. Manage the catalog in Settings → Skills.">
          {skills.length === 0 ? (
            <div style={{ fontSize: '11px', color: 'var(--text-faint)', fontStyle: 'italic' }}>
              No skills installed yet — add some in Settings → Skills.
            </div>
          ) : (
            <>
              {skills.length > 5 && (
                <div style={{ position: 'relative', marginBottom: '6px' }}>
                  <Search size={13} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--text-faint)' }} />
                  <input
                    className="field-input"
                    value={skillSearch}
                    onChange={(e) => setSkillSearch(e.target.value)}
                    placeholder="Search skills…"
                    style={{ paddingLeft: '26px', fontSize: '12px' }}
                  />
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: 160, overflowY: 'auto' }}>
                {filteredSkills.length === 0 && (
                  <div style={{ fontSize: '11px', color: 'var(--text-faint)', fontStyle: 'italic' }}>
                    No skills match "{skillSearch}".
                  </div>
                )}
                {filteredSkills.map((s) => (
                  <label
                    key={s.id}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px', cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={skillIds.includes(s.id)}
                      onChange={() => toggleSkill(s.id)}
                      style={{ marginTop: 2 }}
                    />
                    <span>
                      <div style={{ fontWeight: 600 }}>{s.name || s.id}</div>
                      {s.description && (
                        <div style={{ color: 'var(--text-faint)', fontSize: '11px' }}>{s.description}</div>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </Field>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '4px' }}>
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" type="button" loading={saving} disabled={!name.trim()} onClick={handleSave}>
            {employee ? 'Save' : 'Create'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
