import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Cloud, History, ArrowRight, X, ShieldCheck, RefreshCw, Archive, CheckCircle2, AlertTriangle } from 'lucide-react';
import axios from 'axios';
import { useThemeAuth } from '../context/ThemeAuthContext';

export default function RestoreBackupModal({ isOpen, onClose, onRefresh }) {
  const { showSuccess, showError, showConfirm } = useThemeAuth();
  const [backups, setBackups] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const fetchBackups = async () => {
    setIsLoading(true);
    try {
      const res = await axios.get('/api/cloud-backups');
      if (res.data && res.data.backups) {
        setBackups(res.data.backups);
      }
    } catch (err) {
      console.warn('[Restore Modal] Error fetching backups:', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchBackups();
    }
  }, [isOpen]);

  // Keyboard accessibility
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleCreateBackup = async () => {
    setIsCreating(true);
    try {
      const res = await axios.post('/api/cloud-backups/create');
      showSuccess(res.data.message || 'Compressed cloud backup saved to Supabase Storage!');
      await fetchBackups();
    } catch (err) {
      showError('Backup failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsCreating(false);
    }
  };

  const handleRestore = async (filename) => {
    const confirmed = await showConfirm(
      `Restore the complete database from snapshot "${filename}"? All current tables will be synchronized to this point in time.`
    );
    if (!confirmed) return;

    setIsRestoring(true);
    try {
      const res = await axios.post('/api/cloud-backups/restore', { filename });
      showSuccess(res.data.message || 'Database restored successfully from cloud backup!');
      if (onRefresh) onRefresh();
      onClose();
    } catch (err) {
      showError('Restore failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsRestoring(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '—';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  const formatDateDisplay = (dateStr, filename) => {
    if (filename) {
      const match = filename.match(/ladder_backup_(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
      if (match) {
        const [_, y, m, d, h, min] = match;
        return `${d}-${m}-${y} ${h}:${min} UTC`;
      }
    }
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        const hours = String(d.getHours()).padStart(2, '0');
        const mins = String(d.getMinutes()).padStart(2, '0');
        return `${day}-${month}-${year} ${hours}:${mins}`;
      }
    } catch (e) {}
    return dateStr;
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-3xl modal-surface reports-card border border-inherit shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="p-5 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                <Cloud className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  Cloud Database Snapshots
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                    10-Day Retention
                  </span>
                </h2>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={fetchBackups}
                disabled={isLoading}
                className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all cursor-pointer disabled:opacity-50"
                title="Refresh snapshots"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition-all cursor-pointer"
                title="Close (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Action Bar */}
          <div className="px-5 py-3 bg-slate-900/40 border-b border-slate-800/60 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Archive className="w-4 h-4 text-emerald-400" />
              <span>{backups.length} snapshot{backups.length !== 1 ? 's' : ''} available (auto-deleted after 10 days)</span>
            </div>

            <button
              onClick={handleCreateBackup}
              disabled={isCreating}
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-obsidian-950 font-black text-xs flex items-center gap-2 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer disabled:opacity-50"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{isCreating ? 'Backing up...' : 'Backup Now'}</span>
            </button>
          </div>

          {/* Snapshots List */}
          <div className="p-5 overflow-y-auto space-y-2.5 flex-1 custom-scrollbar">
            {backups.length === 0 ? (
              <div className="p-8 rounded-2xl bg-slate-900/40 border border-slate-800 text-center space-y-2">
                <Cloud className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-xs font-semibold text-slate-400">
                  {isLoading ? 'Checking Supabase Cloud Storage...' : 'No cloud snapshots recorded yet.'}
                </p>
                <p className="text-[11px] text-slate-500">
                  Click "Backup Now" to create your first compressed snapshot.
                </p>
              </div>
            ) : (
              backups.map((b, idx) => {
                const isGz = b.name.endsWith('.gz');
                return (
                  <div
                    key={b.name || idx}
                    className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-indigo-500/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-all"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 shrink-0">
                        <History className="w-4 h-4 text-indigo-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-bold text-white truncate max-w-xs sm:max-w-sm">
                            {b.name}
                          </span>
                          {idx === 0 && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-500/20 border border-indigo-500/40 text-indigo-300">
                              Latest
                            </span>
                          )}
                          {isGz && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                              Gzip Lossless
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          Date: {formatDateDisplay(b.created_at, b.name)} &bull; Compressed Size: {formatFileSize(b.metadata?.size)}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => handleRestore(b.name)}
                      disabled={isRestoring}
                      className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 rounded-xl text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 self-end sm:self-auto shrink-0"
                    >
                      <ArrowRight className="w-3 h-3" />
                      <span>{isRestoring ? 'Restoring...' : 'Restore'}</span>
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Note */}
          <div className="p-4 bg-slate-950/60 border-t border-slate-800/80 flex items-center justify-center text-[11px] text-slate-500">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span>Automated scheduled backup executes daily at 8:25 AM IST.</span>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}
