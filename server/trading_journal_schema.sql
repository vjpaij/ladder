-- ==============================================================================
-- LADDER TRADING JOURNAL SCHEMA
-- Run this script in the Supabase SQL Editor if you want a dedicated relational
-- table for individual trades alongside the compressed cloud storage snapshot.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.trading_journal (
    id TEXT PRIMARY KEY,
    user_id TEXT DEFAULT 'admin',
    symbol TEXT NOT NULL,
    name TEXT,
    market TEXT DEFAULT 'IN',
    segment TEXT DEFAULT 'IN_EQUITY',
    trade_type TEXT DEFAULT 'LONG',
    status TEXT DEFAULT 'CLOSED',
    entry_date DATE,
    exit_date DATE,
    entry_price NUMERIC(14, 4),
    exit_price NUMERIC(14, 4),
    quantity NUMERIC(14, 4),
    target_price NUMERIC(14, 4),
    stop_loss_price NUMERIC(14, 4),
    planned_risk_reward NUMERIC(8, 2),
    setup TEXT DEFAULT 'Breakout',
    timeframe TEXT DEFAULT 'Daily',
    emotions TEXT DEFAULT 'Disciplined',
    discipline BOOLEAN DEFAULT true,
    tags JSONB DEFAULT '[]'::jsonb,
    notes TEXT,
    chart_url TEXT,
    rating INTEGER DEFAULT 4,
    brokerage NUMERIC(12, 2) DEFAULT 0,
    stt NUMERIC(12, 2) DEFAULT 0,
    exchange_charges NUMERIC(12, 2) DEFAULT 0,
    gst NUMERIC(12, 2) DEFAULT 0,
    stamp_duty NUMERIC(12, 2) DEFAULT 0,
    sebi_charges NUMERIC(12, 2) DEFAULT 0,
    total_charges NUMERIC(12, 2) DEFAULT 0,
    gross_pnl NUMERIC(14, 2) DEFAULT 0,
    net_pnl NUMERIC(14, 2) DEFAULT 0,
    roi_pct NUMERIC(10, 2) DEFAULT 0,
    breakeven_exit NUMERIC(14, 4),
    linked_holding_id TEXT,
    linked_transaction_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.trading_journal ENABLE ROW LEVEL SECURITY;

-- Allow authenticated read/write access
CREATE POLICY "Allow authenticated read access on trading_journal"
ON public.trading_journal FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert access on trading_journal"
ON public.trading_journal FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update access on trading_journal"
ON public.trading_journal FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Allow authenticated delete access on trading_journal"
ON public.trading_journal FOR DELETE TO authenticated USING (true);

-- Index frequently filtered columns for lightning-fast queries
CREATE INDEX IF NOT EXISTS idx_trading_journal_symbol ON public.trading_journal(symbol);
CREATE INDEX IF NOT EXISTS idx_trading_journal_entry_date ON public.trading_journal(entry_date);
CREATE INDEX IF NOT EXISTS idx_trading_journal_status ON public.trading_journal(status);
CREATE INDEX IF NOT EXISTS idx_trading_journal_segment ON public.trading_journal(segment);
