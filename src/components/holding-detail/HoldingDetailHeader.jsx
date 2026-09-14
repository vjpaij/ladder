import React from 'react';
import { Globe, X } from 'lucide-react';
import HoldingLogo from '../HoldingLogo';
import { getQuoteBadgeStatus } from '../../utils/dateFormatter';

export default function HoldingDetailHeader({
  holding,
  accentColor,
  displayHoldingName,
  isEodAsset,
  isUSStock,
  isLight,
  displayCurrency,
  setDisplayCurrency,
  detail,
  fxRate,
  isDisplayUSD,
  fmtUSD,
  fmtINR,
  formatMoney,
  quotePriceVal,
  dayChangeVal,
  dayChangePctVal,
  isFundOrNps,
  m,
  onClose
}) {
  return (
    <div
      className="flex items-center justify-between px-6 py-4 border-b border-slate-800 flex-shrink-0"
      style={{ background: `linear-gradient(135deg, ${accentColor}10 0%, transparent 60%)` }}
    >
      <div className="flex items-center gap-3">
        <HoldingLogo holding={holding} accentColor={accentColor} />
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-white font-black text-[15px] leading-tight">{displayHoldingName}</h2>
            {holding.category_id !== 'epf' && (
              <span
                className="text-[9px] font-black px-2 py-0.5 rounded-full border"
                style={{ background: `${accentColor}20`, borderColor: `${accentColor}40`, color: accentColor }}
              >
                {holding.symbol}
              </span>
            )}
            {holding.exchange && (
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                {holding.exchange}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {holding.category_id !== 'bank' && holding.category_id !== 'epf' && (
              <span className="text-[11px] font-semibold text-slate-400">
                {holding.category_id === 'mutual_funds' ? 'Mutual Fund'
                  : holding.category_id === 'us_stocks' ? 'US Equity'
                  : holding.category_id === 'nps' ? 'NPS Scheme'
                  : holding.category_id === 'loans' ? 'Housing Loan'
                  : holding.category_id === 'credit_cards' ? 'Credit Card'
                  : 'Indian Equity'}
              </span>
            )}
            {!isEodAsset && (Number(holding.quantity) || 0) > 0 && (
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg font-mono border shadow-sm ${
                isLight
                  ? 'bg-slate-100 text-slate-900 border-slate-300'
                  : 'bg-slate-800/90 text-white border-slate-700'
              }`}>
                <span className="text-[10px] uppercase font-bold text-emerald-400">
                  {holding.category_id === 'mutual_funds' || holding.category_id === 'nps' ? 'Units' : 'Shares'}:
                </span>
                <span className="text-sm font-black text-slate-900 dark:text-emerald-300">
                  {Number(holding.quantity).toLocaleString('en-IN', { maximumFractionDigits: 4 })}
                </span>
              </span>
            )}
            {isEodAsset && (
              <span className="text-xs text-slate-300 font-mono font-bold">
                Current Balance: {formatMoney(m?.currentValue ?? holding.current_price ?? 0)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 sm:gap-4">
        {isUSStock && (
          <>
            <div className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono border ${
              isLight
                ? 'bg-purple-100 text-purple-950 border-purple-300 shadow-sm font-black'
                : 'bg-purple-500/15 text-purple-300 border-purple-500/30'
            }`}>
              <Globe className={`w-3.5 h-3.5 ${isLight ? 'text-purple-700' : 'text-purple-400'}`} />
              <span className={`text-[10px] uppercase font-sans font-bold ${isLight ? 'text-purple-800' : 'text-slate-400'}`}>FX:</span>
              <span className={`font-extrabold ${isLight ? 'text-purple-950' : 'text-purple-200'}`}>
                {(detail?.fxRate || fxRate) ? `₹${Number(detail?.fxRate || fxRate).toFixed(2)}` : '...'}
              </span>
            </div>

            <div className={`flex items-center rounded-xl p-1 text-[11px] font-bold border ${
              isLight ? 'bg-slate-200/80 border-slate-300' : 'bg-slate-900 border-slate-700/80'
            }`}>
              <button
                onClick={() => setDisplayCurrency('INR')}
                className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                  displayCurrency === 'INR'
                    ? 'bg-purple-600 text-white shadow-md font-black'
                    : (isLight ? 'text-slate-700 hover:text-slate-950' : 'text-slate-400 hover:text-white')
                }`}
              >
                ₹ INR
              </button>
              <button
                onClick={() => setDisplayCurrency('USD')}
                className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                  displayCurrency === 'USD'
                    ? 'bg-purple-600 text-white shadow-md font-black'
                    : (isLight ? 'text-slate-700 hover:text-slate-950' : 'text-slate-400 hover:text-white')
                }`}
              >
                $ USD
              </button>
            </div>
          </>
        )}

        {/* Live Price Header Display */}
        {!isEodAsset && (
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-2">
              <span className={`text-base sm:text-lg font-black font-mono ${isLight ? 'text-slate-900' : 'text-white'}`}>
                {isDisplayUSD 
                  ? fmtUSD(quotePriceVal) 
                  : isFundOrNps 
                  ? `₹${Number(quotePriceVal).toLocaleString('en-IN', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}` 
                  : fmtINR(quotePriceVal * (isUSStock && !isDisplayUSD ? fxRate : 1))}
              </span>
              {dayChangeVal !== undefined && (
                <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono ${
                  dayChangeVal >= 0 
                    ? (isLight ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30')
                    : (isLight ? 'bg-rose-100 text-rose-700 border border-rose-200' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30')
                }`}>
                  {dayChangeVal >= 0 ? '▲ +' : '▼ '}{isDisplayUSD ? `$${Math.abs(dayChangeVal).toFixed(2)}` : isFundOrNps ? `₹${Math.abs(dayChangeVal).toLocaleString('en-IN', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}` : `₹${Math.abs(dayChangeVal).toFixed(2)}`} ({dayChangeVal >= 0 ? '+' : ''}{dayChangePctVal}%)
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center justify-end">
              {(() => {
                const rawQuoteDate = detail?.quote?.quoteDate || holding?.quote_date || holding?.quoteDate || detail?.quote?.updated;
                const status = getQuoteBadgeStatus(rawQuoteDate);
                if (!status.formattedDate && !status.label) return null;
                
                return (
                  <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                    status.isUpToDate
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                      : 'bg-amber-500/10 text-amber-400/90 border-amber-500/20'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${status.isUpToDate ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    {status.label}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        <button
          onClick={onClose}
          className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          title="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
