import fs from 'fs';

// 1. IndianStocksView.jsx
let inPath = 'src/views/IndianStocksView.jsx';
let inCode = fs.readFileSync(inPath, 'utf8');
const inTarget = `                              {h.sector && h.sector !== 'Unknown' && (
                                <div className="mt-0.5">
                                  <span className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-400 block tracking-tight">
                                    {h.sector}
                                  </span>
                                </div>
                              )}`;
const inRepl = `                              {(h.sector || h.market_cap) && (
                                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                  {h.sector && h.sector !== 'Unknown' && (
                                    <span className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-400 tracking-tight">
                                      {h.sector}
                                    </span>
                                  )}
                                  {h.sector && h.sector !== 'Unknown' && h.market_cap && h.market_cap !== 'Unknown' && (
                                    <span className="text-[9px] text-slate-500">•</span>
                                  )}
                                  {h.market_cap && h.market_cap !== 'Unknown' && (
                                    <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                      {h.market_cap}
                                    </span>
                                  )}
                                </div>
                              )}`;
if (inCode.includes(inTarget)) {
  inCode = inCode.replace(inTarget, inRepl);
  fs.writeFileSync(inPath, inCode, 'utf8');
  console.log('Updated IndianStocksView.jsx');
} else {
  console.log('IndianStocksView.jsx target not found');
}

// 2. UsStocksView.jsx
let usPath = 'src/views/UsStocksView.jsx';
let usCode = fs.readFileSync(usPath, 'utf8');
const usTarget = `                            {h.sector && h.sector !== 'Unknown' && (
                              <div className="mt-0.5">
                                <span className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-400 block tracking-tight">
                                  {h.sector}
                                </span>
                              </div>
                            )}`;
const usRepl = `                            {(h.sector || h.market_cap) && (
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                {h.sector && h.sector !== 'Unknown' && (
                                  <span className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-400 tracking-tight">
                                    {h.sector}
                                  </span>
                                )}
                                {h.sector && h.sector !== 'Unknown' && h.market_cap && h.market_cap !== 'Unknown' && (
                                  <span className="text-[9px] text-slate-500">•</span>
                                )}
                                {h.market_cap && h.market_cap !== 'Unknown' && (
                                  <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                    {h.market_cap}
                                  </span>
                                )}
                              </div>
                            )}`;
if (usCode.includes(usTarget)) {
  usCode = usCode.replace(usTarget, usRepl);
  fs.writeFileSync(usPath, usCode, 'utf8');
  console.log('Updated UsStocksView.jsx');
} else {
  console.log('UsStocksView.jsx target not found');
}

// 3. HoldingDetailHeader.jsx
let headerPath = 'src/components/holding-detail/HoldingDetailHeader.jsx';
let headerCode = fs.readFileSync(headerPath, 'utf8');
const headerTarget = `            {holding.sector && holding.sector !== 'Unknown' && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                {holding.sector}
              </span>
            )}`;
const headerRepl = `            {holding.sector && holding.sector !== 'Unknown' && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                {holding.sector}
              </span>
            )}
            {holding.market_cap && holding.market_cap !== 'Unknown' && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-300 border border-blue-700/50">
                {holding.market_cap}
              </span>
            )}`;
if (headerCode.includes(headerTarget) && !headerCode.includes('holding.market_cap')) {
  headerCode = headerCode.replace(headerTarget, headerRepl);
  fs.writeFileSync(headerPath, headerCode, 'utf8');
  console.log('Updated HoldingDetailHeader.jsx');
}

// 4. HoldingTransactionLedger.jsx
let ledgerPath = 'src/components/holding-detail/HoldingTransactionLedger.jsx';
let ledgerCode = fs.readFileSync(ledgerPath, 'utf8');
const ledgerTarget = `          {holding?.sector && holding?.sector !== 'Unknown' && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800/80 text-emerald-400 border border-slate-700/80 normal-case tracking-normal">
              {holding.sector}
            </span>
          )}`;
const ledgerRepl = `          {holding?.sector && holding?.sector !== 'Unknown' && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800/80 text-emerald-400 border border-slate-700/80 normal-case tracking-normal">
              {holding.sector}
            </span>
          )}
          {holding?.market_cap && holding?.market_cap !== 'Unknown' && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-300 border border-blue-700/50 normal-case tracking-normal">
              {holding.market_cap}
            </span>
          )}`;
if (ledgerCode.includes(ledgerTarget) && !ledgerCode.includes('holding?.market_cap')) {
  ledgerCode = ledgerCode.replace(ledgerTarget, ledgerRepl);
  fs.writeFileSync(ledgerPath, ledgerCode, 'utf8');
  console.log('Updated HoldingTransactionLedger.jsx');
}

// 5. StockAnalysisView.jsx
let stockPath = 'src/views/StockAnalysisView.jsx';
let stockCode = fs.readFileSync(stockPath, 'utf8');
const stockTarget1 = `                    {item.sector && item.sector !== 'Unknown' && (
                      <div className="text-[9.5px] font-medium text-[var(--text-secondary)] truncate mt-0.5">
                        {item.sector}
                      </div>
                    )}`;
const stockRepl1 = `                    {(item.sector || item.market_cap) && (
                      <div className="text-[9.5px] font-medium text-[var(--text-secondary)] truncate mt-0.5 flex items-center gap-1">
                        {item.sector && item.sector !== 'Unknown' && <span>{item.sector}</span>}
                        {item.sector && item.sector !== 'Unknown' && item.market_cap && item.market_cap !== 'Unknown' && <span>•</span>}
                        {item.market_cap && item.market_cap !== 'Unknown' && <span className="text-blue-400 font-semibold">{item.market_cap}</span>}
                      </div>
                    )}`;
if (stockCode.includes(stockTarget1)) {
  stockCode = stockCode.replace(stockTarget1, stockRepl1);
}

const stockTarget2 = `                          {selected.sector && (
                            <>
                              <span>•</span>
                              <span>{selected.sector}</span>
                            </>
                          )}`;
const stockRepl2 = `                          {selected.sector && (
                            <>
                              <span>•</span>
                              <span>{selected.sector}</span>
                            </>
                          )}
                          {selected.market_cap && selected.market_cap !== 'Unknown' && (
                            <>
                              <span>•</span>
                              <span className="text-blue-400 font-semibold">{selected.market_cap}</span>
                            </>
                          )}`;
if (stockCode.includes(stockTarget2)) {
  stockCode = stockCode.replace(stockTarget2, stockRepl2);
}
fs.writeFileSync(stockPath, stockCode, 'utf8');
console.log('Updated StockAnalysisView.jsx');

// 6. BuyAnalysisView.jsx
let buyPath = 'src/views/BuyAnalysisView.jsx';
let buyCode = fs.readFileSync(buyPath, 'utf8');
const buyTarget = `                {analysis.sector && analysis.sector !== 'Unknown' && (
                  <>
                    <span className="text-[var(--text-muted)]">•</span>
                    <span className="text-[11px] font-medium text-emerald-400/90">{analysis.sector}</span>
                  </>
                )}`;
const buyRepl = `                {analysis.sector && analysis.sector !== 'Unknown' && (
                  <>
                    <span className="text-[var(--text-muted)]">•</span>
                    <span className="text-[11px] font-medium text-emerald-400/90">{analysis.sector}</span>
                  </>
                )}
                {analysis.market_cap && analysis.market_cap !== 'Unknown' && (
                  <>
                    <span className="text-[var(--text-muted)]">•</span>
                    <span className="text-[11px] font-medium text-blue-400/90">{analysis.market_cap}</span>
                  </>
                )}`;
if (buyCode.includes(buyTarget)) {
  buyCode = buyCode.replace(buyTarget, buyRepl);
  fs.writeFileSync(buyPath, buyCode, 'utf8');
  console.log('Updated BuyAnalysisView.jsx');
}

// 7. TradingJournalView.jsx
let journalPath = 'src/views/TradingJournalView.jsx';
let journalCode = fs.readFileSync(journalPath, 'utf8');
const journalTarget = `                          {sym.sector && sym.sector !== 'Unknown' && (
                            <div className="text-[9.5px] text-emerald-600 dark:text-emerald-400 font-medium truncate max-w-[160px]">
                              {sym.sector}
                            </div>
                          )}`;
const journalRepl = `                          {(sym.sector || sym.market_cap) && (
                            <div className="text-[9.5px] text-[var(--text-secondary)] font-medium truncate max-w-[180px] flex items-center gap-1">
                              {sym.sector && sym.sector !== 'Unknown' && <span className="text-emerald-600 dark:text-emerald-400">{sym.sector}</span>}
                              {sym.sector && sym.sector !== 'Unknown' && sym.market_cap && sym.market_cap !== 'Unknown' && <span>•</span>}
                              {sym.market_cap && sym.market_cap !== 'Unknown' && <span className="text-blue-500 dark:text-blue-400 font-semibold">{sym.market_cap}</span>}
                            </div>
                          )}`;
if (journalCode.includes(journalTarget)) {
  journalCode = journalCode.replace(journalTarget, journalRepl);
  fs.writeFileSync(journalPath, journalCode, 'utf8');
  console.log('Updated TradingJournalView.jsx');
}

// 8. SymbolTradeLogsModal.jsx
let modalPath = 'src/components/SymbolTradeLogsModal.jsx';
let modalCode = fs.readFileSync(modalPath, 'utf8');
const modalTarget = `                {symbolData.sector && symbolData.sector !== 'Unknown' && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                    {symbolData.sector}
                  </span>
                )}`;
const modalRepl = `                {symbolData.sector && symbolData.sector !== 'Unknown' && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                    {symbolData.sector}
                  </span>
                )}
                {symbolData.market_cap && symbolData.market_cap !== 'Unknown' && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-400">
                    {symbolData.market_cap}
                  </span>
                )}`;
if (modalCode.includes(modalTarget) && !modalCode.includes('symbolData.market_cap')) {
  modalCode = modalCode.replace(modalTarget, modalRepl);
  fs.writeFileSync(modalPath, modalCode, 'utf8');
  console.log('Updated SymbolTradeLogsModal.jsx');
}

// Update UsStocksView.jsx line-by-line
let usCode2 = fs.readFileSync('src/views/UsStocksView.jsx', 'utf8');
let lines = usCode2.split(/\r?\n/);
let startIdx = lines.findIndex(l => l.includes('{h.sector && h.sector !== \'Unknown\' && ('));
if (startIdx !== -1) {
  const replLines = [
    '                            {(h.sector || h.market_cap) && (',
    '                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">',
    '                                {h.sector && h.sector !== \'Unknown\' && (',
    '                                  <span className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-400 tracking-tight">',
    '                                    {h.sector}',
    '                                  </span>',
    '                                )}',
    '                                {h.sector && h.sector !== \'Unknown\' && h.market_cap && h.market_cap !== \'Unknown\' && (',
    '                                  <span className="text-[9px] text-slate-500">•</span>',
    '                                )}',
    '                                {h.market_cap && h.market_cap !== \'Unknown\' && (',
    '                                  <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">',
    '                                    {h.market_cap}',
    '                                  </span>',
    '                                )}',
    '                              </div>',
    '                            )}'
  ];
  lines.splice(startIdx, 7, ...replLines);
  fs.writeFileSync('src/views/UsStocksView.jsx', lines.join('\n'), 'utf8');
  console.log('UsStocksView.jsx updated line-by-line successfully!');
}
