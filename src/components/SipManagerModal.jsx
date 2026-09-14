import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play, Pause, Trash2, Edit2, Check, Plus, Repeat, AlertCircle, Calendar, StopCircle } from 'lucide-react';
import axios from 'axios';
import { useThemeAuth } from '../context/ThemeAuthContext';
import DatePicker from './common/DatePicker';

const FREQUENCY_OPTIONS = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'FORTNIGHTLY', label: 'Fortnightly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
];

export default function SipManagerModal({ isOpen, onClose, holdings }) {
  const { formatMoney, showError, showConfirm } = useThemeAuth();
  const [sips, setSips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingSipId, setEditingSipId] = useState(null);
  const [editAmount, setEditAmount] = useState('');
  const [editFrequency, setEditFrequency] = useState('MONTHLY');
  const [editEndDate, setEditEndDate] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [activeTab, setActiveTab] = useState('SCHEDULES'); // 'SCHEDULES' | 'HISTORY'
  const [history, setHistory] = useState([]);

  // New SIP form state
  const todayStr = new Date().toISOString().split('T')[0];
  const [selectedHoldingId, setSelectedHoldingId] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newFrequency, setNewFrequency] = useState('MONTHLY');
  const [newStartDate, setNewStartDate] = useState(todayStr);
  const [newEndDate, setNewEndDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const mfHoldings = holdings?.filter(h => h.category_id === 'mutual_funds' && (Number(h.quantity) || 0) > 0) || [];

  const fetchSips = async () => {
    setLoading(true);
    try {
      const [sipsRes, histRes] = await Promise.all([
        axios.get('/api/sips'),
        axios.get('/api/sips/history')
      ]);
      setSips(sipsRes.data || []);
      setHistory(histRes.data?.history || []);
    } catch (err) {
      console.error('Failed to load SIPs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchSips();
      setShowAddForm(false);
      setNewStartDate(new Date().toISOString().split('T')[0]);
      setNewEndDate('');
      setNewFrequency('MONTHLY');
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleToggleStatus = async (sip) => {
    const nextStatus = sip.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    try {
      await axios.patch(`/api/sips/${sip.id}/status`, { status: nextStatus });
      setSips(prev => prev.map(s => s.id === sip.id ? { ...s, status: nextStatus } : s));
    } catch (err) {
      showError('Failed to update SIP status: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleEndSip = async (sip) => {
    const confirmed = await showConfirm(`Are you sure you want to end and close the open SIP for "${sip.name}"?`);
    if (!confirmed) return;
    try {
      await axios.patch(`/api/sips/${sip.id}/status`, { status: 'CLOSED' });
      setSips(prev => prev.map(s => s.id === sip.id ? { ...s, status: 'CLOSED' } : s));
    } catch (err) {
      showError('Failed to end SIP: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleDeleteSip = async (sip) => {
    const confirmed = await showConfirm(`Are you sure you want to permanently delete the SIP record for "${sip.name}"?`);
    if (!confirmed) return;
    try {
      await axios.delete(`/api/sips/${sip.id}`);
      setSips(prev => prev.filter(s => s.id !== sip.id));
    } catch (err) {
      showError('Failed to delete SIP: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleSaveEdit = async (sipId) => {
    try {
      await axios.put(`/api/sips/${sipId}`, {
        amount: Number(editAmount),
        frequency: editFrequency,
        end_date: editEndDate || null
      });
      setSips(prev => prev.map(s => s.id === sipId ? { 
        ...s, 
        amount: Number(editAmount), 
        frequency: editFrequency,
        end_date: editEndDate || null 
      } : s));
      setEditingSipId(null);
    } catch (err) {
      showError('Failed to edit SIP: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleCreateSip = async (e) => {
    e.preventDefault();
    if (!selectedHoldingId || !newAmount) {
      showError('Please select a fund and enter a valid instalment amount.');
      return;
    }

    const holding = mfHoldings.find(h => h.id === selectedHoldingId);
    if (!holding) return;

    if (newEndDate && newEndDate < newStartDate) {
      showError('End date cannot be earlier than start date.');
      return;
    }

    setSubmitting(true);
    try {
      const startD = new Date(newStartDate);
      const dom = startD.getDate() || 1;

      const res = await axios.post('/api/sips', {
        holding_id: holding.id,
        symbol: holding.symbol,
        name: holding.name,
        amount: Number(newAmount),
        frequency: newFrequency,
        start_date: newStartDate,
        end_date: newEndDate || null,
        day_of_month: dom
      });

      if (res.data.sip) {
        setSips(prev => [res.data.sip, ...prev]);
        setShowAddForm(false);
        setNewAmount('');
        setSelectedHoldingId('');
        setNewEndDate('');
      }
    } catch (err) {
      showError(err.response?.data?.error || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const activeSips = sips.filter(s => s.status === 'ACTIVE');
  const totalMonthlyActive = activeSips.reduce((sum, s) => {
    const amt = Number(s.amount) || 0;
    const freq = (s.frequency || 'MONTHLY').toUpperCase();
    if (freq === 'WEEKLY') return sum + (amt * 4.33);
    if (freq === 'FORTNIGHTLY') return sum + (amt * 2.16);
    if (freq === 'QUARTERLY') return sum + (amt / 3);
    return sum + amt;
  }, 0);

  const formatFrequencyLabel = (freq) => {
    const f = (freq || 'MONTHLY').toUpperCase();
    switch (f) {
      case 'WEEKLY': return 'Weekly';
      case 'FORTNIGHTLY': return 'Fortnightly';
      case 'QUARTERLY': return 'Quarterly';
      default: return 'Monthly';
    }
  };

  const formatDateLabel = (dateStr) => {
    if (!dateStr) return 'Continuous';
    const parts = dateStr.split('-');
    if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
    return dateStr;
  };

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-950/75 backdrop-blur-md overflow-y-auto"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            className="relative w-full max-w-2xl modal-surface reports-card rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col overflow-hidden border border-inherit my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-4 border-b border-inherit pb-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-500 flex items-center justify-center shadow-md shadow-amber-500/10 shrink-0 font-bold">
                  <Repeat className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black flex items-center gap-2">
                    <span>SIPs</span>
                  </h3>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!showAddForm && (
                  <button
                    onClick={() => {
                      setActiveTab('SCHEDULES');
                      setShowAddForm(true);
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-600 dark:text-amber-400 border border-amber-500/30 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add SIP</span>
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="p-2 rounded-xl opacity-70 hover:opacity-100 hover:bg-slate-500/10 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Active Summary Card */}
            {activeSips.length > 0 && (
              <div className="p-3.5 reports-subcard rounded-2xl flex items-center justify-between shrink-0">
                <div>
                  <span className="text-[10px] uppercase font-bold opacity-70 block">Estimated Monthly Outflow</span>
                  <p className="text-lg font-black font-mono mt-0.5 text-amber-500">
                    {formatMoney(totalMonthlyActive, true)}/mo
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold opacity-70 block">Active Schedules</span>
                  <p className="text-xs font-mono font-bold mt-1 opacity-90">
                    {activeSips.length} {activeSips.length === 1 ? 'Scheme' : 'Schemes'}
                  </p>
                </div>
              </div>
            )}

            {/* View Mode Switcher */}
            <div className="flex items-center gap-1 p-1 bg-slate-900/60 border border-slate-800 rounded-xl text-xs font-semibold shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('SCHEDULES')}
                className={`flex-1 py-1.5 rounded-lg transition-all cursor-pointer font-bold text-center ${
                  activeTab === 'SCHEDULES'
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Schedules ({sips.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('HISTORY')}
                className={`flex-1 py-1.5 rounded-lg transition-all cursor-pointer font-bold text-center ${
                  activeTab === 'HISTORY'
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Execution & Skips ({history.length})
              </button>
            </div>

            {/* Tab 1: Active & Configured Schedules */}
            {activeTab === 'SCHEDULES' && (
              <>
                {/* Add SIP Drawer */}
                <AnimatePresence>
                  {showAddForm && (
                    <motion.form
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      onSubmit={handleCreateSip}
                      className="p-4 reports-subcard rounded-2xl space-y-3 shrink-0 border"
                    >
                      <div className="font-bold text-xs">Setup New SIP</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="sm:col-span-2">
                          <label className="text-[10px] opacity-70 font-medium block mb-1">Mutual Fund</label>
                          <select
                            value={selectedHoldingId}
                            onChange={(e) => setSelectedHoldingId(e.target.value)}
                            className="w-full px-3 py-2 bg-inherit border border-inherit rounded-xl text-xs outline-none focus:border-amber-500"
                            required
                          >
                            <option value="" className="bg-slate-900 text-white">Select fund...</option>
                            {mfHoldings.map(h => (
                              <option key={h.id} value={h.id} className="bg-slate-900 text-white">{h.name}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-[10px] opacity-70 font-medium block mb-1">Instalment Amount (₹)</label>
                          <input
                            type="number"
                            value={newAmount}
                            onChange={(e) => setNewAmount(e.target.value)}
                            placeholder="5000"
                            min="100"
                            step="100"
                            className="w-full px-3 py-2 bg-inherit border border-inherit rounded-xl text-xs font-mono outline-none focus:border-amber-500"
                            required
                          />
                        </div>

                        <div>
                          <label className="text-[10px] opacity-70 font-medium block mb-1">Frequency</label>
                          <select
                            value={newFrequency}
                            onChange={(e) => setNewFrequency(e.target.value)}
                            className="w-full px-3 py-2 bg-inherit border border-inherit rounded-xl text-xs outline-none focus:border-amber-500"
                          >
                            {FREQUENCY_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value} className="bg-slate-900 text-white">
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-[10px] opacity-70 font-medium block mb-1">Start Date</label>
                          <DatePicker
                            value={newStartDate}
                            onChange={(e) => setNewStartDate(e.target.value)}
                            required
                          />
                        </div>

                        <div>
                          <label className="text-[10px] opacity-70 font-medium block mb-1">End Date (Optional)</label>
                          <DatePicker
                            value={newEndDate}
                            onChange={(e) => setNewEndDate(e.target.value)}
                            placeholder="Continuous"
                          />
                        </div>
                      </div>


                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-inherit">
                        <button
                          type="button"
                          onClick={() => setShowAddForm(false)}
                          className="px-3.5 py-1.5 opacity-70 hover:opacity-100 text-xs font-bold rounded-xl hover:bg-slate-500/10 transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={submitting}
                          className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs transition-colors disabled:opacity-50 cursor-pointer shadow-sm"
                        >
                          {submitting ? 'Creating...' : 'Save SIP'}
                        </button>
                      </div>
                    </motion.form>
                  )}
                </AnimatePresence>

                {/* Status Filter Tabs */}
                {sips.length > 0 && (
                  <div className="flex items-center gap-1.5 p-1 bg-slate-900/60 border border-slate-800 rounded-xl text-xs font-semibold shrink-0">
                    {['ALL', 'ACTIVE', 'PAUSED', 'CLOSED'].map(st => {
                      const count = st === 'ALL' ? sips.length : sips.filter(s => s.status === st).length;
                      if (st !== 'ALL' && count === 0) return null;
                      return (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setStatusFilter(st)}
                          className={`px-3 py-1 rounded-lg transition-all cursor-pointer text-xs font-bold ${
                            statusFilter === st
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {st === 'ALL' ? 'All' : st === 'ACTIVE' ? 'Active' : st === 'PAUSED' ? 'Paused' : 'Closed'} ({count})
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* SIP List */}
                <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-1">
                  {loading ? (
                    <div className="py-12 text-center opacity-60 text-xs font-medium">Loading SIP schedules...</div>
                  ) : sips.length === 0 ? (
                    <div className="py-12 text-center opacity-60 text-xs font-medium">
                      No active SIPs found. Click "Add SIP" to set one up!
                    </div>
                  ) : (() => {
                    const filtered = sips.filter(s => statusFilter === 'ALL' || s.status === statusFilter);
                    if (filtered.length === 0) {
                      return (
                        <div className="py-12 text-center opacity-60 text-xs font-medium">
                          No {statusFilter.toLowerCase()} SIPs found.
                        </div>
                      );
                    }
                    return filtered.map(sip => {
                      const isEditing = editingSipId === sip.id;
                      const isClosed = sip.status === 'CLOSED';
                      const isPaused = sip.status === 'PAUSED';

                      return (
                        <div
                          key={sip.id}
                          className={`p-4 rounded-2xl reports-subcard transition-all ${
                            isClosed ? 'opacity-60' : ''
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-xs">{sip.name}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider ${
                                  isClosed
                                    ? 'bg-slate-500/20 opacity-70'
                                    : isPaused
                                    ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                                    : 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                                }`}>
                                  {sip.status}
                                </span>
                                <span className="px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider bg-slate-500/15 opacity-80 border border-inherit font-mono">
                                  {formatFrequencyLabel(sip.frequency)}
                                </span>
                              </div>

                              <div className="text-[10px] opacity-60 font-mono">
                                AMFI #{sip.symbol}
                                {sip.start_date ? ` • Start: ${formatDateLabel(sip.start_date)}` : ''}
                                {sip.end_date ? ` • End: ${formatDateLabel(sip.end_date)}` : ' • Open/Continuous'}
                              </div>

                              <div className="text-[10px] opacity-80 flex items-center gap-3">
                                <span>Next Run: <strong className="font-mono">{formatDateLabel(sip.next_run_date)}</strong></span>
                                {sip.last_run_date && (
                                  <span>Last Run: <strong className="font-mono">{formatDateLabel(sip.last_run_date)}</strong></span>
                                )}
                              </div>
                            </div>

                            {/* Amount & Controls */}
                            <div className="flex items-center gap-3 justify-between sm:justify-end border-t sm:border-t-0 pt-2 sm:pt-0 border-inherit">
                              {isEditing ? (
                                <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
                                  <input
                                    type="number"
                                    value={editAmount}
                                    onChange={(e) => setEditAmount(e.target.value)}
                                    className="w-24 px-2.5 py-1 bg-inherit border border-inherit rounded-lg text-xs font-mono outline-none focus:border-amber-500"
                                    placeholder="Amount"
                                  />
                                  <select
                                    value={editFrequency}
                                    onChange={(e) => setEditFrequency(e.target.value)}
                                    className="px-2 py-1 bg-inherit border border-inherit rounded-lg text-xs outline-none focus:border-amber-500"
                                  >
                                    {FREQUENCY_OPTIONS.map(opt => (
                                      <option key={opt.value} value={opt.value} className="bg-slate-900 text-white">
                                        {opt.label}
                                      </option>
                                    ))}
                                  </select>
                                  <div className="w-32">
                                    <DatePicker
                                      value={editEndDate}
                                      onChange={(e) => setEditEndDate(e.target.value)}
                                      placeholder="End Date"
                                    />
                                  </div>

                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => handleSaveEdit(sip.id)}
                                      className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30 cursor-pointer"
                                      title="Save Changes"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => setEditingSipId(null)}
                                      className="p-1.5 rounded-lg opacity-70 hover:opacity-100 hover:bg-slate-500/10 cursor-pointer"
                                      title="Cancel"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-right">
                                  <div className="text-sm font-black font-mono text-amber-500">
                                    {formatMoney(sip.amount, true)}
                                  </div>
                                  <div className="text-[9px] opacity-60 uppercase font-mono">
                                    per {formatFrequencyLabel(sip.frequency).toLowerCase()}
                                  </div>
                                </div>
                              )}

                              {!isClosed && !isEditing && (
                                <div className="flex items-center gap-1">
                                  {/* Pause / Resume */}
                                  <button
                                    onClick={() => handleToggleStatus(sip)}
                                    className={`p-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                                      isPaused
                                        ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-500'
                                        : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-500'
                                    }`}
                                    title={isPaused ? 'Resume SIP' : 'Pause SIP'}
                                  >
                                    {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                                  </button>

                                  {/* Edit Amount / Frequency / End Date */}
                                  <button
                                    onClick={() => {
                                      setEditingSipId(sip.id);
                                      setEditAmount(String(sip.amount));
                                      setEditFrequency(sip.frequency || 'MONTHLY');
                                      setEditEndDate(sip.end_date || '');
                                    }}
                                    className="p-2 rounded-xl opacity-70 hover:opacity-100 hover:bg-slate-500/10 transition-all cursor-pointer"
                                    title="Edit Schedule"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>

                                  {/* End / Close Open SIP */}
                                  <button
                                    onClick={() => handleEndSip(sip)}
                                    className="p-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 transition-all cursor-pointer"
                                    title="End Open SIP"
                                  >
                                    <StopCircle className="w-3.5 h-3.5" />
                                  </button>

                                  {/* Delete SIP */}
                                  <button
                                    onClick={() => handleDeleteSip(sip)}
                                    className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 transition-all cursor-pointer"
                                    title="Delete SIP"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </>
            )}

            {/* Tab 2: Execution & Skips History */}
            {activeTab === 'HISTORY' && (
              <div className="flex-1 overflow-y-auto space-y-2.5 custom-scrollbar pr-1">
                {history.length === 0 ? (
                  <div className="py-12 text-center opacity-60 text-xs font-medium space-y-1.5">
                    <AlertCircle className="w-8 h-8 opacity-40 mx-auto text-amber-400" />
                    <p className="font-bold">No execution or skip history recorded yet.</p>
                    <p className="text-[11px] opacity-70 max-w-sm mx-auto">
                      The automated scheduler tracks all runs, successful allocations, and skipped attempts.
                    </p>
                  </div>
                ) : (
                  history.map((ev, idx) => {
                    const isSuccess = ev.status === 'SUCCESS';
                    const isSkipped = ev.status === 'SKIPPED';
                    const isClosed = ev.status === 'CLOSED';

                    return (
                      <div
                        key={ev.id || idx}
                        className="p-3.5 rounded-2xl reports-subcard transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-xs">{ev.name}</span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider ${
                                isSuccess
                                  ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                                  : isSkipped
                                  ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                                  : isClosed
                                  ? 'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                                  : 'bg-rose-500/15 text-rose-500 border border-rose-500/30'
                              }`}
                            >
                              {ev.status}
                            </span>
                            {ev.symbol && (
                              <span className="text-[10px] opacity-60 font-mono">AMFI #{ev.symbol}</span>
                            )}
                          </div>

                          <div className="text-[10px] opacity-70 font-mono">
                            {ev.timestamp ? formatDateLabel(ev.timestamp.slice(0, 10)) : formatDateLabel(ev.date)}
                            {ev.timestamp && ` • ${ev.timestamp.slice(11, 16)} UTC`}
                          </div>

                          {ev.reason && (
                            <div className="text-[10.5px] text-amber-400/90 font-medium">
                              Note: {ev.reason}
                            </div>
                          )}

                          {isSuccess && ev.units && (
                            <div className="text-[10.5px] text-emerald-400 font-mono">
                              Units: {ev.units} @ NAV ₹{Number(ev.nav || 0).toFixed(4)}
                            </div>
                          )}
                        </div>

                        <div className="text-right shrink-0">
                          <div className="text-xs font-black font-mono text-amber-500">
                            {formatMoney(ev.amount || 0, true)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
}
