import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play, Pause, Trash2, Edit2, Check, Plus, Calendar, DollarSign, RefreshCw, AlertCircle } from 'lucide-react';
import axios from 'axios';
import { useThemeAuth } from '../context/ThemeAuthContext';

export default function SipManagerModal({ isOpen, onClose, holdings }) {
  const { formatMoney } = useThemeAuth();
  const [sips, setSips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingSipId, setEditingSipId] = useState(null);
  const [editAmount, setEditAmount] = useState('');
  const [editDay, setEditDay] = useState('1');
  const [showAddForm, setShowAddForm] = useState(false);

  // New SIP form state
  const [selectedHoldingId, setSelectedHoldingId] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newDay, setNewDay] = useState('5');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const mfHoldings = holdings.filter(h => h.category_id === 'mutual_funds' && (Number(h.quantity) || 0) > 0);

  const fetchSips = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/sips');
      setSips(res.data || []);
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
      setErrorMsg(null);
    }
  }, [isOpen]);

  const handleToggleStatus = async (sip) => {
    const nextStatus = sip.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    try {
      await axios.patch(`/api/sips/${sip.id}/status`, { status: nextStatus });
      setSips(prev => prev.map(s => s.id === sip.id ? { ...s, status: nextStatus } : s));
    } catch (err) {
      alert('Failed to update SIP status: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleCloseSip = async (sip) => {
    if (!window.confirm(`Are you sure you want to stop and close the recurring SIP for "${sip.name}"?`)) return;
    try {
      await axios.patch(`/api/sips/${sip.id}/status`, { status: 'CLOSED' });
      setSips(prev => prev.map(s => s.id === sip.id ? { ...s, status: 'CLOSED' } : s));
    } catch (err) {
      alert('Failed to close SIP: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleSaveEdit = async (sipId) => {
    try {
      await axios.put(`/api/sips/${sipId}`, {
        amount: Number(editAmount),
        day_of_month: parseInt(editDay)
      });
      setSips(prev => prev.map(s => s.id === sipId ? { ...s, amount: Number(editAmount), day_of_month: parseInt(editDay) } : s));
      setEditingSipId(null);
    } catch (err) {
      alert('Failed to edit SIP: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleCreateSip = async (e) => {
    e.preventDefault();
    if (!selectedHoldingId || !newAmount) {
      setErrorMsg('Please select a fund and enter a valid monthly amount.');
      return;
    }

    const holding = mfHoldings.find(h => h.id === selectedHoldingId);
    if (!holding) return;

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await axios.post('/api/sips', {
        holding_id: holding.id,
        symbol: holding.symbol,
        name: holding.name,
        amount: Number(newAmount),
        day_of_month: parseInt(newDay) || 5
      });
      if (res.data.sip) {
        setSips(prev => [res.data.sip, ...prev]);
        setShowAddForm(false);
        setNewAmount('');
        setSelectedHoldingId('');
      }
    } catch (err) {
      setErrorMsg(err.response?.data?.error || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const totalMonthlyActive = sips
    .filter(s => s.status === 'ACTIVE')
    .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-slate-800 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                CLOUD BACKGROUND WORKER
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Auto-executes on schedule
              </span>
            </div>
            <h3 className="text-lg font-black text-white mt-1">Manage Recurring SIPs</h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Commitment Summary Banner */}
        <div className="px-6 py-3 bg-slate-800/40 border-b border-slate-800/60 flex items-center justify-between">
          <div className="text-xs text-slate-400">
            Active Monthly Commitment:{' '}
            <strong className="text-amber-400 font-bold font-mono text-sm ml-1">
              {formatMoney(totalMonthlyActive, true)}/mo
            </strong>
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 rounded-xl text-xs font-bold transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            {showAddForm ? 'Cancel' : 'Add Recurring SIP'}
          </button>
        </div>

        {/* Add SIP Drawer */}
        <AnimatePresence>
          {showAddForm && (
            <motion.form
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              onSubmit={handleCreateSip}
              className="p-5 bg-slate-950/60 border-b border-slate-800 space-y-3 overflow-hidden"
            >
              <div className="font-bold text-xs text-slate-200">Setup New Recurring SIP</div>
              {errorMsg && (
                <div className="text-[11px] text-rose-400 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {errorMsg}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-1">
                  <label className="text-[10px] text-slate-400 font-medium block mb-1">Mutual Fund</label>
                  <select
                    value={selectedHoldingId}
                    onChange={(e) => setSelectedHoldingId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white"
                    required
                  >
                    <option value="">Select fund...</option>
                    {mfHoldings.map(h => (
                      <option key={h.id} value={h.id}>{h.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 font-medium block mb-1">Monthly Amount (₹)</label>
                  <input
                    type="number"
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                    placeholder="5000"
                    min="100"
                    step="100"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 font-medium block mb-1">Day of Month</label>
                  <input
                    type="number"
                    value={newDay}
                    onChange={(e) => setNewDay(e.target.value)}
                    min="1"
                    max="28"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white font-mono"
                    required
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-amber-500 text-obsidian-950 font-bold rounded-xl text-xs hover:bg-amber-400 transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Creating...' : 'Start SIP Schedule'}
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* SIP List */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-3">
          {loading ? (
            <div className="py-12 text-center text-slate-500 text-xs">Loading SIP schedules...</div>
          ) : sips.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              No active recurring SIPs found. Click "Add Recurring SIP" to set one up!
            </div>
          ) : (
            sips.map(sip => {
              const isEditing = editingSipId === sip.id;
              const isClosed = sip.status === 'CLOSED';
              const isPaused = sip.status === 'PAUSED';

              return (
                <div
                  key={sip.id}
                  className={`p-4 rounded-2xl border transition-all ${
                    isClosed
                      ? 'bg-slate-900/40 border-slate-800/40 opacity-60'
                      : isPaused
                      ? 'bg-slate-900/70 border-amber-500/25'
                      : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-xs text-white">{sip.name}</span>
                        <span className={`px-1.5 py-0.2 rounded text-[8.5px] font-bold uppercase tracking-wider ${
                          isClosed
                            ? 'bg-slate-800 text-slate-400'
                            : isPaused
                            ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                            : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        }`}>
                          {sip.status}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                        AMFI #{sip.symbol} • Runs on {sip.day_of_month}th of every month
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-3">
                        <span>Next Run: <strong className="text-slate-200 font-mono">{sip.next_run_date}</strong></span>
                        {sip.last_run_date && (
                          <span>Last Run: <strong className="text-slate-400 font-mono">{sip.last_run_date}</strong></span>
                        )}
                      </div>
                    </div>

                    {/* Amount & Controls */}
                    <div className="flex items-center gap-3 justify-between sm:justify-end border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-800">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={editAmount}
                            onChange={(e) => setEditAmount(e.target.value)}
                            className="w-20 px-2 py-1 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white font-mono"
                          />
                          <button
                            onClick={() => handleSaveEdit(sip.id)}
                            className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setEditingSipId(null)}
                            className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="text-right">
                          <div className="text-sm font-black font-mono text-amber-400">
                            {formatMoney(sip.amount, true)}
                          </div>
                          <div className="text-[9px] text-slate-500 uppercase">per month</div>
                        </div>
                      )}

                      {!isClosed && (
                        <div className="flex items-center gap-1">
                          {/* Pause / Resume */}
                          <button
                            onClick={() => handleToggleStatus(sip)}
                            className={`p-2 rounded-xl text-xs font-bold transition-all ${
                              isPaused
                                ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400'
                                : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-400'
                            }`}
                            title={isPaused ? 'Resume SIP' : 'Pause SIP'}
                          >
                            {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                          </button>

                          {/* Edit Amount / Day */}
                          <button
                            onClick={() => {
                              setEditingSipId(sip.id);
                              setEditAmount(String(sip.amount));
                              setEditDay(String(sip.day_of_month));
                            }}
                            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all"
                            title="Edit Amount"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {/* Close SIP */}
                          <button
                            onClick={() => handleCloseSip(sip)}
                            className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-all"
                            title="Close SIP"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </motion.div>
    </div>
  );
}
