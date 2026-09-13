import React from 'react';
import { PALETTE } from './reportsConstants';

// Modern Ranked List Component (100% Theme-Adaptive)
export default function RankedBarList({ items, onItemClick, activeIndex, onHoverIndex, formatMoney }) {
  return (
    <div className="space-y-2 pt-1">
      {items.map((item, index) => {
        const isSelected = activeIndex === index;
        const color = item.color || PALETTE[index % PALETTE.length];
        return (
          <div
            key={item.name}
            onClick={() => {
              if (onItemClick) onItemClick(item);
              if (onHoverIndex) onHoverIndex(isSelected ? null : index);
            }}
            onMouseEnter={() => {
              if (onHoverIndex) onHoverIndex(index);
            }}
            onMouseLeave={() => {
              if (onHoverIndex) onHoverIndex(null);
            }}
            className={`group relative overflow-hidden p-3 rounded-2xl border transition-all duration-150 cursor-pointer reports-subcard ${
              isSelected ? 'is-selected ring-2 ring-inset ring-emerald-500' : ''
            }`}
          >
            {/* Subtle Progress Fill Bar */}
            <div 
              className="absolute inset-y-0 left-0 opacity-15 group-hover:opacity-25 transition-all duration-300 rounded-2xl pointer-events-none"
              style={{ 
                width: `${Math.max(2, item.percentage)}%`, 
                backgroundColor: color 
              }}
            />

            <div className="relative flex items-center justify-between gap-3 min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: color }} />
                <div className="min-w-0">
                  <p className="text-xs font-extrabold truncate">
                    {item.name}
                  </p>
                  {item.symbol && item.symbol !== 'OTHER' && (
                    <p className="text-[10px] opacity-60 font-mono font-semibold truncate">{item.symbol}</p>
                  )}
                </div>
              </div>

              <div className="text-right shrink-0 font-mono">
                <p className="text-xs font-black group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                  {formatMoney ? formatMoney(item.value) : item.value}
                </p>
                <p className="text-[10px] font-extrabold text-emerald-600 dark:text-emerald-400">{item.percentage}%</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
