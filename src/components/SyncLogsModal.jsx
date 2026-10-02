import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Activity, 
  X, 
  CheckCircle2, 
  XCircle, 
  RefreshCw, 
  Clock, 
  Calendar,
  Layers,
  ArrowUpDown,
  Search
} from 'lucide-react';
import axios from 'axios';
import { useThemeAuth } from '../context/ThemeAuthContext';

export default function SyncLogsModal({ isOpen, onClose }) {
  const { showError, showSuccess } = useThemeAuth();
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncingNow, setIsSyncingNow] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const res = await axios.get('/api/sync-logs?days=10&limit=150');
      if (res.data?.logs) {
        setLogs(res.data.logs);
      }
    } catch (err) {
      console.warn('[SyncLogsModal] Failed to load sync logs:', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen]);

  // Keyboard accessibility
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleManualSync = async () => {
    setIsSyncingNow(true);
    try {
      const res = await axios.post('/api/sync-logs/trigger');
      showSuccess('Manual sync completed successfully!');
      await fetchLogs();
    } catch (err) {
      showError('Sync failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsSyncingNow(false);
    }
  };

  const formatLogDate = (isoStr) => {
    if (!isoStr) return '—';
    try {
      const d = new Date(isoStr);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      const hours = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      const secs = String(d.getSeconds()).padStart(2, '0');
      return `${day}-${month}-${year} ${hours}:${mins}:${secs}`;
    } catch {
      return isoStr;
    }
  };

  const filteredLogs = logs.filter(log => {
    if (selectedFilter !== 'ALL') {
      if (selectedFilter === 'EOD' && log.jobType !== 'EOD_REBUILD') return false;
      if (selectedFilter === 'PRICE' && log.jobType !== 'PRICE_SYNC' && log.jobType !== 'LOGIN_SYNC' && log.jobType !== 'MANUAL_SYNC') return false;
      if (selectedFilter === 'BACKUP' && log.jobType !== 'CLOUD_BACKUP') return false;
      if (selectedFilter === 'HEAL' && log.jobType !== 'SELF_HEALING') return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = (log.jobName || '').toLowerCase().includes(q);
      const matchDetails = (log.details || '').toLowerCase().includes(q);
      const matchSched = (log.scheduledTime || '').toLowerCase().includes(q);
      const matchDate = formatLogDate(log.runTime).toLowerCase().includes(q);
      if (!matchName && !matchDetails && !matchSched && !matchDate) return false;
    }
    return true;
  });

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-hidden">
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.2 }}
          className="modal-surface reports-card relative w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl shadow-2xl border border-inherit overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-inherit bg-slate-900/40">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-inherit tracking-tight">Automated Sync & Scheduler Logs</h2>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    Last 10 Days
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleManualSync}
                disabled={isSyncingNow}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 transition-all cursor-pointer disabled:opacity-50"
                title="Run immediate sync"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingNow ? 'animate-spin' : ''}`} />
                <span>{isSyncingNow ? 'Syncing...' : 'Sync Now'}</span>
              </button>

              <button
                onClick={onClose}
                className="p-1.5 rounded-xl hover:bg-slate-800/60 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                title="Close (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Controls Bar: Filters & Search */}
          <div className="px-6 py-3 border-b border-inherit bg-slate-950/20 flex flex-wrap items-center justify-between gap-3">
            {/* Filter Tabs */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/60 border border-inherit text-xs">
              {[
                { id: 'ALL', label: 'All Jobs' },
                { id: 'EOD', label: 'EOD Rebuilds' },
                { id: 'PRICE', label: 'Price Sync' },
                { id: 'HEAL', label: 'Self-Healing' },
                { id: 'BACKUP', label: 'Backups' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setSelectedFilter(tab.id)}
                  className={`px-3 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                    selectedFilter === tab.id
                      ? 'bg-amber-500/15 text-amber-300 font-bold border border-amber-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative min-w-[220px]">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search job name, details..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-slate-900/60 border border-inherit text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
              />
            </div>
          </div>

          {/* Table Container */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
                <RefreshCw className="w-6 h-6 animate-spin text-amber-400" />
                <span className="text-xs">Loading sync records...</span>
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
                <Activity className="w-8 h-8 opacity-40" />
                <span className="text-xs">No sync logs match the selected filter.</span>
              </div>
            ) : (
              <div className="reports-subcard rounded-xl border border-inherit overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-inherit bg-slate-900/70 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      <th className="py-2.5 px-3 w-14 text-center">Status</th>
                      <th className="py-2.5 px-3">Sync Job / Category</th>
                      <th className="py-2.5 px-3">Scheduled Time</th>
                      <th className="py-2.5 px-3">Executed At</th>
                      <th className="py-2.5 px-3 text-right">Duration</th>
                      <th className="py-2.5 px-3">Details / Result</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs divide-y divide-inherit">
                    {filteredLogs.map((log) => {
                      const isSuccess = log.status === 'SUCCESS';
                      return (
                        <tr 
                          key={log.id}
                          className="hover:bg-slate-800/30 transition-colors"
                        >
                          {/* Status Tick / Cross Mark */}
                          <td className="py-2.5 px-3 text-center">
                            {isSuccess ? (
                              <div className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" title="Success">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </div>
                            ) : (
                              <div className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400" title="Failed">
                                <XCircle className="w-3.5 h-3.5" />
                              </div>
                            )}
                          </td>

                          {/* Job Name */}
                          <td className="py-2.5 px-3 font-semibold text-inherit">
                            <div className="flex flex-col">
                              <span>{log.jobName}</span>
                              <span className="text-[10px] text-slate-400 font-normal font-mono">
                                {log.jobType}
                              </span>
                            </div>
                          </td>

                          {/* Scheduled Time */}
                          <td className="py-2.5 px-3 text-slate-300 font-mono text-[11px]">
                            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-slate-800/50 border border-inherit">
                              <Clock className="w-3 h-3 text-slate-400" />
                              <span>{log.scheduledTime || 'Scheduled'}</span>
                            </div>
                          </td>

                          {/* Executed At */}
                          <td className="py-2.5 px-3 text-slate-300 font-mono text-[11px] whitespace-nowrap">
                            {formatLogDate(log.runTime)}
                          </td>

                          {/* Duration */}
                          <td className="py-2.5 px-3 text-right font-mono text-slate-400 text-[11px]">
                            {log.durationMs ? `${(log.durationMs / 1000).toFixed(1)}s` : '—'}
                          </td>

                          {/* Details */}
                          <td className="py-2.5 px-3 text-slate-300 text-[11px] max-w-xs truncate" title={log.details || log.error}>
                            {log.details || (log.error ? <span className="text-rose-400">{log.error}</span> : 'Completed successfully.')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-inherit bg-slate-900/40 flex items-center justify-between text-xs text-slate-400">
            <span className="font-mono text-[11px]">
              Showing {filteredLogs.length} of {logs.length} logged sync events
            </span>
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 font-semibold transition-colors cursor-pointer border border-inherit"
            >
              Close
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body
  );
}
