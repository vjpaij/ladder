import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const TEST_SYMBOL = "AARTIDRUGS";

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

// Parse date like "2022-10-24 GMT+0530" to "2022-10-24"
function parseDate(raw) {
  if (!raw || typeof raw !== "string") return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

async function main() {
  console.log(`\n=== Loading test symbol: ${TEST_SYMBOL} ===\n`);

  const wb = XLSX.readFile("./Indian Stocks/Book1.xlsx");
  const ws = wb.Sheets["Sheet1"];
  const allRows = XLSX.utils.sheet_to_json(ws, { defval: "" });

  // Filter to this symbol only
  const symRows = allRows.filter(r => r["Display Symbol"] === TEST_SYMBOL);
  const infoRow = symRows[0];
  const txRows = symRows.filter(r => r["Type"] !== "" && r["Transaction Date"] !== "");

  const stockName = infoRow["Name"] || TEST_SYMBOL;
  const exchange = infoRow["Exchange"] === "NSI" ? "NSE" : (infoRow["Exchange"] || "NSE");

  console.log(`Name: ${stockName} | Exchange: ${exchange}`);
  console.log(`Total rows: ${symRows.length} | Transaction rows: ${txRows.length}`);

  txRows.forEach((r, i) => {
    console.log(`  Tx ${i+1}: ${r["Type"]} | ${r["Transaction Date"]} | Qty=${r["Shares Owned"]} | Price=${r["Cost Per Share"]} | Commission=${r["Commission"]}`);
  });

  // ---- Compute holding summary (FIFO) ----
  let totalBuyQty = 0, totalBuyCost = 0, totalSellQty = 0, totalCharges = 0;
  let realizedPnl = 0;
  const buyLots = [];

  for (const r of txRows) {
    const type = r["Type"];
    const qty = parseFloat(r["Shares Owned"]) || 0;
    const price = parseFloat(r["Cost Per Share"]) || 0;
    const commission = parseFloat(r["Commission"]) || 0;
    totalCharges += commission;

    if (type === "Buy" || type === "Dividend Reinvest") {
      totalBuyQty += qty;
      totalBuyCost += qty * price;
      buyLots.push({ qty, price });
    } else if (type === "Sell" || type === "Sell All") {
      totalSellQty += qty;
      let remaining = qty;
      while (remaining > 0 && buyLots.length > 0) {
        const lot = buyLots[0];
        const used = Math.min(lot.qty, remaining);
        realizedPnl += used * (price - lot.price);
        lot.qty -= used;
        remaining -= used;
        if (lot.qty <= 0) buyLots.shift();
      }
    }
    // Dividend, Split: skip for qty/cost calc
  }

  const currentQty = totalBuyQty - totalSellQty;
  const avgBuyPrice = totalBuyQty > 0 ? totalBuyCost / totalBuyQty : 0;
  const status = currentQty <= 0 ? "REDEEMED" : "ACTIVE";

  console.log(`\n=== Computed Holding ===`);
  console.log(`  Buy Qty: ${totalBuyQty} | Sell Qty: ${totalSellQty} | Current Qty: ${currentQty}`);
  console.log(`  Avg Buy Price: ${avgBuyPrice.toFixed(4)} | Realized PnL: ${realizedPnl.toFixed(2)} | Charges: ${totalCharges.toFixed(2)}`);
  console.log(`  Status: ${status}`);

  // ---- Insert Holding ----
  const { data: holding, error: hErr } = await supabase.from("holdings").insert({
    user_id: null,
    category_id: "in_stocks",
    symbol: TEST_SYMBOL,
    name: stockName,
    exchange: exchange,
    quantity: currentQty,
    avg_buy_price: parseFloat(avgBuyPrice.toFixed(4)),
    current_price: 0,
    currency: "INR",
    buy_qty: totalBuyQty,
    sell_qty: totalSellQty,
    realized_pnl: parseFloat(realizedPnl.toFixed(2)),
    total_charges: parseFloat(totalCharges.toFixed(2)),
    status: status
  }).select().single();

  if (hErr) { console.error("Holding insert error:", hErr.message, hErr.details); process.exit(1); }
  console.log(`\nHolding inserted: ID=${holding.id}`);

  // ---- Insert Transactions ----
  const txInserts = [];
  for (const r of txRows) {
    const type = r["Type"];
    const qty = parseFloat(r["Shares Owned"]) || 0;
    const price = parseFloat(r["Cost Per Share"]) || 0;
    const commission = parseFloat(r["Commission"]) || 0;
    const dateStr = parseDate(r["Transaction Date"]);
    if (!dateStr) continue;

    let txType = null;
    if (type === "Buy" || type === "Dividend Reinvest") txType = "BUY";
    else if (type === "Sell" || type === "Sell All") txType = "SELL";
    else if (type === "Dividend") txType = "DIVIDEND";
    else if (type === "Split") txType = "SPLIT";
    if (!txType) continue;

    txInserts.push({
      holding_id: holding.id,
      user_id: null,
      symbol: TEST_SYMBOL,
      name: stockName,
      type: txType,
      quantity: qty,
      price: price,
      total_amount: parseFloat((qty * price).toFixed(2)),
      currency: "INR",
      date: dateStr,
      notes: type === "Dividend Reinvest" ? "Dividend Reinvest" : (type === "Split" ? "Stock Split" : null),
      charges: parseFloat(commission.toFixed(2)),
      net_amount: parseFloat((qty * price + commission).toFixed(2))
    });
  }

  if (txInserts.length > 0) {
    const { error: txErr } = await supabase.from("transactions").insert(txInserts);
    if (txErr) { console.error("Transaction insert error:", txErr.message, txErr.details); process.exit(1); }
    console.log(`Inserted ${txInserts.length} transactions.`);
  }

  // ---- Insert Dividends ----
  const divRows = txRows.filter(r => r["Type"] === "Dividend");
  if (divRows.length > 0) {
    const divInserts = divRows.map(r => {
      const rawAmt = parseFloat(r["Cost Per Share"]) || 0;
      const qty = parseFloat(r["Shares Owned"]) || 0;
      // For Dividend rows: Cost Per Share is 0, Shares Owned holds the total dividend amount
      const amount = rawAmt > 0 ? rawAmt : qty;
      return {
        holding_id: holding.id,
        user_id: null,
        symbol: TEST_SYMBOL,
        name: stockName,
        amount_original: amount,
        currency: "INR",
        fx_rate: 1,
        amount_inr: amount,
        ex_date: parseDate(r["Transaction Date"]),
        payment_date: parseDate(r["Transaction Date"])
      };
    });
    console.log("Dividend rows to insert:", JSON.stringify(divInserts));
    const { error: dErr } = await supabase.from("dividends").insert(divInserts);
    if (dErr) console.error("Dividend insert error:", dErr.message, dErr.details);
    else console.log(`Inserted ${divInserts.length} dividend records.`);
  }

  console.log(`\n=== DONE: ${TEST_SYMBOL} loaded successfully! Check the dashboard. ===`);
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
