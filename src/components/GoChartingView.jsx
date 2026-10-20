import React, { useState, useEffect, useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid
} from 'recharts';
import {
  ExternalLink,
  TrendingUp,
  TrendingDown,
  BarChart2,
  Activity,
  Layers,
  Sparkles,
  Target,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import axios from 'axios';
import { useThemeAuth } from '../context/ThemeAuthContext';
import HoldingLogo from './HoldingLogo';

export default function GoChartingView({
  symbol,
  name,
  market = 'IN',
  executionPrice,
  executionDate,
  tradeType,
  className = ''
}) {
  const { theme, currency } = useThemeAuth();
  const isLight = theme === 'light' || theme === 'warm_light' || theme === 'nordic_light';

  const [seriesData, setSeriesData] = useState([]);
  const [indicators, setIndicators] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedRange, setSelectedRange] = useState('6M'); // '1M' | '3M' | '6M' | '1Y' | 'ALL'

  const cleanSymbol = useMemo(() => {
    return String(symbol || '').trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
  }, [symbol]);

  const isUs = market === 'US' || ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA'].includes(cleanSymbol);
  const currencySymbol = isUs && currency === 'USD' ? '$' : '₹';

  const formatPrice = (val) => {
    if (val === undefined || val === null || isNaN(Number(val))) return '—';
    return `${currencySymbol}${Number(val).toLocaleString(isUs && currency === 'USD' ? 'en-US' : 'en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  };

  const fetchChartData = async () => {
    if (!cleanSymbol) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`/api/trading-journal/technical-chart/${cleanSymbol}`, {
        params: { market: isUs ? 'US' : 'IN' }
      });
      if (res.data?.success && Array.isArray(res.data.series)) {
        setSeriesData(res.data.series);
        setIndicators(res.data.indicators || null);
      } else {
        setError('No technical chart data available for this ticker.');
      }
    } catch (err) {
      console.error('[GoChartingView] Error fetching chart:', err);
      setError(err.response?.data?.error || 'Failed to load technical chart data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChartData();
  }, [cleanSymbol, isUs]);

  // Filter series according to selected time range
  const filteredData = useMemo(() => {
    if (!seriesData || seriesData.length === 0) return [];
    if (selectedRange === 'ALL') return seriesData;

    const daysMap = {
      '1M': 30,
      '3M': 90,
      '6M': 180,
      '1Y': 365
    };
    const days = daysMap[selectedRange] || 180;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const filtered = seriesData.filter(d => d.date >= cutoff);
    return filtered.length > 5 ? filtered : seriesData.slice(-60);
  }, [seriesData, selectedRange]);

  // Current quote and price change
  const currentQuote = useMemo(() => {
    if (filteredData.length === 0) return null;
    const latest = filteredData[filteredData.length - 1];
    const prev = filteredData.length > 1 ? filteredData[filteredData.length - 2] : latest;
    const change = latest.close - prev.close;
    const changePct = prev.close > 0 ? (change / prev.close) * 100 : 0;
    return {
      price: latest.close,
      change,
      changePct,
      date: latest.date
    };
  }, [filteredData]);

  // Latest indicator readings
  const latestEma21 = indicators?.ema21 ?? filteredData[filteredData.length - 1]?.ema21;
  const latestEma50 = indicators?.ema50 ?? filteredData[filteredData.length - 1]?.ema50;
  const latestEma200 = indicators?.ema200 ?? filteredData[filteredData.length - 1]?.ema200;
  const latestRsi10 = indicators?.rsi10 ?? filteredData[filteredData.length - 1]?.rsi10;

  // External Terminal Links
  const goChartingUrl = isUs
    ? `https://gocharting.com/terminal?ticker=NASDAQ:${cleanSymbol}`
    : `https://gocharting.com/terminal?ticker=NSE:${cleanSymbol}`;

  const tradingViewUrl = isUs
    ? `https://www.tradingview.com/chart/?symbol=NASDAQ:${cleanSymbol}`
    : `https://www.tradingview.com/chart/?symbol=NSE:${cleanSymbol}`;

  // Indicator Colors matching user specification
  const ema21Color = '#3B82F6'; // Blue
  const ema50Color = '#EAB308'; // Yellow
  const ema200Color = isLight ? '#1E293B' : '#E2E8F0'; // High contrast Dark/Light
  const rsiColor = '#EF4444'; // Red/Coral

  // Custom Chart Tooltip
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const dataPoint = payload[0]?.payload || {};
    return (
      <div className="reports-card p-3 rounded-2xl border border-[var(--border-color)] shadow-2xl backdrop-blur-md text-xs font-mono space-y-1.5 min-w-[190px]">
        <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-1.5 mb-1.5">
          <span className="font-bold text-[var(--text-primary)]">{dataPoint.date}</span>
          <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-sans font-bold">1D Close</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[var(--text-secondary)] font-sans">Close Price:</span>
          <span className="font-black text-[var(--text-primary)]">{formatPrice(dataPoint.close)}</span>
        </div>
        {dataPoint.ema21 !== null && (
          <div className="flex items-center justify-between text-[#3B82F6]">
            <span className="font-sans flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#3B82F6]" /> 21 EMA:
            </span>
            <span className="font-bold">{formatPrice(dataPoint.ema21)}</span>
          </div>
        )}
        {dataPoint.ema50 !== null && (
          <div className="flex items-center justify-between text-[#EAB308]">
            <span className="font-sans flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#EAB308]" /> 50 EMA:
            </span>
            <span className="font-bold">{formatPrice(dataPoint.ema50)}</span>
          </div>
        )}
        {dataPoint.ema200 !== null && (
          <div className="flex items-center justify-between text-[var(--text-primary)]">
            <span className="font-sans flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${isLight ? 'bg-slate-900' : 'bg-slate-200'}`} /> 200 EMA:
            </span>
            <span className="font-bold">{formatPrice(dataPoint.ema200)}</span>
          </div>
        )}
        {dataPoint.rsi10 !== null && (
          <div className="flex items-center justify-between text-[#EF4444] pt-1 border-t border-[var(--border-color)]">
            <span className="font-sans flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#EF4444]" /> RSI (10):
            </span>
            <span className="font-bold">{dataPoint.rsi10}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`reports-card rounded-3xl border border-[var(--border-color)] p-4 sm:p-6 space-y-5 ${className}`}>
      {/* 1. Header Bar: Ticker Dossier, Price, Indicator Pills, and Live Terminal Links */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-[var(--border-color)]">
        {/* Left: Logo, Symbol, Market Flag, Timeframe */}
        <div className="flex items-center gap-3">
          <HoldingLogo
            symbol={cleanSymbol}
            name={name}
            category={isUs ? 'us_stocks' : 'in_stocks'}
            className="w-11 h-11 rounded-2xl shadow-md border border-[var(--border-color)]"
          />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xl font-black text-[var(--text-primary)] tracking-tight">{cleanSymbol}</h3>
              <span className="text-sm" title={isUs ? 'United States Equities' : 'Indian National Stock Exchange'}>
                {isUs ? '🇺🇸' : '🇮🇳'}
              </span>
              <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-700 dark:text-cyan-300">
                1D Daily
              </span>
              {tradeType && (
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                  tradeType === 'BUY' || tradeType === 'LONG'
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                    : 'bg-rose-500/15 border-rose-500/30 text-rose-700 dark:text-rose-300'
                }`}>
                  {tradeType}
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--text-secondary)] font-medium truncate max-w-xs sm:max-w-md">
              {name || `${cleanSymbol} Daily Technical Chart with 21/50/200 EMA & RSI(10)`}
            </p>
          </div>
        </div>

        {/* Center: Live Price & Key Technical Metrics */}
        {currentQuote && (
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <div className="text-lg font-black font-mono text-[var(--text-primary)]">
                {formatPrice(currentQuote.price)}
              </div>
              <div className={`text-xs font-bold font-mono flex items-center gap-1 ${
                currentQuote.change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}>
                {currentQuote.change >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                <span>
                  {currentQuote.change >= 0 ? '+' : ''}{formatPrice(currentQuote.change)} ({currentQuote.changePct >= 0 ? '+' : ''}{currentQuote.changePct.toFixed(2)}%)
                </span>
              </div>
            </div>

            {/* Overlaid Indicator Quick Status Badges */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {latestEma21 && (
                <div className="px-2 py-1 rounded-xl text-[10px] font-mono font-bold bg-blue-500/10 border border-blue-500/30 text-[#3B82F6]" title="21-Day Exponential Moving Average">
                  EMA(21): {formatPrice(latestEma21)}
                </div>
              )}
              {latestEma50 && (
                <div className="px-2 py-1 rounded-xl text-[10px] font-mono font-bold bg-amber-500/10 border border-amber-500/30 text-[#EAB308]" title="50-Day Exponential Moving Average">
                  EMA(50): {formatPrice(latestEma50)}
                </div>
              )}
              {latestEma200 && (
                <div className={`px-2 py-1 rounded-xl text-[10px] font-mono font-bold border ${
                  isLight ? 'bg-slate-200 border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-700 text-slate-200'
                }`} title="200-Day Exponential Moving Average (Institutional Baseline)">
                  EMA(200): {formatPrice(latestEma200)}
                </div>
              )}
              {latestRsi10 !== undefined && latestRsi10 !== null && (
                <div className="px-2 py-1 rounded-xl text-[10px] font-mono font-bold bg-rose-500/10 border border-rose-500/30 text-[#EF4444]" title="10-Day Relative Strength Index">
                  RSI(10): {latestRsi10}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Right: Time Range Selector & External GoCharting / TradingView Direct Links */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Timeframe Range Selector */}
          <div className="flex items-center p-1 rounded-2xl reports-subcard border border-[var(--border-color)]">
            {['1M', '3M', '6M', '1Y', 'ALL'].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setSelectedRange(r)}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition-all cursor-pointer ${
                  selectedRange === r
                    ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          {/* External Links */}
          <a
            href={goChartingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 transition-all cursor-pointer shadow-sm"
            title="Open Interactive Chart in Live GoCharting Terminal"
          >
            <span>GoCharting</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <a
            href={tradingViewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold reports-subcard hover:border-[var(--text-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-color)] transition-all cursor-pointer shadow-sm"
            title="Open Live Chart in TradingView"
          >
            <span>TradingView</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* 2. Loading / Error / Empty States */}
      {loading ? (
        <div className="h-80 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="w-7 h-7 text-emerald-500 animate-spin" />
          <p className="text-xs font-bold text-[var(--text-secondary)]">
            Loading Daily OHLCV candles & technical indicators for {cleanSymbol}...
          </p>
        </div>
      ) : error ? (
        <div className="h-64 flex flex-col items-center justify-center gap-3 p-6 text-center reports-subcard rounded-2xl border border-rose-500/30">
          <AlertCircle className="w-8 h-8 text-rose-500" />
          <p className="text-sm font-bold text-[var(--text-primary)]">{error}</p>
          <button
            type="button"
            onClick={fetchChartData}
            className="px-4 py-1.5 rounded-xl text-xs font-bold bg-emerald-500 text-obsidian-950 hover:bg-emerald-400 transition-all cursor-pointer"
          >
            Retry Fetch
          </button>
        </div>
      ) : filteredData.length === 0 ? (
        <div className="h-64 flex flex-col items-center justify-center gap-2 text-center text-xs text-[var(--text-muted)]">
          <BarChart2 className="w-8 h-8 opacity-40" />
          <span>No historical price candles recorded for {cleanSymbol}.</span>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Main Price Chart with Overlaid 21/50/200 EMA Lines & Execution Price Target */}
          <div className="relative">
            <div className="flex items-center justify-between text-[11px] font-bold text-[var(--text-muted)] px-1 mb-1">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" /> Daily Close & Overlaid EMAs
              </span>
              <div className="flex items-center gap-3 text-[10px] font-mono">
                <span className="flex items-center gap-1 text-[#3B82F6]">
                  <span className="w-2.5 h-0.5 bg-[#3B82F6]" /> 21 EMA
                </span>
                <span className="flex items-center gap-1 text-[#EAB308]">
                  <span className="w-2.5 h-0.5 bg-[#EAB308]" /> 50 EMA
                </span>
                <span className={`flex items-center gap-1 ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
                  <span className={`w-2.5 h-0.5 ${isLight ? 'bg-slate-900' : 'bg-slate-200'}`} /> 200 EMA
                </span>
                {executionPrice && (
                  <span className="flex items-center gap-1 text-pink-500 font-bold">
                    <span className="w-2.5 h-0.5 bg-pink-500" style={{ borderTop: '1px dashed' }} /> Trade Entry
                  </span>
                )}
              </div>
            </div>

            <div className="h-72 sm:h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={filteredData} margin={{ top: 10, right: 15, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="priceGlow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>

                  <CartesianGrid strokeDasharray="3 3" stroke={isLight ? '#E2E8F0' : 'rgba(255,255,255,0.06)'} vertical={false} />

                  <XAxis
                    dataKey="date"
                    stroke={isLight ? '#64748B' : '#94A3B8'}
                    fontSize={10}
                    tickLine={false}
                    axisLine={{ stroke: isLight ? '#CBD5E1' : 'rgba(255,255,255,0.1)' }}
                    tickFormatter={(str) => {
                      if (!str) return '';
                      const parts = str.split('-');
                      if (parts.length === 3) return `${parts[2]}/${parts[1]}`;
                      return str;
                    }}
                    minTickGap={25}
                  />

                  <YAxis
                    domain={['auto', 'auto']}
                    stroke={isLight ? '#64748B' : '#94A3B8'}
                    fontSize={10}
                    tickLine={false}
                    axisLine={{ stroke: isLight ? '#CBD5E1' : 'rgba(255,255,255,0.1)' }}
                    tickFormatter={(val) => `${currencySymbol}${Number(val).toLocaleString()}`}
                    orientation="right"
                  />

                  <Tooltip content={<CustomTooltip />} />

                  {/* Daily Price Area */}
                  <Area
                    type="monotone"
                    dataKey="close"
                    stroke="#10B981"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#priceGlow)"
                    name="Daily Close"
                    isAnimationActive={false}
                  />

                  {/* 21 EMA Line */}
                  <Line
                    type="monotone"
                    dataKey="ema21"
                    stroke={ema21Color}
                    strokeWidth={1.8}
                    dot={false}
                    name="21 EMA"
                    isAnimationActive={false}
                  />

                  {/* 50 EMA Line */}
                  <Line
                    type="monotone"
                    dataKey="ema50"
                    stroke={ema50Color}
                    strokeWidth={1.8}
                    dot={false}
                    name="50 EMA"
                    isAnimationActive={false}
                  />

                  {/* 200 EMA Line (Long-Term Stage Baseline) */}
                  <Line
                    type="monotone"
                    dataKey="ema200"
                    stroke={ema200Color}
                    strokeWidth={2}
                    strokeDasharray="4 2"
                    dot={false}
                    name="200 EMA"
                    isAnimationActive={false}
                  />

                  {/* Execution Price Highlight (Transaction Milestone) */}
                  {executionPrice && Number(executionPrice) > 0 && (
                    <ReferenceLine
                      y={Number(executionPrice)}
                      stroke="#EC4899"
                      strokeDasharray="4 4"
                      strokeWidth={2}
                      label={{
                        value: `🎯 Executed @ ${formatPrice(executionPrice)}${executionDate ? ` (${executionDate})` : ''}`,
                        fill: '#EC4899',
                        fontSize: 11,
                        fontWeight: 'bold',
                        position: 'insideTopLeft'
                      }}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 3. RSI(10) Sub-Panel with Corridors (26, 50, 80) */}
          <div className="reports-subcard p-3 rounded-2xl border border-[var(--border-color)]">
            <div className="flex items-center justify-between text-[11px] font-bold mb-1">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#EF4444]" />
                <span className="text-[var(--text-primary)] font-mono">RSI (10) Relative Strength Index</span>
                {latestRsi10 !== undefined && latestRsi10 !== null && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    latestRsi10 >= 75
                      ? 'bg-rose-500/15 border-rose-500/30 text-rose-600 dark:text-rose-400'
                      : latestRsi10 <= 30
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                      : 'bg-cyan-500/15 border-cyan-500/30 text-cyan-600 dark:text-cyan-400'
                  }`}>
                    {latestRsi10 >= 75 ? 'Overbought' : latestRsi10 <= 30 ? 'Oversold' : 'Neutral / Momentum'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-[10px] font-mono text-[var(--text-muted)]">
                <span className="text-rose-500">Overbought: 80</span>
                <span className="text-[var(--text-muted)]">Neutral: 50</span>
                <span className="text-emerald-500">Oversold: 26</span>
              </div>
            </div>

            <div className="h-24 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={filteredData} margin={{ top: 5, right: 15, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 2" stroke={isLight ? '#E2E8F0' : 'rgba(255,255,255,0.05)'} vertical={false} />

                  <XAxis dataKey="date" hide />

                  <YAxis
                    domain={[10, 90]}
                    ticks={[26, 50, 80]}
                    stroke={isLight ? '#64748B' : '#94A3B8'}
                    fontSize={9}
                    tickLine={false}
                    axisLine={false}
                    orientation="right"
                  />

                  {/* Overbought corridor line (80) */}
                  <ReferenceLine y={80} stroke="#EF4444" strokeDasharray="3 3" strokeOpacity={0.6} />

                  {/* Neutral midpoint line (50) */}
                  <ReferenceLine y={50} stroke={isLight ? '#94A3B8' : '#64748B'} strokeDasharray="3 3" strokeOpacity={0.4} />

                  {/* Oversold corridor line (26) */}
                  <ReferenceLine y={26} stroke="#10B981" strokeDasharray="3 3" strokeOpacity={0.6} />

                  {/* RSI 10 Curve */}
                  <Line
                    type="monotone"
                    dataKey="rsi10"
                    stroke={rsiColor}
                    strokeWidth={1.8}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
