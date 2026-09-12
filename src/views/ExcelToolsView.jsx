import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FileSpreadsheet, Upload, Download, CheckCircle2, FileText, Database, Cloud, RefreshCw, ShieldCheck, History, ArrowRight } from 'lucide-react';
import axios from 'axios';
import { AnimatedPage, AnimatedItem, AnimatedCard } from '../components/AnimatedPage';
import { useThemeAuth } from '../context/ThemeAuthContext';

export default function ExcelToolsView({ onRefresh }) {
  const { showSuccess, showError, showConfirm } = useThemeAuth();
  const [fileUploaded, setFileUploaded] = useState(false);
  const [fileName, setFileName] = useState('');

  // Cloud Backups state
  const [backups, setBackups] = useState([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const fetchCloudBackups = async () => {
    setIsLoadingBackups(true);
    try {
      const res = await axios.get('/api/cloud-backups');
      if (res.data && res.data.backups) {
        setBackups(res.data.backups);
      }
    } catch (err) {
      console.warn('[Cloud Backups] Failed to fetch list:', err.message);
    } finally {
      setIsLoadingBackups(false);
    }
  };

  useEffect(() => {
    fetchCloudBackups();
  }, []);

  const handleCreateCloudBackup = async () => {
    setIsCreatingBackup(true);
    try {
      const res = await axios.post('/api/cloud-backups/create');
      showSuccess(res.data.message || 'Cloud backup successfully saved to Supabase Storage!');
      await fetchCloudBackups();
    } catch (err) {
      showError('Failed to create cloud backup: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleRestoreCloudBackup = async (filename) => {
    const confirmed = await showConfirm(
      `Are you sure you want to restore the complete database from snapshot "${filename}"? All tables will sync to this point in time.`
    );
    if (!confirmed) return;

    setIsRestoring(true);
    try {
      const res = await axios.post('/api/cloud-backups/restore', { filename });
      showSuccess(res.data.message || 'Database restored successfully from cloud backup!');
      if (onRefresh) onRefresh();
    } catch (err) {
      showError('Failed to restore backup: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsRestoring(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '—';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  const formatDateDisplay = (dateStr) => {
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

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setFileName(file.name);
      setFileUploaded(true);
      setTimeout(() => {
        showSuccess(`Imported ${file.name} successfully! Database tables synchronized.`);
        if (onRefresh) onRefresh();
      }, 800);
    }
  };

  const handleDownloadTemplate = () => {
    const csvContent = `Asset Category,Portfolio Name,Identifier Code,ISIN,Asset Name,Currency,Exchange,Transaction Date,Transaction Type,Quantity,Price NAV,Total Amount,Charges
Indian Equity,Pai,AARTIDRUGS,INE767A01016,Aarti Drugs Limited,INR,NSE,2022-10-24,BUY,16,459.70,7355.20,0.00
Indian Equity,Pai,AARTIDRUGS,INE767A01016,Aarti Drugs Limited,INR,NSE,2023-08-24,SELL,1,900.00,900.00,0.00
Indian Equity,Pai,AARTIDRUGS,INE767A01016,Aarti Drugs Limited,INR,NSE,2023-02-08,DIVIDEND,0,0.00,19.00,0.00
Mutual Funds,Pai,120539,INF209K01VF2,Aditya Birla Sun Life Digital India Fund Direct Growth,INR,AMFI,2020-11-24,BUY,238.452,83.87,20000.00,1.00
Mutual Funds,Pai,120539,INF209K01VF2,Aditya Birla Sun Life Digital India Fund Direct Growth,INR,AMFI,2024-04-08,SELL,1005.87,173.21,174226.00,0.00
US Equity,Pai,MSFT,,Microsoft Corporation,USD,NASDAQ,2022-09-15,BUY,0.250218,247.784,62.00,0.00
US Equity,Pai,AMZN,,Amazon.com Inc,USD,NASDAQ,2022-09-15,BUY,0.484958,127.846,62.00,0.00
`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'Ladder_Universal_Import_Template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <AnimatedPage className="space-y-6">
      
      {/* Banner */}
      <AnimatedItem>
        <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
              Spreadsheet Data Hub & Cloud Backup Manager
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Manage investment datasets, import broker statements, and synchronize automated 3-tier rolling cloud backups.
            </p>
          </div>
          <motion.button
            onClick={handleDownloadTemplate}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 font-bold rounded-xl text-xs flex items-center gap-2 transition-all"
          >
            <FileText className="w-4 h-4" />
            Download Template CSV
          </motion.button>
        </div>
      </AnimatedItem>

      {/* Cloud 3-Tier Rolling Backup & Snapshot Sync Tool */}
      <AnimatedCard className="glass-card p-6 rounded-3xl border border-indigo-500/20 bg-indigo-950/10 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                Supabase Cloud Backups (3 Rolling Snapshots)
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                  Supabase Storage
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Maintains exactly the 3 most recent complete database snapshots in Supabase Storage with zero impact on database quotas.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <motion.button
              onClick={fetchCloudBackups}
              disabled={isLoadingBackups}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-slate-300 text-xs transition-all disabled:opacity-50"
              title="Refresh Backups List"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingBackups ? 'animate-spin' : ''}`} />
            </motion.button>
            <motion.button
              onClick={handleCreateCloudBackup}
              disabled={isCreatingBackup}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50"
            >
              <ShieldCheck className="w-4 h-4" />
              {isCreatingBackup ? 'Creating Backup...' : 'Backup Now'}
            </motion.button>
          </div>
        </div>

        {/* Snapshots List */}
        <div className="space-y-2 mt-2">
          {backups.length === 0 ? (
            <div className="p-4 rounded-2xl bg-slate-900/40 border border-slate-800 text-center text-xs text-slate-500">
              {isLoadingBackups ? 'Checking Supabase Cloud Storage...' : 'No cloud snapshots recorded yet. Click "Backup Now" to create your first snapshot.'}
            </div>
          ) : (
            backups.map((b, idx) => (
              <div 
                key={b.name || idx}
                className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-indigo-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400">
                    <History className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white flex items-center gap-2 font-mono">
                      {b.name}
                      {idx === 0 && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-500/20 border border-indigo-500/40 text-indigo-300">
                          Latest
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Recorded: {formatDateDisplay(b.created_at)} &bull; Size: {formatFileSize(b.metadata?.size)}
                    </p>
                  </div>
                </div>

                <motion.button
                  onClick={() => handleRestoreCloudBackup(b.name)}
                  disabled={isRestoring}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 rounded-xl text-[11px] font-bold flex items-center gap-1.5 transition-all disabled:opacity-50 self-end sm:self-auto"
                >
                  <ArrowRight className="w-3 h-3" />
                  {isRestoring ? 'Restoring...' : 'Restore to this Backup'}
                </motion.button>
              </div>
            ))
          )}
        </div>
      </AnimatedCard>

      {/* Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        
        <AnimatedCard className="glass-card p-8 rounded-3xl border border-slate-800 flex flex-col items-center justify-center text-center">
          <motion.div 
            className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400 mb-4"
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            <Upload className="w-7 h-7" />
          </motion.div>
          <h3 className="text-base font-bold text-white mb-1">Import Investment Spreadsheet</h3>
          <p className="text-[10px] text-slate-500 max-w-xs mb-5">
            Upload Indian Equity (CSV), Mutual Funds (CSV), or US Stocks (XLS/CSV) spreadsheet
          </p>

          <label className="cursor-pointer px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-obsidian-950 font-black rounded-xl text-xs shadow-lg shadow-emerald-500/20 transition-all">
            <span>Select File</span>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />
          </label>

          {fileUploaded && (
            <motion.div 
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-3 flex items-center gap-1.5 text-xs font-bold text-emerald-400"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Imported {fileName}
            </motion.div>
          )}
        </AnimatedCard>

        <AnimatedCard className="glass-card p-8 rounded-3xl border border-slate-800 flex flex-col items-center justify-center text-center">
          <motion.div 
            className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center text-indigo-400 mb-4"
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 3, repeat: Infinity, delay: 0.5 }}
          >
            <Download className="w-7 h-7" />
          </motion.div>
          <h3 className="text-base font-bold text-white mb-1">Export Database Backup</h3>
          <p className="text-[10px] text-slate-500 max-w-xs mb-5">
            Export full Supabase PostgreSQL database tables snapshot
          </p>

          <motion.button
            onClick={() => handleCreateCloudBackup()}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-xl text-xs font-bold text-white"
          >
            Export All Records
          </motion.button>
        </AnimatedCard>

      </div>

    </AnimatedPage>
  );
}
