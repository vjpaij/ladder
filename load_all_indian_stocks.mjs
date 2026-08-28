import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

function parseDate(raw) {
  if (!raw || typeof raw !== "string") return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

async function run() {
  console.log("=== STARTING FULL INDIAN STOCKS INGESTION (Book1.xlsx) ===\n");

  // Read Excel
  const wb = XLSX.readFile("./Indian Stocks/Book1.xlsx");
  const ws = wb.Sheets["Sheet1"];
  const allRows = XLSX.utils.sheet_to_json(ws, { defval: "" });

  const allSymbols = [...new Set(allRows.map(r => r["Display Symbol"]).filter(Boolean))];
  console.log(`Found ${allSymbols.length} unique symbols in Book1.xlsx\n`);

  // Purge existing in_stocks records from Supabase first
  const { data: existingInStocks } = await supabase
    .from("holdings")
    .select("id")
    .eq("category_id", "in_stocks");

  if (existingInStocks && existingInStocks.length > 0) {
    const existingIds = existingInStocks.map(h => h.id);
    console.log(`Purging ${existingIds.length} existing in_stocks holdings and related records...`);
    
    // Batch delete transactions and dividends by holding_id
    for (let i = 0; i < existingIds.length; i += 100) {
      const chunk = existingIds.slice(i, i + 100);
      await supabase.from("transactions").delete().in("holding_id", chunk);
      await supabase.from("dividends").delete().in("holding_id", chunk);
      await supabase.from("holdings").delete().in("id", chunk);
    }
    console.log("Purge complete.\n");
  }

  let totalActiveHoldings = 0;
  let totalRedeemedHoldings = 0;
  let grandTotalBuyCost = 0;
  let grandTotalRealizedPnl = 0;
  let grandTotalDividends = 0;
  let grandTotalCharges = 0;

  // Process each symbol
  for (let idx = 0; idx < allSymbols.length; idx++) {
    const symbol = allSymbols[idx];
    const symRows = allRows.filter(r => r["Display Symbol"] === symbol);
    if (symRows.length === 0) continue;

    const infoRow = symRows[0];
    const stockName = infoRow["Name"] || symbol;
    const rawExchange = infoRow["Exchange"];
    const exchange = rawExchange === "NSI" ? "NSE" : (rawExchange === "BSI" ? "BSE" : (rawExchange || "NSE"));

    const rawTxRows = symRows.filter(r => r["Type"] !== "" && r["Transaction Date"] !== "");

    const typeOrder = { "Buy": 1, "Dividend Reinvest": 1, "Split": 2, "Sell": 3, "Sell All": 4, "Dividend": 5 };

    rawTxRows.sort((a, b) => {
      const da = parseDate(a["Transaction Date"]) || "";
      const db = parseDate(b["Transaction Date"]) || "";
      if (da !== db) return da.localeCompare(db);
      return (typeOrder[a["Type"]] || 99) - (typeOrder[b["Type"]] || 99);
    });

    let currentQty = 0;
    let totalBuyQty = 0;
    let totalBuyCost = 0;
    let totalSellQty = 0;
    let totalCharges = 0;
    let realizedPnl = 0;
    const buyLots = [];

    const processedTxs = [];
    const processedDivs = [];

    for (const r of rawTxRows) {
      const rawType = r["Type"];
      const dateStr = parseDate(r["Transaction Date"]);
      if (!dateStr) continue;

      const price = parseFloat(r["Cost Per Share"]) || 0;
      const commission = parseFloat(r["Commission"]) || 0;
      totalCharges += commission;

      if (rawType === "Buy") {
        const qty = parseFloat(r["Shares Owned"]) || 0;
        if (qty <= 0) continue;
        currentQty += qty;
        totalBuyQty += qty;
        totalBuyCost += qty * price;
        buyLots.push({ qty, price });

        processedTxs.push({
          type: "BUY",
          quantity: qty,
          price: price,
          total_amount: parseFloat((qty * price).toFixed(2)),
          charges: parseFloat(commission.toFixed(2)),
          date: dateStr,
          notes: null
        });

      } else if (rawType === "Dividend Reinvest" || rawType === "Bonus") {
        const qty = parseFloat(r["Shares Owned"]) || 0;
        if (qty <= 0) continue;
        const preQty = currentQty;
        currentQty += qty;
        totalBuyQty += qty;
        const bonusMultiplier = preQty > 0 ? (currentQty / preQty) : 1;
        
        // Scale all preceding open buy lots and buy transactions
        for (const lot of buyLots) {
          lot.qty = lot.qty * bonusMultiplier;
          lot.price = lot.price / bonusMultiplier;
        }
        for (const tx of processedTxs) {
          if (tx.type === "BUY") {
            tx.quantity = parseFloat((tx.quantity * bonusMultiplier).toFixed(4));
            tx.price = parseFloat((tx.price / bonusMultiplier).toFixed(4));
            tx.total_amount = parseFloat((tx.quantity * tx.price).toFixed(2));
          }
        }

        const bonusRatioStr = preQty > 0 ? `1:${parseFloat((qty / preQty).toFixed(2))}` : `+${qty} shares`;
        processedTxs.push({
          type: "BONUS",
          quantity: 0,
          price: 0,
          total_amount: 0,
          charges: parseFloat(commission.toFixed(2)),
          date: dateStr,
          notes: `+${qty} Shares Received as Bonus`
        });

      } else if (rawType === "Split") {
        const newRatio = parseFloat(r["Shares Owned"]) || 1;
        const oldRatio = parseFloat(r["Cost Per Share"]) || 1;
        if (oldRatio <= 0 || newRatio <= 0) {
          console.warn(`[Validation Warning] Invalid split ratio for ${symbol} on ${dateStr}: ${oldRatio}:${newRatio}`);
          continue;
        }
        const splitMultiplier = newRatio / oldRatio;
        const preSplitQty = currentQty;
        currentQty = currentQty * splitMultiplier;
        totalBuyQty = totalBuyQty * splitMultiplier;

        // Scale all preceding open buy lots and buy transactions
        for (const lot of buyLots) {
          lot.qty = lot.qty * splitMultiplier;
          lot.price = lot.price / splitMultiplier;
        }
        for (const tx of processedTxs) {
          if (tx.type === "BUY") {
            tx.quantity = parseFloat((tx.quantity * splitMultiplier).toFixed(4));
            tx.price = parseFloat((tx.price / splitMultiplier).toFixed(4));
            tx.total_amount = parseFloat((tx.quantity * tx.price).toFixed(2));
          }
        }

        processedTxs.push({
          type: "SPLIT",
          quantity: 0,
          price: 0,
          total_amount: 0,
          charges: 0,
          date: dateStr,
          notes: `Stock Split (${oldRatio}:${newRatio})`
        });

      } else if (rawType === "Sell" || rawType === "Sell All") {
        let qty = 0;
        if (rawType === "Sell All") {
          qty = currentQty;
        } else {
          qty = parseFloat(r["Shares Owned"]) || 0;
        }

        if (qty > 0) {
          totalSellQty += qty;
          currentQty = Math.max(0, currentQty - qty);

          let remaining = qty;
          while (remaining > 0 && buyLots.length > 0) {
            const lot = buyLots[0];
            const used = Math.min(lot.qty, remaining);
            realizedPnl += used * (price - lot.price);
            lot.qty -= used;
            remaining -= used;
            if (lot.qty <= 0) buyLots.shift();
          }

          processedTxs.push({
            type: "SELL",
            quantity: qty,
            price: price,
            total_amount: parseFloat((qty * price).toFixed(2)),
            charges: parseFloat(commission.toFixed(2)),
            date: dateStr,
            notes: rawType === "Sell All" ? "Sell All (Full position liquidated)" : null
          });
        }

      } else if (rawType === "Dividend") {
        const rawAmt = parseFloat(r["Cost Per Share"]) || 0;
        const sharesVal = parseFloat(r["Shares Owned"]) || 0;
        const amount = rawAmt > 0 ? rawAmt : sharesVal;

        processedDivs.push({
          amount_original: amount,
          currency: "INR",
          fx_rate: 1,
          amount_inr: amount,
          ex_date: dateStr,
          payment_date: dateStr
        });

        processedTxs.push({
          type: "DIVIDEND",
          quantity: 0,
          price: 0,
          total_amount: amount,
          charges: parseFloat(commission.toFixed(2)),
          date: dateStr,
          notes: `Dividend ₹${amount}`
        });
      }
    }

    // Ingestion Integrity Assertions
    if (totalSellQty > totalBuyQty + 0.001 || currentQty < -0.001) {
      throw new Error(`[CRITICAL INGESTION VALIDATION FAILED for ${symbol}]: sell_qty (${totalSellQty}) > buy_qty (${totalBuyQty}) or currentQty (${currentQty}) < 0`);
    }

    const avgBuyPrice = currentQty > 0 && buyLots.length > 0
      ? buyLots.reduce((s, l) => s + l.qty * l.price, 0) / currentQty
      : (totalBuyQty > 0 ? totalBuyCost / totalBuyQty : 0);
    const status = currentQty <= 0 ? "REDEEMED" : "ACTIVE";

    if (status === "ACTIVE") totalActiveHoldings++;
    else totalRedeemedHoldings++;

    grandTotalBuyCost += totalBuyCost;
    grandTotalRealizedPnl += realizedPnl;
    grandTotalCharges += totalCharges;

    // 1. Insert Holding
    const { data: holding, error: hErr } = await supabase
      .from("holdings")
      .insert({
        user_id: null,
        category_id: "in_stocks",
        symbol: symbol,
        name: stockName,
        exchange: exchange,
        quantity: parseFloat(currentQty.toFixed(4)),
        avg_buy_price: parseFloat(avgBuyPrice.toFixed(4)),
        current_price: 0,
        currency: "INR",
        buy_qty: parseFloat(totalBuyQty.toFixed(4)),
        sell_qty: parseFloat(totalSellQty.toFixed(4)),
        realized_pnl: parseFloat(realizedPnl.toFixed(2)),
        total_charges: parseFloat(totalCharges.toFixed(2)),
        status: status
      })
      .select()
      .single();

    if (hErr) {
      console.error(`[${idx+1}/${allSymbols.length}] Error inserting holding for ${symbol}:`, hErr.message);
      continue;
    }

    // 2. Insert Transactions
    if (processedTxs.length > 0) {
      const txInserts = processedTxs.map(t => ({
        holding_id: holding.id,
        user_id: null,
        symbol: symbol,
        name: stockName,
        type: t.type,
        quantity: t.quantity,
        price: t.price,
        total_amount: t.total_amount,
        currency: "INR",
        date: t.date,
        notes: t.notes,
        charges: t.charges,
        net_amount: parseFloat((t.total_amount + t.charges).toFixed(2))
      }));

      const { error: txErr } = await supabase.from("transactions").insert(txInserts);
      if (txErr) console.error(`  Error inserting transactions for ${symbol}:`, txErr.message);
    }

    // 3. Insert Dividends
    if (processedDivs.length > 0) {
      const divInserts = processedDivs.map(d => ({
        holding_id: holding.id,
        user_id: null,
        symbol: symbol,
        name: stockName,
        amount_original: d.amount_original,
        currency: "INR",
        fx_rate: 1,
        amount_inr: d.amount_inr,
        ex_date: d.ex_date,
        payment_date: d.payment_date
      }));

      const { error: divErr } = await supabase.from("dividends").insert(divInserts);
      if (divErr) console.error(`  Error inserting dividends for ${symbol}:`, divErr.message);
      grandTotalDividends += divInserts.reduce((s, d) => s + d.amount_inr, 0);
    }

    // 4. Lock exact holding metrics (ensuring split/FIFO accuracy)
    await supabase
      .from("holdings")
      .update({
        quantity: parseFloat(currentQty.toFixed(4)),
        avg_buy_price: parseFloat(avgBuyPrice.toFixed(4)),
        buy_qty: parseFloat(totalBuyQty.toFixed(4)),
        sell_qty: parseFloat(totalSellQty.toFixed(4)),
        realized_pnl: parseFloat(realizedPnl.toFixed(2)),
        total_charges: parseFloat(totalCharges.toFixed(2)),
        status: status
      })
      .eq("id", holding.id);

    if ((idx + 1) % 50 === 0 || idx + 1 === allSymbols.length) {
      console.log(`Progress: [${idx + 1}/${allSymbols.length}] symbols processed...`);
    }
  }

  console.log("\n=======================================================");
  console.log("=== FULL INDIAN STOCKS INGESTION SUMMARY ===");
  console.log("=======================================================");
  console.log(`  Total Symbols Processed: ${allSymbols.length}`);
  console.log(`  Active Holdings (Qty > 0): ${totalActiveHoldings}`);
  console.log(`  Redeemed Holdings (Qty = 0): ${totalRedeemedHoldings}`);
  console.log(`  Total Cumulative Buy Cost: ₹${grandTotalBuyCost.toFixed(2)}`);
  console.log(`  Total Realized P&L: ₹${grandTotalRealizedPnl.toFixed(2)}`);
  console.log(`  Total Dividends Recorded: ₹${grandTotalDividends.toFixed(2)}`);
  console.log(`  Total Brokerage / Charges: ₹${grandTotalCharges.toFixed(2)}`);
  console.log("=======================================================\n");
}

run().catch(console.error);
