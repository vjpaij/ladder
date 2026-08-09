import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

async function fetchYahooPrice(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
    const res = await axios.get(url, {
      timeout: 6000,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    const meta = res.data?.chart?.result?.[0]?.meta;
    if (meta && meta.regularMarketPrice) {
      return meta.regularMarketPrice;
    }
  } catch (err) {
    console.warn(`Could not fetch live price for ${symbol}:`, err.message);
  }
  return null;
}

async function updatePrices() {
  console.log("Fetching live NASDAQ/NYSE quotes for US Stocks...");
  const { data: holdings } = await supabase
    .from("holdings")
    .select("id, symbol, avg_buy_price, quantity")
    .eq("category_id", "us_stocks");

  if (!holdings) return;

  for (const h of holdings) {
    const live = await fetchYahooPrice(h.symbol);
    const finalPrice = live || h.avg_buy_price;
    console.log(`  ${h.symbol}: Live Price = $${finalPrice} (Avg Buy = $${h.avg_buy_price})`);

    await supabase
      .from("holdings")
      .update({ current_price: parseFloat(finalPrice.toFixed(4)) })
      .eq("id", h.id);
  }
  console.log("US Stock prices updated successfully.");
}

updatePrices().catch(console.error);
