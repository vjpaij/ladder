import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import { supabase } from '../supabaseClient.js';

// Category Definitions matching Supabase schema
const CATEGORIES = [
  { id: 'in_stocks', name: 'Indian Stocks (NSE/BSE)', type: 'ASSET', icon: 'TrendingUp', color: '#10B981' },
  { id: 'us_stocks', name: 'US Equity (NASDAQ/NYSE)', type: 'ASSET', icon: 'Globe', color: '#8B5CF6' },
  { id: 'mutual_funds', name: 'Mutual Funds (AMFI)', type: 'ASSET', icon: 'PieChart', color: '#F59E0B' },
  { id: 'bank', name: 'Bank Accounts & FDs', type: 'ASSET', icon: 'Landmark', color: '#3B82F6' },
  { id: 'loans', name: 'Home & Personal Loans', type: 'LIABILITY', icon: 'CreditCard', color: '#EF4444' },
  { id: 'credit_cards', name: 'Credit Card Balances', type: 'LIABILITY', icon: 'Wallet', color: '#F43F5E' }
];

function generateUuid(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(12, '0');
  return `10000000-0000-4000-8000-${hex.slice(0, 12)}`;
}

// Historical USD/INR exchange rate lookup for US stocks transaction dates
function getHistoricalFxRate(dateStr) {
  if (!dateStr) return 87.25;
  const year = parseInt(String(dateStr).slice(0, 4), 10);
  if (isNaN(year)) return 87.25;

  if (year <= 2019) return 70.4;
  if (year === 2020) return 74.1;
  if (year === 2021) return 73.9;
  if (year === 2022) return 79.8;
  if (year === 2023) return 82.6;
  if (year === 2024) return 83.5;
  if (year === 2025) return 85.2;
  return 87.25; // 2026 / current live rate
}

function parseCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const regex = /(?:^|,)(?:"([^"]*)"|([^,]*))/g;
    const row = [];
    let match;
    while ((match = regex.exec(lines[i])) !== null) {
      if (match[0] === '' && row.length >= headers.length) break;
      const val = match[1] !== undefined ? match[1] : match[2];
      row.push(val ? val.trim() : '');
    }
    if (row.length > 0) {
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = row[idx] || '';
      });
      rows.push(obj);
    }
  }
  return rows;
}

async function loadData() {
  console.log('=== [Ladder Portfolio Ingestion Engine] ===\n');

  // 1. Ensure Categories exist in Supabase
  console.log('[1/4] Ensuring core investment categories in Supabase...');
  for (const cat of CATEGORIES) {
    const { error } = await supabase.from('categories').upsert(cat, { onConflict: 'id' });
    if (error) console.error(`   Error upserting category ${cat.name}:`, error.message);
  }
  console.log('   Categories setup complete.');

  // Data aggregators
  const holdingsMap = {}; // key -> holding object
  const transactionsList = [];
  const dividendsList = [];

  function getOrCreateHolding(key, symbol, name, categoryId, exchange, currency, isin = '') {
    if (!holdingsMap[key]) {
      holdingsMap[key] = {
        id: generateUuid(key),
        category_id: categoryId,
        symbol: symbol,
        name: name,
        exchange: exchange,
        currency: currency,
        isin: isin,
        buy_qty: 0,
        sell_qty: 0,
        quantity: 0,
        total_buy_val: 0,
        total_buy_val_inr: 0, // Invested value in INR calculated at transaction date FX rate
        avg_buy_price: 0,
        avg_buy_price_inr: 0,
        current_price: 0,
        total_charges: 0,
        realized_pnl: 0
      };
    }
    return holdingsMap[key];
  }

  // -------------------------------------------------------------
  // 2. Parse Indian Stocks (Ind_Stocks.csv)
  // -------------------------------------------------------------
  const indStocksPath = path.resolve(process.cwd(), 'Indian Stocks', 'Ind_Stocks.csv');
  if (fs.existsSync(indStocksPath)) {
    console.log('\n[2/4] Parsing Indian Stocks dataset (Ind_Stocks.csv)...');
    const rows = parseCsv(indStocksPath);
    console.log(`   Found ${rows.length} raw transaction rows.`);

    rows.forEach(r => {
      const symbol = r['Symbol'] || r['name'] || 'IND_STOCK';
      const name = r['Name'] || symbol;
      const isin = r['ISIN'] || '';
      const date = r['Transaction Date'];
      const rawType = (r['Transaction Type'] || '').toUpperCase();
      const amount = Math.abs(parseFloat(r['Transaction Amount']) || 0);
      const charges = Math.abs(parseFloat(r['Transaction Charges']) || 0);
      const units = Math.abs(parseFloat(r['Transaction Units']) || 0);
      const price = parseFloat(r['Transaction Price']) || (units > 0 ? amount / units : 0);
      const latestPrice = parseFloat(r['Price']) || 0;

      if (!date || !rawType) return;

      const key = `IND_STOCK_${symbol.toUpperCase()}`;
      const holding = getOrCreateHolding(key, symbol, name, 'in_stocks', 'NSE', 'INR', isin);

      if (latestPrice > 0) holding.current_price = latestPrice;

      if (rawType.includes('PURCHASE') || rawType === 'BUY') {
        holding.buy_qty += units;
        holding.total_buy_val += amount;
        holding.total_buy_val_inr += amount;
        holding.total_charges += charges;

        transactionsList.push({
          id: generateUuid(`tx_${key}_${date}_${transactionsList.length}`),
          holding_id: holding.id,
          type: 'BUY',
          quantity: units,
          price: price,
          total_amount: amount,
          charges: charges,
          currency: 'INR',
          date: date,
          notes: `Purchase of ${units} shares of ${symbol} (${name})`
        });
      } else if (rawType.includes('SALE') || rawType === 'SELL') {
        holding.sell_qty += units;
        holding.total_charges += charges;

        transactionsList.push({
          id: generateUuid(`tx_${key}_${date}_${transactionsList.length}`),
          holding_id: holding.id,
          type: 'SELL',
          quantity: units,
          price: price,
          total_amount: amount,
          charges: charges,
          currency: 'INR',
          date: date,
          notes: `Sale of ${units} shares of ${symbol} (${name})`
        });
      } else if (rawType.includes('DIVIDEND')) {
        dividendsList.push({
          id: generateUuid(`div_${key}_${date}_${dividendsList.length}`),
          holding_id: holding.id,
          amount_original: amount,
          currency: 'INR',
          fx_rate: 1.0,
          amount_inr: amount,
          payment_date: date
        });
      }
    });
  } else {
    console.warn('   Ind_Stocks.csv not found.');
  }

  // -------------------------------------------------------------
  // 3. Parse Mutual Funds (Ind_Mfs.csv)
  // -------------------------------------------------------------
  const indMfsPath = path.resolve(process.cwd(), 'Mutual Funds', 'Ind_Mfs.csv');
  if (fs.existsSync(indMfsPath)) {
    console.log('\n[3/4] Parsing Mutual Funds dataset (Ind_Mfs.csv)...');
    const rows = parseCsv(indMfsPath);
    console.log(`   Found ${rows.length} raw transaction rows.`);

    rows.forEach(r => {
      const schemeCode = r['Scheme Code'] || 'MF_SCHEME';
      const schemeName = r['Scheme Name'] || schemeCode;
      const isin = r['ISIN'] || '';
      const date = r['Transaction Date'];
      const rawType = (r['Transaction Type'] || '').toUpperCase();
      const amount = Math.abs(parseFloat(r['Transaction Amount']) || 0);
      const charges = Math.abs(parseFloat(r['Transaction Charges']) || 0);
      const units = Math.abs(parseFloat(r['Transaction Units']) || 0);
      const nav = parseFloat(r['Transaction NAV']) || (units > 0 ? amount / units : 0);
      const latestNav = parseFloat(r['NAV']) || 0;

      if (!date || !rawType) return;

      const key = `MF_${schemeCode}`;
      const holding = getOrCreateHolding(key, schemeCode, schemeName, 'mutual_funds', 'AMFI', 'INR', isin);

      if (latestNav > 0) holding.current_price = latestNav;

      if (rawType.includes('INVESTMENT') || rawType === 'BUY') {
        holding.buy_qty += units;
        holding.total_buy_val += amount;
        holding.total_buy_val_inr += amount;
        holding.total_charges += charges;

        transactionsList.push({
          id: generateUuid(`tx_${key}_${date}_${transactionsList.length}`),
          holding_id: holding.id,
          type: 'BUY',
          quantity: units,
          price: nav,
          total_amount: amount,
          charges: charges,
          currency: 'INR',
          date: date,
          notes: `SIP/Lumpsum investment in ${schemeName}`
        });
      } else if (rawType.includes('REDEMPTION') || rawType === 'SELL') {
        holding.sell_qty += units;
        holding.total_charges += charges;

        transactionsList.push({
          id: generateUuid(`tx_${key}_${date}_${transactionsList.length}`),
          holding_id: holding.id,
          type: 'SELL',
          quantity: units,
          price: nav,
          total_amount: amount,
          charges: charges,
          currency: 'INR',
          date: date,
          notes: `Redemption of ${units} units from ${schemeName}`
        });
      }
    });
  } else {
    console.warn('   Ind_Mfs.csv not found.');
  }

  // -------------------------------------------------------------
  // 4. Parse US Stocks (US_Stocks.xls)
  // -------------------------------------------------------------
  const usStocksPath = path.resolve(process.cwd(), 'US Stocks', 'US_Stocks.xls');
  if (fs.existsSync(usStocksPath)) {
    console.log('\n[4/4] Parsing US Stocks dataset (US_Stocks.xls)...');
    const workbook = xlsx.readFile(usStocksPath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    const headerRow = rawData[10] || [];
    console.log('   Headers:', headerRow.join(' | '));

    const rows = rawData.slice(11);
    console.log(`   Found ${rows.length} raw transaction rows.`);

    rows.forEach(r => {
      if (!r || r.length < 5) return;
      const stockName = r[0] || '';
      const symbol = r[1] || '';
      const dateStr = r[3] || r[2] || '';
      const rawType = (r[5] || '').toUpperCase();
      const qty = Math.abs(parseFloat(r[7]) || 0);
      const priceUSD = parseFloat(r[8]) || 0;
      const amountUSD = Math.abs(parseFloat(r[9]) || 0);
      const brokerageUSD = Math.abs(parseFloat(r[10]) || 0);

      if (!symbol || !rawType || qty === 0) return;

      let date = dateStr;
      try {
        const parsedDate = new Date(dateStr);
        if (!isNaN(parsedDate.getTime())) {
          date = parsedDate.toISOString().split('T')[0];
        }
      } catch (e) {}

      // Transaction date exchange rate (for purchase cost basis in INR)
      const txFxRate = getHistoricalFxRate(date);
      const amountINR_at_tx = amountUSD * txFxRate;

      const key = `US_STOCK_${symbol.toUpperCase()}`;
      const holding = getOrCreateHolding(key, symbol, stockName, 'us_stocks', 'NASDAQ', 'USD');

      if (rawType.includes('BUY')) {
        holding.buy_qty += qty;
        holding.total_buy_val += amountUSD;
        holding.total_buy_val_inr += amountINR_at_tx;
        holding.total_charges += brokerageUSD;

        transactionsList.push({
          id: generateUuid(`tx_${key}_${date}_${transactionsList.length}`),
          holding_id: holding.id,
          type: 'BUY',
          quantity: qty,
          price: priceUSD,
          total_amount: amountUSD,
          charges: brokerageUSD,
          currency: 'USD',
          date: date,
          notes: `US Equity Buy of ${symbol} (${stockName}) at FX rate ₹${txFxRate}/$`
        });
      } else if (rawType.includes('SELL')) {
        holding.sell_qty += qty;
        holding.total_charges += brokerageUSD;

        transactionsList.push({
          id: generateUuid(`tx_${key}_${date}_${transactionsList.length}`),
          holding_id: holding.id,
          type: 'SELL',
          quantity: qty,
          price: priceUSD,
          total_amount: amountUSD,
          charges: brokerageUSD,
          currency: 'USD',
          date: date,
          notes: `US Equity Sell of ${symbol} (${stockName}) at FX rate ₹${txFxRate}/$`
        });
      }
    });
  } else {
    console.warn('   US_Stocks.xls not found.');
  }

  // -------------------------------------------------------------
  // Calculate Final Holding Positions
  // -------------------------------------------------------------
  const finalHoldings = Object.values(holdingsMap).map(h => {
    const netQty = h.buy_qty - h.sell_qty;
    const avgBuyPriceUSD = h.buy_qty > 0 ? (h.total_buy_val / h.buy_qty) : 0;
    const avgBuyPriceINR = h.buy_qty > 0 ? (h.total_buy_val_inr / h.buy_qty) : 0;
    const currentPrice = h.current_price > 0 ? h.current_price : avgBuyPriceUSD;
    const status = netQty > 0.0001 ? 'active' : 'closed';

    return {
      id: h.id,
      category_id: h.category_id,
      symbol: h.symbol,
      name: h.name,
      exchange: h.exchange,
      currency: h.currency,
      quantity: Number(netQty.toFixed(4)),
      buy_qty: Number(h.buy_qty.toFixed(4)),
      sell_qty: Number(h.sell_qty.toFixed(4)),
      avg_buy_price: Number(avgBuyPriceUSD.toFixed(4)),
      current_price: Number(currentPrice.toFixed(4)),
      total_charges: Number(h.total_charges.toFixed(2)),
      status: status
    };
  });

  console.log(`\n=== Summary of Processed Records ===`);
  console.log(`Unique Investment Holdings: ${finalHoldings.length}`);
  console.log(`Total Transactions Logged: ${transactionsList.length}`);
  console.log(`Total Dividends Logged: ${dividendsList.length}`);

  // -------------------------------------------------------------
  // Upload Records to Supabase PostgreSQL Tables
  // -------------------------------------------------------------
  console.log('\n[Uploading to Supabase Database Tables...]');

  // 1. Upload Holdings
  console.log(' -> Uploading holdings...');
  for (const h of finalHoldings) {
    const { error } = await supabase.from('holdings').upsert(h, { onConflict: 'id' });
    if (error) console.error(`   Error upserting holding ${h.symbol}:`, error.message);
  }

  // 2. Upload Transactions in batches of 50
  console.log(' -> Uploading transactions...');
  const batchSize = 50;
  for (let i = 0; i < transactionsList.length; i += batchSize) {
    const batch = transactionsList.slice(i, i + batchSize);
    const { error } = await supabase.from('transactions').upsert(batch, { onConflict: 'id' });
    if (error) console.error(`   Error upserting transaction batch ${i}:`, error.message);
  }

  // 3. Upload Dividends
  if (dividendsList.length > 0) {
    console.log(' -> Uploading dividends...');
    const { error } = await supabase.from('dividends').upsert(dividendsList, { onConflict: 'id' });
    if (error) console.error(`   Error upserting dividends:`, error.message);
  }

  console.log('\n SUCCESS: All Indian Stocks, Mutual Funds, and US Stocks datasets successfully loaded into Supabase PostgreSQL database tables!\n');
}

loadData().catch(err => {
  console.error('Fatal Ingestion Error:', err);
});
