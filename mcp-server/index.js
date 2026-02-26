#!/usr/bin/env node

/**
 * ============================================================
 *  AI Visual Workflow — MCP Server
 * ============================================================
 *
 * WHAT IS THIS?
 * This is a Model Context Protocol (MCP) server.
 * MCP is an open standard (by Anthropic) that lets AI assistants
 * (like Claude Desktop, Copilot, Cursor) call "tools" that you define.
 *
 * Think of it like giving an AI assistant a set of buttons it can press.
 * Each button (tool) does something useful — like looking up stock prices,
 * checking weather, defining words, or converting units.
 *
 * HOW DOES IT WORK?
 * 1. This server runs as a background process on your computer.
 * 2. An AI assistant connects to it via "stdio" (standard input/output).
 * 3. The assistant sees the tools listed below and can call them.
 * 4. The server returns the results back to the assistant.
 *
 * HOW TO USE IT?
 * See the MCP-README.md file for setup instructions.
 *
 * ============================================================
 */

// ─── Imports ────────────────────────────────────────────────
// The official MCP SDK (open-source, MIT license)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── Create the MCP Server ─────────────────────────────────

const server = new McpServer({
  name: "ai-visual-workflow",          // Name shown to AI assistants
  version: "2.0.0",                     // Version of this server
  description: "MCP server with real-data tools: stocks, weather, news, dictionary, Wikipedia, world clock, unit converter, and calculator.",
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  REAL-WORLD TOOLS — all call FREE APIs or perform real computation
//  No API keys needed!
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ─── Helper: Look up ticker symbol from company name ────────
// Uses Yahoo Finance search/autosuggest API to find the correct ticker.
// This prevents the AI from guessing wrong tickers!

async function searchTicker(query) {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=5&newsCount=0&listsCount=0&enableFuzzyQuery=false`;
  const response = await fetch(url, {
    headers: { "User-Agent": "MCP-Server/1.0" },
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance search returned ${response.status}`);
  }

  const data = await response.json();
  const quotes = data.quotes || [];

  // Filter to only stocks/ETFs (not crypto, futures, etc.)
  return quotes
    .filter((q) => q.quoteType === "EQUITY" || q.quoteType === "ETF")
    .map((q) => ({
      symbol: q.symbol,
      name: q.shortname || q.longname || q.symbol,
      exchange: q.exchDisp || q.exchange || "Unknown",
      type: q.quoteType,
    }));
}

// ─── Tool 1: Stock Ticker Search ────────────────────────────
// ALWAYS use this first when the user mentions a company NAME.
// This resolves "Open Text" → "OTEX", "Apple" → "AAPL", etc.

server.tool(
  "search_stock_ticker",
  "Search for a stock ticker symbol by company name. ALWAYS use this FIRST when the user gives a company name instead of a ticker symbol. This prevents looking up the wrong stock. Example: searching 'Open Text' returns 'OTEX'.",
  {
    company_name: z.string().describe(
      "The company name to search for, e.g. 'Open Text', 'Apple', 'Tesla', 'Microsoft'"
    ),
  },
  async ({ company_name }) => {
    try {
      const results = await searchTicker(company_name);

      if (results.length === 0) {
        return {
          content: [{
            type: "text",
            text: `❌ No stocks found for "${company_name}". Try a different name or search for the ticker symbol directly.`,
          }],
        };
      }

      const lines = results.map(
        (r, i) => `${i + 1}. **${r.symbol}** — ${r.name} (${r.exchange}, ${r.type})`
      );

      const text = [
        `## Ticker Search Results for "${company_name}"`,
        "",
        ...lines,
        "",
        `Use the **get_stock_price** tool with the correct ticker symbol from above (e.g. \`${results[0].symbol}\`).`,
      ].join("\n");

      return { content: [{ type: "text", text }] };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `❌ Failed to search for "${company_name}": ${error.message}`,
        }],
      };
    }
  }
);

// ─── Tool 2: Stock Price Lookup ─────────────────────────────
// Gets the actual price. If unsure of the ticker, use search_stock_ticker first!

server.tool(
  "get_stock_price",
  "Get the current/latest stock price for a given ticker symbol. If you only have a company name (not a ticker), use search_stock_ticker FIRST to find the correct ticker. IMPORTANT: Only report the data returned by this tool. Do NOT add analyst ratings, volume, or any other data that is not included in the response.",
  {
    ticker: z.string().describe(
      "The stock ticker symbol (e.g. AAPL, MSFT, OTEX, TSLA). Use search_stock_ticker first if you only know the company name."
    ),
  },
  async ({ ticker }) => {
    const symbol = ticker.toUpperCase().trim();

    try {
      // Step 1: Validate the ticker exists by searching for it
      let companyName = symbol;
      try {
        const searchResults = await searchTicker(symbol);
        const exactMatch = searchResults.find(
          (r) => r.symbol.toUpperCase() === symbol
        );
        if (exactMatch) {
          companyName = exactMatch.name;
        } else if (searchResults.length > 0) {
          // Warn if the ticker doesn't exactly match any result
          companyName = searchResults[0].name;
        }
      } catch {
        // Search failed, continue with just the ticker
      }

      // Step 2: Get the price data
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;
      const response = await fetch(url, {
        headers: { "User-Agent": "MCP-Server/1.0" },
      });

      if (!response.ok) {
        throw new Error(`Yahoo Finance returned ${response.status}`);
      }

      const data = await response.json();
      const result = data.chart?.result?.[0];

      if (!result) {
        return {
          content: [{
            type: "text",
            text: `❌ Ticker "${symbol}" not found. Use the search_stock_ticker tool to find the correct symbol for the company you're looking for.`,
          }],
        };
      }

      const meta = result.meta;
      const price = meta.regularMarketPrice;
      const prevClose = meta.chartPreviousClose || meta.previousClose;
      const change = price - prevClose;
      const changePercent = ((change / prevClose) * 100).toFixed(2);
      const arrow = change >= 0 ? "🟢 ▲" : "🔴 ▼";
      const currency = meta.currency || "USD";
      const displayName = meta.shortName || companyName || symbol;

      // Get recent closing prices
      const closes = result.indicators?.quote?.[0]?.close?.filter(Boolean) || [];
      const recentPrices = closes.slice(-5).map((p) => p.toFixed(2));

      const text = [
        `## ${displayName} (${symbol})`,
        `**Exchange:** ${meta.exchangeName || "N/A"}`,
        "",
        `| Metric | Value |`,
        `|--------|-------|`,
        `| **Current Price** | ${currency} ${price.toFixed(2)} |`,
        `| **Change** | ${arrow} ${change >= 0 ? "+" : ""}${change.toFixed(2)} (${change >= 0 ? "+" : ""}${changePercent}%) |`,
        `| **Previous Close** | ${currency} ${prevClose.toFixed(2)} |`,
        `| **Currency** | ${currency} |`,
        "",
        ...(recentPrices.length > 0
          ? [`**Last ${recentPrices.length} closes:** ${recentPrices.join(" → ")}`]
          : []),
        "",
        `_Data from Yahoo Finance. Prices may be delayed 15-20 min._`,
        `_**⚠️ IMPORTANT:** Only report the data shown above. Do not invent or add analyst ratings, trading volume, market cap, or any other metrics not listed here._`,
      ].join("\n");

      return { content: [{ type: "text", text }] };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `❌ Failed to fetch stock price for "${symbol}": ${error.message}\n\nTip: Use the **search_stock_ticker** tool first to find the correct ticker symbol.`,
        }],
      };
    }
  }
);

// ─── Tool 3: Weather Lookup ────────────────────────────────
// Uses Open-Meteo API (completely free, no API key, open-source).
// Step 1: Convert city name → coordinates (geocoding)
// Step 2: Get weather for those coordinates

server.tool(
  "get_weather",
  "Get current weather for any city in the world. Returns temperature, humidity, wind speed, and conditions. Uses the free Open-Meteo API.",
  {
    city: z.string().describe(
      "The city name, e.g. 'New York', 'London', 'Tokyo', 'Mumbai'"
    ),
  },
  async ({ city }) => {
    try {
      // Step 1: Convert city name to latitude/longitude
      // Open-Meteo geocoding API (free, no key)
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en`;
      const geoResponse = await fetch(geoUrl);
      const geoData = await geoResponse.json();

      if (!geoData.results || geoData.results.length === 0) {
        return {
          content: [{
            type: "text",
            text: `❌ City "${city}" not found. Try a well-known city name like "New York", "London", or "Tokyo".`,
          }],
        };
      }

      const location = geoData.results[0];
      const { latitude, longitude, name, country, admin1 } = location;

      // Step 2: Get current weather for those coordinates
      // Open-Meteo weather API (free, no key, open-source)
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto&forecast_days=3`;
      const weatherResponse = await fetch(weatherUrl);
      const weatherData = await weatherResponse.json();

      const current = weatherData.current;
      const daily = weatherData.daily;

      // Weather code to description mapping
      const weatherDescriptions = {
        0: "☀️ Clear sky",
        1: "🌤️ Mainly clear",
        2: "⛅ Partly cloudy",
        3: "☁️ Overcast",
        45: "🌫️ Foggy",
        48: "🌫️ Depositing rime fog",
        51: "🌦️ Light drizzle",
        53: "🌦️ Moderate drizzle",
        55: "🌧️ Dense drizzle",
        61: "🌧️ Slight rain",
        63: "🌧️ Moderate rain",
        65: "🌧️ Heavy rain",
        71: "🌨️ Slight snowfall",
        73: "🌨️ Moderate snowfall",
        75: "❄️ Heavy snowfall",
        80: "🌦️ Slight rain showers",
        81: "🌧️ Moderate rain showers",
        82: "⛈️ Violent rain showers",
        95: "⛈️ Thunderstorm",
        96: "⛈️ Thunderstorm with hail",
        99: "⛈️ Thunderstorm with heavy hail",
      };

      const condition = weatherDescriptions[current.weather_code] || `Code ${current.weather_code}`;
      const region = admin1 ? `${name}, ${admin1}, ${country}` : `${name}, ${country}`;

      // Build a 3-day forecast
      const forecastLines = [];
      if (daily && daily.time) {
        for (let i = 0; i < Math.min(3, daily.time.length); i++) {
          const day = new Date(daily.time[i]).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
          forecastLines.push(`| ${day} | ${daily.temperature_2m_min[i]}° – ${daily.temperature_2m_max[i]}° |`);
        }
      }

      const text = [
        `## Weather in ${region}`,
        "",
        `### Current Conditions: ${condition}`,
        "",
        `| Metric | Value |`,
        `|--------|-------|`,
        `| **Temperature** | ${current.temperature_2m}°C (${(current.temperature_2m * 9/5 + 32).toFixed(1)}°F) |`,
        `| **Feels Like** | ${current.apparent_temperature}°C (${(current.apparent_temperature * 9/5 + 32).toFixed(1)}°F) |`,
        `| **Humidity** | ${current.relative_humidity_2m}% |`,
        `| **Wind** | ${current.wind_speed_10m} km/h |`,
        "",
        ...(forecastLines.length > 0
          ? [
              "### 3-Day Forecast",
              "",
              "| Day | Temp Range (°C) |",
              "|-----|----------------|",
              ...forecastLines,
            ]
          : []),
        "",
        `_Data from [Open-Meteo](https://open-meteo.com/) (free, open-source API)._`,
      ].join("\n");

      return { content: [{ type: "text", text }] };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `❌ Failed to get weather for "${city}": ${error.message}\n\nTip: Make sure you have internet access.`,
        }],
      };
    }
  }
);

// ─── Tool 4: Math Calculator ───────────────────────────────
// A safe math evaluator. Supports basic arithmetic, exponents,
// square roots, trigonometry, and more.
// NO "eval()" is used — only safe math operations.

server.tool(
  "calculate",
  "Evaluate a math expression safely. Supports: +, -, *, /, ^ (power), sqrt(), sin(), cos(), tan(), log(), abs(), round(), ceil(), floor(), pi, e. Examples: '2 + 3 * 4', 'sqrt(144)', 'sin(pi/2)', '2^10', '(15 + 25) / 4'.",
  {
    expression: z.string().describe(
      "The math expression to evaluate. Examples: '2 + 3', 'sqrt(144)', '2^10', 'sin(pi/2)'"
    ),
  },
  async ({ expression }) => {
    try {
      const result = safeMathEval(expression);

      const text = [
        `## 🧮 Calculator`,
        "",
        `**Expression:** \`${expression}\``,
        `**Result:** **${result}**`,
        "",
        // Show the result in different formats if it's a number
        ...(typeof result === "number" && Number.isFinite(result)
          ? [
              `| Format | Value |`,
              `|--------|-------|`,
              `| Decimal | ${result} |`,
              `| Rounded | ${Math.round(result * 10000) / 10000} |`,
              ...(Number.isInteger(result) && result > 0 && result < 1e15
                ? [`| With commas | ${result.toLocaleString()} |`]
                : []),
              ...(Number.isInteger(result) && result >= 0 && result < 2 ** 53
                ? [`| Binary | ${result.toString(2)} |`, `| Hex | 0x${result.toString(16).toUpperCase()} |`]
                : []),
            ]
          : []),
      ].join("\n");

      return { content: [{ type: "text", text }] };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `❌ Math error: ${error.message}\n\n**Expression:** \`${expression}\`\n\n**Supported operations:**\n- Basic: \`+ - * / %\`\n- Power: \`2^10\` or \`pow(2,10)\`\n- Roots: \`sqrt(144)\`, \`cbrt(27)\`\n- Trig: \`sin(x)\`, \`cos(x)\`, \`tan(x)\`\n- Other: \`log(x)\`, \`abs(x)\`, \`round(x)\`, \`ceil(x)\`, \`floor(x)\`\n- Constants: \`pi\`, \`e\``,
        }],
      };
    }
  }
);

/**
 * Safe math evaluator — parses and computes math expressions
 * WITHOUT using eval(). Only allows math operations.
 *
 * How it works:
 * 1. Tokenize the expression into numbers, operators, parentheses, functions
 * 2. Convert to a safe function using only Math.* operations
 * 3. Execute in a restricted scope (no access to global objects)
 */
function safeMathEval(expr) {
  // Whitelist of allowed function & constant names
  const ALLOWED = {
    // Math functions
    sqrt: Math.sqrt,
    cbrt: Math.cbrt,
    abs: Math.abs,
    round: Math.round,
    ceil: Math.ceil,
    floor: Math.floor,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    log: Math.log,       // Natural log
    log2: Math.log2,
    log10: Math.log10,
    exp: Math.exp,
    pow: Math.pow,
    min: Math.min,
    max: Math.max,
    sign: Math.sign,
    trunc: Math.trunc,
    // Constants
    pi: Math.PI,
    PI: Math.PI,
    e: Math.E,
    E: Math.E,
    Infinity: Infinity,
  };

  // Clean up the expression
  let cleaned = expr
    .replace(/\s+/g, "")           // Remove spaces
    .replace(/\*\*/g, "^")         // ** → ^ (Python-style power)
    .replace(/×/g, "*")            // × → *
    .replace(/÷/g, "/")            // ÷ → /
    .replace(/,/g, ",");           // Keep commas for function args

  // Validate: only allow safe characters
  // Allowed: digits, dots, operators, parens, commas, and letter names
  if (!/^[0-9a-zA-Z_.+\-*/^%(),]+$/.test(cleaned)) {
    throw new Error(`Invalid characters in expression. Only numbers, operators (+−*/^%), parentheses, and math function names are allowed.`);
  }

  // Block dangerous patterns (just in case)
  const dangerous = /\b(eval|function|return|var|let|const|import|require|process|global|window|document|this|constructor|prototype|__proto__)\b/i;
  if (dangerous.test(cleaned)) {
    throw new Error("Expression contains disallowed keywords.");
  }

  // Replace ^ with ** for JavaScript power operator
  cleaned = cleaned.replace(/\^/g, "**");

  // Replace known function/constant names with safe references
  // We build a scope object and reference it
  const scopeEntries = Object.entries(ALLOWED);

  // Build the function body — references scope variables by position
  let body = cleaned;

  // Sort by name length descending so "log10" is matched before "log"  
  // Use a COPY (spreading) so original order is preserved
  const sortedEntries = [...scopeEntries].sort((a, b) => b[0].length - a[0].length);
  for (const [name, value] of sortedEntries) {
    // Find this name's original index in scopeEntries
    const idx = scopeEntries.findIndex(([k]) => k === name);
    // Use word boundary replacement
    const regex = new RegExp(`\\b${name}\\b`, "g");
    body = body.replace(regex, `_s[${idx}]`);
  }

  // Final safety check: no remaining letter sequences (would be unknown variables)
  const remaining = body.replace(/_s\[\d+\]/g, "").replace(/[0-9.+\-*/(),%*]/g, "");
  if (/[a-zA-Z]/.test(remaining)) {
    throw new Error(`Unknown variable or function in expression.`);
  }

  // Execute in restricted scope
  try {
    const scopeValues = scopeEntries.map(([, v]) => v);
    const fn = new Function("_s", `"use strict"; return (${body});`);
    const result = fn(scopeValues);

    if (typeof result !== "number") {
      throw new Error("Expression did not produce a number.");
    }
    if (Number.isNaN(result)) {
      return "NaN (Not a Number — check your inputs)";
    }

    return result;
  } catch (e) {
    if (e.message.includes("Expression")) throw e;
    throw new Error(`Could not evaluate "${expr}". Check syntax and try again.`);
  }
}

// ═══════════════════════════════════════════════════════════
//  Tool 5: convert_currency — Live exchange rates (ECB)
// ═══════════════════════════════════════════════════════════

server.tool(
  "convert_currency",
  "Convert between currencies using live exchange rates from the European Central Bank (updated daily). Supports 30+ currencies. Free, no API key needed. Example: 100 USD to INR.",
  {
    amount: z.number().default(1).describe("Amount to convert. Default: 1"),
    from: z.string().describe("Source currency code (e.g. USD, EUR, GBP, INR, JPY, CAD, AUD, CNY, CHF)"),
    to: z.string().describe("Target currency code (e.g. INR, EUR, GBP, USD, JPY)"),
  },
  async ({ amount, from, to }) => {
    const fromCode = from.toUpperCase().trim();
    const toCode = to.toUpperCase().trim();

    if (fromCode === toCode) {
      return { content: [{ type: "text", text: `${amount} ${fromCode} = ${amount} ${toCode} (same currency!)` }] };
    }

    try {
      const url = `https://api.frankfurter.dev/v1/latest?base=${fromCode}&symbols=${toCode}`;
      const res = await fetch(url);
      if (!res.ok) {
        return { content: [{ type: "text", text: `❌ Could not fetch exchange rate for ${fromCode} → ${toCode}. Make sure both are valid ISO 4217 currency codes.` }] };
      }

      const data = await res.json();
      const rate = data.rates?.[toCode];
      if (!rate) {
        return { content: [{ type: "text", text: `❌ No rate found for ${toCode}. Supported currencies: USD, EUR, GBP, INR, JPY, CAD, AUD, CNY, CHF, KRW, BRL, MXN, SGD, HKD, NZD, SEK, NOK, DKK, ZAR, THB, MYR, PHP, IDR, TRY, PLN, CZK, HUF, RON, BGN, ISK.` }] };
      }

      const converted = amount * rate;
      const text = [
        `## 💱 Currency Conversion`,
        "",
        `**${amount.toLocaleString()} ${fromCode}** = **${converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${toCode}**`,
        "",
        `| Detail | Value |`,
        `|--------|-------|`,
        `| Rate | 1 ${fromCode} = ${rate} ${toCode} |`,
        `| Date | ${data.date} |`,
        `| Source | European Central Bank |`,
      ].join("\n");

      return { content: [{ type: "text", text }] };
    } catch (error) {
      return { content: [{ type: "text", text: `❌ Currency conversion error: ${error.message}` }] };
    }
  }
);

// ═══════════════════════════════════════════════════════════
//  Tool 6: get_news — Trending articles from Wikipedia
// ═══════════════════════════════════════════════════════════

server.tool(
  "get_news",
  "Get trending news, headlines, and 'on this day' events. Optionally filter by topic. Uses Wikipedia's free Featured Content API — no API key needed.",
  {
    topic: z.string().optional().describe(
      "Optional topic to look up. Leave empty for general trending articles."
    ),
  },
  async ({ topic }) => {
    try {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");

      // If a topic is provided, get its Wikipedia summary
      if (topic) {
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data.extract) {
            return {
              content: [{
                type: "text",
                text: [
                  `## 📰 Latest on "${topic}"`,
                  "",
                  data.extract,
                  "",
                  `*Source: Wikipedia*`,
                ].join("\n"),
              }],
            };
          }
        }
      }

      // General: today's featured content
      const url = `https://en.wikipedia.org/api/rest_v1/feed/featured/${yyyy}/${mm}/${dd}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Wikipedia API returned ${res.status}`);

      const data = await res.json();
      const lines = [`## 📰 Today's Headlines (${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })})`, ""];

      if (data.tfa) {
        lines.push(`### Featured Article`);
        lines.push(`**${data.tfa.titles?.normalized || "Article"}** — ${data.tfa.extract || ""}`);
        lines.push("");
      }

      if (data.onthisday?.length > 0) {
        lines.push(`### On This Day`);
        for (const event of data.onthisday.slice(0, 4)) {
          lines.push(`- **${event.year}:** ${event.text}`);
        }
        lines.push("");
      }

      if (data.mostread?.articles?.length > 0) {
        lines.push(`### Trending Now`);
        for (const a of data.mostread.articles.slice(0, 5)) {
          if (a.titles?.normalized) {
            lines.push(`- **${a.titles.normalized}** — ${(a.extract || "").slice(0, 120)}…`);
          }
        }
        lines.push("");
      }

      lines.push(`*Source: Wikipedia Featured Content*`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (error) {
      return { content: [{ type: "text", text: `❌ Could not fetch news: ${error.message}` }] };
    }
  }
);

// ═══════════════════════════════════════════════════════════
//  Tool 7: get_dictionary — Word definitions
// ═══════════════════════════════════════════════════════════

server.tool(
  "get_dictionary",
  "Look up the definition, pronunciation, and usage examples of an English word. Uses the free Dictionary API (dictionaryapi.dev) — no API key needed.",
  {
    word: z.string().describe("The English word to define. Example: 'serendipity'"),
  },
  async ({ word }) => {
    try {
      const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.trim().toLowerCase())}`;
      const res = await fetch(url);
      if (!res.ok) {
        return { content: [{ type: "text", text: `❌ No definition found for "${word}".` }] };
      }

      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        return { content: [{ type: "text", text: `❌ No definition found for "${word}".` }] };
      }

      const entry = data[0];
      const lines = [`## 📖 ${entry.word}`];

      if (entry.phonetic) lines.push(`*${entry.phonetic}*`);
      lines.push("");

      for (const meaning of (entry.meanings || []).slice(0, 3)) {
        lines.push(`### ${meaning.partOfSpeech}`);
        for (const def of (meaning.definitions || []).slice(0, 2)) {
          lines.push(`- ${def.definition}`);
          if (def.example) lines.push(`  > *"${def.example}"*`);
        }
        if (meaning.synonyms?.length > 0) {
          lines.push(`  **Synonyms:** ${meaning.synonyms.slice(0, 5).join(", ")}`);
        }
        if (meaning.antonyms?.length > 0) {
          lines.push(`  **Antonyms:** ${meaning.antonyms.slice(0, 5).join(", ")}`);
        }
        lines.push("");
      }

      lines.push(`*Source: Free Dictionary API*`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (error) {
      return { content: [{ type: "text", text: `❌ Dictionary error: ${error.message}` }] };
    }
  }
);

// ═══════════════════════════════════════════════════════════
//  Tool 8: get_wikipedia — Wikipedia article summary
// ═══════════════════════════════════════════════════════════

server.tool(
  "get_wikipedia",
  "Get a Wikipedia summary for any topic, person, place, or concept. Free, no API key needed.",
  {
    topic: z.string().describe("The topic to look up on Wikipedia. Example: 'Albert Einstein'"),
  },
  async ({ topic }) => {
    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`;
      const res = await fetch(url);
      if (!res.ok) {
        return { content: [{ type: "text", text: `❌ No Wikipedia article found for "${topic}".` }] };
      }

      const data = await res.json();
      if (!data.extract) {
        return { content: [{ type: "text", text: `❌ No content found for "${topic}" on Wikipedia.` }] };
      }

      const lines = [
        `## 📚 ${data.titles?.normalized || topic}`,
        data.description ? `*${data.description}*` : "",
        "",
        data.extract,
        "",
        data.content_urls?.desktop?.page ? `[Read full article](${data.content_urls.desktop.page})` : "",
        "",
        `*Source: Wikipedia*`,
      ].filter(Boolean);

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (error) {
      return { content: [{ type: "text", text: `❌ Wikipedia error: ${error.message}` }] };
    }
  }
);

// ═══════════════════════════════════════════════════════════
//  Tool 9: get_world_time — Current time in any timezone
// ═══════════════════════════════════════════════════════════

server.tool(
  "get_world_time",
  "Get the current date and time in any timezone or city. Uses built-in Intl.DateTimeFormat — no API key needed.",
  {
    timezone: z.string().optional().describe(
      "City name or IANA timezone. Examples: 'Tokyo', 'New York', 'UTC', 'Asia/Kolkata'. Leave empty for a world overview."
    ),
  },
  async ({ timezone }) => {
    const ZONE_MAP = {
      "new york": "America/New_York", "nyc": "America/New_York", "est": "America/New_York",
      "los angeles": "America/Los_Angeles", "la": "America/Los_Angeles", "pst": "America/Los_Angeles",
      "chicago": "America/Chicago", "cst": "America/Chicago",
      "denver": "America/Denver", "mst": "America/Denver",
      "london": "Europe/London", "uk": "Europe/London", "gmt": "Europe/London",
      "paris": "Europe/Paris", "france": "Europe/Paris",
      "berlin": "Europe/Berlin", "germany": "Europe/Berlin",
      "tokyo": "Asia/Tokyo", "japan": "Asia/Tokyo",
      "shanghai": "Asia/Shanghai", "china": "Asia/Shanghai", "beijing": "Asia/Shanghai",
      "mumbai": "Asia/Kolkata", "india": "Asia/Kolkata", "delhi": "Asia/Kolkata", "kolkata": "Asia/Kolkata",
      "dubai": "Asia/Dubai", "uae": "Asia/Dubai",
      "singapore": "Asia/Singapore",
      "sydney": "Australia/Sydney", "australia": "Australia/Sydney",
      "toronto": "America/Toronto", "canada": "America/Toronto",
      "moscow": "Europe/Moscow", "russia": "Europe/Moscow",
      "seoul": "Asia/Seoul", "korea": "Asia/Seoul",
      "bangkok": "Asia/Bangkok", "thailand": "Asia/Bangkok",
      "istanbul": "Europe/Istanbul",
      "utc": "UTC",
    };

    const now = new Date();

    if (timezone) {
      const tz = ZONE_MAP[timezone.toLowerCase().trim()] || timezone.trim();
      try {
        const fmt = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          weekday: "long", year: "numeric", month: "long", day: "numeric",
          hour: "2-digit", minute: "2-digit", second: "2-digit",
          hour12: true, timeZoneName: "long",
        });
        return {
          content: [{
            type: "text",
            text: `## 🕐 Time in ${timezone}\n\n**${fmt.format(now)}**\n\n*Source: System clock*`,
          }],
        };
      } catch {
        return {
          content: [{
            type: "text",
            text: `❌ Unknown timezone "${timezone}". Use an IANA timezone like "America/New_York" or a city name like "Tokyo".`,
          }],
        };
      }
    }

    // World overview
    const zones = [
      { label: "UTC", tz: "UTC" },
      { label: "New York", tz: "America/New_York" },
      { label: "London", tz: "Europe/London" },
      { label: "Paris", tz: "Europe/Paris" },
      { label: "Mumbai", tz: "Asia/Kolkata" },
      { label: "Tokyo", tz: "Asia/Tokyo" },
      { label: "Sydney", tz: "Australia/Sydney" },
    ];

    const lines = ["## 🌍 World Clock", "", "| City | Time |", "|------|------|"];
    for (const z of zones) {
      try {
        const fmt = new Intl.DateTimeFormat("en-US", {
          timeZone: z.tz, hour: "2-digit", minute: "2-digit", second: "2-digit",
          hour12: true, weekday: "short", month: "short", day: "numeric",
        });
        lines.push(`| ${z.label} | ${fmt.format(now)} |`);
      } catch { /* skip */ }
    }
    lines.push("", "*Source: System clock*");
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ═══════════════════════════════════════════════════════════
//  Tool 10: convert_units — Unit conversion
// ═══════════════════════════════════════════════════════════

server.tool(
  "convert_units",
  "Convert between common units: length (km↔mi, m↔ft, cm↔in), weight (kg↔lbs, g↔oz), temperature (°C↔°F), volume (L↔gal), speed (mph↔km/h). No API key needed.",
  {
    value: z.number().describe("The numeric value to convert. Example: 100"),
    from: z.string().describe("Unit to convert FROM. Examples: 'km', 'lbs', 'celsius', 'mph'"),
    to: z.string().describe("Unit to convert TO. Examples: 'miles', 'kg', 'fahrenheit', 'kmh'"),
  },
  async ({ value, from, to }) => {
    const normalize = (u) => {
      const unit = u.toLowerCase().trim().replace(/s$/, "");
      const map = {
        "km": "km", "kilometer": "km", "kilometre": "km",
        "mi": "miles", "mile": "miles",
        "kg": "kg", "kilogram": "kg",
        "lb": "lbs", "pound": "lbs",
        "°c": "celsius", "c": "celsius", "celsius": "celsius", "centigrade": "celsius",
        "°f": "fahrenheit", "f": "fahrenheit", "fahrenheit": "fahrenheit",
        "meter": "m", "metre": "m", "m": "m",
        "ft": "ft", "feet": "ft", "foot": "ft",
        "liter": "l", "litre": "l", "l": "l",
        "gallon": "gal", "gal": "gal",
        "cm": "cm", "centimeter": "cm", "centimetre": "cm",
        "inch": "in", "inche": "in", "in": "in",
        "oz": "oz", "ounce": "oz",
        "gram": "g", "g": "g",
        "mph": "mph",
        "km/h": "kmh", "kmh": "kmh", "kph": "kmh",
      };
      return map[unit] || null;
    };

    const conversions = {
      km:   { miles: (v) => v * 0.621371 },
      miles: { km: (v) => v * 1.60934 },
      kg:   { lbs: (v) => v * 2.20462 },
      lbs:  { kg: (v) => v * 0.453592 },
      celsius: { fahrenheit: (v) => v * 9 / 5 + 32 },
      fahrenheit: { celsius: (v) => (v - 32) * 5 / 9 },
      m:    { ft: (v) => v * 3.28084 },
      ft:   { m: (v) => v * 0.3048 },
      l:    { gal: (v) => v * 0.264172 },
      gal:  { l: (v) => v * 3.78541 },
      cm:   { in: (v) => v * 0.393701 },
      in:   { cm: (v) => v * 2.54 },
      oz:   { g: (v) => v * 28.3495 },
      g:    { oz: (v) => v * 0.035274 },
      mph:  { kmh: (v) => v * 1.60934 },
      kmh:  { mph: (v) => v * 0.621371 },
    };

    const fromNorm = normalize(from);
    const toNorm = normalize(to);

    if (!fromNorm || !toNorm) {
      return { content: [{ type: "text", text: `❌ Unrecognized unit: "${!fromNorm ? from : to}". Supported: km, miles, kg, lbs, celsius, fahrenheit, m, ft, l, gal, cm, in, oz, g, mph, kmh.` }] };
    }

    if (fromNorm === toNorm) {
      return { content: [{ type: "text", text: `${value} ${from} = ${value} ${to} (same unit!)` }] };
    }

    const fn = conversions[fromNorm]?.[toNorm];
    if (!fn) {
      return { content: [{ type: "text", text: `❌ Cannot convert ${from} → ${to}. Supported pairs: km↔miles, kg↔lbs, °C↔°F, m↔ft, L↔gal, cm↔in, oz↔g, mph↔km/h.` }] };
    }

    const result = fn(value);
    return {
      content: [{
        type: "text",
        text: [
          `## 🔄 Unit Conversion`,
          "",
          `**${value} ${from}** = **${result.toFixed(4)} ${to}**`,
          "",
          `*Rounded: ${Math.round(result * 100) / 100} ${to}*`,
        ].join("\n"),
      }],
    };
  }
);

// ─── Start the Server ───────────────────────────────────────
// This connects the server to "stdio" (standard input/output).
// AI assistants communicate with MCP servers through this channel.

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Note: We use console.error for logging because console.log (stdout)
  // is reserved for MCP protocol communication.
  console.error("✅ AI Visual Workflow MCP Server is running!");
  console.error("   Tools: search_stock_ticker, get_stock_price, get_weather, calculate, convert_currency, get_news, get_dictionary, get_wikipedia, get_world_time, convert_units");
}

main().catch((error) => {
  console.error("❌ Failed to start MCP server:", error);
  process.exit(1);
});
