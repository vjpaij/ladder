import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const TEST_SYMBOL = 'BLUESTARCO';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

function parseDate(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

async function loadSymbol(targetSymbol) {
  console.log('\n=== Loading trial symbol:', targetSymbol, '===\n');

  const wb = XLSX.readFile('./Indian Stocks/Book1.xlsx');
  const ws = wb.Sheets['Sheet1'];
  const allRows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  const symRows = allRows.filter(r => r['Display Symbol'] === targetSymbol);
  if (symRows.length === 0) {
    console.error('No rows found for symbol:', targetSymbol);
    return;
  }

  const infoRow = symRows[0];
  const stockName = infoRow['Name'] || targetSymbol;
  const rawExchange = infoRow['Exchange'];
  const exchange = rawExchange === 'NSI' ? 'NSE' : (rawExchange === 'BSI' ? 'BSE' : (rawExchange || 'NSE'));

  const rawTxRows = symRows.filter(r => r['Type'] !== '' && r['Transaction Date'] !== '');

  rawTxRows.sort((a, b) => {
    const da = parseDate(a['Transaction Date']) || '';
    const db = parseDate(b['Transaction Date']) || '';
    return da.localeCompare(db);
  });

  console.log('Stock:', stockName, '(' + targetSymbol + ') | Exchange:', exchange);
  console.log('Total rows in Excel:', symRows.length, '| Valid transaction rows:', rawTxRows.length);

  let currentQty = 0;       // Open quantity at any moment
  let totalBuyQty = 0;      // Cumulative buy + bonus quantity
  let totalBuyCost = 0;     // Cumulative buy + bonus cost
  let totalSellQty = 0;     // Cumulative sell quantity
  let totalCharges = 0;
  let realizedPnl = 0;
  const buyLots = [];       // FIFO lots

  const processedTxs = [];
  const processedDivs = [];

  for (const r of rawTxRows) {
    const rawType = r['Type'];
    const dateStr = parseDate(r['Transaction Date']);
    if (!dateStr) continue;

    // RULE 4: Ignore type Splits
    if (rawType === 'Split') {
      console.log('  [IGNORE SPLIT] Date:', dateStr);
      continue;
    }

    const price = parseFloat(r['Cost Per Share']) || 0;
    const commission = parseFloat(r['Commission']) || 0;
    totalCharges += commission;

    if (rawType === 'Buy') {
      const qty = parseFloat(r['Shares Owned']) || 0;
      currentQty += qty;
      totalBuyQty += qty;
      totalBuyCost += qty * price;
      buyLots.push({ qty, price });

      processedTxs.push({
        type: 'BUY',
        quantity: qty,
        price: price,
        total_amount: parseFloat((qty * price).toFixed(2)),
        charges: parseFloat(commission.toFixed(2)),
        date: dateStr,
        notes: null
      });
      console.log('  [BUY] Date:', dateStr, '| Qty:', qty, '| Price: ?' + price, '| Open Qty:', currentQty);

    } else if (rawType === 'Dividend Reinvest') {
      // RULE 3: Dividend Reinvestment is addition of new quantities. Save as BONUS.
      const qty = parseFloat(r['Shares Owned']) || 0;
      currentQty += qty;
      totalBuyQty += qty;
      totalBuyCost += qty * price;
      buyLots.push({ qty, price });

      processedTxs.push({
        type: 'BONUS',
        quantity: qty,
        price: price,
        total_amount: parseFloat((qty * price).toFixed(2)),
        charges: parseFloat(commission.toFixed(2)),
        date: dateStr,
        notes: 'Dividend Reinvestment / Bonus'
      });
      console.log('  [BONUS] Date:', dateStr, '| Qty:', qty, '| Price: ?' + price, '| Open Qty:', currentQty);

    } else if (rawType === 'Sell' || rawType === 'Sell All') {
      // RULE 2: When type is Sell All -> The Sell quantity would be the Open quantity at that moment. Save as SELL.
      let qty = 0;
      if (rawType === 'Sell All') {
        qty = currentQty;
        console.log('  [SELL ALL -> SELL] Date:', dateStr, '| Open Qty:', qty, '| Price: ?' + price);
      } else {
        qty = parseFloat(r['Shares Owned']) || 0;
        console.log('  [SELL] Date:', dateStr, '| Qty:', qty, '| Price: ?' + price);
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
          type: 'SELL',
          quantity: qty,
          price: price,
          total_amount: parseFloat((qty * price).toFixed(2)),
          charges: parseFloat(commission.toFixed(2)),
          date: dateStr,
          notes: rawType === 'Sell All' ? 'Sell All (Full position liquidated)' : null
        });
      }

    } else if (rawType === 'Dividend') {
      // RULE 1: Dividend saved in dividends table
      const rawAmt = parseFloat(r['Cost Per Share']) || 0;
      const sharesVal = parseFloat(r['Shares Owned']) || 0;
      const amount = rawAmt > 0 ? rawAmt : sharesVal;

      processedDivs.push({
        amount_original: amount,
        currency: 'INR',
        fx_rate: 1,
        amount_inr: amount,
        ex_date: dateStr,
        payment_date: dateStr
      });

      processedTxs.push({
        type: 'DIVIDEND',
        quantity: 0,
        price: 0,
        total_amount: amount,
        charges: parseFloat(commission.toFixed(2)),
        date: dateStr,
        notes: 'Dividend ?' + amount
      });
      console.log('  [DIVIDEND] Date:', dateStr, '| Amount: ?' + amount);
    }
  }

  const avgBuyPrice = totalBuyQty > 0 ? totalBuyCost / totalBuyQty : 0;
  const status = currentQty <= 0 ? 'REDEEMED' : 'ACTIVE';

  console.log('\n=== Computed Summary for', targetSymbol, '===\n');
  console.log('  Buy Qty (inc. Bonus):', totalBuyQty);
  console.log('  Sell Qty:', totalSellQty);
  console.log('  Remaining Open Qty:', currentQty);
  console.log('  Total Buy Cost: ?' + totalBuyCost.toFixed(2));
  console.log('  Avg Buy Price: ?' + avgBuyPrice.toFixed(4));
  console.log('  Realized P&L: ?' + realizedPnl.toFixed(2));
  console.log('  Total Charges: ?' + totalCharges.toFixed(2));
  console.log('  Status:', status);

  // Delete existing records for BLUESTARCO if any
  const { data: existingHoldings } = await supabase.from('holdings').select('id').eq('symbol', targetSymbol);
  if (existingHoldings && existingHoldings.length > 0) {
    const ids = existingHoldings.map(h => h.id);
    await supabase.from('transactions').delete().in('holding_id', ids);
    await supabase.from('dividends').delete().in('holding_id', ids);
    await supabase.from('holdings').delete().in('id', ids);
    console.log('Deleted existing', ids.length, 'holding records for', targetSymbol);
  }

  // Insert Holding
  const { data: holding, error: hErr } = await supabase.from('holdings').insert({
    user_id: null,
    category_id: 'in_stocks',
    symbol: targetSymbol,
    name: stockName,
    exchange: exchange,
    quantity: currentQty,
    avg_buy_price: parseFloat(avgBuyPrice.toFixed(4)),
    current_price: 0,
    currency: 'INR',
    buy_qty: totalBuyQty,
    sell_qty: totalSellQty,
    realized_pnl: parseFloat(realizedPnl.toFixed(2)),
    total_charges: parseFloat(totalCharges.toFixed(2)),
    status: status
  }).select().single();

  if (hErr) {
    console.error('Holding insert error:', hErr.message);
    return;
  }
  console.log('\nHolding inserted in Supabase: ID =', holding.id);

  // Insert Transactions
  const txInserts = processedTxs.map(t => ({
    holding_id: holding.id,
    user_id: null,
    symbol: targetSymbol,
    name: stockName,
    type: t.type,
    quantity: t.quantity,
    price: t.price,
    total_amount: t.total_amount,
    currency: 'INR',
    date: t.date,
    notes: t.notes,
    charges: t.charges,
    net_amount: parseFloat((t.total_amount + t.charges).toFixed(2))
  }));

  if (txInserts.length > 0) {
    const { error: txErr } = await supabase.from('transactions').insert(txInserts);
    if (txErr) console.error('Transaction insert error:', txErr.message);
    else console.log('Inserted', txInserts.length, 'transaction records.');
  }

  // Insert Dividends
  if (processedDivs.length > 0) {
    const divInserts = processedDivs.map(d => ({
      holding_id: holding.id,
      user_id: null,
      symbol: targetSymbol,
      name: stockName,
      amount_original: d.amount_original,
      currency: 'INR',
      fx_rate: 1,
      amount_inr: d.amount_inr,
      ex_date: d.ex_date,
      payment_date: d.payment_date
    }));
    const { error: divErr } = await supabase.from('dividends').insert(divInserts);
    if (divErr) console.error('Dividend insert error:', divErr.message);
    else console.log('Inserted', divInserts.length, 'dividend records.');
  }

  console.log('\n=== Trial Complete for', targetSymbol, '! ===');
}

loadSymbol(TEST_SYMBOL).catch(console.error);
