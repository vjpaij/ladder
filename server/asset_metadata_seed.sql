-- Run this in Supabase SQL Editor to create the asset_metadata table

CREATE TABLE IF NOT EXISTS public.asset_metadata (
    symbol TEXT PRIMARY KEY,
    name TEXT,
    asset_class TEXT,
    sector TEXT,
    capitalisation TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.asset_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read access" 
ON public.asset_metadata 
FOR SELECT 
TO authenticated 
USING (true);

-- Insert some sample mappings for Indian Stocks & US Stocks
INSERT INTO public.asset_metadata (symbol, name, asset_class, sector, capitalisation) VALUES 
('RELIANCE', 'Reliance Industries', 'IN_EQUITY', 'Energy', 'Mega Cap'),
('TCS', 'Tata Consultancy Services', 'IN_EQUITY', 'IT', 'Mega Cap'),
('HDFCBANK', 'HDFC Bank', 'IN_EQUITY', 'Bank', 'Mega Cap'),
('INFY', 'Infosys', 'IN_EQUITY', 'IT', 'Large Cap'),
('AAPL', 'Apple Inc.', 'US_EQUITY', 'Technology', 'Mega Cap'),
('MSFT', 'Microsoft', 'US_EQUITY', 'Technology', 'Mega Cap')
ON CONFLICT (symbol) DO UPDATE 
SET 
    sector = EXCLUDED.sector,
    capitalisation = EXCLUDED.capitalisation;
