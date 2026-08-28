import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

const monthMap = {
  "jan": "01", "feb": "02", "mar": "03", "apr": "04", "may": "05", "jun": "06",
  "jul": "07", "aug": "08", "sep": "09", "oct": "10", "nov": "11", "dec": "12"
};

function parseUsOrderDate(str) {
  if (!str || typeof str !== "string") return null;
  const m = str.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (m) {
    const day = m[1].padStart(2, "0");
    const mon = monthMap[m[2].toLowerCase()] || "01";
    const year = m[3];
    return `${year}-${mon}-${day}`;
  }
  const iso = str.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
}

function getFallbackFxRate(dateStr) {
  if (!dateStr) return 82.5;
  const y = parseInt(dateStr.slice(0, 4), 10);
  if (y <= 2019) return 70.4;
  if (y === 2020) return 74.1;
  if (y === 2021) return 73.9;
  if (y === 2022) return 79.8;
  if (y === 2023) return 82.6;
  if (y === 2024) return 83.5;
  if (y === 2025) return 85.8;
  if (y === 2026) return 92.5;
  return 87.25;
}

const nameToTicker = {
  "amazon": "AMZN",
  "salesforce": "CRM",
  "alphabet": "GOOG",
  "google": "GOOG",
  "apple": "AAPL",
  "microsoft": "MSFT",
  "asml": "ASML",
  "arista": "ANET",
  "meta": "META",
  "taiwan": "TSM",
  "broadcom": "AVGO",
  "nvidia": "NVDA",
  "palantir": "PLTR"
};

function getTickerFromName(name, displaySymbol) {
  const combined = ((name || "") + " " + (displaySymbol || "")).toLowerCase();
  for (const [k, v] of Object.entries(nameToTicker)) {
    if (combined.includes(k)) return v;
  }
  return null;
}

async function run() {
  console.log("=== STARTING US STOCKS INGESTION ===\n");

  // 1. Read Book2.xlsx for historical FX rates and Dividends
  const wb2 = XLSX.readFile("./US Stocks/Book2.xlsx");
  const ws2 = wb2.Sheets["Sheet1"];
  const book2Rows = XLSX.utils.sheet_to_json(ws2, { defval: "" });

  const historicalFxMap = {};
  book2Rows.forEach(r => {
    const rawDate = r["Transaction Date"];
    const rate = parseFloat(r["Purchase Exchange Rate"]);
    if (rawDate && rate > 0) {
      const d = parseUsOrderDate(rawDate);
      if (d) historicalFxMap[d] = rate;
    }
  });
  console.log(`Loaded ${Object.keys(historicalFxMap).length} historical FX rate mapping points from Book2.xlsx`);

  // Extract Dividends from Book2.xlsx
  const rawDivs = book2Rows.filter(r => r["Type"] === "Dividend");
  console.log(`Found ${rawDivs.length} dividend rows in Book2.xlsx\n`);

  // 2. Read US_Stocks.xls for Buy and Sell Orders
  const wb1 = XLSX.readFile("./US Stocks/US_Stocks.xls");
  const ws1 = wb1.Sheets["ORDER_BOOK"];
  const raw1 = XLSX.utils.sheet_to_json(ws1, { header: 1, defval: "" });

  const headers = raw1[10];
  const orderRows = [];
  for (let i = 11; i < raw1.length; i++) {
    const r = raw1[i];
    if (!r || !r[1]) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = r[idx];
    });
    orderRows.push(obj);
  }
  console.log(`Loaded ${orderRows.length} order rows from US_Stocks.xls`);

  // 3. Purge existing us_stocks records from Supabase
  const { data: existingUsStocks } = await supabase
    .from("holdings")
    .select("id")
    .eq("category_id", "us_stocks");

  if (existingUsStocks && existingUsStocks.length > 0) {
    const ids = existingUsStocks.map(h => h.id);
    console.log(`Purging ${ids.length} existing us_stocks holdings and related records...`);
    await supabase.from("transactions").delete().in("holding_id", ids);
    await supabase.from("dividends").delete().in("holding_id", ids);
    await supabase.from("holdings").delete().in("id", ids);
    console.log("Purge complete.\n");
  }

  const uniqueTickers = [...new Set(orderRows.map(r => r["Stock Symbol"]))];
  console.log(`Processing ${uniqueTickers.length} US Stock symbols:`, uniqueTickers, "\n");

  let totalActive = 0;
  let totalRedeemed = 0;
  let grandTotalBuyUSD = 0;
  let grandTotalBuyINR = 0;
  let grandTotalRealizedPnlUSD = 0;
  let grandTotalRealizedPnlINR = 0;
  let grandTotalDivsUSD = 0;
  let grandTotalDivsINR = 0;
  let grandTotalChargesUSD = 0;

  for (let idx = 0; idx < uniqueTickers.length; idx++) {
    const ticker = uniqueTickers[idx];
    const tickerOrders = orderRows.filter(r => r["Stock Symbol"] === ticker);
    const stockName = tickerOrders[0]["Stock Name"] || ticker;

    // Extract matching Split rows from Book2.xlsx for this ticker
    const tickerSplits = book2Rows.filter(r => {
      const mappedTicker = getTickerFromName(r["Name"], r["Display Symbol"]);
      return mappedTicker === ticker && (r["Type"] || "").toLowerCase() === "split";
    });

    // Combine order book trades with corporate action splits
    const combinedEvents = [];

    for (const ord of tickerOrders) {
      const type = (ord["Transaction Type"] || "").toUpperCase();
      const dateStr = parseUsOrderDate(ord["Order Execution Time"] || ord["Order Placed Time"]);
      if (!dateStr) continue;
      combinedEvents.push({
        eventType: type,
        dateStr,
        qty: parseFloat(ord["Quantity"]) || 0,
        priceUSD: parseFloat(ord["Price ($)"]) || 0,
        amountUSD: parseFloat(ord["Order Amount ($)"]) || parseFloat(((parseFloat(ord["Quantity"]) || 0) * (parseFloat(ord["Price ($)"]) || 0)).toFixed(2)),
        brokerageUSD: parseFloat(ord["Brokerage ($)"]) || 0,
        raw: ord
      });
    }

    for (const spl of tickerSplits) {
      const dateStr = parseUsOrderDate(spl["Transaction Date"]);
      if (!dateStr) continue;
      combinedEvents.push({
        eventType: "SPLIT",
        dateStr,
        oldRatio: parseFloat(spl["Cost Per Share"]) || 1,
        newRatio: parseFloat(spl["Shares Owned"]) || 1,
        qty: 0,
        priceUSD: 0,
        amountUSD: 0,
        brokerageUSD: 0,
        raw: spl
      });
    }

    // Deterministic chronological & same-day priority sorting: BUY -> SPLIT -> SELL -> DIVIDEND
    const eventPriority = { BUY: 1, BONUS: 1, SPLIT: 2, SELL: 3, DIVIDEND: 4 };
    combinedEvents.sort((a, b) => {
      if (a.dateStr !== b.dateStr) return a.dateStr.localeCompare(b.dateStr);
      return (eventPriority[a.eventType] || 9) - (eventPriority[b.eventType] || 9);
    });

    let currentQty = 0;
    let totalBuyQty = 0;
    let totalBuyCostUSD = 0;
    let totalBuyCostINR = 0;
    let totalSellQty = 0;
    let totalChargesUSD = 0;
    let realizedPnlUSD = 0;
    let realizedPnlINR = 0;
    const buyLots = [];

    const processedTxs = [];

    for (const ev of combinedEvents) {
      const type = ev.eventType;
      const dateStr = ev.dateStr;
      const fxRate = historicalFxMap[dateStr] || getFallbackFxRate(dateStr);

      if (type === "BUY") {
        const qty = ev.qty;
        const priceUSD = ev.priceUSD;
        const amountUSD = ev.amountUSD;
        const brokerageUSD = ev.brokerageUSD;

        totalChargesUSD += brokerageUSD;
        currentQty += qty;
        totalBuyQty += qty;
        totalBuyCostUSD += amountUSD;
        totalBuyCostINR += amountUSD * fxRate;
        buyLots.push({ qty, priceUSD, fxRate, date: dateStr });

        processedTxs.push({
          type: "BUY",
          quantity: parseFloat(qty.toFixed(6)),
          price: parseFloat(priceUSD.toFixed(4)),
          total_amount: parseFloat(amountUSD.toFixed(2)),
          currency: "USD",
          fx_rate: parseFloat(fxRate.toFixed(4)),
          charges: parseFloat(brokerageUSD.toFixed(2)),
          date: dateStr,
          notes: `Buy @ $${priceUSD.toFixed(2)} | FX: ₹${fxRate.toFixed(2)}/$`
        });

      } else if (type === "SPLIT") {
        const oldRatio = ev.oldRatio;
        const newRatio = ev.newRatio;
        if (oldRatio <= 0 || newRatio <= 0) {
          console.warn(`[Validation Warning] Invalid split ratio for ${ticker} on ${dateStr}: ${oldRatio}:${newRatio}`);
          continue;
        }

        const splitMultiplier = newRatio / oldRatio;
        const preSplitQty = currentQty;
        currentQty = currentQty * splitMultiplier;
        totalBuyQty = totalBuyQty * splitMultiplier;

        // Scale all preceding open buy lots and buy transactions
        for (const lot of buyLots) {
          lot.qty = lot.qty * splitMultiplier;
          lot.priceUSD = lot.priceUSD / splitMultiplier;
        }
        for (const tx of processedTxs) {
          if (tx.type === "BUY") {
            tx.quantity = parseFloat((tx.quantity * splitMultiplier).toFixed(6));
            tx.price = parseFloat((tx.price / splitMultiplier).toFixed(4));
            tx.total_amount = parseFloat((tx.quantity * tx.price).toFixed(2));
          }
        }

        processedTxs.push({
          type: "SPLIT",
          quantity: 0,
          price: 0,
          total_amount: 0,
          currency: "USD",
          fx_rate: parseFloat(fxRate.toFixed(4)),
          charges: 0,
          date: dateStr,
          notes: `Stock Split (${oldRatio}:${newRatio}) — holding scaled from ${preSplitQty.toFixed(4)} to ${currentQty.toFixed(4)} shares`
        });

      } else if (type === "SELL") {
        const qty = ev.qty;
        const priceUSD = ev.priceUSD;
        const amountUSD = ev.amountUSD;
        const brokerageUSD = ev.brokerageUSD;
        totalChargesUSD += brokerageUSD;

        if (qty > 0) {
          totalSellQty += qty;
          currentQty = Math.max(0, currentQty - qty);

          let remaining = qty;
          while (remaining > 0 && buyLots.length > 0) {
            const lot = buyLots[0];
            const used = Math.min(lot.qty, remaining);

            // USD Realized P&L
            realizedPnlUSD += used * (priceUSD - lot.priceUSD);

            // INR Realized P&L (Sell Date FX - Buy Date FX)
            realizedPnlINR += (used * priceUSD * fxRate) - (used * lot.priceUSD * lot.fxRate);

            lot.qty -= used;
            remaining -= used;
            if (lot.qty <= 0) buyLots.shift();
          }

          processedTxs.push({
            type: "SELL",
            quantity: parseFloat(qty.toFixed(6)),
            price: parseFloat(priceUSD.toFixed(4)),
            total_amount: parseFloat(amountUSD.toFixed(2)),
            currency: "USD",
            fx_rate: parseFloat(fxRate.toFixed(4)),
            charges: parseFloat(brokerageUSD.toFixed(2)),
            date: dateStr,
            notes: `Sell @ $${priceUSD.toFixed(2)} | FX: ₹${fxRate.toFixed(2)}/$`
          });
        }
      }
    }

    const avgBuyPriceUSD = totalBuyQty > 0 ? totalBuyCostUSD / totalBuyQty : 0;
    const avgTxFxRate = totalBuyCostUSD > 0 ? totalBuyCostINR / totalBuyCostUSD : (historicalFxMap[processedTxs[0]?.date] || 82.5);
    const status = currentQty <= 0.000001 ? "REDEEMED" : "ACTIVE";

    if (status === "ACTIVE") totalActive++;
    else totalRedeemed++;

    grandTotalBuyUSD += totalBuyCostUSD;
    grandTotalBuyINR += totalBuyCostINR;
    grandTotalRealizedPnlUSD += realizedPnlUSD;
    grandTotalRealizedPnlINR += realizedPnlINR;
    grandTotalChargesUSD += totalChargesUSD;

    // 1. Insert Holding
    const { data: holding, error: hErr } = await supabase
      .from("holdings")
      .insert({
        user_id: null,
        category_id: "us_stocks",
        symbol: ticker,
        name: stockName,
        exchange: "NASDAQ",
        quantity: parseFloat(currentQty.toFixed(6)),
        avg_buy_price: parseFloat(avgBuyPriceUSD.toFixed(4)),
        current_price: parseFloat(avgBuyPriceUSD.toFixed(4)), // baseline current price
        currency: "USD",
        sector: "US Equities",
        buy_qty: parseFloat(totalBuyQty.toFixed(6)),
        sell_qty: parseFloat(totalSellQty.toFixed(6)),
        realized_pnl: parseFloat(realizedPnlUSD.toFixed(2)),
        total_charges: parseFloat(totalChargesUSD.toFixed(2)),
        status: status
      })
      .select()
      .single();

    if (hErr) {
      console.error(`Error inserting holding for ${ticker}:`, hErr.message);
      continue;
    }

    // 2. Insert Transactions
    if (processedTxs.length > 0) {
      const txInserts = processedTxs.map(t => ({
        holding_id: holding.id,
        user_id: null,
        symbol: ticker,
        name: stockName,
        type: t.type,
        quantity: t.quantity,
        price: t.price,
        total_amount: t.total_amount,
        currency: "USD",
        fx_rate: t.fx_rate,
        date: t.date,
        notes: t.notes,
        charges: t.charges,
        net_amount: parseFloat((t.total_amount + t.charges).toFixed(2))
      }));

      const { error: txErr } = await supabase.from("transactions").insert(txInserts);
      if (txErr) console.error(`  Error inserting transactions for ${ticker}:`, txErr.message);
    }

    // 3. Insert Matching Dividends from Book2.xlsx
    const matchingDivs = rawDivs.filter(d => {
      const mappedTicker = getTickerFromName(d["Name"], d["Display Symbol"]);
      return mappedTicker === ticker;
    });

    if (matchingDivs.length > 0) {
      const divInserts = matchingDivs.map(d => {
        const dateStr = parseUsOrderDate(d["Transaction Date"]) || "2024-01-01";
        const rawAmt = parseFloat(d["Cost Per Share"]) || 0;
        const sharesVal = parseFloat(d["Shares Owned"]) || 0;
        const amtUSD = rawAmt > 0 ? rawAmt : sharesVal;
        const fxRate = parseFloat(d["Purchase Exchange Rate"]) || historicalFxMap[dateStr] || getFallbackFxRate(dateStr);
        const amtINR = amtUSD * fxRate;

        grandTotalDivsUSD += amtUSD;
        grandTotalDivsINR += amtINR;

        return {
          holding_id: holding.id,
          user_id: null,
          symbol: ticker,
          name: stockName,
          amount_original: parseFloat(amtUSD.toFixed(4)),
          currency: "USD",
          fx_rate: parseFloat(fxRate.toFixed(4)),
          amount_inr: parseFloat(amtINR.toFixed(2)),
          ex_date: dateStr,
          payment_date: dateStr
        };
      });

      const { error: divErr } = await supabase.from("dividends").insert(divInserts);
      if (divErr) console.error(`  Error inserting dividends for ${ticker}:`, divErr.message);
      else console.log(`[${idx+1}/${uniqueTickers.length}] ${ticker}: Ingested ${processedTxs.length} orders & ${divInserts.length} dividends.`);
    } else {
      console.log(`[${idx+1}/${uniqueTickers.length}] ${ticker}: Ingested ${processedTxs.length} orders (0 dividends).`);
    }
  }

  console.log("\n=======================================================");
  console.log("=== US STOCKS INGESTION SUMMARY ===");
  console.log("=======================================================");
  console.log(`  Total US Symbols Processed: ${uniqueTickers.length}`);
  console.log(`  Active Holdings (Qty > 0): ${totalActive}`);
  console.log(`  Redeemed Holdings (Qty = 0): ${totalRedeemed}`);
  console.log(`  Total Cumulative Buy Cost: $${grandTotalBuyUSD.toFixed(2)} (₹${grandTotalBuyINR.toFixed(2)})`);
  console.log(`  Total Realized P&L: $${grandTotalRealizedPnlUSD.toFixed(2)} (₹${grandTotalRealizedPnlINR.toFixed(2)})`);
  console.log(`  Total Dividends Recorded: $${grandTotalDivsUSD.toFixed(2)} (₹${grandTotalDivsINR.toFixed(2)})`);
  console.log(`  Total Brokerage / Charges: $${grandTotalChargesUSD.toFixed(2)}`);
  console.log("=======================================================\n");
}

run().catch(console.error);
