import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { X, PlusCircle } from 'lucide-react';

export default function AddAssetModal({ isOpen, onClose, onRefresh }) {
  const [instrumentType, setInstrumentType] = useState('in_stocks');
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [exchange, setExchange] = useState('NSE');
  const [quantity, setQuantity] = useState('');
  const [avgBuyPrice, setAvgBuyPrice] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [sector, setSector] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg(null);

    const numQty = Number(quantity);
    const numPrice = Number(avgBuyPrice);

    if (isNaN(numQty) || numQty <= 0) {
      setErrorMsg('Quantity / Balance must be a positive number greater than zero.');
      return;
    }
    if (isNaN(numPrice) || numPrice < 0) {
      setErrorMsg('Price / Principal must be a valid non-negative number.');
      return;
    }

    try {
      if (instrumentType === 'loans' || instrumentType === 'credit_cards') {
        await axios.post('/api/liabilities', {
          category_id: instrumentType, name: name.trim(),
          lender: symbol.trim() || 'Bank',
          total_principal: numPrice,
          outstanding_balance: numQty,
          interest_rate: 8.5,
          monthly_emi: numQty * 0.02
        });
      } else {
        await axios.post('/api/holdings', {
          category_id: instrumentType, symbol: symbol.trim().toUpperCase(), name: name.trim(), exchange,
          quantity: numQty, avg_buy_price: numPrice,
          current_price: numPrice,
          currency: instrumentType === 'us_stocks' ? 'USD' : 'INR',
          sector: sector.trim() || 'General'
        });
      }
      onRefresh(); onClose();
    } catch (err) {
      setErrorMsg(err.response?.data?.error || err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92 }}
        transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="modal-surface w-full max-w-lg rounded-3xl p-6 border border-slate-800 relative shadow-2xl"
      >
        <button onClick={onClose} className="absolute right-4 top-4 text-slate-500 hover:text-white p-1 rounded-full hover:bg-slate-800">
          <X className="w-4 h-4" />
        </button>

        <h3 className="text-base font-bold text-white mb-0.5 flex items-center gap-2">
          <PlusCircle className="w-4 h-4 text-emerald-400" />
          Add Position
        </h3>
        <p className="text-[10px] text-slate-500 mb-4">Choose category and enter details</p>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          
          <div>
            <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase">Category</label>
            <select
              value={instrumentType}
              onChange={(e) => {
                setInstrumentType(e.target.value);
                if (e.target.value === 'us_stocks') { setExchange('NASDAQ'); setCurrency('USD'); }
                else if (e.target.value === 'mutual_funds') { setExchange('AMFI'); setCurrency('INR'); }
                else { setExchange('NSE'); setCurrency('INR'); }
              }}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-100 font-semibold focus:outline-none focus:border-emerald-500"
            >
              <option value="in_stocks">Indian Stocks (NSE/BSE)</option>
              <option value="us_stocks">US Equity (NASDAQ/NYSE)</option>
              <option value="mutual_funds">Mutual Funds (AMFI)</option>
              <option value="bank">Bank / Fixed Deposit</option>
              <option value="nps">NPS</option>
              <option value="epf">EPF</option>
              <option value="loans">Loan</option>
              <option value="credit_cards">Credit Card</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-slate-400 mb-1">Name</label>
              <input type="text" required placeholder="e.g. Tata Motors" value={name} onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-400 mb-1">Symbol / Ticker</label>
              <input type="text" required placeholder="e.g. TATAMOTORS.NS" value={symbol} onChange={(e) => setSymbol(e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-emerald-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-slate-400 mb-1">Quantity</label>
              <input type="number" step="any" required placeholder="100" value={quantity} onChange={(e) => setQuantity(e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-400 mb-1">Avg Price ({instrumentType === 'us_stocks' ? '$' : '₹'})</label>
              <input type="number" step="any" required placeholder="980.50" value={avgBuyPrice} onChange={(e) => setAvgBuyPrice(e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-emerald-500" />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-slate-400 mb-1">Sector</label>
            <input type="text" placeholder="e.g. Technology" value={sector} onChange={(e) => setSector(e.target.value)}
              className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500" />
          </div>

          {errorMsg && (
            <div className="p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-400 font-bold">
              {errorMsg}
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button type="button" onClick={onClose}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-semibold text-slate-400">
              Cancel
            </button>
            <motion.button
              type="submit"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="px-4 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 font-bold rounded-xl text-xs shadow-lg shadow-emerald-500/20"
            >
              Save
            </motion.button>
          </div>

        </form>
      </motion.div>
    </div>
  );
}
