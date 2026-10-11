import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Activity, BarChart3, CandlestickChart, CheckCircle2, Clock3, History, Search, Settings2, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useThemeAuth } from '../context/ThemeAuthContext';
import HoldingLogo from '../components/HoldingLogo';
import { AnimatedPage, AnimatedItem } from '../components/AnimatedPage';

const STATE_META = {
  NORMAL: { label: 'Monitor', tone: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
  WATCH: { label: 'Watch', tone: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
  TECHNICAL_TRIM_CANDIDATE: { label: 'Exit review', tone: 'text-rose-300 border-rose-500/30 bg-rose-500/10' },
  PORTFOLIO_RISK_TRIM: { label: 'Position size', tone: 'text-orange-300 border-orange-500/30 bg-orange-500/10' },
  DATA_UNAVAILABLE: { label: 'Insufficient history', tone: 'text-slate-400 border-slate-600/50 bg-white/[0.03]' }
};

function money(formatMoney, amount, compact = false) {
  return amount === null || amount === undefined ? '—' : formatMoney(amount, compact);
}

function Metric({ label, value, detail, tone = 'text-inherit' }) {
  return <div className="reports-subcard rounded-2xl border border-slate-800/70 p-3.5 min-w-0">
    <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">{label}</div>
    <div className={`mt-1.5 text-base font-black font-mono truncate ${tone}`}>{value}</div>
    {detail && <div className="mt-1 text-[9px] leading-relaxed text-slate-500">{detail}</div>}
  </div>;
}

function StateBadge({ state }) {
  const meta = STATE_META[state] || STATE_META.DATA_UNAVAILABLE;
  return <span className={`rounded-full border px-2 py-1 text-[9px] font-bold whitespace-nowrap ${meta.tone}`}>{meta.label}</span>;
}

function actionInstruction(item) {
  if (!item) return '';
  if (item.state === 'DATA_UNAVAILABLE') return `ACTION: Do not trade from this screen. Refresh or reconcile the stored price history first. ${item.invalidation || ''}`;
  if (item.state === 'WATCH') return 'ACTION: No sale is triggered. Review the holding and wait for another completed weekly close; the rule requires persistent weakness before an Exit review.';
  if (item.state === 'TECHNICAL_TRIM_CANDIDATE') return item.suggestedSellQuantity
    ? `ACTION: Review a sale of ${item.suggestedSellQuantity.toLocaleString()} shares. This is a review quantity; place any order yourself.`
    : 'ACTION: Review the holding and verify company information. No sell quantity is validated, so this screen is not telling you to sell a specific number of shares.';
  if (item.state === 'PORTFOLIO_RISK_TRIM') return item.suggestedSellQuantity
    ? `ACTION: Your configured position limit implies selling ${item.suggestedSellQuantity.toLocaleString()} shares. Verify the quote and tax impact; no order is placed.`
    : 'ACTION: Review your configured position limit; no share quantity is available.';
  return 'ACTION: No price-rule sale is triggered. Review company information and your own plan; Monitor is not a recommendation to hold.';
}

function BacktestPanel({ report, formatMoney }) {
  const [expanded, setExpanded] = useState(false);
  const test = report?.periods?.test;
  const candidate25 = test?.candidates?.find(item => item.trimFraction === report?.exploratoryTrimFraction);
  const hold = test?.buyAndHold;
  const missedRate = candidate25?.exits ? candidate25.exitsWith10PctPlusForwardUpside / candidate25.exits * 100 : null;
  return <section className="glass-card rounded-3xl border border-slate-800 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex gap-2.5"><BarChart3 className="w-4 h-4 mt-0.5 text-cyan-400" /><div><h3 className="text-sm font-bold text-inherit">Historical backtest</h3><p className="mt-1 text-[10px] text-slate-500">Frozen rule · validation-selected scenario · separate held-out years</p></div></div>
      <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold ${report?.passedOutOfSample ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`}>
        {report?.passedOutOfSample ? 'Passed exploratory checks' : 'No validated sell size'}
      </span>
    </div>
    {test && <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
      <Metric label="Held-out sample" value={`${test.eligibleSymbols} stocks`} detail="Current holdings with enough history" />
      <Metric label="Buy & hold return" value={`${hold?.avgCagrPct ?? '—'}% / yr`} detail={`Average max drawdown ${hold?.avgMaxDrawdownPct ?? '—'}%`} />
      <Metric label="Best drawdown trade-off" value={candidate25 ? `${candidate25.avgCagrPct}% / yr` : 'Not available'} detail={candidate25 ? `${candidate25.avgMaxDrawdownPct}% drawdown · ${Math.round(candidate25.trimFraction * 100)}% trim` : 'No eligible scenario'} />
      <Metric label="Sold, then rose 10%+" value={missedRate === null ? '—' : `${missedRate.toFixed(1)}% of exits`} detail="Within about six months after exit" />
    </div>}
    <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-3 text-[10px] leading-relaxed text-slate-400">{report?.outcome}</div>
    <button onClick={() => setExpanded(value => !value)} className="mt-3 text-[10px] font-bold text-cyan-300 hover:text-cyan-200">{expanded ? 'Hide period comparison' : 'Show training, validation and test results'}</button>
    {expanded && <div className="mt-3 overflow-x-auto rounded-xl border border-slate-800">
      <table className="min-w-[620px] w-full text-[10px]">
        <thead className="bg-slate-950/40 text-slate-500"><tr><th className="p-2.5 text-left">Period / method</th><th className="p-2.5 text-right">Stocks</th><th className="p-2.5 text-right">Avg CAGR</th><th className="p-2.5 text-right">Avg max drawdown</th><th className="p-2.5 text-right">Avg trades</th><th className="p-2.5 text-right">Beat hold</th></tr></thead>
        <tbody>{Object.entries(report.periods).flatMap(([id, period]) => [
          <tr key={`${id}-hold`} className="border-t border-slate-800/70"><td className="p-2.5 text-slate-300">{period.label} · buy & hold</td><td className="p-2.5 text-right">{period.buyAndHold?.symbols ?? 0}</td><td className="p-2.5 text-right">{period.buyAndHold?.avgCagrPct ?? '—'}%</td><td className="p-2.5 text-right">{period.buyAndHold?.avgMaxDrawdownPct ?? '—'}%</td><td className="p-2.5 text-right">0</td><td className="p-2.5 text-right">—</td></tr>,
          ...period.candidates.map(candidate => <tr key={`${id}-${candidate.trimFraction}`} className="border-t border-slate-800/70"><td className="p-2.5 text-slate-400">{period.label} · trim {Math.round(candidate.trimFraction * 100)}% on confirmed breakdown</td><td className="p-2.5 text-right">{candidate.symbols ?? 0}</td><td className="p-2.5 text-right">{candidate.avgCagrPct ?? '—'}%</td><td className="p-2.5 text-right">{candidate.avgMaxDrawdownPct ?? '—'}%</td><td className="p-2.5 text-right">{candidate.avgTrades ?? '—'}</td><td className="p-2.5 text-right">{candidate.beatBuyAndHold ?? '—'}/{candidate.symbols ?? 0}</td></tr>)
        ])}</tbody>
      </table>
    </div>}
    <ul className="mt-3 list-disc pl-4 space-y-1 text-[9px] leading-relaxed text-slate-500">{report?.limitations?.map(item => <li key={item}>{item}</li>)}</ul>
  </section>;
}

export default function StockAnalysisView({ holdings = [], onSelectHolding }) {
  const { formatMoney } = useThemeAuth();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [maxWeight, setMaxWeight] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMessage, setConfigMessage] = useState('');

  const reload = async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const response = await axios.get('/api/stock-intelligence/overview');
      setData(response.data);
      setMaxWeight(response.data.config?.maxPositionWeightPct ?? '');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not load stock analysis.');
    } finally { if (!silent) setLoading(false); }
  };
  useEffect(() => {
    reload();
    const timer = setInterval(() => reload(true), 15 * 60 * 1000);
    const refreshOnFocus = () => { if (document.visibilityState === 'visible') reload(true); };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
    };
  }, []);

  const analyses = data?.analyses || [];
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return analyses.filter(item => !term || `${item.name} ${item.symbol} ${item.sector || ''}`.toLowerCase().includes(term))
      .sort((a, b) => {
        const severity = { TECHNICAL_TRIM_CANDIDATE: 0, PORTFOLIO_RISK_TRIM: 1, WATCH: 2, DATA_UNAVAILABLE: 3, NORMAL: 4 };
        return (severity[a.state] ?? 5) - (severity[b.state] ?? 5) || b.currentWeightPct - a.currentWeightPct;
      });
  }, [analyses, query]);
  const activeId = visible.some(item => item.holdingId === selectedId) ? selectedId : visible[0]?.holdingId || '';
  const selected = analyses.find(item => item.holdingId === activeId);

  useEffect(() => {
    if (!activeId) { setHistory([]); return; }
    axios.get('/api/stock-intelligence/history', { params: { holdingId: activeId } })
      .then(response => setHistory(response.data.events || []))
      .catch(() => setHistory([]));
  }, [activeId]);

  const saveRiskLimit = async event => {
    event.preventDefault();
    setSavingConfig(true); setConfigMessage('');
    try {
      const response = await axios.post('/api/stock-intelligence/config', { maxPositionWeightPct: maxWeight });
      setData(current => ({ ...current, config: response.data.config }));
      setConfigMessage('Saved. Reloading position checks…');
      await reload();
    } catch (err) {
      setConfigMessage(err.response?.data?.error || 'Could not save position limit.');
    } finally { setSavingConfig(false); }
  };
  const clearRiskLimit = async () => {
    setSavingConfig(true); setConfigMessage('');
    try {
      await axios.post('/api/stock-intelligence/config', { maxPositionWeightPct: null });
      setMaxWeight('');
      setConfigMessage('Position limit disabled.');
      await reload(true);
    } catch (err) {
      setConfigMessage(err.response?.data?.error || 'Could not clear the position limit.');
    } finally { setSavingConfig(false); }
  };

  const summary = data?.summary;
  const sectorExposure = useMemo(() => {
    const grouped = new Map();
    analyses.forEach(item => {
      const sector = item.sector || 'Sector not recorded';
      grouped.set(sector, (grouped.get(sector) || 0) + (Number(item.currentValueINR) || 0));
    });
    return [...grouped.entries()].map(([sector, value]) => ({ sector, value, weight: summary?.totalValueINR ? value / summary.totalValueINR * 100 : 0 })).sort((a, b) => b.value - a.value);
  }, [analyses, summary?.totalValueINR]);
  const selectedState = selected && (STATE_META[selected.state] ? selected.state : 'DATA_UNAVAILABLE');
  const priceChart = selected?.history || [];
  const returnTone = value => value === null || value === undefined ? 'text-slate-400' : value >= 0 ? 'text-emerald-400' : 'text-rose-400';

  return <AnimatedPage className="space-y-5">
    <AnimatedItem>
      <div className="glass-card rounded-3xl border border-slate-800 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div><div className="flex items-center gap-2 text-emerald-400 mb-2"><CandlestickChart className="w-4 h-4" /><span className="text-[10px] font-bold tracking-[0.16em] uppercase">Executive</span></div><h2 className="text-2xl font-black text-inherit">Stock Analysis</h2><p className="mt-1 text-[11px] text-slate-500">Price trend and position review for your Indian equity holdings</p><p className="mt-1 text-[9px] text-slate-500">Screen refreshes every 15 minutes while open. Market history is not fetched on that timer; it depends on the app's price refresh.</p></div>
          <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-bold text-cyan-200">{data?.ruleVersion || 'Loading rules'}</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
          <Metric label="Active holdings" value={summary?.activePositions ?? '—'} detail={`${summary?.withPriceHistory ?? 0} have price history`} />
          <Metric label="Indian equity value" value={money(formatMoney, summary?.totalValueINR)} />
          <Metric label="Open P&L" value={money(formatMoney, summary?.unrealizedPnlINR)} tone={summary?.unrealizedPnlINR >= 0 ? 'text-emerald-400' : 'text-rose-400'} detail={`Cost ${money(formatMoney, summary?.totalCostINR)}`} />
          <Metric label="Positions for review" value={(summary?.states?.TECHNICAL_TRIM_CANDIDATE || 0) + (summary?.states?.PORTFOLIO_RISK_TRIM || 0)} detail={`Counts stock positions, not shares · ${summary?.states?.WATCH || 0} watch · ${summary?.states?.NORMAL || 0} monitor`} />
        </div>
      </div>
    </AnimatedItem>

    {error && <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">{error}</div>}

    <BacktestPanel report={data?.backtest} formatMoney={formatMoney} />

    <div className="grid grid-cols-1 xl:grid-cols-[minmax(260px,0.82fr)_minmax(0,2fr)] gap-5">
      <AnimatedItem>
        <section className="glass-card rounded-3xl border border-slate-800 p-4 h-full">
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-inherit">Your Indian stocks</h3><span className="text-[10px] text-slate-500">{visible.length}</span></div>
          <div className="relative mb-3"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search holdings" className="w-full rounded-xl border border-slate-800 bg-slate-950/30 py-2 pl-9 pr-3 text-xs text-inherit outline-none focus:border-emerald-500/50" /></div>
          <div className="space-y-1 max-h-[600px] overflow-y-auto custom-scrollbar">
            {visible.map(item => <button key={item.holdingId} onClick={() => setSelectedId(item.holdingId)} className={`w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors ${activeId === item.holdingId ? 'bg-emerald-500/10 border border-emerald-500/25' : 'border border-transparent hover:bg-white/[0.03]'}`}>
              <HoldingLogo holding={item} className="w-8 h-8 rounded-xl" />
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-inherit">{item.name}</span><span className="block text-[10px] text-slate-500">{item.symbol} · {item.currentWeightPct.toFixed(1)}% of Indian equity</span></span>
              <StateBadge state={item.state} />
            </button>)}
            {visible.length === 0 && !loading && <div className="py-10 text-center text-xs text-slate-500">No active Indian equity holdings match.</div>}
            {loading && <div className="py-10 text-center text-xs text-slate-500">Evaluating stored history…</div>}
          </div>
        </section>
      </AnimatedItem>

      <AnimatedItem delay={0.05}>
        <div className="space-y-5">
          <section className="glass-card rounded-3xl border border-slate-800 p-5">
            {!selected ? <div className="py-12 text-center text-sm text-slate-500">No active Indian stock positions found.</div> : <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><div className="flex flex-wrap items-center gap-2"><Activity className="w-4 h-4 text-emerald-400" /><h3 className="text-base font-black text-inherit">{selected.name}</h3><span className="text-[10px] text-slate-500">{selected.symbol}</span><StateBadge state={selectedState} /></div><div className="mt-1 text-[10px] text-slate-500">{selected.quantity.toLocaleString()} shares · {selected.currentWeightPct.toFixed(2)}% of Indian equity · quote date {selected.quoteDate || 'unknown'}</div></div>
                <div className="text-right"><div className="text-lg font-black font-mono text-inherit">{money(formatMoney, selected.currentValueINR)}</div><div className="text-[10px] text-slate-500">{money(formatMoney, selected.currentPrice, true)} per share</div></div>
              </div>

                <div className={`mt-4 rounded-2xl border p-3.5 ${selected.state === 'TECHNICAL_TRIM_CANDIDATE' || selected.state === 'PORTFOLIO_RISK_TRIM' ? 'border-rose-500/25 bg-rose-500/[0.06]' : selected.state === 'WATCH' || selected.state === 'DATA_UNAVAILABLE' ? 'border-amber-500/25 bg-amber-500/[0.05]' : 'border-slate-700 bg-slate-900/30'}`}>
                  <div className="flex gap-2.5"><ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-300" /><div><div className="text-[10px] uppercase font-bold tracking-wider text-slate-300">What the system is telling you</div><p className="mt-1 text-xs leading-relaxed text-slate-200">{selected.explanation}</p>
                  <p className="mt-2 rounded-xl border border-slate-700/70 bg-slate-950/40 p-2.5 text-[10px] font-semibold leading-relaxed text-slate-200">{actionInstruction(selected)}</p>
                  {selected.suggestedSellQuantity && <p className="mt-2 text-xs font-bold text-rose-200">Review quantity: {selected.suggestedSellQuantity.toLocaleString()} shares · reference proceeds {money(formatMoney, selected.estimatedGrossProceedsINR)} gross</p>}
                  {selected.scenarioSellQuantity !== null && selected.scenarioSellQuantity !== undefined && !selected.suggestedSellQuantity && selected.state === 'TECHNICAL_TRIM_CANDIDATE' && <p className="mt-2 text-[10px] leading-relaxed text-amber-200">Research scenario only: a {Math.round(data.backtest.exploratoryTrimFraction * 100)}% trim rounds to {selected.scenarioSellQuantity.toLocaleString()} whole shares ({money(formatMoney, selected.scenarioSellQuantity * selected.referencePrice)} gross). The held-out test lagged buy-and-hold; this is not a recommendation.</p>}
                  {selected.state === 'TECHNICAL_TRIM_CANDIDATE' && selected.quantityScenarios?.length > 0 && <div className="mt-3 overflow-x-auto rounded-xl border border-slate-700/70"><div className="px-2.5 pt-2 text-[9px] font-bold uppercase tracking-wider text-slate-400">Historical quantity scenarios · informational</div><table className="min-w-[540px] w-full text-[9px]"><thead className="text-slate-500"><tr><th className="p-2 text-left">Trim</th><th className="p-2 text-right">Shares</th><th className="p-2 text-right">Gross proceeds</th><th className="p-2 text-right">Test CAGR</th><th className="p-2 text-right">Max drawdown</th><th className="p-2 text-right">Beat hold</th></tr></thead><tbody>{selected.quantityScenarios.map(scenario => <tr key={scenario.fraction} className="border-t border-slate-800/70"><td className="p-2 text-slate-300">{Math.round(scenario.fraction * 100)}%</td><td className="p-2 text-right">{scenario.quantity.toLocaleString()}</td><td className="p-2 text-right">{money(formatMoney, scenario.quantity * selected.referencePrice, true)}</td><td className="p-2 text-right">{scenario.averageCagrPct ?? '—'}%</td><td className="p-2 text-right">{scenario.averageMaxDrawdownPct ?? '—'}%</td><td className="p-2 text-right">{scenario.beatBuyAndHold ?? '—'}/{scenario.eligibleSymbols ?? 0}</td></tr>)}</tbody></table><p className="px-2.5 pb-2 text-[9px] text-slate-500">Test results are portfolio averages across current holdings, not a prediction for this company. Selling any quantity can be followed by further gains.</p></div>}
                  <p className="mt-2 text-[10px] leading-relaxed text-slate-400">Rule: wait for three completed weekly closes below a falling 30-week average. Clears after two completed weekly closes above it. {selected.invalidation}</p>
                  <p className="mt-1 text-[10px] text-slate-500">Fundamentals and verified company events are not connected, so this is a price-only review. Check company filings before acting. <a className="text-cyan-300 hover:underline" href={`https://www.screener.in/search/?q=${encodeURIComponent(selected.symbol)}`} target="_blank" rel="noreferrer">Open Screener search</a></p>
                </div></div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
                <Metric label="Holding P&L vs recorded cost" value={selected.investedValueINR > 0 ? `${((selected.currentValueINR / selected.investedValueINR - 1) * 100 >= 0 ? '+' : '')}${((selected.currentValueINR / selected.investedValueINR - 1) * 100).toFixed(2)}%` : 'Unavailable'} tone={selected.currentValueINR >= selected.investedValueINR ? 'text-emerald-400' : 'text-rose-400'} detail={`${money(formatMoney, selected.currentValueINR - selected.investedValueINR)} unrealized · loss from cost alone does not trigger this price trend rule`} />
                <Metric label="30-week average" value={selected.sma30Week ? money(formatMoney, selected.sma30Week, true) : 'Insufficient'} detail={selected.lastCompletedWeek ? `Last completed week ${selected.lastCompletedWeek}` : 'Need more history'} />
                <Metric label="Close vs average" value={selected.weeklyClose && selected.sma30Week ? `${((selected.weeklyClose / selected.sma30Week - 1) * 100).toFixed(2)}%` : 'Insufficient'} tone={selected.weeklyClose >= selected.sma30Week ? 'text-emerald-400' : 'text-rose-400'} detail={`${selected.weeksBelowAverage} consecutive weeks below`} />
                <Metric label="30-day price move" value={selected.observed30DayReturn ? `${selected.observed30DayReturn.pct >= 0 ? '+' : ''}${selected.observed30DayReturn.pct.toFixed(2)}%` : 'Insufficient history'} tone={returnTone(selected.observed30DayReturn?.pct)} detail={selected.observed30DayReturn ? `${selected.observed30DayReturn.from} to ${selected.observed30DayReturn.to}` : 'Observed stored closes'} />
                <Metric label="90-day price move" value={selected.observed90DayReturn ? `${selected.observed90DayReturn.pct >= 0 ? '+' : ''}${selected.observed90DayReturn.pct.toFixed(2)}%` : 'Insufficient history'} tone={returnTone(selected.observed90DayReturn?.pct)} detail={selected.observed90DayReturn ? `${selected.observed90DayReturn.from} to ${selected.observed90DayReturn.to}` : 'Observed stored closes'} />
              </div>

              <div className="mt-4"><div className="flex items-center justify-between mb-2"><h4 className="text-xs font-bold text-inherit">Price history</h4><span className="text-[10px] text-slate-500">{priceChart.length} daily observations · adjusted close cache</span></div><div className="h-52 rounded-2xl border border-slate-800/70 bg-slate-950/20 p-2">
                {priceChart.length > 1 ? <ResponsiveContainer width="100%" height="100%"><LineChart data={priceChart}><XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 9 }} tickFormatter={value => value.slice(5)} minTickGap={30} /><YAxis domain={['auto', 'auto']} tick={{ fill: '#64748b', fontSize: 9 }} width={58} tickFormatter={value => Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })} /><Tooltip contentStyle={{ background: 'var(--surface-primary, #10131b)', border: '1px solid #334155', borderRadius: 12, fontSize: 11 }} labelStyle={{ color: '#94a3b8' }} formatter={value => [money(formatMoney, value, true), 'Close']} /><Line type="monotone" dataKey="price" stroke="#34d399" strokeWidth={2} dot={false} activeDot={{ r: 3 }} /></LineChart></ResponsiveContainer> : <div className="h-full flex items-center justify-center text-xs text-slate-500">Not enough stored closes to chart.</div>}
              </div></div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-[10px] text-slate-500"><History className="w-3.5 h-3.5" />{history.length} recorded state change(s)</div>{onSelectHolding && <button onClick={() => onSelectHolding(holdings.find(item => String(item.id) === selected.holdingId))} className="rounded-xl border border-slate-700 px-3 py-2 text-[10px] font-bold text-slate-300 hover:border-emerald-500/40 hover:text-emerald-300">Open holding & transaction history</button>}</div>
              {history.length > 0 && <div className="mt-3 border-t border-slate-800 pt-3"><div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-slate-500">Recent state changes</div><div className="space-y-1.5">{history.slice(0, 5).map(event => <div key={event.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[9px]"><span className="text-slate-300">{event.from || 'New'} → {event.to}</span><span className="text-slate-500">{new Date(event.at).toLocaleString()}</span></div>)}</div></div>}
            </>}
          </section>

          <section className="glass-card rounded-3xl border border-slate-800 p-5">
            <div className="flex items-center gap-2 mb-3"><Settings2 className="w-4 h-4 text-cyan-400" /><h3 className="text-sm font-bold text-inherit">Position risk limit</h3></div>
            <form onSubmit={saveRiskLimit} className="flex flex-wrap items-end gap-3">
              <label className="text-[10px] text-slate-400">Maximum weight within Indian equities (%)<input type="number" min="0.1" max="100" step="0.1" value={maxWeight} onChange={event => setMaxWeight(event.target.value)} placeholder="Disabled" className="mt-1 block w-40 rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-2 text-xs text-inherit outline-none focus:border-cyan-500/50" /></label>
              <button disabled={savingConfig} className="rounded-xl bg-cyan-500/15 border border-cyan-500/30 px-3 py-2 text-[10px] font-bold text-cyan-200 disabled:opacity-50">{savingConfig ? 'Saving…' : 'Save limit'}</button>
              <button type="button" disabled={savingConfig} onClick={clearRiskLimit} className="rounded-xl border border-slate-700 px-3 py-2 text-[10px] text-slate-400 disabled:opacity-50">Clear limit</button>
              {configMessage && <span className="text-[10px] text-slate-400">{configMessage}</span>}
            </form>
            <p className="mt-2 text-[9px] leading-relaxed text-slate-500">When you choose a limit, the page calculates shares as ceil(excess position value ÷ current reference price), capped at shares held. This uses only your Indian equity portfolio value, not all assets.</p>
          </section>
          <section className="glass-card rounded-3xl border border-slate-800 p-5">
            <h3 className="text-sm font-bold text-inherit mb-3">Sector exposure</h3>
            <div className="space-y-3">{sectorExposure.map(item => <div key={item.sector}><div className="mb-1 flex justify-between gap-3 text-[10px]"><span className="truncate text-inherit">{item.sector}</span><span className="shrink-0 font-mono text-slate-400">{item.weight.toFixed(1)}% · {money(formatMoney, item.value, true)}</span></div><div className="h-1.5 rounded-full bg-slate-800 overflow-hidden"><div className="h-full rounded-full bg-cyan-400/80" style={{ width: `${Math.min(100, item.weight)}%` }} /></div></div>)}{!sectorExposure.length && <p className="text-[10px] text-slate-500">Waiting for holdings.</p>}</div>
          </section>
        </div>
      </AnimatedItem>
    </div>

    <AnimatedItem>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="reports-subcard rounded-2xl border border-slate-800/70 p-3.5 flex gap-2.5"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><p className="text-[10px] leading-relaxed text-slate-400"><b>Monitor:</b> no sale trigger. Review company facts; this is not a hold recommendation.</p></div>
        <div className="reports-subcard rounded-2xl border border-slate-800/70 p-3.5 flex gap-2.5"><TrendingDown className="w-4 h-4 text-amber-300 shrink-0" /><p className="text-[10px] leading-relaxed text-slate-400"><b>Watch:</b> no sale yet. Review weekly; wait for the confirmed rule before considering a sale.</p></div>
        <div className="reports-subcard rounded-2xl border border-slate-800/70 p-3.5 flex gap-2.5"><TrendingUp className="w-4 h-4 text-rose-300 shrink-0" /><p className="text-[10px] leading-relaxed text-slate-400"><b>Exit review:</b> investigate a possible sale. A specific share count appears only if a sell size passed the backtest checks; otherwise no quantity is recommended.</p></div>
      </div>
    </AnimatedItem>
    <AnimatedItem><div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-3.5 text-[9px] leading-relaxed text-slate-500"><Clock3 className="w-4 h-4 shrink-0 text-amber-300" /><span>Backtests use the current holdings universe, so they exclude delisted failures and are affected by survivorship bias. Stored prices are daily closes; the strategy omits verified fundamentals, dividends, audited corporate actions, liquidity, and tax. No strategy passed both held-out average return and drawdown checks, so the app does not claim a validated technical sell quantity. Sell transactions update your current holdings, but the app does not yet run or track a staged “sell 25%, then another 25%” plan. Any transaction still requires your explicit action in the existing transaction flow.</span></div></AnimatedItem>
  </AnimatedPage>;
}
