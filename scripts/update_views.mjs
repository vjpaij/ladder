/**
 * scripts/update_views.mjs
 * Updates frontend views with dedicated sector display.
 */
import fs from 'fs';

// 1. Update UsStocksView.jsx
{
  const file = 'src/views/UsStocksView.jsx';
  let content = fs.readFileSync(file, 'utf8');
  const targetPattern = /<span className="text-\[10px\] text-slate-500 font-mono">\{h\.symbol\}\{h\.sector && h\.sector !== 'Unknown' \? ` • \$\{h\.sector\}` : ''\}<\/span>/;
  const replacement = '<span className="text-[10.5px] text-slate-400 font-mono font-bold">{h.symbol}</span>';
  
  if (targetPattern.test(content)) {
    content = content.replace(targetPattern, replacement);
    const divEnd = '                              })()}\r\n                            </div>';
    const divEndLF = '                              })()}\n                            </div>';
    const sectorDiv = '\r\n                            {h.sector && h.sector !== \'Unknown\' && (\r\n                              <div className="mt-0.5">\r\n                                <span className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-400 block tracking-tight">\r\n                                  {h.sector}\r\n                                </span>\r\n                              </div>\r\n                            )}';
    const sectorDivLF = '\n                            {h.sector && h.sector !== \'Unknown\' && (\n                              <div className="mt-0.5">\n                                <span className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-400 block tracking-tight">\n                                  {h.sector}\n                                </span>\n                              </div>\n                            )}';
    
    if (content.includes(divEnd)) {
      content = content.replace(divEnd, divEnd + sectorDiv);
    } else if (content.includes(divEndLF)) {
      content = content.replace(divEndLF, divEndLF + sectorDivLF);
    }
    fs.writeFileSync(file, content, 'utf8');
    console.log('✓ Updated UsStocksView.jsx');
  } else {
    console.log('UsStocksView target pattern not matched or already updated');
  }
}

// 2. Update HoldingDetailHeader.jsx
{
  const file = 'src/components/holding-detail/HoldingDetailHeader.jsx';
  let content = fs.readFileSync(file, 'utf8');
  const target = '{holding.category_id !== \'bank\' && holding.category_id !== \'epf\' && (';
  const sectorBadgeSnippet = `{holding.sector && holding.sector !== 'Unknown' && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                {holding.sector}
              </span>
            )}
            {holding.category_id !== 'bank' && holding.category_id !== 'epf' && (`;
  if (content.includes(target) && !content.includes('holding.sector && holding.sector !== \'Unknown\'')) {
    content = content.replace(target, sectorBadgeSnippet);
    fs.writeFileSync(file, content, 'utf8');
    console.log('✓ Updated HoldingDetailHeader.jsx');
  } else {
    console.log('HoldingDetailHeader already updated or pattern not matched');
  }
}

// 3. Update HoldingTransactionLedger.jsx
{
  const file = 'src/components/holding-detail/HoldingTransactionLedger.jsx';
  let content = fs.readFileSync(file, 'utf8');
  const target = `Transaction Ledger ({sortedTxs.length} {sortedTxs.length === 1 ? 'record' : 'records'})`;
  const replacement = `Transaction Ledger ({sortedTxs.length} {sortedTxs.length === 1 ? 'record' : 'records'})
          {holding?.sector && holding?.sector !== 'Unknown' && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800/80 text-emerald-400 border border-slate-700/80 normal-case tracking-normal">
              {holding.sector}
            </span>
          )}`;
  if (content.includes(target) && !content.includes('holding?.sector && holding?.sector !== \'Unknown\'')) {
    content = content.replace(target, replacement);
    fs.writeFileSync(file, content, 'utf8');
    console.log('✓ Updated HoldingTransactionLedger.jsx');
  } else {
    console.log('HoldingTransactionLedger already updated or pattern not matched');
  }
}

// 4. Update StockAnalysisView.jsx
{
  const file = 'src/views/StockAnalysisView.jsx';
  let content = fs.readFileSync(file, 'utf8');
  const target = `<div className="text-[10px] text-[var(--text-muted)] flex items-center gap-1.5 font-mono">
                      <span>{item.symbol}</span>
                      <span>•</span>
                      <span>{item.currentWeightPct.toFixed(1)}% wt</span>
                    </div>`;
  const replacement = `<div className="text-[10px] text-[var(--text-muted)] flex items-center gap-1.5 font-mono">
                      <span>{item.symbol}</span>
                      <span>•</span>
                      <span>{item.currentWeightPct.toFixed(1)}% wt</span>
                    </div>
                    {item.sector && item.sector !== 'Unknown' && (
                      <div className="text-[9.5px] font-medium text-[var(--text-secondary)] truncate mt-0.5">
                        {item.sector}
                      </div>
                    )}`;
  if (content.includes(target) && !content.includes('item.sector && item.sector !== \'Unknown\'')) {
    content = content.replace(target, replacement);
    fs.writeFileSync(file, content, 'utf8');
    console.log('✓ Updated StockAnalysisView.jsx');
  } else {
    console.log('StockAnalysisView already updated or pattern not matched');
  }
}

// 5. Update BuyAnalysisView.jsx
{
  const file = 'src/views/BuyAnalysisView.jsx';
  let content = fs.readFileSync(file, 'utf8');
  const target = `<p className="text-xs text-[var(--text-secondary)] truncate mt-0.5">{analysis.name}</p>`;
  const replacement = `<p className="text-xs text-[var(--text-secondary)] truncate mt-0.5 flex items-center gap-1.5">
                <span>{analysis.name}</span>
                {analysis.sector && analysis.sector !== 'Unknown' && (
                  <>
                    <span className="text-[var(--text-muted)]">•</span>
                    <span className="text-[11px] font-medium text-emerald-400/90">{analysis.sector}</span>
                  </>
                )}
              </p>`;
  if (content.includes(target) && !content.includes('analysis.sector && analysis.sector !== \'Unknown\'')) {
    content = content.replace(target, replacement);
    fs.writeFileSync(file, content, 'utf8');
    console.log('✓ Updated BuyAnalysisView.jsx');
  } else {
    console.log('BuyAnalysisView already updated or pattern not matched');
  }
}

// 6. Update TradingJournalView.jsx
{
  const file = 'src/views/TradingJournalView.jsx';
  let content = fs.readFileSync(file, 'utf8');
  
  // In Table View: under stock name, show sector
  const targetTable = `<div className="text-[10px] text-[var(--text-muted)] truncate max-w-[160px] font-medium">
                            {sym.name || sym.symbol}
                          </div>`;
  const replacementTable = `<div className="text-[10px] text-[var(--text-muted)] truncate max-w-[160px] font-medium">
                            {sym.name || sym.symbol}
                          </div>
                          {sym.sector && sym.sector !== 'Unknown' && (
                            <div className="text-[9.5px] text-emerald-600 dark:text-emerald-400 font-medium truncate max-w-[160px]">
                              {sym.sector}
                            </div>
                          )}`;
  if (content.includes(targetTable) && !content.includes('sym.sector && sym.sector !== \'Unknown\'')) {
    content = content.replace(targetTable, replacementTable);
  }

  // In Card View: beside sym.name, show sector
  const targetCard = `<div className="text-[11px] text-[var(--text-secondary)] truncate max-w-[150px] font-medium">
                        {sym.name || sym.symbol}
                      </div>`;
  const replacementCard = `<div className="text-[11px] text-[var(--text-secondary)] truncate max-w-[150px] font-medium">
                        {sym.name || sym.symbol}
                      </div>
                      {sym.sector && sym.sector !== 'Unknown' && (
                        <div className="text-[9.5px] text-emerald-600 dark:text-emerald-400 font-medium truncate max-w-[150px]">
                          {sym.sector}
                        </div>
                      )}`;
  if (content.includes(targetCard) && !content.includes('sym.sector && sym.sector !== \'Unknown\'')) {
    content = content.replace(targetCard, replacementCard);
  }

  fs.writeFileSync(file, content, 'utf8');
  console.log('✓ Updated TradingJournalView.jsx');
}

// 7. Update SymbolTradeLogsModal.jsx
{
  const file = 'src/components/SymbolTradeLogsModal.jsx';
  let content = fs.readFileSync(file, 'utf8');
  const target = `<span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-[var(--border-color)] bg-white/[0.04] text-[var(--text-secondary)]">
                  {symbolData.market === 'US' ? '🇺🇸 US Equity' : '🇮🇳 Indian Equity'}
                </span>`;
  const replacement = `<span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-[var(--border-color)] bg-white/[0.04] text-[var(--text-secondary)]">
                  {symbolData.market === 'US' ? '🇺🇸 US Equity' : '🇮🇳 Indian Equity'}
                </span>
                {symbolData.sector && symbolData.sector !== 'Unknown' && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                    {symbolData.sector}
                  </span>
                )}`;
  if (content.includes(target) && !content.includes('symbolData.sector && symbolData.sector !== \'Unknown\'')) {
    content = content.replace(target, replacement);
    fs.writeFileSync(file, content, 'utf8');
    console.log('✓ Updated SymbolTradeLogsModal.jsx');
  } else {
    console.log('SymbolTradeLogsModal already updated or pattern not matched');
  }
}
