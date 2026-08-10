import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

// ---------------------------------------------------------------------------
// Scheme name -> npsnav.in scheme code mapping
// The CSV files use various name formats; we normalize to the canonical code.
// ---------------------------------------------------------------------------
const SCHEME_CODE_MAP = {
  // Aditya Birla Sunlife
  "ADITYA BIRLA SUNLIFE PENSION FUND SCHEME E - TIER I POP": "SM010001",
  "ADITYA BIRLA SUNLIFE PENSION FUND SCHEME C - TIER I POP": "SM010002",
  "ADITYA BIRLA SUNLIFE PENSION FUND SCHEME G - TIER I POP": "SM010003",
  // SBI
  "SBI PENSION FUND SCHEME E - TIER I POP": "SM001003",
  "SBI PENSION FUND SCHEME C - TIER I POP": "SM001004",
  "SBI PENSION FUND SCHEME G - TIER I POP": "SM001005",
  // LIC
  "LIC PENSION FUND SCHEME E - TIER I POP": "SM003005",
  "LIC PENSION FUND SCHEME C - TIER I POP": "SM003006",
  "LIC PENSION FUND SCHEME G - TIER I POP": "SM003007",
  // HDFC (POP)
  "NPS TRUST- A/C HDFC PENSION FUND MANAGEMENT LIMITED SCHEME C - TIER I POP": "SM008002",
  // UTI (POP)
  "NPS TRUST- A/C - UTI PENSION FUND SCHEME E - TIER I POP": "SM002003",
  // HDFC (DIRECT - new Multiple NAV Framework 2026)
  "NPS TRUST A/C HDFC PENSION FUND MANAGEMENT LIMITED SCHEME C - TIER I DIRECT": "SM008002",
  // LIC (DIRECT)
  "NPS TRUST A/C LIC PENSION FUND SCHEME G - TIER I DIRECT": "SM003007",
  // UTI (DIRECT)
  "NPS TRUST A/C - UTI PENSION FUND SCHEME E - TIER I DIRECT": "SM002003",
};

// Derive a short human-readable name from the raw scheme header
function shortName(raw) {
  // e.g. "ADITYA BIRLA SUNLIFE PENSION FUND SCHEME E - TIER I POP" -> "ABSL Scheme E Tier I"
  const r = raw.toUpperCase();
  if (r.includes("ADITYA BIRLA")) {
    const m = r.match(/SCHEME\s+([ECGA])\s*-\s*TIER\s+(I+)/);
    return m ? `ABSL Scheme ${m[1]} Tier ${m[2]}` : raw;
  }
  if (r.includes("SBI PENSION")) {
    const m = r.match(/SCHEME\s+([ECGA])\s*-\s*TIER\s+(I+)/);
    return m ? `SBI Scheme ${m[1]} Tier ${m[2]}` : raw;
  }
  if (r.includes("LIC PENSION")) {
    const m = r.match(/SCHEME\s+([ECGA])\s*-\s*TIER\s+(I+)/);
    const suffix = r.includes("DIRECT") ? " Direct" : "";
    return m ? `LIC Scheme ${m[1]} Tier ${m[2]}${suffix}` : raw;
  }
  if (r.includes("HDFC PENSION")) {
    const m = r.match(/SCHEME\s+([ECGA])\s*-\s*TIER\s+(I+)/);
    const suffix = r.includes("DIRECT") ? " Direct" : "";
    return m ? `HDFC Scheme ${m[1]} Tier ${m[2]}${suffix}` : raw;
  }
  if (r.includes("UTI PENSION") || r.includes("UTI RETIREMENT")) {
    const m = r.match(/SCHEME\s+([ECGA])\s*-\s*TIER\s+(I+)/);
    const suffix = r.includes("DIRECT") ? " Direct" : "";
    return m ? `UTI Scheme ${m[1]} Tier ${m[2]}${suffix}` : raw;
  }
  return raw;
}

// Derive the scheme type for sector tagging
function schemeType(raw) {
  const r = raw.toUpperCase();
  if (r.includes("SCHEME E")) return "Equity (E)";
  if (r.includes("SCHEME C")) return "Corporate Debt (C)";
  if (r.includes("SCHEME G")) return "Government Securities (G)";
  if (r.includes("SCHEME A")) return "Alternative (A)";
  return "NPS";
}

// Parse NPS date format "DD-Mon-YYYY" -> "YYYY-MM-DD"
function parseNpsDate(raw) {
  if (!raw) return null;
  const months = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const m = raw.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    const mm = months[m[2]] || "01";
    return `${m[3]}-${mm}-${m[1]}`;
  }
  return raw;
}

// Parse an NPS amount string: "(27.80)" -> -27.80, "3125.25" -> 3125.25
function parseAmount(raw) {
  if (!raw || raw === "") return 0;
  const s = String(raw).trim().replace(/,/g, "");
  if (s.startsWith("(") && s.endsWith(")")) {
    return -parseFloat(s.slice(1, -1));
  }
  return parseFloat(s) || 0;
}

// Classify a transaction description into a transaction type
function classifyTxType(desc) {
  const d = (desc || "").toLowerCase();
  if (d.includes("opening balance") || d.includes("closing balance")) return "IGNORE";
  if (d.includes("by voluntary contributions")) return "BUY";
  if (d.includes("by contribution on account of subscriber initiated scheme preference change")) return "BUY";
  if (d.includes("credit of units due to implementation of multiple nav framework")) return "BUY";
  if (d.includes("by switch in from")) return "BUY";
  if (d.includes("to switch out to")) return "SELL";
  if (d.includes("to withdrawal on account of subscriber initiated scheme preference change")) return "SELL";
  if (d.includes("debit of units due to implementation of multiple nav framework")) return "SELL";
  if (d.includes("billing for")) return "SELL"; // intermediary charges (unit deduction)
  return "BUY"; // default fallback
}

// ---------------------------------------------------------------------------
// Parse a single NPS CSV file and extract scheme-level transactions
// ---------------------------------------------------------------------------
function parseNpsCsv(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  // Find "Transaction Details" section
  let txStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "Transaction Details") {
      txStart = i + 1;
      break;
    }
  }
  if (txStart < 0) return [];

  const schemes = [];
  let currentScheme = null;
  let headerParsed = false;

  for (let i = txStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      headerParsed = false;
      continue;
    }

    // Check if this line is a scheme header (non-CSV, non-Date line that is a known scheme or contains PENSION/SCHEME)
    const upper = line.toUpperCase();
    if (
      !line.startsWith("Date,") &&
      !headerParsed &&
      (upper.includes("PENSION FUND SCHEME") ||
        upper.includes("NPS TRUST"))
    ) {
      currentScheme = {
        rawName: line.replace(/,$/, "").trim(),
        transactions: [],
      };
      schemes.push(currentScheme);
      headerParsed = false;
      continue;
    }

    // Header row
    if (line.startsWith("Date,Description,")) {
      headerParsed = true;
      continue;
    }

    // Transaction row: Date,Description,Amount (in Rs),NAV,Units
    if (headerParsed && currentScheme) {
      // Smart CSV split respecting commas inside descriptions
      const parts = [];
      let current = "";
      let inQuotes = false;
      for (const ch of line) {
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === "," && !inQuotes) { parts.push(current); current = ""; continue; }
        current += ch;
      }
      parts.push(current);

      if (parts.length >= 2) {
        const dateStr = parts[0].trim();
        const desc = parts[1].trim();
        const amount = parseAmount(parts[2]);
        const nav = parseFloat(parts[3]) || 0;
        const units = parseAmount(parts[4]);

        const txType = classifyTxType(desc);
        if (txType !== "IGNORE") {
          currentScheme.transactions.push({
            date: parseNpsDate(dateStr),
            description: desc,
            amount: Math.abs(amount),
            nav,
            units: Math.abs(units),
            type: txType,
          });
        }
      }
    }
  }

  return schemes;
}

// ---------------------------------------------------------------------------
// Main ingestion logic
// ---------------------------------------------------------------------------
async function run() {
  console.log("=== STARTING NPS PORTFOLIO INGESTION ===\n");

  const npsDir = path.resolve("./NPS");
  const csvFiles = fs.readdirSync(npsDir).filter(f => f.endsWith(".csv")).sort();
  console.log(`Found ${csvFiles.length} CSV files: ${csvFiles.join(", ")}\n`);

  // Purge existing NPS holdings and related records
  const { data: existingNps } = await supabase
    .from("holdings")
    .select("id")
    .eq("category_id", "nps");

  if (existingNps && existingNps.length > 0) {
    const existingIds = existingNps.map(h => h.id);
    console.log(`Purging ${existingIds.length} existing NPS holdings and related records...`);
    for (let i = 0; i < existingIds.length; i += 100) {
      const chunk = existingIds.slice(i, i + 100);
      await supabase.from("transactions").delete().in("holding_id", chunk);
      await supabase.from("dividends").delete().in("holding_id", chunk);
      await supabase.from("holdings").delete().in("id", chunk);
    }
    console.log("Purge complete.\n");
  }

  // Aggregate all transactions across all files by scheme raw name
  const schemeMap = {}; // rawName -> { transactions: [], ... }

  for (const file of csvFiles) {
    const filePath = path.join(npsDir, file);
    console.log(`Parsing: ${file}`);
    const schemes = parseNpsCsv(filePath);
    for (const scheme of schemes) {
      if (!schemeMap[scheme.rawName]) {
        schemeMap[scheme.rawName] = { rawName: scheme.rawName, transactions: [] };
      }
      schemeMap[scheme.rawName].transactions.push(...scheme.transactions);
    }
  }

  const schemeNames = Object.keys(schemeMap);
  console.log(`\nExtracted ${schemeNames.length} unique NPS schemes:\n`);
  schemeNames.forEach(n => console.log(`  - ${n}`));
  console.log();

  // Deduplicate transactions (same date + same amount + same type within a scheme)
  for (const name of schemeNames) {
    const txs = schemeMap[name].transactions;
    const seen = new Set();
    const deduped = [];
    for (const tx of txs) {
      const key = `${tx.date}|${tx.type}|${tx.amount.toFixed(4)}|${tx.units.toFixed(4)}|${tx.nav.toFixed(4)}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(tx);
      }
    }
    schemeMap[name].transactions = deduped;
  }

  // Sort transactions chronologically
  for (const name of schemeNames) {
    schemeMap[name].transactions.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  }

  // Upsert each scheme as a holding + insert transactions
  let totalHoldings = 0;
  let totalTxInserted = 0;

  for (const rawName of schemeNames) {
    const scheme = schemeMap[rawName];
    const code = SCHEME_CODE_MAP[rawName];
    if (!code) {
      console.warn(`WARNING: No scheme code mapping for "${rawName}" - SKIPPING`);
      continue;
    }

    const txs = scheme.transactions;
    if (txs.length === 0) continue;

    // Compute holding metrics from transactions
    let totalUnits = 0;
    let totalBuyCost = 0;
    let totalBuyUnits = 0;

    for (const tx of txs) {
      if (tx.type === "BUY") {
        totalUnits += tx.units;
        totalBuyCost += tx.amount;
        totalBuyUnits += tx.units;
      } else if (tx.type === "SELL") {
        totalUnits -= tx.units;
      }
    }

    // Get the latest NAV from the last BUY transaction
    const lastBuy = [...txs].reverse().find(t => t.type === "BUY" && t.nav > 0);
    const latestNav = lastBuy ? lastBuy.nav : 0;
    const avgBuyNav = totalBuyUnits > 0 ? totalBuyCost / totalBuyUnits : 0;
    const finalUnits = Math.max(0, parseFloat(totalUnits.toFixed(4)));
    const sName = shortName(rawName);

    console.log(`\n--- ${sName} (${code}) ---`);
    console.log(`  Transactions: ${txs.length}`);
    console.log(`  Units: ${finalUnits.toFixed(4)}`);
    console.log(`  Avg Buy NAV: ${avgBuyNav.toFixed(4)}`);
    console.log(`  Latest NAV: ${latestNav.toFixed(4)}`);

    // Insert holding
    const { data: holding, error: hErr } = await supabase
      .from("holdings")
      .insert({
        category_id: "nps",
        symbol: code,
        name: sName,
        exchange: "NPS-CRA",
        quantity: finalUnits,
        avg_buy_price: parseFloat(avgBuyNav.toFixed(4)),
        current_price: latestNav,
        nse_price: 0,
        bse_price: 0,
        currency: "INR",
        sector: schemeType(rawName),
        status: finalUnits > 0 ? "active" : "closed",
      })
      .select()
      .single();

    if (hErr) {
      console.error(`  ERROR inserting holding: ${hErr.message}`);
      continue;
    }
    totalHoldings++;
    console.log(`  Holding ID: ${holding.id}`);

    // Insert transactions in batches of 50
    const txRows = txs.map(tx => ({
      holding_id: holding.id,
      type: tx.type,
      quantity: tx.units,
      price: tx.nav,
      total_amount: tx.amount,
      currency: "INR",
      date: tx.date,
      symbol: code,
      name: sName,
      notes: tx.description,
    }));

    for (let i = 0; i < txRows.length; i += 50) {
      const batch = txRows.slice(i, i + 50);
      const { error: txErr } = await supabase.from("transactions").insert(batch);
      if (txErr) {
        console.error(`  ERROR inserting tx batch: ${txErr.message}`);
      } else {
        totalTxInserted += batch.length;
      }
    }
  }

  console.log("\n=== NPS INGESTION COMPLETE ===");
  console.log(`Holdings created: ${totalHoldings}`);
  console.log(`Transactions inserted: ${totalTxInserted}`);
}

run().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
