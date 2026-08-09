import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Database, Table, Edit3, Check, RefreshCw, Layers, ShieldCheck, Tag } from 'lucide-react';

export default function DatabaseViewer() {
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState('holdings');
  const [tableData, setTableData] = useState({ columns: [], rows: [] });
  const [editingCell, setEditingCell] = useState(null); // { id, column, value }
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchTables();
  }, []);

  useEffect(() => {
    if (selectedTable) fetchTableData(selectedTable);
  }, [selectedTable]);

  const fetchTables = async () => {
    try {
      const res = await axios.get('/api/db-tables');
      setTables(res.data);
    } catch (err) {
      console.error('[DB] Error fetching tables:', err);
    }
  };

  const fetchTableData = async (tableName) => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/db-table-data/${tableName}`);
      setTableData(res.data);
    } catch (err) {
      console.error('[DB] Error fetching table data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCellSave = async () => {
    if (!editingCell) return;
    try {
      await axios.post('/api/db-table-update', {
        tableName: selectedTable,
        id: editingCell.id,
        column: editingCell.column,
        value: editingCell.value
      });
      setEditingCell(null);
      fetchTableData(selectedTable);
    } catch (err) {
      alert('Error updating database table: ' + err.message);
    }
  };

  return (
    <div className="space-y-6 mb-8">
      
      {/* DB Inspector Header */}
      <div className="glass-panel p-6 rounded-3xl border border-slate-800/80 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Database className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-white flex items-center gap-2">
              Relational Database Inspector & Visual Table Manager
              <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full">
                RELATIONAL CASCADE
              </span>
            </h3>
            <p className="text-xs text-slate-400">Inspect raw database tables (`holdings`, `transactions`, `dividends`, `liabilities`) with Name & Symbol identification</p>
          </div>
        </div>

        <button
          onClick={() => fetchTableData(selectedTable)}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs font-semibold text-slate-200"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Table
        </button>
      </div>

      {/* Table Selector Pills */}
      <div className="flex items-center gap-2 overflow-x-auto p-1.5 bg-slate-900/60 rounded-2xl border border-slate-800/80">
        {tables.map(tbl => (
          <button
            key={tbl}
            onClick={() => setSelectedTable(tbl)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
              selectedTable === tbl
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <Table className="w-3.5 h-3.5" />
            <span>{tbl}</span>
          </button>
        ))}
      </div>

      {/* Live Data Grid */}
      <div className="glass-panel p-6 rounded-3xl border border-slate-800/80">
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs font-bold text-slate-300 font-mono">
            TABLE: <span className="text-emerald-400">{selectedTable.toUpperCase()}</span> ({tableData.rows.length} records)
          </div>
          <span className="text-[11px] text-slate-400">Click cell icon to edit record inline</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse font-mono text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] uppercase text-slate-400 bg-slate-900/60">
                {tableData.columns.map(col => (
                  <th key={col.name} className={`py-3 px-3 ${col.name === 'symbol' || col.name === 'name' ? 'text-emerald-400 font-extrabold' : ''}`}>
                    <div>{col.name}</div>
                    <div className="text-[9px] text-slate-500 lowercase">({col.type})</div>
                  </th>
                ))}
                <th className="py-3 px-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {tableData.rows.map(row => (
                <tr key={`row-${row.id}`} className="hover:bg-slate-800/30 transition-colors">
                  {tableData.columns.map(col => {
                    const isEditing = editingCell && editingCell.id === row.id && editingCell.column === col.name;
                    const val = row[col.name];

                    return (
                      <td key={`cell-${row.id}-${col.name}`} className="py-3 px-3 text-slate-200">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={editingCell.value}
                              onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                              className="px-2 py-1 bg-slate-900 border border-emerald-500 rounded text-xs text-white focus:outline-none w-28"
                            />
                            <button onClick={handleCellSave} className="p-1 bg-emerald-500 text-slate-950 rounded">
                              <Check className="w-3 h-3 stroke-[3]" />
                            </button>
                          </div>
                        ) : (
                          <div 
                            className="group/cell flex items-center justify-between cursor-pointer hover:text-emerald-400 transition-colors"
                            onClick={() => setEditingCell({ id: row.id, column: col.name, value: val })}
                          >
                            <span>
                              {col.name === 'symbol' ? (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold">
                                  {val}
                                </span>
                              ) : col.name === 'name' ? (
                                <span className="font-bold text-slate-100">{val}</span>
                              ) : (
                                String(val ?? '')
                              )}
                            </span>
                            <Edit3 className="w-3 h-3 text-slate-600 opacity-0 group-hover/cell:opacity-100 transition-opacity" />
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className="py-3 px-3 text-center">
                    <button
                      onClick={() => setEditingCell({ id: row.id, column: tableData.columns[0]?.name, value: row[tableData.columns[0]?.name] })}
                      className="px-2 py-1 text-[10px] font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
