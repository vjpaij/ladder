import fs from 'fs';

let path = 'src/components/ActionPlanModal.jsx';
let code = fs.readFileSync(path, 'utf8');

// 1. Immediate Buys
code = code.replace(
  `<td className="py-2.5 px-3 text-[var(--text-muted)] truncate max-w-[160px]" title={b.name}>
                              {b.name}
                            </td>`,
  `<td className="py-2.5 px-3 text-[var(--text-muted)] max-w-[180px]" title={b.name}>
                              <div className="font-medium truncate">{b.name}</div>
                              {(b.sector || b.market_cap) && (
                                <div className="text-[9.5px] font-semibold text-[var(--text-secondary)] truncate mt-0.5 flex items-center gap-1">
                                  {b.sector && <span className="text-emerald-500/90">{b.sector}</span>}
                                  {b.sector && b.market_cap && <span>•</span>}
                                  {b.market_cap && <span className="text-blue-400">{b.market_cap}</span>}
                                </div>
                              )}
                            </td>`
);

// 2. Queued Buys
code = code.replace(
  `<td className="py-2.5 px-3 text-[var(--text-muted)] truncate max-w-[180px]" title={q.name}>
                            {q.name}
                          </td>`,
  `<td className="py-2.5 px-3 text-[var(--text-muted)] max-w-[180px]" title={q.name}>
                            <div className="font-medium truncate">{q.name}</div>
                            {(q.sector || q.market_cap) && (
                              <div className="text-[9.5px] font-semibold text-[var(--text-secondary)] truncate mt-0.5 flex items-center gap-1">
                                {q.sector && <span className="text-cyan-500/90">{q.sector}</span>}
                                {q.sector && q.market_cap && <span>•</span>}
                                {q.market_cap && <span className="text-blue-400">{q.market_cap}</span>}
                              </div>
                            )}
                          </td>`
);

// 3. Sells
code = code.replace(
  `<td className="py-2.5 px-3 font-mono font-bold text-[var(--text-primary)]">
                            <div>{s.symbol}</div>
                            <div className="text-[10px] text-[var(--text-muted)] font-normal truncate max-w-[120px]">{s.name}</div>
                          </td>`,
  `<td className="py-2.5 px-3 font-mono font-bold text-[var(--text-primary)]">
                            <div>{s.symbol}</div>
                            <div className="text-[10px] text-[var(--text-muted)] font-normal truncate max-w-[140px]">{s.name}</div>
                            {(s.sector || s.market_cap) && (
                              <div className="text-[9px] font-semibold text-[var(--text-secondary)] truncate font-sans mt-0.5 flex items-center gap-1">
                                {s.sector && <span className="text-emerald-500/90">{s.sector}</span>}
                                {s.sector && s.market_cap && <span>•</span>}
                                {s.market_cap && <span className="text-blue-400">{s.market_cap}</span>}
                              </div>
                            )}
                          </td>`
);

fs.writeFileSync(path, code, 'utf8');
console.log('ActionPlanModal.jsx updated successfully!');
