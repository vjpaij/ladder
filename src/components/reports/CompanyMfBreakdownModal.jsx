import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search } from 'lucide-react';

export default function CompanyMfBreakdownModal({
  companyDetailTarget,
  companyMfBreakdown,
  setCompanyDetailTarget,
  companyModalSearch,
  setCompanyModalSearch,
  companyModalSort,
  handleSortClick,
  setCompanyModalSort,
  renderSortIcon,
  formatMoney
}) {
  // Close on Escape key press
  useEffect(() => {
    if (!companyDetailTarget) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setCompanyDetailTarget(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [companyDetailTarget, setCompanyDetailTarget]);

  if (!companyDetailTarget || !companyMfBreakdown) return null;

  const modalContent = (
    <AnimatePresence>
      {companyDetailTarget && companyMfBreakdown && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-950/75 backdrop-blur-md overflow-y-auto"
          onClick={() => setCompanyDetailTarget(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="relative w-full max-w-2xl modal-surface reports-card rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col overflow-hidden border border-inherit my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4 border-b border-inherit pb-4 shrink-0">
              <div className="min-w-0">
                <h3 className="text-base sm:text-lg font-black flex items-center gap-2 flex-wrap">
                  <span className="truncate">{companyMfBreakdown.name}</span>
                  {companyMfBreakdown.symbol && (
                    <span className="text-xs px-2 py-0.5 rounded-md reports-subcard font-mono font-bold border border-inherit opacity-80 shrink-0">
                      {companyMfBreakdown.symbol}
                    </span>
                  )}
                </h3>
                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs opacity-75 font-medium">
                  {companyMfBreakdown.sector && <span>{companyMfBreakdown.sector}</span>}
                  {companyMfBreakdown.sector && companyMfBreakdown.capTier && <span>•</span>}
                  {companyMfBreakdown.capTier && <span className="font-bold">{companyMfBreakdown.capTier}</span>}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setCompanyDetailTarget(null)}
                className="p-2 rounded-xl opacity-70 hover:opacity-100 hover:bg-slate-500/10 transition-colors cursor-pointer shrink-0"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Total Holding Stat Banner */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 shrink-0">
              <div className="p-3.5 reports-subcard rounded-2xl border border-inherit">
                <p className="text-[10px] uppercase font-bold opacity-75">Total Portfolio Value</p>
                <p className="text-base font-black font-mono mt-1 text-emerald-600 dark:text-emerald-400">
                  {formatMoney(companyMfBreakdown.totalGrandVal)}
                </p>
              </div>
              <div className="p-3.5 reports-subcard rounded-2xl border border-inherit">
                <p className="text-[10px] uppercase font-bold opacity-75">Via Mutual Funds</p>
                <p className="text-base font-black font-mono mt-1 text-purple-600 dark:text-purple-400">
                  {formatMoney(companyMfBreakdown.totalMfAllocated)}
                </p>
              </div>
              <div className="p-3.5 reports-subcard rounded-2xl border border-inherit">
                <p className="text-[10px] uppercase font-bold opacity-75">Direct Equity Holding</p>
                <p className="text-base font-black font-mono mt-1 text-blue-600 dark:text-blue-400">
                  {formatMoney(companyMfBreakdown.directVal)}
                </p>
              </div>
            </div>

            {/* Mutual Funds Scheme Breakdown Table */}
            <div className="space-y-3 min-h-0 flex-1 flex flex-col">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shrink-0">
                <p className="text-xs font-black uppercase tracking-wider opacity-80">
                  Mutual Fund Schemes Breakdown ({companyMfBreakdown.schemes.length})
                </p>

                {companyMfBreakdown.schemes.length > 0 && (
                  <div className="relative w-full sm:w-64">
                    <Search className="w-3.5 h-3.5 opacity-50 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Filter schemes..."
                      value={companyModalSearch}
                      onChange={(e) => setCompanyModalSearch(e.target.value)}
                      className="w-full pl-9 pr-8 py-1.5 rounded-xl text-xs reports-subcard border border-inherit focus:outline-none focus:border-emerald-500/80 font-medium"
                    />
                    {companyModalSearch && (
                      <button 
                        type="button"
                        onClick={() => setCompanyModalSearch('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 p-0.5 cursor-pointer"
                        aria-label="Clear filter"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {companyMfBreakdown.schemes.length > 0 ? (
                <div className="relative overflow-x-auto overflow-y-auto max-h-[380px] custom-scrollbar rounded-2xl reports-table-container flex-1 border border-inherit">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 z-30 reports-table-sticky-head shadow-sm select-none">
                      <tr className="reports-table-head font-bold uppercase text-[10px] select-none">
                        <th 
                          onClick={() => handleSortClick(setCompanyModalSort, 'scheme_name')} 
                          className="py-3 pl-4 cursor-pointer hover:text-emerald-500 transition-colors sticky left-0 top-0 z-40 reports-table-sticky-head border-r border-inherit min-w-[200px]"
                        >
                          Mutual Fund Scheme {renderSortIcon(companyModalSort, 'scheme_name')}
                        </th>
                        <th 
                          onClick={() => handleSortClick(setCompanyModalSort, 'fund_weight_pct')} 
                          className="py-3 text-right cursor-pointer hover:text-emerald-500 transition-colors reports-table-sticky-head"
                        >
                          Fund Weight {renderSortIcon(companyModalSort, 'fund_weight_pct')}
                        </th>
                        <th 
                          onClick={() => handleSortClick(setCompanyModalSort, 'allocatedINR')} 
                          className="py-3 text-right cursor-pointer hover:text-emerald-500 transition-colors reports-table-sticky-head"
                        >
                          Allocated Value {renderSortIcon(companyModalSort, 'allocatedINR')}
                        </th>
                        <th 
                          onClick={() => handleSortClick(setCompanyModalSort, 'shareOfStockPct')} 
                          className="py-3 text-right pr-4 cursor-pointer hover:text-emerald-500 transition-colors reports-table-sticky-head"
                        >
                          Share of Holding {renderSortIcon(companyModalSort, 'shareOfStockPct')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-inherit font-mono">
                      {(() => {
                        let list = [...companyMfBreakdown.schemes];
                        if (companyModalSearch.trim()) {
                          const q = companyModalSearch.toLowerCase().trim();
                          list = list.filter(s =>
                            (s.scheme_name || '').toLowerCase().includes(q) ||
                            (s.scheme_code || '').toString().includes(q)
                          );
                        }
                        if (companyModalSort.field) {
                          list.sort((a, b) => {
                            let valA = a[companyModalSort.field];
                            let valB = b[companyModalSort.field];
                            if (typeof valA === 'string') {
                              return companyModalSort.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(aVal);
                            }
                            valA = Number(valA) || 0;
                            valB = Number(valB) || 0;
                            return companyModalSort.direction === 'asc' ? valA - valB : valB - valA;
                          });
                        }
                        return list.map((s, idx) => (
                          <tr key={`${s.scheme_code}-${idx}`} className="reports-table-row transition-colors">
                            <td className="py-3 pl-4 font-sans font-bold sticky left-0 z-20 reports-table-sticky-cell border-r border-inherit min-w-[200px]">
                              {s.scheme_name}
                            </td>
                            <td className="py-3 text-right opacity-80 font-bold">
                              {s.fund_weight_pct}%
                            </td>
                            <td className="py-3 text-right text-emerald-600 dark:text-emerald-400 font-bold">
                              {formatMoney(s.allocatedINR)}
                            </td>
                            <td className="py-3 text-right pr-4 text-purple-600 dark:text-purple-400 font-black">
                              {s.shareOfStockPct}%
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6 text-center text-xs opacity-70 reports-subcard rounded-2xl border border-inherit">
                  This company is held directly as equity shares in your portfolio.
                </div>
              )}
            </div>
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

