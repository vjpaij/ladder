import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { motion } from 'framer-motion';
import { Database, Table, Edit3, Check, RefreshCw, Download } from 'lucide-react';
import { AnimatedPage, AnimatedItem } from '../components/AnimatedPage';

export default function DatabaseStudioView() {
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState('holdings');
  const [tableData, setTableData] = useState({ columns: [], rows: [] });
  const [editingCell, setEditingCell] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetchTables(); }, []);
  useEffect(() => { if (selectedTable) fetchTableData(selectedTable); }, [selectedTable]);

  const fetchTables = async () => {
    try { const res = await axios.get('/api/db-tables'); setTables(res.data); } catch (err) { console.error(err); }
  };

  const fetchTableData = async (tableName) => {
    setLoading(true);
    try { const res = await axios.get(`/api/db-table-data/${tableName}`); setTableData(res.data); } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const handleCellSave = async () => {
    if (!editingCell) return;
    try {
      await axios.post('/api/db-table-update', { tableName: selectedTable, id: editingCell.id, column: editingCell.column, value: editingCell.value });
      setEditingCell(null);
      fetchTableData(selectedTable);
    } catch (err) { alert('Error: ' + err.message); }
  };

  const exportTableJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tableData.rows, null, 2));
    const a = document.createElement('a');
    a.setAttribute("href", dataStr);
    a.setAttribute("download", `${selectedTable}_export.json`);
    document.body.appendChild(a); a.click(); a.remove();
  };

  return (
    <AnimatedPage className="space-y-5">
      
      {/* Banner */}
      <AnimatedItem>
        <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-3">
            <motion.div 
              className="w-10 h-10 rounded-2xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center text-indigo-400"
              animate={{ rotate: [0, 360] }}
              transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
            >
              <Database className="w-5 h-5" />
            </motion.div>
            <div>
              <h2 className="text-xl font-black text-white">Database Studio</h2>
              <p className="text-[11px] text-slate-500">View & edit tables with relational sync</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <motion.button
              onClick={exportTableJSON}
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs font-bold text-slate-300"
            >
              <Download className="w-3.5 h-3.5" />
              Export JSON
            </motion.button>
            <motion.button
              onClick={() => fetchTableData(selectedTable)}
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-xs font-bold text-white shadow-lg shadow-indigo-600/20"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </motion.button>
          </div>
        </div>
      </AnimatedItem>

      {/* Table Selector */}
      <AnimatedItem>
        <div className="flex items-center gap-1.5 overflow-x-auto p-1 bg-slate-900/60 rounded-2xl border border-slate-800/80">
          {tables.map(tbl => (
            <motion.button
              key={tbl}
              onClick={() => setSelectedTable(tbl)}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap ${
                selectedTable === tbl
                  ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-600/20'
                  : 'text-slate-500 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              <Table className="w-3 h-3" />
              {tbl}
            </motion.button>
          ))}
        </div>
      </AnimatedItem>

      {/* Data Grid */}
      <AnimatedItem>
        <div className="glass-card p-5 rounded-3xl border border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] font-bold text-slate-400 font-mono">
              <span className="text-emerald-400">{selectedTable.toUpperCase()}</span> • {tableData.rows.length} rows
            </div>
            <span className="text-[10px] text-slate-600">Click to edit</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse font-mono text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-500 bg-slate-900/60">
                  {tableData.columns.map(col => (
                    <th key={col.name} className="py-2.5 px-2.5">
                      <div>{col.name}</div>
                      <div className="text-[8px] text-slate-600 lowercase font-sans">({col.type})</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {tableData.rows.map(row => (
                  <tr key={`row-${row.id}`} className="hover:bg-slate-800/40">
                    {tableData.columns.map(col => {
                      const isEditing = editingCell && editingCell.id === row.id && editingCell.column === col.name;
                      return (
                        <td key={`cell-${row.id}-${col.name}`} className="py-2.5 px-2.5 text-slate-300">
                          {isEditing ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={editingCell.value}
                                onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                                className="px-1.5 py-0.5 bg-slate-900 border border-emerald-500 rounded text-xs text-white focus:outline-none w-24 font-mono"
                                autoFocus
                              />
                              <button onClick={handleCellSave} className="p-0.5 bg-emerald-500 text-slate-950 rounded">
                                <Check className="w-2.5 h-2.5 stroke-[3]" />
                              </button>
                            </div>
                          ) : (
                            <div
                              onClick={() => setEditingCell({ id: row.id, column: col.name, value: row[col.name] })}
                              className="cursor-pointer hover:text-emerald-400 flex items-center justify-between group/cell"
                            >
                              <span className="truncate max-w-[120px]">{String(row[col.name] ?? '')}</span>
                              <Edit3 className="w-2.5 h-2.5 text-slate-700 opacity-0 group-hover/cell:opacity-100 ml-1 shrink-0" />
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </AnimatedItem>

    </AnimatedPage>
  );
}
