import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Modal } from './Modal';
import { ConfirmModal } from './ConfirmModal';
import { Button } from './Button';
import { useToast } from './Toast';
import {
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  Code,
  Archive,
  Download,
  Copy,
  Trash2,
  Eye,
  Search,
  RefreshCw,
  FolderOpen,
  X,
  ExternalLink,
} from 'lucide-react';

export interface ArtifactItem {
  name: string;
  path: string;
  rel_path: string;
  size: number;
  size_fmt: string;
  type: 'image' | 'video' | 'audio' | 'document' | 'code' | 'archive' | 'other';
  extension: string;
  mtime: number;
  mtime_fmt: string;
  view_url: string;
  download_url: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type FilterType = 'all' | 'image' | 'document' | 'code' | 'video' | 'archive';

export function ArtifactsModal({ isOpen, onClose }: Props) {
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [previewItem, setPreviewItem] = useState<ArtifactItem | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<ArtifactItem | null>(null);
  const { toast } = useToast();

  const fetchArtifacts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/artifacts');
      if (res.ok) {
        const data = await res.json();
        setArtifacts(data.artifacts || []);
      }
    } catch (err) {
      console.error('Failed to fetch artifacts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchArtifacts();
    }
  }, [isOpen, fetchArtifacts]);

  const handleOpenPreview = async (item: ArtifactItem) => {
    setPreviewItem(item);
    if (item.type === 'document' || item.type === 'code' || item.extension === '.json' || item.extension === '.md') {
      try {
        setLoadingContent(true);
        const res = await fetch(`/api/artifacts/content?path=${encodeURIComponent(item.path)}`);
        if (res.ok) {
          const data = await res.json();
          setPreviewContent(data.content);
        } else {
          setPreviewContent('(Pratinjau tidak tersedia untuk berkas ini)');
        }
      } catch {
        setPreviewContent('(Gagal memuat isi berkas)');
      } finally {
        setLoadingContent(false);
      }
    } else {
      setPreviewContent(null);
    }
  };

  const handleCopyPath = (filePath: string) => {
    navigator.clipboard.writeText(filePath);
    toast('Path lokal disalin ke clipboard', 'ok');
  };

  const handleDelete = async () => {
    if (!itemToDelete) return;
    try {
      const res = await fetch(`/api/artifacts?path=${encodeURIComponent(itemToDelete.path)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast(`Artefak "${itemToDelete.name}" berhasil dihapus`, 'ok');
        setArtifacts((prev) => prev.filter((a) => a.path !== itemToDelete.path));
        if (previewItem?.path === itemToDelete.path) {
          setPreviewItem(null);
        }
      } else {
        toast('Gagal menghapus artefak', 'err');
      }
    } catch {
      toast('Terjadi kesalahan saat menghapus artefak', 'err');
    } finally {
      setItemToDelete(null);
    }
  };

  const filteredArtifacts = useMemo(() => {
    return artifacts.filter((item) => {
      const matchesSearch =
        !searchQuery.trim() ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.rel_path.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter = filterType === 'all' || item.type === filterType;
      return matchesSearch && matchesFilter;
    });
  }, [artifacts, searchQuery, filterType]);

  const getIcon = (type: string) => {
    switch (type) {
      case 'image':
        return <ImageIcon size={14} style={{ color: '#38bdf8' }} />;
      case 'video':
        return <Video size={14} style={{ color: '#f43f5e' }} />;
      case 'audio':
        return <Music size={14} style={{ color: '#a855f7' }} />;
      case 'code':
        return <Code size={14} style={{ color: '#34d399' }} />;
      case 'archive':
        return <Archive size={14} style={{ color: '#fbbf24' }} />;
      default:
        return <FileText size={14} style={{ color: '#94a3b8' }} />;
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="📁 Workspace Artifacts Hub">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minHeight: '360px' }}>
          {/* Top Filter and Search Bar */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: '#06090e',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '5px',
              padding: '6px 10px',
            }}>
              <Search size={13} style={{ color: 'var(--text-faint)' }} />
              <input
                type="text"
                placeholder="Cari artefak (nama atau folder)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--text)',
                  fontSize: '12.5px',
                  width: '100%',
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: 0 }}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={fetchArtifacts}
              title="Refresh artifacts list"
            >
              <RefreshCw size={12} className={loading ? 'spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>

          {/* Category Filter Pills */}
          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
            {(['all', 'image', 'document', 'code', 'video', 'archive'] as FilterType[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilterType(f)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '12px',
                  fontSize: '11.5px',
                  border: '1px solid',
                  borderColor: filterType === f ? 'var(--accent)' : 'rgba(255, 255, 255, 0.08)',
                  background: filterType === f ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                  color: filterType === f ? '#ffffff' : 'var(--text-dim)',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                  whiteSpace: 'nowrap',
                }}
              >
                {f === 'all' ? `Semua (${artifacts.length})` : f}
              </button>
            ))}
          </div>

          {/* Artifacts List */}
          <div style={{
            maxHeight: '380px',
            overflowY: 'auto',
            border: '1px solid rgba(255, 255, 255, 0.07)',
            borderRadius: '6px',
            background: 'rgba(0, 0, 0, 0.2)',
          }}>
            {loading && artifacts.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-faint)', fontSize: '12px' }}>
                Memuat berkas artefak...
              </div>
            ) : filteredArtifacts.length === 0 ? (
              <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--text-faint)', fontSize: '12.5px' }}>
                <FolderOpen size={28} style={{ opacity: 0.4, margin: '0 auto 8px auto', display: 'block' }} />
                <span>{searchQuery ? 'Tidak ada artefak yang cocok dengan pencarian.' : 'Belum ada berkas artefak yang dibuat oleh agen.'}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {filteredArtifacts.map((item) => (
                  <div
                    key={item.path}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                      transition: 'background-color 0.12s ease',
                      gap: '12px',
                    }}
                    className="artifact-row-hover"
                  >
                    {/* Left File Details */}
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1, cursor: 'pointer' }}
                      onClick={() => handleOpenPreview(item)}
                    >
                      <div style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '4px',
                        background: 'rgba(255, 255, 255, 0.04)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        {getIcon(item.type)}
                      </div>
                      <div style={{ minWidth: 0, overflow: 'hidden' }}>
                        <div style={{ fontSize: '12.5px', fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.name}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-faint)', display: 'flex', gap: '8px' }}>
                          <span>{item.rel_path}</span>
                          <span>•</span>
                          <span>{item.size_fmt}</span>
                          <span>•</span>
                          <span>{item.mtime_fmt}</span>
                        </div>
                      </div>
                    </div>

                    {/* Right Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      <button
                        type="button"
                        className="aux-action-btn"
                        onClick={() => handleOpenPreview(item)}
                        title="Lihat Pratinjau"
                      >
                        <Eye size={12} />
                      </button>

                      <a
                        href={item.download_url}
                        download={item.name}
                        className="aux-action-btn"
                        title="Unduh Berkas"
                      >
                        <Download size={12} />
                      </a>

                      <button
                        type="button"
                        className="aux-action-btn"
                        onClick={() => handleCopyPath(item.path)}
                        title="Salin Path Lokal"
                      >
                        <Copy size={12} />
                      </button>

                      <button
                        type="button"
                        className="aux-action-btn"
                        onClick={() => setItemToDelete(item)}
                        title="Hapus Artefak"
                        style={{ color: 'var(--err)' }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Preview Modal */}
      {previewItem && (
        <Modal
          isOpen={previewItem !== null}
          onClose={() => setPreviewItem(null)}
          title={`Pratinjau: ${previewItem.name}`}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {previewItem.type === 'image' && (
              <div style={{ textAlign: 'center', background: '#05070a', padding: '16px', borderRadius: '6px', maxHeight: '420px', overflow: 'auto' }}>
                <img
                  src={previewItem.view_url}
                  alt={previewItem.name}
                  style={{ maxWidth: '100%', maxHeight: '380px', objectFit: 'contain', borderRadius: '4px' }}
                />
              </div>
            )}

            {previewItem.type === 'video' && (
              <div style={{ textAlign: 'center', background: '#05070a', padding: '16px', borderRadius: '6px' }}>
                <video
                  src={previewItem.view_url}
                  controls
                  style={{ maxWidth: '100%', maxHeight: '360px', borderRadius: '4px' }}
                />
              </div>
            )}

            {(previewItem.type === 'document' || previewItem.type === 'code' || previewItem.type === 'other') && (
              <div style={{
                background: '#06090e',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '6px',
                padding: '12px 16px',
                maxHeight: '380px',
                overflowY: 'auto',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                lineHeight: 1.5,
                color: '#e2e8f0',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {loadingContent ? 'Memuat isi teks...' : previewContent || 'Tidak ada konten teks yang dapat ditampilkan.'}
              </div>
            )}

            {/* Footer details & download button */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' }}>
              <div style={{ fontSize: '11.5px', color: 'var(--text-faint)' }}>
                {previewItem.size_fmt} • {previewItem.rel_path}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => handleCopyPath(previewItem.path)}
                >
                  <Copy size={12} />
                  <span>Salin Path</span>
                </button>
                <a
                  href={previewItem.download_url}
                  download={previewItem.name}
                  className="btn btn-primary btn-small"
                >
                  <Download size={12} />
                  <span>Unduh</span>
                </a>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={itemToDelete !== null}
        onClose={() => setItemToDelete(null)}
        onConfirm={handleDelete}
        title="Hapus Artefak"
        message={`Apakah Anda yakin ingin menghapus berkas artefak "${itemToDelete?.name}"? Berkas fisik di disk akan dihapus permanen.`}
        confirmText="Hapus Berkas"
      />
    </>
  );
}
