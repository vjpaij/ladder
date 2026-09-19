import React from 'react';
import { DollarSign, ArrowUpCircle, ArrowDownCircle, TrendingUp, Calendar } from 'lucide-react';
import formatDateDDMMYYYY from '../../utils/dateFormatter';

export function fmtINR(val) {
  const n = Number(val) || 0;
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtUSD(val) {
  const n = Number(val) || 0;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatTxDate(dateStr) {
  if (!dateStr) return '—';
  const parts = dateStr.split('T')[0].split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateStr;
}

export function formatAxisValue(value, isUSD) {
  const n = Number(value) || 0;
  if (isUSD) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function MetricCard({ label, value, sub, color = 'text-white', icon: Icon, positive, accent }) {
  const posClass = positive === true ? 'text-emerald-400' : positive === false ? 'text-rose-400' : color;
  const accentBar = accent || (positive === true ? 'bg-emerald-500' : positive === false ? 'bg-rose-500' : 'bg-slate-600');
  return (
    <div className="glass-card rounded-xl border border-slate-800/60 flex overflow-hidden h-full group hover:border-slate-700/80 transition-all duration-300">
      <div className={`w-1 shrink-0 ${accentBar}`} />
      <div className="flex flex-col py-3 px-3.5 flex-1 min-w-0">
        <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-500 mb-1">{label}</span>
        <div className={`text-[15px] font-black font-mono ${posClass} leading-tight`}>{value}</div>
        {sub && <div className="mt-auto pt-1.5">{typeof sub === 'string' ? <span className="text-[10px] text-slate-500 font-mono">{sub}</span> : sub}</div>}
      </div>
    </div>
  );
}

export function TxBadge({ type }) {
  const cfg = {
    BUY:          { cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: 'BUY' },
    SELL:         { cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30',          label: 'SELL' },
    REDEEM:       { cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30',          label: 'SELL' },
    REDEMPTION:   { cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30',          label: 'SELL' },
    DIVIDEND:     { cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30',       label: 'DIV' },
    SPLIT:        { cls: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',     label: 'SPLIT' },
    BONUS:        { cls: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',          label: 'BONUS' },
    CREDIT:       { cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: 'DEPOSIT' },
    DEPOSIT:      { cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: 'DEPOSIT' },
    DEBIT:        { cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30',          label: 'WITHDRAW' },
    WITHDRAWAL:   { cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30',          label: 'WITHDRAW' },
    CONTRIBUTION: { cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: 'CONTRIB' },
    INTEREST:     { cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: 'INTEREST' },
    BORROW:       { cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30',          label: 'BORROW' },
    EMI_PAYMENT:  { cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30',              label: 'EMI' },
    CHARGE:       { cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30',       label: 'CHARGE' },
    PAYMENT:      { cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: 'PAYMENT' },
  };
  const c = cfg[type?.toUpperCase()] || { cls: 'bg-slate-500/15 text-slate-400 border-slate-500/30', label: type || 'TX' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black border ${c.cls}`}>
      {c.label}
    </span>
  );
}

export function ChartTooltip({ active, payload, label, isUSD }) {
  if (!active || !payload?.length) return null;
  const fmt = isUSD ? fmtUSD : fmtINR;
  return (
    <div className="bg-slate-900/95 border border-slate-700 rounded-xl px-3 py-2 text-xs shadow-2xl">
      <div className="text-slate-400 mb-1.5 font-mono">{formatDateDDMMYYYY(label)}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
          <span className="text-slate-300">{p.name}:</span>
          <span className="font-black" style={{ color: p.color }}>{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function ActualChartTooltip({ active, payload, label, isUSD, isFundOrNps, timelineData }) {
  if (!active || !payload?.length) return null;
  const fmt = isUSD ? fmtUSD : fmtINR;
  const rawPrice = payload[0]?.value;
  const priceStr = isUSD 
    ? `$${Number(rawPrice).toFixed(2)}` 
    : isFundOrNps 
    ? `₹${Number(rawPrice).toFixed(4)}` 
    : `₹${Number(rawPrice).toFixed(2)}`;

  const currentItem = timelineData?.find(d => d.label === label);
  const events = currentItem?.events || [];

  return (
    <div className="bg-slate-900/95 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs shadow-2xl min-w-[200px]">
      <div className="text-slate-400 mb-1.5 font-mono flex items-center justify-between">
        <span>{formatDateDDMMYYYY(label)}</span>
        <span className="font-black text-sky-400">{priceStr}</span>
      </div>
      {events.length > 0 ? (
        <div className="border-t border-slate-800 pt-2 space-y-1.5">
          {events.map((ev, idx) => {
            const isBuy = ev.type === 'BUY';
            const isSell = ev.type === 'SELL';
            const isSplit = ev.type === 'SPLIT';
            const isBonus = ev.type === 'BONUS';
            const isDiv = ev.type === 'DIVIDEND';

            let badgeColor = 'bg-slate-500/20 text-slate-300 border-slate-500/30';
            if (isBuy) badgeColor = 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
            if (isSell) badgeColor = 'bg-rose-500/20 text-rose-400 border-rose-500/30';
            if (isSplit) badgeColor = 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30';
            if (isBonus) badgeColor = 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
            if (isDiv) badgeColor = 'bg-amber-500/20 text-amber-400 border-amber-500/30';

            const qty = ev.quantity ?? ev.qty ?? 0;
            const price = isUSD ? (ev.priceUSD ?? ev.price ?? 0) : (ev.priceINR ?? ev.price ?? 0);
            const divAmount = isUSD
              ? (ev.amountUSD ?? ev.amount ?? ev.priceUSD ?? ev.price ?? 0)
              : (ev.amountINR ?? ev.amount ?? ev.priceINR ?? ev.price ?? 0);

            let detailText;
            if (isSplit) {
              detailText = ev.notes || 'Split';
            } else if (isBonus) {
              detailText = qty > 0 ? `+${qty} Shares` : (ev.notes || 'Bonus Issue');
            } else if (isDiv) {
              detailText = `+${fmt(divAmount)}`;
            } else {
              detailText = `${qty} @ ${fmt(price)}`;
            }

            return (
              <div key={idx} className="flex items-center justify-between text-[11px] gap-2">
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-black border ${badgeColor}`}>
                  {ev.type}
                </span>
                <span className="font-mono font-bold text-slate-200">
                  {detailText}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ActualEventDot(props) {
  const { cx, cy, payload } = props;
  if (!payload?.events || payload.events.length === 0) return null;

  const events = payload.events;
  const hasBuy = events.some(e => e.type === 'BUY');
  const hasSell = events.some(e => e.type === 'SELL');
  const hasSplit = events.some(e => e.type === 'SPLIT');
  const hasBonus = events.some(e => e.type === 'BONUS');
  const hasDiv = events.some(e => e.type === 'DIVIDEND');

  let fill = '#38bdf8';
  if (hasSplit) fill = '#818cf8';
  else if (hasBonus) fill = '#22d3ee';
  else if (hasDiv) fill = '#fbbf24';
  else if (hasBuy && hasSell) fill = '#e2e8f0';
  else if (hasBuy) fill = '#34d399';
  else if (hasSell) fill = '#f87171';

  return (
    <g>
      <circle cx={cx} cy={cy} r={6} fill={fill} stroke="#0f172a" strokeWidth={2} className="cursor-pointer" />
      <circle cx={cx} cy={cy} r={2.5} fill="#0f172a" />
    </g>
  );
}
