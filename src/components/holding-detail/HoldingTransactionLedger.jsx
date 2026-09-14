import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar, Plus, PlusCircle, Search, X, ChevronUp, ChevronDown,
  Edit3, Trash2, Save, XCircle
} from 'lucide-react';
import formatDateDDMMYYYY from '../../utils/dateFormatter';
import { TxBadge, formatTxDate } from './holdingDetailUtils';
import DatePicker from '../common/DatePicker';

export default function HoldingTransactionLedger({
  holding,
  isEodAsset,
  isUSStock,
  isLight,
  isDisplayUSD,
  isFundOrNps,
  fxRate,
  sortedTxs,
  txSort,
  handleTxSort,
  availableTxTypes,
  txTypeFilter,
  setTxTypeFilter,
  txSearch,
  setTxSearch,
  isAddingTx,
  setIsAddingTx,
  newTxType,
  setNewTxType,
  newTxDate,
  setNewTxDate,
  newTxQty,
  setNewTxQty,
  newTxPrice,
  setNewTxPrice,
  newTxAmount,
  setNewTxAmount,
  newTxCharges,
  setNewTxCharges,
  newTxFxRate,
  setNewTxFxRate,
  newTxNotes,
  setNewTxNotes,
  isSavingTx,
  handleSaveNewTransaction,
  editingTxId,
  editForm,
  setEditForm,
  startEditTx,
  cancelEditTx,
  saveEditTx,
  txActionLoading,
  deleteTx,
  deleteConfirmTx,
  setDeleteConfirmTx,
  isDeletingTx,
  handleConfirmDeleteTx
}) {
  const SortIcon = ({ field }) => {
    if (txSort.field !== field) return <ChevronDown className="w-3 h-3 text-slate-600 inline ml-0.5" />;
    return txSort.dir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-emerald-400 inline ml-0.5" />
      : <ChevronDown className="w-3 h-3 text-emerald-400 inline ml-0.5" />;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5" />
          Transaction Ledger ({sortedTxs.length} {sortedTxs.length === 1 ? 'record' : 'records'})
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (!isAddingTx) {
                const num = Number(holding?.current_price || 0);
                if (num > 0 && (!newTxPrice || !String(newTxPrice).includes('.'))) {
                  const isFund = holding?.category_id === 'mutual_funds' || holding?.category_id === 'nps';
                  setNewTxPrice(isFund ? num.toFixed(4) : num.toFixed(2));
                }
                if (!newTxCharges || newTxCharges === '0' || newTxCharges === '') {
                  setNewTxCharges('0.00');
                }
              }
              setIsAddingTx(!isAddingTx);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              isAddingTx
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isAddingTx ? 'Close' : 'Add Transaction'}</span>
          </button>

          {availableTxTypes.length > 1 && (
            <div className="flex flex-wrap items-center gap-1 p-0.5 bg-slate-900/80 border border-slate-800 rounded-xl text-[10px] font-bold">
              {availableTxTypes.map(type => (
                <button
                  key={type}
                  onClick={() => setTxTypeFilter(type)}
                  className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
                    txTypeFilter === type
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          )}

          <div className="relative w-full sm:w-52">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter records..."
              value={txSearch}
              onChange={(e) => setTxSearch(e.target.value)}
              className="w-full pl-8 pr-10 py-1 bg-slate-900/80 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50"
            />
            {txSearch && (
              <button
                onClick={() => setTxSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Quick Add Transaction Drawer */}
      <AnimatePresence>
        {isAddingTx && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            onSubmit={handleSaveNewTransaction}
            className="reports-subcard border border-inherit rounded-2xl p-4 shadow-xl space-y-3 overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-inherit pb-2">
              <span className="text-xs font-bold flex items-center gap-1.5 text-emerald-400">
                <PlusCircle className="w-4 h-4" />
                Add Transaction for {holding.symbol || holding.name}
              </span>
              <button
                type="button"
                onClick={() => setIsAddingTx(false)}
                className="p-1 rounded-lg opacity-70 hover:opacity-100 hover:bg-slate-500/10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] opacity-70 font-medium block mb-1">Transaction Type</label>
                <select
                  value={newTxType}
                  onChange={(e) => setNewTxType(e.target.value)}
                  className="w-full px-3 py-1.5 bg-inherit border border-inherit rounded-xl text-xs outline-none focus:border-emerald-500"
                >
                  {(() => {
                    let types = ['BUY', 'SELL', 'BONUS', 'DIVIDEND', 'SPLIT'];
                    if (holding.category_id === 'mutual_funds' || holding.category_id === 'nps') {
                      types = ['BUY', 'REDEEM', 'INVESTMENT', 'INVESTMENT (SIP)'];
                    } else if (holding.category_id === 'bank') {
                      types = ['DEPOSIT', 'WITHDRAWAL', 'CREDIT', 'DEBIT', 'INTEREST', 'CHARGE'];
                    } else if (holding.category_id === 'epf') {
                      types = ['CONTRIBUTION', 'WITHDRAWAL', 'INTEREST'];
                    } else if (holding.category_id === 'loans') {
                      types = ['EMI_PAYMENT', 'PREPAYMENT', 'BORROW', 'CHARGE'];
                    } else if (holding.category_id === 'credit_cards') {
                      types = ['EXPENSE', 'PAYMENT', 'CHARGE'];
                    }
                    return types.map(t => (
                      <option key={t} value={t} className="bg-slate-900 text-white">{t}</option>
                    ));
                  })()}
                </select>
              </div>

              <div>
                <label className="text-[10px] opacity-70 font-medium block mb-1">Date</label>
                <DatePicker
                  value={newTxDate}
                  onChange={(e) => setNewTxDate(e.target.value)}
                  required
                  placeholder="Select date"
                />
              </div>

              {!isEodAsset ? (
                <>
                  <div>
                    <label className="text-[10px] opacity-70 font-medium block mb-1">Quantity / Units</label>
                    <input
                      type="number"
                      step="any"
                      value={newTxQty}
                      onChange={(e) => {
                        const qty = e.target.value;
                        setNewTxQty(qty);
                        if (holding.category_id === 'mutual_funds' && newTxType === 'BUY' && newTxPrice && (!newTxCharges || newTxCharges === '0')) {
                          const gross = (Number(qty) || 0) * (Number(newTxPrice) || 0);
                          setNewTxCharges((gross * 0.00015).toFixed(2));
                        }
                      }}
                      placeholder="Units"
                      required
                      className="w-full px-3 py-1.5 bg-inherit border border-inherit rounded-xl text-xs outline-none focus:border-emerald-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] opacity-70 font-medium block mb-1">Price / NAV ({holding.currency === 'USD' ? '$' : '₹'})</label>
                    <input
                      type="number"
                      step="any"
                      value={newTxPrice}
                      onChange={(e) => {
                        const price = e.target.value;
                        setNewTxPrice(price);
                        if (holding.category_id === 'mutual_funds' && newTxType === 'BUY' && newTxQty && (!newTxCharges || newTxCharges === '0' || newTxCharges === '0.00')) {
                          const gross = (Number(newTxQty) || 0) * (Number(price) || 0);
                          setNewTxCharges((gross * 0.00015).toFixed(2));
                        }
                      }}
                      onBlur={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val)) {
                          const isFund = holding?.category_id === 'mutual_funds' || holding?.category_id === 'nps';
                          setNewTxPrice(isFund ? val.toFixed(4) : val.toFixed(2));
                        }
                      }}
                      placeholder="0.00"
                      required
                      className="w-full px-3 py-1.5 bg-inherit border border-inherit rounded-xl text-xs outline-none focus:border-emerald-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] opacity-70 font-medium block mb-1">Charges ({holding.currency === 'USD' ? '$' : '₹'})</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={newTxCharges}
                      onChange={(e) => setNewTxCharges(e.target.value)}
                      onBlur={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val)) {
                          setNewTxCharges(val.toFixed(2));
                        } else if (e.target.value === '') {
                          setNewTxCharges('0.00');
                        }
                      }}
                      placeholder="0.00"
                      className="w-full px-3 py-1.5 bg-inherit border border-inherit rounded-xl text-xs outline-none focus:border-emerald-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] opacity-70 font-medium block mb-1">
                      Total Amount ({holding.currency === 'USD' ? '$' : '₹'}) {newTxType === 'SELL' ? '(Net)' : '(Incl. Charges)'}
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={(() => {
                        const q = Number(newTxQty) || 0;
                        const p = Number(newTxPrice) || 0;
                        const c = Number(newTxCharges) || 0;
                        const gross = q * p;
                        const net = newTxType === 'SELL' ? Math.max(0, gross - c) : (gross + c);
                        return net.toFixed(2);
                      })()}
                      className="w-full px-3 py-1.5 bg-inherit border border-inherit/40 rounded-xl text-xs font-mono font-bold opacity-90"
                    />
                  </div>
                  {isUSStock && (
                    <div>
                      <label className="text-[10px] opacity-70 font-medium block mb-1 text-purple-400 font-bold">USD/INR Rate (₹)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={newTxFxRate || ''}
                        onChange={(e) => setNewTxFxRate(e.target.value)}
                        placeholder={String(fxRate || 95.5)}
                        className="w-full px-3 py-1.5 bg-inherit border border-purple-500/40 rounded-xl text-xs outline-none focus:border-purple-500 font-mono text-purple-300"
                      />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <label className="text-[10px] opacity-70 font-medium block mb-1">Amount (₹)</label>
                    <input
                      type="number"
                      step="any"
                      value={newTxAmount}
                      onChange={(e) => setNewTxAmount(e.target.value)}
                      placeholder="Amount in ₹"
                      required
                      className="w-full px-3 py-1.5 bg-inherit border border-inherit rounded-xl text-xs outline-none focus:border-emerald-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] opacity-70 font-medium block mb-1">Charges / Fees (₹)</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={newTxCharges}
                      onChange={(e) => setNewTxCharges(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-1.5 bg-inherit border border-inherit rounded-xl text-xs outline-none focus:border-emerald-500 font-mono"
                    />
                  </div>
                </>
              )}

              <div className={isUSStock ? 'sm:col-span-2 md:col-span-2' : (!isEodAsset ? 'sm:col-span-2 md:col-span-3' : 'sm:col-span-2 md:col-span-3')}>
                <label className="text-[10px] opacity-70 font-medium block mb-1">Notes / Description (Optional)</label>
                <input
                  type="text"
                  value={newTxNotes}
                  onChange={(e) => setNewTxNotes(e.target.value)}
                  placeholder="Transaction note..."
                  className="w-full px-3 py-1.5 bg-inherit border border-inherit rounded-xl text-xs outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-inherit">
              <button
                type="button"
                onClick={() => setIsAddingTx(false)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold opacity-70 hover:opacity-100 hover:bg-slate-500/10 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSavingTx}
                className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer shadow-md shadow-emerald-500/20 disabled:opacity-50"
              >
                {isSavingTx ? 'Saving...' : 'Save Transaction'}
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      <div className="glass-card rounded-2xl border border-slate-800 overflow-hidden">
        <div className="relative overflow-x-auto overflow-y-auto max-h-[560px] custom-scrollbar rounded-2xl">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 z-30 bg-slate-900 shadow-sm">
              <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 select-none">
                <th onClick={() => handleTxSort('date')} className="py-3 px-4 cursor-pointer hover:text-white whitespace-nowrap sticky left-0 top-0 z-40 bg-slate-900 border-r border-slate-800 min-w-[130px]">
                  Date <SortIcon field="date" />
                </th>

                {isEodAsset ? (
                  <>
                    <th className="py-3 px-4 bg-slate-900">Type</th>
                    <th onClick={() => handleTxSort('netTxAmount')} className="py-3 px-4 text-right cursor-pointer hover:text-white whitespace-nowrap bg-slate-900">
                      Amount (₹) <SortIcon field="netTxAmount" />
                    </th>
                    <th onClick={() => handleTxSort('runningBalance')} className="py-3 px-4 text-right cursor-pointer hover:text-white whitespace-nowrap bg-slate-900">
                      Running Balance (₹) <SortIcon field="runningBalance" />
                    </th>
                    <th className="py-3 px-4 text-left bg-slate-900">Notes</th>
                    <th className="py-3 px-4 text-center whitespace-nowrap bg-slate-900">Actions</th>
                  </>
                ) : (
                  <>
                    <th className="py-3 px-4 bg-slate-900">Type</th>
                    <th onClick={() => handleTxSort('quantity')} className="py-3 px-4 text-right cursor-pointer hover:text-white whitespace-nowrap bg-slate-900">
                      Qty <SortIcon field="quantity" />
                    </th>
                    <th onClick={() => handleTxSort('price')} className="py-3 px-4 text-right cursor-pointer hover:text-white whitespace-nowrap bg-slate-900">
                      Price <SortIcon field="price" />
                    </th>
                    <th onClick={() => handleTxSort('total_amount')} className="py-3 px-4 text-right cursor-pointer hover:text-white whitespace-nowrap bg-slate-900">
                      {isDisplayUSD ? 'Amount ($)' : 'Amount (₹)'} <SortIcon field="total_amount" />
                    </th>
                    <th className="py-3 px-4 text-right whitespace-nowrap bg-slate-900">Charges</th>
                    {isUSStock && (
                      <th className="py-3 px-4 text-right whitespace-nowrap text-purple-400 font-bold bg-slate-900">
                        Tx Dollar Rate
                      </th>
                    )}
                    <th className="py-3 px-4 text-left bg-slate-900">Notes</th>
                    <th className="py-3 px-4 text-center whitespace-nowrap bg-slate-900">Actions</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {sortedTxs.map((tx, i) => {
                if (isEodAsset) {
                  if (editingTxId === tx.id) {
                    return (
                      <tr key={tx.id || i} className="bg-slate-800/80 border-y border-blue-500/40">
                        <td className="py-2 px-3 sticky left-0 z-20 bg-slate-900 border-r border-slate-800 min-w-[140px]">
                          <DatePicker
                            value={editForm.date || ''}
                            onChange={(e) => setEditForm(prev => ({ ...prev, date: e.target.value }))}
                          />
                        </td>
                        <td className="py-2 px-3">
                          <select
                            value={editForm.type || 'CREDIT'}
                            onChange={(e) => setEditForm(prev => ({ ...prev, type: e.target.value }))}
                            className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                          >
                            {(() => {
                              let types = ['CREDIT', 'DEBIT', 'DEPOSIT', 'WITHDRAWAL', 'INTEREST', 'CHARGE'];
                              if (holding.category_id === 'epf') {
                                types = ['CONTRIBUTION', 'WITHDRAWAL', 'INTEREST'];
                              } else if (holding.category_id === 'loans') {
                                types = ['EMI_PAYMENT', 'PREPAYMENT', 'BORROW', 'CHARGE'];
                              } else if (holding.category_id === 'credit_cards') {
                                types = ['EXPENSE', 'PAYMENT', 'CHARGE'];
                              }
                              return types.map(t => (
                                <option key={t} value={t} className="bg-slate-900 text-white">{t}</option>
                              ));
                            })()}
                          </select>
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="number"
                            step="any"
                            value={editForm.total_amount}
                            onChange={(e) => setEditForm(prev => ({ ...prev, total_amount: e.target.value, price: e.target.value }))}
                            onBlur={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val)) {
                                setEditForm(prev => ({ ...prev, total_amount: val.toFixed(2), price: val.toFixed(2) }));
                              }
                            }}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono text-right focus:outline-none focus:border-blue-500"
                          />
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-500">
                          —
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="text"
                            value={editForm.notes || ''}
                            onChange={(e) => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                            placeholder="Notes"
                          />
                        </td>
                        <td className="py-2 px-3 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => saveEditTx(tx.id)}
                              disabled={txActionLoading === tx.id}
                              className="p-1 hover:bg-emerald-500/20 text-emerald-400 rounded-lg transition-colors cursor-pointer"
                              title="Save"
                            >
                              <Save className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={cancelEditTx}
                              className="p-1 hover:bg-slate-700/60 text-slate-400 rounded-lg transition-colors cursor-pointer"
                              title="Cancel"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  const isPos = tx.isInflow;
                  const changeVal = Number(tx.netTxAmount || tx.total_amount || 0);
                  const balance = Number(tx.runningBalance || 0);

                  return (
                    <motion.tr
                      key={tx.id || i}
                      className="group hover:bg-slate-800/30 transition-colors"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(i * 0.015, 0.4) }}
                    >
                      <td className="py-2.5 px-4 font-mono text-slate-300 whitespace-nowrap sticky left-0 z-20 bg-slate-900/95 group-hover:bg-slate-900/95 border-r border-slate-800 min-w-[130px]">{formatTxDate(tx.date)}</td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <TxBadge type={tx.type} />
                      </td>
                      <td className={`py-2.5 px-4 text-right font-mono font-bold ${isPos ? 'text-emerald-400' : 'text-rose-400'}`}>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black border ${
                          isPos ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30'
                        }`}>
                          {isPos ? '↑ +' : '↓ -'}₹{changeVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-black text-white">
                        ₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 px-4 text-slate-400 text-xs">
                        {tx.notes || (isPos ? 'Deposit / Inflow' : 'Withdrawal / Outflow')}
                      </td>
                      <td className="py-2.5 px-4 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); startEditTx(tx); }}
                            className="p-1 hover:bg-slate-700/60 text-slate-500 hover:text-blue-400 rounded-lg transition-colors cursor-pointer"
                            title="Edit Transaction"
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteTx(tx); }}
                            disabled={txActionLoading === tx.id}
                            className="p-1 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                            title="Delete Transaction"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                }

                const isBuy   = tx.type === 'BUY';
                const isSell  = tx.type === 'SELL';
                const isDiv   = tx.type === 'DIVIDEND';
                const isSplit = tx.type === 'SPLIT';
                const isBonus = tx.type === 'BONUS' || tx.type === 'DIVIDEND_REINVEST';
                
                const rowHover = isBuy   ? 'hover:bg-emerald-500/5'
                              : isSell  ? 'hover:bg-rose-500/5'
                              : isDiv   ? 'hover:bg-amber-500/5'
                              : isSplit ? 'hover:bg-indigo-500/5'
                              : isBonus ? 'hover:bg-cyan-500/5'
                              : 'hover:bg-slate-800/30';
                const amtColor = isBuy   ? 'text-rose-400'
                              : isSell  ? 'text-emerald-400'
                              : isDiv   ? 'text-amber-400'
                              : isSplit ? 'text-indigo-400'
                              : isBonus ? 'text-cyan-400'
                              : 'text-slate-400';

                const txRate = isUSStock ? (Number(tx.fx_rate) || fxRate) : 1.0;
                const displayAmt = isDisplayUSD
                  ? `$${(Number(tx.total_amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : `₹${((Number(tx.total_amount) || 0) * txRate).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

                const displayCharges = isDisplayUSD
                  ? (Number(tx.charges) > 0 ? `$${Number(tx.charges).toFixed(2)}` : '—')
                  : (Number(tx.charges) > 0 ? `₹${(Number(tx.charges) * txRate).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—');

                let qtyDisplay = '—';
                if (isSplit && Number(tx.quantity) > 0) {
                  qtyDisplay = `+${Number(tx.quantity).toLocaleString('en-IN', { maximumFractionDigits: 4 })}`;
                } else if (isBonus && Number(tx.quantity) > 0) {
                  qtyDisplay = `+${Number(tx.quantity).toLocaleString('en-IN', { maximumFractionDigits: 4 })}`;
                } else if (Number(tx.quantity) > 0) {
                  qtyDisplay = Number(tx.quantity).toLocaleString('en-IN', { maximumFractionDigits: 4 });
                }

                let priceDisplay = '—';
                if (isSplit) {
                  priceDisplay = '—';
                } else if (isBonus && (!tx.price || Number(tx.price) === 0)) {
                  priceDisplay = isUSStock ? '$0.00' : '₹0.00';
                } else if (Number(tx.price) > 0) {
                  const priceDigits = isFundOrNps ? 4 : 2;
                  priceDisplay = `${isUSStock ? '$' : '₹'}${Number(tx.price).toLocaleString('en-IN', { minimumFractionDigits: priceDigits, maximumFractionDigits: priceDigits })}`;
                }

                let amountDisplay = '—';
                if (isSplit) {
                  amountDisplay = '—';
                } else if (isBonus && (!tx.total_amount || Number(tx.total_amount) === 0)) {
                  amountDisplay = isUSStock ? '$0.00' : '₹0.00';
                } else if (Number(tx.total_amount) > 0) {
                  amountDisplay = displayAmt;
                }

                if (isSplit || isBonus) {
                  let actionText = '';
                  if (isSplit) {
                    const ratioMatch = (tx.notes || '').match(/(\d+\s*:\s*\d+)/);
                    actionText = ratioMatch ? `Ratio ${ratioMatch[1]}` : '';
                  } else if (isBonus) {
                    const sharesMatch = (tx.notes || '').match(/\+(\d+(?:\.\d+)?)/);
                    actionText = sharesMatch ? `+${sharesMatch[1]} Shares Credited` : '+Shares Credited';
                  }

                  return (
                    <tr
                      key={tx.id || i}
                      className={`border-y transition-colors ${
                        isSplit
                          ? (isLight
                              ? 'bg-purple-50/90 border-purple-200 shadow-sm'
                              : 'bg-purple-950/60 border-purple-500/40')
                          : (isLight
                              ? 'bg-amber-100/60 border-amber-300/80 shadow-sm'
                              : 'bg-amber-950/60 border-amber-600/40')
                      }`}
                    >
                      <td className={`py-2.5 px-4 font-mono font-bold whitespace-nowrap sticky left-0 z-20 ${isLight ? 'bg-purple-100 text-slate-700' : 'bg-slate-900/95 text-slate-300'} border-r border-slate-800 min-w-[130px]`}>
                        {formatDateDDMMYYYY(tx.date)}
                      </td>
                      <td colSpan={isUSStock ? 7 : 6} className="py-2.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-2.5 text-xs font-mono">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                            isSplit
                              ? (isLight
                                  ? 'bg-purple-100 text-purple-950 border-purple-300'
                                  : 'bg-purple-500/25 text-purple-300 border-purple-500/40')
                              : (isLight
                                  ? 'bg-amber-200/90 text-amber-950 border-amber-400 font-black'
                                  : 'bg-amber-900/40 text-amber-300 border-amber-600/50')
                          }`}>
                            {isSplit ? 'Stock Split' : 'Bonus Issue'}
                          </span>
                          {actionText && (
                            <span className={`font-bold text-[12px] ${
                              isSplit
                                ? (isLight ? 'text-purple-950 font-black' : 'text-purple-200')
                                : (isLight ? 'text-amber-950 font-black' : 'text-amber-300')
                            }`}>
                              {actionText}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                }

                // Inline Edit Mode
                if (editingTxId === tx.id) {
                  return (
                    <tr key={tx.id || i} className="bg-blue-950/20 border-y border-blue-500/30">
                      <td className="py-2 px-3 sticky left-0 z-20 bg-slate-900 border-r border-slate-800 min-w-[140px]">
                        <DatePicker
                          value={editForm.date || ''}
                          onChange={(e) => setEditForm(prev => ({ ...prev, date: e.target.value }))}
                        />
                      </td>
                      <td className="py-2 px-3">
                        <select value={editForm.type || 'BUY'} onChange={(e) => setEditForm(prev => ({ ...prev, type: e.target.value }))} className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-blue-500">
                          {(() => {
                            let types = ['BUY', 'SELL', 'DIVIDEND', 'BONUS', 'SPLIT'];
                            if (holding.category_id === 'mutual_funds' || holding.category_id === 'nps') {
                              types = ['BUY', 'REDEEM', 'INVESTMENT', 'INVESTMENT (SIP)', 'BONUS', 'DIVIDEND'];
                            }
                            return types.map(t => <option key={t} value={t} className="bg-slate-900 text-white">{t}</option>);
                          })()}
                        </select>
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          step="any"
                          value={editForm.quantity}
                          onChange={(e) => {
                            const q = e.target.value;
                            setEditForm(prev => {
                              const p = Number(prev.price) || 0;
                              const c = Number(prev.charges) || 0;
                              const total = prev.type === 'SELL' ? Math.max(0, (Number(q) * p) - c) : ((Number(q) * p) + c);
                              return { ...prev, quantity: q, total_amount: q && p ? total.toFixed(2) : prev.total_amount };
                            });
                          }}
                          className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono text-right focus:outline-none focus:border-blue-500"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          step="any"
                          value={editForm.price}
                          onChange={(e) => {
                            const p = e.target.value;
                            setEditForm(prev => {
                              const q = Number(prev.quantity) || 0;
                              const c = Number(prev.charges) || 0;
                              const total = prev.type === 'SELL' ? Math.max(0, (q * Number(p)) - c) : ((q * Number(p)) + c);
                              return { ...prev, price: p, total_amount: q && p ? total.toFixed(2) : prev.total_amount };
                            });
                          }}
                          onBlur={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val)) {
                              const isFund = holding?.category_id === 'mutual_funds' || holding?.category_id === 'nps';
                              setEditForm(prev => ({ ...prev, price: isFund ? val.toFixed(4) : val.toFixed(2) }));
                            }
                          }}
                          className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono text-right focus:outline-none focus:border-blue-500"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          step="any"
                          value={editForm.total_amount}
                          onChange={(e) => setEditForm(prev => ({ ...prev, total_amount: e.target.value }))}
                          onBlur={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val)) {
                              setEditForm(prev => ({ ...prev, total_amount: val.toFixed(2) }));
                            }
                          }}
                          className="w-28 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono text-right focus:outline-none focus:border-blue-500"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={editForm.charges || ''}
                          onChange={(e) => {
                            const c = e.target.value;
                            setEditForm(prev => {
                              const q = Number(prev.quantity) || 0;
                              const p = Number(prev.price) || 0;
                              const total = prev.type === 'SELL' ? Math.max(0, (q * p) - Number(c)) : ((q * p) + Number(c));
                              return { ...prev, charges: c, total_amount: q && p ? total.toFixed(2) : prev.total_amount };
                            });
                          }}
                          onBlur={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val)) {
                              setEditForm(prev => ({ ...prev, charges: val.toFixed(2) }));
                            } else {
                              setEditForm(prev => ({ ...prev, charges: '0.00' }));
                            }
                          }}
                          className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono text-right focus:outline-none focus:border-blue-500"
                          placeholder="0.00"
                        />
                      </td>
                      {isUSStock && (
                        <td className="py-2 px-3">
                          <input type="number" step="any" value={editForm.fx_rate || ''} onChange={(e) => setEditForm(prev => ({ ...prev, fx_rate: e.target.value }))} className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-purple-300 font-mono text-right focus:outline-none focus:border-purple-500" placeholder="₹" />
                        </td>
                      )}
                      <td className="py-2 px-3">
                        <input type="text" value={editForm.notes || ''} onChange={(e) => setEditForm(prev => ({ ...prev, notes: e.target.value }))} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-blue-500" placeholder="Notes" />
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => saveEditTx(tx.id)} disabled={txActionLoading === tx.id} className="p-1 hover:bg-emerald-500/20 text-emerald-400 rounded-lg transition-colors cursor-pointer" title="Save">
                            <Save className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={cancelEditTx} className="p-1 hover:bg-slate-700/60 text-slate-400 rounded-lg transition-colors cursor-pointer" title="Cancel">
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return (
                  <motion.tr
                    key={tx.id || i}
                    className={`group transition-colors ${rowHover}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.015, 0.4) }}
                  >
                    <td className="py-2.5 px-4 font-mono text-slate-300 whitespace-nowrap sticky left-0 z-20 bg-slate-900/95 group-hover:bg-slate-900/95 border-r border-slate-800 min-w-[130px]" title={formatDateDDMMYYYY(tx.date)}>{formatDateDDMMYYYY(tx.date)}</td>
                    <td className="py-2.5 px-4"><TxBadge type={tx.type} /></td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-200">
                      {qtyDisplay}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-400">
                      {priceDisplay}
                    </td>
                    <td className={`py-2.5 px-4 text-right font-mono font-bold ${amtColor}`}>
                      {amountDisplay}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-500">
                      {displayCharges}
                    </td>
                    {isUSStock && (
                      <td className="py-2.5 px-4 text-right font-mono font-bold text-purple-400">
                        {tx.fx_rate ? `₹${Number(tx.fx_rate).toFixed(2)}` : '—'}
                      </td>
                    )}
                    <td className="py-2.5 px-4 text-slate-400 text-[11px]">
                      {tx.notes || ''}
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button 
                          onClick={(e) => { e.stopPropagation(); startEditTx(tx); }} 
                          className="p-1 hover:bg-slate-700/60 text-slate-500 hover:text-blue-400 rounded-lg transition-colors cursor-pointer" 
                          title="Edit Transaction"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); deleteTx(tx); }} 
                          disabled={txActionLoading === tx.id}
                          className="p-1 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 rounded-lg transition-colors disabled:opacity-50 cursor-pointer" 
                          title="Delete Transaction"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
              {sortedTxs.length === 0 && (
                <tr>
                  <td colSpan={isEodAsset ? 6 : (isUSStock ? 9 : 8)} className="py-8 text-center text-slate-600">
                    No records found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Standard Themed Transaction Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteConfirmTx && (
          <div 
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm"
            onClick={() => !isDeletingTx && setDeleteConfirmTx(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="modal-surface w-full max-w-sm rounded-2xl border border-slate-700/80 p-5 shadow-2xl space-y-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-500 shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">Delete Transaction</h3>
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Irreversible Action</span>
                </div>
              </div>

              <div className="text-xs space-y-1.5 leading-relaxed text-slate-700 dark:text-slate-300">
                <p>
                  Are you sure you want to delete this <span className="font-bold font-mono text-rose-500">{deleteConfirmTx.type || 'BUY'}</span> transaction on <span className="font-mono font-bold">{formatTxDate(deleteConfirmTx.date)}</span>?
                </p>
                {Number(deleteConfirmTx.total_amount) > 0 && (
                  <p className="font-mono text-xs text-emerald-600 dark:text-emerald-400 font-bold">
                    Amount: {isUSStock ? '$' : '₹'}{Number(deleteConfirmTx.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                )}
                <p className="text-[11px] text-slate-500 pt-1">
                  This will permanently remove this transaction and recalculate the position.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  disabled={isDeletingTx}
                  onClick={() => setDeleteConfirmTx(null)}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 px-3.5 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeletingTx}
                  onClick={handleConfirmDeleteTx}
                  className="rounded-xl px-4 py-1.5 text-xs font-black bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-500/25 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isDeletingTx ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
