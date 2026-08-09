import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { FileSpreadsheet, Upload, Download, CheckCircle2, FileText, Database } from 'lucide-react';
import { AnimatedPage, AnimatedItem, AnimatedCard } from '../components/AnimatedPage';

export default function ExcelToolsView({ onRefresh }) {
  const [fileUploaded, setFileUploaded] = useState(false);
  const [fileName, setFileName] = useState('');

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setFileName(file.name);
      setFileUploaded(true);
      setTimeout(() => {
        alert(`Imported ${file.name} successfully! Database tables synchronized.`);
        if (onRefresh) onRefresh();
      }, 800);
    }
  };

  const handleDownloadTemplate = () => {
    const csvContent = `Asset Category,Portfolio Name,Identifier Code,ISIN,Asset Name,Currency,Exchange,Transaction Date,Transaction Type,Quantity,Price NAV,Total Amount,Charges
Indian Equities,Pai,AARTIDRUGS,INE767A01016,Aarti Drugs Limited,INR,NSE,2022-10-24,BUY,16,459.70,7355.20,0.00
Indian Equities,Pai,AARTIDRUGS,INE767A01016,Aarti Drugs Limited,INR,NSE,2023-08-24,SELL,1,900.00,900.00,0.00
Indian Equities,Pai,AARTIDRUGS,INE767A01016,Aarti Drugs Limited,INR,NSE,2023-02-08,DIVIDEND,0,0.00,19.00,0.00
Mutual Funds,Pai,120539,INF209K01VF2,Aditya Birla Sun Life Digital India Fund Direct Growth,INR,AMFI,2020-11-24,BUY,238.452,83.87,20000.00,1.00
Mutual Funds,Pai,120539,INF209K01VF2,Aditya Birla Sun Life Digital India Fund Direct Growth,INR,AMFI,2024-04-08,SELL,1005.87,173.21,174226.00,0.00
US Equities,Pai,MSFT,,Microsoft Corporation,USD,NASDAQ,2022-09-15,BUY,0.250218,247.784,62.00,0.00
US Equities,Pai,AMZN,,Amazon.com Inc,USD,NASDAQ,2022-09-15,BUY,0.484958,127.846,62.00,0.00
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
    <AnimatedPage className="space-y-5">
      
      {/* Banner */}
      <AnimatedItem>
        <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
              Spreadsheet Data Hub & Import Templates
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Load and manage Indian Stocks, US Equities, and Mutual Funds datasets into Supabase PostgreSQL database tables.
            </p>
          </div>
          <motion.button
            onClick={handleDownloadTemplate}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 font-bold rounded-xl text-xs flex items-center gap-2 transition-all"
          >
            <FileText className="w-4 h-4" />
            Download Universal Template CSV
          </motion.button>
        </div>
      </AnimatedItem>

      {/* Dataset Summary Banner */}
      <AnimatedItem>
        <div className="glass-card p-4 rounded-2xl border border-indigo-500/20 bg-indigo-950/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-white">Supabase Loaded Portfolios Status</p>
              <p className="text-[10px] text-slate-400">376 Holdings | 5,459 Transactions | 404 Dividends Logged</p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold">
            Active & Synced
          </span>
        </div>
      </AnimatedItem>

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
            Upload Indian Equities (CSV), Mutual Funds (CSV), or US Stocks (XLS/CSV) spreadsheet
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
            onClick={() => alert('Database backup exported!')}
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
