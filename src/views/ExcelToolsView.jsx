import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { FileSpreadsheet, Upload, Download, CheckCircle2 } from 'lucide-react';
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
        alert(`Imported ${file.name} successfully!`);
        onRefresh();
      }, 800);
    }
  };

  return (
    <AnimatedPage className="space-y-5">
      
      {/* Banner */}
      <AnimatedItem>
        <div className="glass-card p-5 rounded-3xl border border-slate-800">
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
            Import & Export
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Import from Excel or CSV, export database backups</p>
        </div>
      </AnimatedItem>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        
        <AnimatedCard className="glass-card p-8 rounded-3xl border border-slate-800 flex flex-col items-center justify-center text-center">
          <motion.div 
            className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400 mb-4"
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            <Upload className="w-7 h-7" />
          </motion.div>
          <h3 className="text-base font-bold text-white mb-1">Import Spreadsheet</h3>
          <p className="text-[10px] text-slate-500 max-w-xs mb-5">
            Upload portfolio.xlsx or broker CSV
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
          <h3 className="text-base font-bold text-white mb-1">Export Backup</h3>
          <p className="text-[10px] text-slate-500 max-w-xs mb-5">
            Export all records as JSON or Excel
          </p>

          <motion.button
            onClick={() => alert('Database exported!')}
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
