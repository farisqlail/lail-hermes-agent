import React, { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Skill } from '../api/types';
import { Field } from '../components/Field';
import { Button } from '../components/Button';
import { Toggle } from '../components/Toggle';
import { useToast } from '../components/Toast';
import { Sparkles, Download, CheckCircle2, Trash2, Plus, AlertTriangle, GitBranch } from 'lucide-react';

interface PresetSkill {
  id: string;
  name: string;
  description: string;
  content: string;
}

// Domain-specific to this agent's own orchestration job — not generic
// productivity presets. Purely a frontend catalog: the backend only ever
// stores whatever ends up installed, catalog pick or manual alike.
const SKILLS_CATALOG: PresetSkill[] = [
  {
    id: 'failure-analysis',
    name: 'Analisis Kegagalan Task',
    description: 'Panggil failure_report, kelompokkan kegagalan per jenis (lingkungan/struktural/sesaat), dan sarankan tindakan konkret per kelompok.',
    content: 'Panggil `failure_report` untuk mengambil data kegagalan task terakhir. '
      + 'Kelompokkan hasilnya menurut jenis kegagalan (lingkungan, struktural, sesaat, kode). '
      + 'Untuk tiap kelompok yang punya anggota, sebutkan jumlahnya dan sarankan SATU tindakan konkret: '
      + 'kegagalan lingkungan → perbaikan di mesin/dependency; struktural → rencana ulang pendekatan; '
      + 'sesaat → cukup dikirim ulang. Tutup dengan jenis kegagalan yang paling sering muncul.',
  },
  {
    id: 'project-status-digest',
    name: 'Ringkasan Status Semua Proyek',
    description: 'Panggil list_projects lalu recent_tasks per proyek, susun jadi satu ringkasan status lintas-proyek yang rapi.',
    content: 'Panggil `list_projects` untuk daftar proyek terdaftar, lalu `recent_tasks` untuk task terbaru. '
      + 'Susun jadi tabel ringkas: nama proyek, status task terakhirnya, dan kapan terakhir ada aktivitas. '
      + 'Tandai proyek yang task terakhirnya berstatus failed atau belum ada aktivitas sama sekali. '
      + 'Jangan mengarang status — kalau sebuah proyek belum pernah punya task, katakan itu apa adanya.',
  },
  {
    id: 'start-task-template',
    name: 'Template Start Task Terstruktur',
    description: 'Panduan menyusun deskripsi start_task yang jelas: sebut @proyek, lingkup spesifik, dan verb yang tidak ambigu.',
    content: 'Sebelum memanggil `start_task`, susun deskripsinya mengikuti format: '
      + '"@nama-proyek <verb spesifik> <lingkup jelas>". Verb harus konkret (perbaiki, tambahkan, hapus, refactor) '
      + 'bukan umum (kerjakan, benerin). Lingkup harus menyebut file/fitur/area yang dimaksud, bukan cuma '
      + '"masalahnya". Kalau permintaan pengguna terlalu samar untuk disusun begini, tanyakan dulu lingkup '
      + 'spesifiknya sebelum memanggil start_task — jangan menebak.',
  },
];

// The only taps the backend will fetch from (hermes/skills.py TRUSTED_TAPS)
// — vendor-published official repos, installed without a security scanner
// because they are not arbitrary community content. Example paths below
// were verified live against each repo's `main` branch, not guessed.
const TRUSTED_TAPS: { tap: string; label: string; examples: string[] }[] = [
  { tap: 'anthropics/skills', label: 'Anthropic (anthropics/skills)',
    examples: ['skills/pdf', 'skills/docx', 'skills/xlsx', 'skills/pptx', 'skills/mcp-builder'] },
  { tap: 'openai/skills', label: 'OpenAI (openai/skills)',
    examples: ['skills/.curated/cli-creator', 'skills/.curated/define-goal', 'skills/.curated/cloudflare-deploy'] },
  { tap: 'nvidia/skills', label: 'NVIDIA (NVIDIA/skills)',
    examples: ['skills/cudaq-guide', 'skills/aiq-deploy', 'skills/aiq-research'] },
  { tap: 'huggingface/skills', label: 'Hugging Face (huggingface/skills)',
    examples: ['skills/hf-cli', 'skills/hf-mem'] },
];

export function ConfigSkills() {
  const { toast } = useToast();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<'installed' | 'catalog' | 'github' | 'add'>('installed');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const [addName, setAddName] = useState('');
  const [addDescription, setAddDescription] = useState('');
  const [addContent, setAddContent] = useState('');

  const [selectedTap, setSelectedTap] = useState(TRUSTED_TAPS[0].tap);
  const [skillPath, setSkillPath] = useState('');
  const [installingTap, setInstallingTap] = useState(false);

  // Live catalog from agenticskills.io — fetched lazily the first time the
  // Katalog tab is opened, not on mount, since most sessions never touch it.
  const [catalogItems, setCatalogItems] = useState<{ slug: string; name: string; description: string }[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);

  const loadCatalog = async (force = false) => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      setCatalogItems(await api.getSkillsCatalog(force));
    } catch (err) {
      setCatalogError(errorMessage(err, 'Gagal memuat katalog agenticskills.io'));
    } finally {
      setCatalogLoading(false);
    }
  };

  useEffect(() => {
    if (viewTab === 'catalog' && catalogItems === null && !catalogLoading) {
      loadCatalog();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewTab]);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setSkills(await api.getSkills());
    } catch (err) {
      setError(errorMessage(err, 'Gagal memuat skill'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  if (error && skills.length === 0 && !loading) {
    return (
      <div style={{ padding: '14px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--err)', borderRadius: '6px', color: 'var(--err)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span>{error}</span>
        <Button variant="danger" type="button" onClick={refresh}>Coba Lagi</Button>
      </div>
    );
  }

  if (loading) {
    return <div style={{ color: 'var(--text-dim)', fontSize: '13px' }}>Memuat skill...</div>;
  }

  const persist = async (nextSkills: Skill[], okMessage: string) => {
    setSaving(true);
    try {
      const result = await api.saveSkills(nextSkills);
      if (result.ok) {
        setSkills(nextSkills);
        toast(okMessage, 'ok');
      } else {
        toast('Gagal menyimpan skill.', 'err');
      }
    } catch (err) {
      toast(errorMessage(err, 'Terjadi kesalahan saat menyimpan skill.'), 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleInstallPreset = (preset: PresetSkill) => {
    const next: Skill = { id: preset.id, name: preset.name, description: preset.description,
      content: preset.content, enabled: true };
    persist([...skills, next], `Skill "${preset.name}" terpasang.`);
    setViewTab('installed');
  };

  const handleToggle = (id: string, enabled: boolean) => {
    persist(skills.map((s) => (s.id === id ? { ...s, enabled } : s)),
      enabled ? 'Skill diaktifkan.' : 'Skill dinonaktifkan.');
  };

  const handleDelete = (id: string) => {
    const removed = skills.find((s) => s.id === id);
    persist(skills.filter((s) => s.id !== id), `Skill "${removed?.name || id}" dicopot.`);
    setDeleteTarget(null);
  };

  const handleAddManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addName.trim() || !addContent.trim()) return;
    const next: Skill = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `skill-${Date.now()}`,
      name: addName.trim(), description: addDescription.trim(), content: addContent.trim(), enabled: true,
    };
    persist([...skills, next], `Skill "${next.name}" ditambahkan.`);
    setAddName(''); setAddDescription(''); setAddContent('');
    setViewTab('installed');
  };

  const handleInstallTap = async () => {
    if (!skillPath.trim()) return;
    setInstallingTap(true);
    try {
      const installed = await api.installSkillTap(selectedTap, skillPath.trim());
      setSkills((prev) => [...prev.filter((s) => s.id !== installed.id), installed]);
      toast(`Skill "${installed.name}" terpasang dari ${selectedTap}.`, 'ok');
      setSkillPath('');
      setViewTab('installed');
    } catch (err) {
      toast(errorMessage(err, 'Gagal memasang skill dari GitHub'), 'err');
    } finally {
      setInstallingTap(false);
    }
  };

  const isPresetInstalled = (presetId: string) => skills.some((s) => s.id === presetId);
  const isCatalogInstalled = (slug: string) => skills.some((s) => s.id === `agenticskills-${slug}`);

  const handleInstallFromCatalog = async (slug: string, name: string) => {
    setInstallingSlug(slug);
    try {
      const installed = await api.installSkillCatalog(slug);
      setSkills((prev) => [...prev.filter((s) => s.id !== installed.id), installed]);
      toast(`Skill "${name}" terpasang tapi masih NONAKTIF — sumber komunitas, cek isinya di tab Terpasang lalu aktifkan sendiri.`, 'ok');
    } catch (err) {
      toast(errorMessage(err, 'Gagal memasang skill dari katalog'), 'err');
    } finally {
      setInstallingSlug(null);
    }
  };

  const filteredCatalog = (catalogItems || []).filter((it) => {
    const q = catalogSearch.trim().toLowerCase();
    if (!q) return true;
    return it.name.toLowerCase().includes(q) || it.description.toLowerCase().includes(q);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <h3 className="settings-section-heading" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={15} style={{ color: 'var(--accent)' }} />
          <span>Skills</span>
        </h3>
        <p className="settings-panel-desc">
          Instruksi siap pakai yang bisa dipanggil chat agent lewat <code>use_skill</code>. Disimpan sebagai file <code>SKILL.md</code> asli — format terbuka agentskills.io. Pasang/copot kapan saja, gak perlu restart.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '10px', flexWrap: 'wrap' }}>
        {(['installed', 'catalog', 'github', 'add'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setViewTab(tab)}
            style={{
              padding: '6px 12px', borderRadius: 'var(--r-md)', fontSize: '12px', fontWeight: 600,
              border: `1px solid ${viewTab === tab ? 'var(--accent)' : 'var(--border)'}`,
              background: viewTab === tab ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
              color: viewTab === tab ? 'var(--text)' : 'var(--text-dim)', cursor: 'pointer',
            }}
          >
            {tab === 'installed' ? `Terpasang (${skills.length})`
              : tab === 'catalog' ? 'Katalog'
              : tab === 'github' ? 'GitHub Resmi'
              : 'Tambah Manual'}
          </button>
        ))}
      </div>

      {viewTab === 'installed' && (
        skills.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px' }}>
            Belum ada skill terpasang. Cek tab <strong>Katalog</strong>, <strong>GitHub Resmi</strong>, atau <strong>Tambah Manual</strong>.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {skills.map((s) => (
              <div key={s.id} style={{
                padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
                backgroundColor: 'var(--surface-2)', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', gap: '12px',
              }}>
                <Toggle checked={s.enabled} onChange={(v) => handleToggle(s.id, v)}
                  label={s.name} helpText={s.description} />
                <button type="button" onClick={() => setDeleteTarget(s.id)} disabled={saving}
                  style={{ background: 'none', border: 'none', color: 'var(--err)', cursor: 'pointer', padding: '4px' }}
                  title="Copot skill">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )
      )}

      {viewTab === 'catalog' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', marginBottom: '8px' }}>
              Direkomendasikan buat Hermes
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px' }}>
              {SKILLS_CATALOG.map((preset) => {
                const installed = isPresetInstalled(preset.id);
                return (
                  <div key={preset.id} style={{
                    background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
                    padding: '14px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '10px',
                  }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', marginBottom: '6px' }}>
                        {preset.name}
                      </div>
                      <p style={{ fontSize: '11.5px', color: 'var(--text-dim)', lineHeight: 1.4, margin: 0 }}>
                        {preset.description}
                      </p>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
                      {installed ? (
                        <span style={{ fontSize: '11px', color: 'var(--ok)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 500 }}>
                          <CheckCircle2 size={12} />
                          <span>Terpasang</span>
                        </span>
                      ) : (
                        <button type="button" className="btn btn-primary btn-small" disabled={saving}
                          onClick={() => handleInstallPreset(preset)}>
                          <Download size={11} />
                          <span>1-Klik Pasang</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
                Katalog agenticskills.io {catalogItems ? `(${catalogItems.length})` : ''}
              </div>
              <button type="button" onClick={() => loadCatalog(true)} disabled={catalogLoading}
                style={{ fontSize: '11px', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}>
                Muat ulang
              </button>
            </div>
            <p style={{ fontSize: '11.5px', color: 'var(--text-dim)', margin: '0 0 10px 0' }}>
              Sumber komunitas — skill yang dipasang dari sini <strong>otomatis nonaktif</strong> sampai kamu review isinya dan aktifkan sendiri lewat tab Terpasang. Gak ada scanner keamanan di sini.
            </p>

            {catalogError && (
              <div style={{ padding: '10px 14px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--err)', borderRadius: '6px', color: 'var(--err)', fontSize: '12px', marginBottom: '10px' }}>
                {catalogError}
              </div>
            )}

            {catalogLoading ? (
              <div style={{ color: 'var(--text-dim)', fontSize: '13px', padding: '12px 0' }}>Memuat katalog...</div>
            ) : (
              <>
                <input type="text" className="field-input" value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder={`Cari dari ${catalogItems?.length || 0} skill...`}
                  style={{ marginBottom: '10px' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '420px', overflowY: 'auto' }}>
                  {filteredCatalog.map((item) => {
                    const installed = isCatalogInstalled(item.slug);
                    const installingThis = installingSlug === item.slug;
                    return (
                      <div key={item.slug} style={{
                        padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
                        backgroundColor: 'var(--surface-2)', display: 'flex', justifyContent: 'space-between',
                        alignItems: 'center', gap: '10px',
                      }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text)' }}>{item.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.description}
                          </div>
                        </div>
                        {installed ? (
                          <span style={{ fontSize: '10.5px', color: 'var(--ok)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 500, flexShrink: 0 }}>
                            <CheckCircle2 size={11} />
                            <span>Terpasang</span>
                          </span>
                        ) : (
                          <button type="button" className="btn btn-primary btn-small" disabled={installingSlug !== null}
                            onClick={() => handleInstallFromCatalog(item.slug, item.name)}
                            style={{ flexShrink: 0 }}>
                            <Download size={11} />
                            <span>{installingThis ? 'Memasang...' : '1-Klik Pasang'}</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {filteredCatalog.length === 0 && (
                    <div style={{ color: 'var(--text-dim)', fontSize: '12px', padding: '12px 0', textAlign: 'center' }}>
                      Gak ada hasil buat "{catalogSearch}".
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {viewTab === 'github' && (
        <div style={{
          background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
          padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
            <GitBranch size={14} />
            <span>Pasang dari Repo Resmi</span>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-dim)', margin: 0 }}>
            Cuma dari 4 repo skill resmi vendor (Anthropic, OpenAI, NVIDIA, Hugging Face) — gak ada scanner keamanan di sini, jadi sumber komunitas sembarang belum didukung.
          </p>

          <Field label="Sumber (Tap)" helpText="">
            <select className="field-select" value={selectedTap}
              onChange={(e) => setSelectedTap(e.target.value)}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 'var(--r-md)', backgroundColor: 'var(--surface-1)', color: 'var(--text)', border: '1px solid var(--border)' }}>
              {TRUSTED_TAPS.map((t) => (
                <option key={t.tap} value={t.tap}>{t.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Path Skill" helpText="Path folder skill di dalam repo (berisi SKILL.md)">
            <input type="text" className="field-input" value={skillPath}
              onChange={(e) => setSkillPath(e.target.value)}
              placeholder="mis. skills/pdf" />
          </Field>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {TRUSTED_TAPS.find((t) => t.tap === selectedTap)?.examples.map((ex) => (
              <button key={ex} type="button" onClick={() => setSkillPath(ex)}
                style={{
                  fontSize: '10.5px', fontFamily: 'var(--font-mono)', padding: '3px 8px',
                  borderRadius: 'var(--r-sm)', border: '1px solid var(--border)',
                  background: 'var(--surface-1)', color: 'var(--text-dim)', cursor: 'pointer',
                }}>
                {ex}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <Button variant="primary" type="button" loading={installingTap} onClick={handleInstallTap}>
              <Download size={13} />
              <span>Pasang dari GitHub</span>
            </Button>
          </div>
        </div>
      )}

      {viewTab === 'add' && (
        <form onSubmit={handleAddManual} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Field label="Nama Skill" helpText="Nama persis ini yang dipakai model saat memanggil use_skill">
            <input type="text" className="field-input" value={addName}
              onChange={(e) => setAddName(e.target.value)} placeholder="mis. Ringkasan Rapat" required />
          </Field>
          <Field label="Deskripsi Singkat" helpText="Muncul di list_skills — bantu model milih skill yang tepat">
            <input type="text" className="field-input" value={addDescription}
              onChange={(e) => setAddDescription(e.target.value)} placeholder="satu kalimat, jelasin kapan skill ini relevan" />
          </Field>
          <Field label="Isi Instruksi" helpText="Instruksi lengkap yang diikuti model begitu use_skill dipanggil">
            <textarea className="field-input" rows={6} value={addContent}
              onChange={(e) => setAddContent(e.target.value)}
              placeholder="Tulis instruksi lengkapnya di sini..." required
              style={{ resize: 'vertical', fontFamily: 'inherit' }} />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <Button variant="primary" type="submit" loading={saving}>
              <Plus size={13} />
              <span>Tambahkan Skill</span>
            </Button>
          </div>
        </form>
      )}

      {deleteTarget && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setDeleteTarget(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
            padding: '20px', maxWidth: '360px', display: 'flex', flexDirection: 'column', gap: '12px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--warn)' }}>
              <AlertTriangle size={16} />
              <span style={{ fontWeight: 600, fontSize: '13px' }}>Copot skill ini?</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Button variant="secondary" type="button" onClick={() => setDeleteTarget(null)}>Batal</Button>
              <Button variant="danger" type="button" onClick={() => handleDelete(deleteTarget)}>Copot</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
