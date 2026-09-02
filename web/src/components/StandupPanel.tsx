import React, { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Meeting, Settings, Team } from '../api/types';
import { useToast } from './Toast';
import { CalendarClock, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

interface StandupPanelProps {
  teams: Team[];
}

function formatDate(unixSeconds: number): string {
  if (!unixSeconds) return '';
  return new Date(unixSeconds * 1000).toLocaleString();
}

/** Daily standups, distinct from the "Call Meeting" ad-hoc flow: a real
 *  recurring ritual (OfficeManager.run_standup) where the whole active team
 *  reports Yesterday/Today/Blockers grounded in their own actual work_items,
 *  not a freeform topic. This panel lists past standups per team and lets
 *  the operator trigger one on demand, same flow the daily scheduler fires
 *  (see hermes/office.py _maybe_trigger_standup). */
export function StandupPanel({ teams }: StandupPanelProps) {
  const { toast } = useToast();
  const [standups, setStandups] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runningTeamId, setRunningTeamId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);

  const load = useCallback(async () => {
    try {
      setStandups(await api.getMeetings(undefined, 'standup'));
    } catch (err) {
      toast(errorMessage(err, 'Failed to load standups'), 'err');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.getSettings().then(setSettings).catch(() => {}); }, []);

  const saveSchedule = async (fields: Partial<Pick<Settings, 'office_standup_enabled' | 'office_standup_time'>>) => {
    if (!settings) return;
    const next = { ...settings, ...fields };
    setSettings(next); // optimistic — the toggle/time input feels instant
    setSavingSchedule(true);
    try {
      await api.saveSettings(next);
    } catch (err) {
      setSettings(settings); // revert on failure
      toast(errorMessage(err, 'Failed to save standup schedule'), 'err');
    } finally {
      setSavingSchedule(false);
    }
  };

  const teamName = (id: string) => teams.find((t) => t.team_id === id)?.name || id;

  const runNow = async (teamId: string) => {
    setRunningTeamId(teamId);
    try {
      await api.runStandup(teamId);
      toast(`Standup run for ${teamName(teamId)}`, 'ok');
      await load();
    } catch (err) {
      toast(errorMessage(err, 'Failed to run standup'), 'err');
    } finally {
      setRunningTeamId(null);
    }
  };

  if (teams.length === 0) return null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <CalendarClock size={13} />
          Daily Standups
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {settings && (
            <label
              title="Automatically run every active team's standup once a day at this time"
              style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--text-faint)', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={settings.office_standup_enabled}
                disabled={savingSchedule}
                onChange={(e) => saveSchedule({ office_standup_enabled: e.target.checked })}
              />
              Auto-run daily at
              <input
                type="time"
                value={settings.office_standup_time}
                disabled={savingSchedule}
                onChange={(e) => saveSchedule({ office_standup_time: e.target.value })}
                style={{
                  fontSize: '11px', padding: '2px 4px', borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--border)', background: 'var(--surface-0)', color: 'var(--text)',
                }}
              />
            </label>
          )}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {teams.map((t) => (
            <button
              key={t.team_id}
              type="button"
              className="session-action-btn"
              disabled={runningTeamId === t.team_id}
              onClick={() => runNow(t.team_id)}
              title={`Run standup now for ${t.name}`}
              style={{ fontSize: '11px', padding: '4px 8px', width: 'auto', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              {runningTeamId === t.team_id ? <Loader2 size={11} className="spin" /> : <CalendarClock size={11} />}
              {t.name}
            </button>
          ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>Loading standups…</div>
      ) : standups.length === 0 ? (
        <div style={{ fontSize: '11px', color: 'var(--text-faint)', fontStyle: 'italic' }}>
          No standups yet — turn on daily standups in Settings, or run one now above.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {standups.map((m) => {
            const expanded = expandedId === m.meeting_id;
            return (
              <div
                key={m.meeting_id}
                style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface-card)' }}
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : m.meeting_id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', padding: '8px 10px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                >
                  {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <span style={{ fontSize: '11px', fontWeight: 600 }}>{teamName(m.team_id)}</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-faint)' }}>{formatDate(m.created)}</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-faint)', marginLeft: 'auto' }}>
                    {m.participant_ids.length} {m.participant_ids.length === 1 ? 'person' : 'people'}
                  </span>
                </button>
                {expanded && (
                  <pre
                    style={{
                      margin: 0, padding: '0 10px 10px 26px', fontSize: '11px',
                      whiteSpace: 'pre-wrap', color: 'var(--text)', fontFamily: 'inherit',
                    }}
                  >
                    {m.transcript}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
