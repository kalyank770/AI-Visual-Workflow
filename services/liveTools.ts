/**
 * ============================================================
 *  Live Tool Runner — Real API calls for the Architect Chat
 * ============================================================
 *
 * This module calls the SAME real APIs that the MCP server uses,
 * but from within the browser (frontend). When the user asks about
 * stocks, weather, or math, these functions fetch real data instead
 * of making up random numbers.
 *
 * All APIs used here are FREE and require NO API keys.
 *
 * NOTE: Yahoo Finance blocks browser requests (CORS). To fix this,
 * we route requests through Vite's dev proxy (see vite.config.ts):
 *   Browser → /api/yahoo-search/... → Vite proxy → Yahoo Finance
 * This way the browser never talks to Yahoo directly.
 * ============================================================
 */

// ─── Stock Ticker Search ───────────────────────────────────
// Searches Yahoo Finance for the correct ticker symbol.
// Example: "Open Text" → OTEX

export async function searchStockTicker(companyName: string): Promise<{
  symbol: string;
  name: string;
  exchange: string;
} | null> {
  // Try the search with the original query first.
  // If it fails, try with spaces inserted into compound words
  // (e.g., "opentext" → "open text") because Yahoo needs the spacing.
  const queries = [companyName];

  // If it's a single word with 6+ chars, try splitting it with a space
  // at common word boundaries. This handles "opentext" → "open text",
  // "salesforce" → "sales force", etc.
  const trimmed = companyName.trim();
  if (trimmed.length >= 6 && !trimmed.includes(" ")) {
    // Try inserting a space at each position
    for (let i = 3; i < trimmed.length - 2; i++) {
      queries.push(trimmed.slice(0, i) + " " + trimmed.slice(i));
    }
  }

  for (const query of queries) {
    try {
      // Use the Vite proxy path to bypass CORS (see vite.config.ts)
      const url = `/api/yahoo-search/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=5&newsCount=0&listsCount=0`;
      const response = await fetch(url);

      if (!response.ok) continue;

      const data = await response.json();
      const quotes = data.quotes || [];

      // Find the first stock (not crypto/futures)
      const stock = quotes.find(
        (q: any) => q.quoteType === "EQUITY" || q.quoteType === "ETF"
      );

      if (stock) {
        return {
          symbol: stock.symbol,
          name: stock.shortname || stock.longname || stock.symbol,
          exchange: stock.exchDisp || stock.exchange || "Unknown",
        };
      }
    } catch (error) {
      console.warn(`Ticker search failed for "${query}":`, error);
    }
  }

  return null;
}

// ─── Stock Price Lookup ────────────────────────────────────
// Gets real-time price from Yahoo Finance (free, no key).

export async function getStockPrice(ticker: string): Promise<string | null> {
  try {
    const symbol = ticker.toUpperCase().trim();
    // Use the Vite proxy path to bypass CORS (see vite.config.ts)
    const url = `/api/yahoo-chart/v8/finance/chart/${symbol}?interval=1d&range=5d`;
    const response = await fetch(url);

    if (!response.ok) return null;

    const data = await response.json();
    const result = data.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose || meta.previousClose;
    const change = price - prevClose;
    const changePercent = ((change / prevClose) * 100).toFixed(2);
    const direction = change >= 0 ? "up" : "down";
    const currency = meta.currency || "USD";
    const name = meta.shortName || symbol;
    const exchange = meta.exchangeName || "N/A";

    // Get recent closing prices
    const closes = result.indicators?.quote?.[0]?.close?.filter(Boolean) || [];
    const recent = closes.slice(-5).map((p: number) => p.toFixed(2));

    return [
      `${name} (${symbol}) on ${exchange}:`,
      `Current Price: ${currency} ${price.toFixed(2)}`,
      `Change: ${change >= 0 ? "+" : ""}${change.toFixed(2)} (${change >= 0 ? "+" : ""}${changePercent}%) ${direction}`,
      `Previous Close: ${currency} ${prevClose.toFixed(2)}`,
      recent.length > 0 ? `Recent closes: ${recent.join(" → ")}` : "",
      `(Data from Yahoo Finance, may be delayed 15-20 min)`,
    ]
      .filter(Boolean)
      .join("\n");
  } catch (error) {
    console.warn("Stock price fetch failed:", error);
    return null;
  }
}

// ─── Weather Lookup ────────────────────────────────────────
// Uses Open-Meteo API (free, no key, open-source).

export async function getWeather(city: string): Promise<string | null> {
  try {
    // Step 1: Geocode city name → coordinates
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en`;
    const geoResponse = await fetch(geoUrl);
    const geoData = await geoResponse.json();

    if (!geoData.results || geoData.results.length === 0) return null;

    const location = geoData.results[0];
    const { latitude, longitude, name, country, admin1 } = location;

    // Step 2: Get weather
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=3`;
    const weatherResponse = await fetch(weatherUrl);
    const weatherData = await weatherResponse.json();

    const current = weatherData.current;
    const daily = weatherData.daily;

    const weatherCodes: Record<number, string> = {
      0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
      45: "Foggy", 48: "Rime fog", 51: "Light drizzle", 53: "Moderate drizzle",
      55: "Dense drizzle", 61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
      71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
      80: "Light rain showers", 81: "Moderate rain showers", 82: "Heavy rain showers",
      95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Heavy hail thunderstorm",
    };

    const condition = weatherCodes[current.weather_code] || `Code ${current.weather_code}`;
    const region = admin1 ? `${name}, ${admin1}, ${country}` : `${name}, ${country}`;
    const tempF = (current.temperature_2m * 9 / 5 + 32).toFixed(1);
    const feelsLikeF = (current.apparent_temperature * 9 / 5 + 32).toFixed(1);

    const forecast = daily?.time
      ?.slice(0, 3)
      .map((date: string, i: number) => {
        const d = new Date(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
        return `${d}: ${daily.temperature_2m_min[i]}°C – ${daily.temperature_2m_max[i]}°C`;
      })
      .join("; ") || "";

    return [
      `Weather in ${region}:`,
      `Conditions: ${condition}`,
      `Temperature: ${current.temperature_2m}°C (${tempF}°F)`,
      `Feels Like: ${current.apparent_temperature}°C (${feelsLikeF}°F)`,
      `Humidity: ${current.relative_humidity_2m}%`,
      `Wind: ${current.wind_speed_10m} km/h`,
      forecast ? `3-Day Forecast: ${forecast}` : "",
      `(Data from Open-Meteo, free open-source API)`,
    ]
      .filter(Boolean)
      .join("\n");
  } catch (error) {
    console.warn("Weather fetch failed:", error);
    return null;
  }
}

// ─── Smart Tool Detector & Runner ──────────────────────────
// Detects what the user is asking about, calls the right APIs,
// and returns real data to inject into the LLM prompt.

export async function runToolsForQuery(userPrompt: string): Promise<string[]> {
  const toolResults: string[] = [];
  const lower = userPrompt.toLowerCase();

  // ── Stock Detection ──
  if (lower.includes("stock") || lower.includes("share price") || lower.includes("trading") || lower.includes("market price") || lower.includes("ticker")) {
    const stockQuery = extractStockQuery(userPrompt);
    if (stockQuery) {
      const isTicker = /^[A-Z]{1,5}$/.test(stockQuery);
      let ticker = stockQuery;
      if (!isTicker) {
        const searchResult = await searchStockTicker(stockQuery);
        if (searchResult) ticker = searchResult.symbol;
      }
      const priceData = await getStockPrice(ticker);
      if (priceData) {
        toolResults.push(`Tool [StockPrice]: ${priceData}`);
      } else {
        toolResults.push(`Tool [StockPrice]: Could not find stock data for "${stockQuery}". The ticker may be incorrect.`);
      }
    }
  }

  // ── Price without "stock" keyword — "AAPL price", "price of Tesla" ──
  if (!toolResults.length && (lower.includes("price") || lower.includes("worth"))) {
    const stockQuery = extractStockQuery(userPrompt);
    if (stockQuery) {
      const isTicker = /^[A-Z]{1,5}$/.test(stockQuery);
      let ticker = stockQuery;
      if (!isTicker) {
        const searchResult = await searchStockTicker(stockQuery);
        if (searchResult) ticker = searchResult.symbol;
      }
      const priceData = await getStockPrice(ticker);
      if (priceData) {
        toolResults.push(`Tool [StockPrice]: ${priceData}`);
      }
    }
  }

  // ── Weather Detection ──
  if (lower.includes("weather") || lower.includes("temperature") || lower.includes("forecast") || lower.includes("climate")) {
    const city = extractCity(userPrompt);
    if (city) {
      const weatherData = await getWeather(city);
      if (weatherData) {
        toolResults.push(`Tool [Weather]: ${weatherData}`);
      } else {
        toolResults.push(`Tool [Weather]: Could not find weather data for "${city}".`);
      }
    }
  }

  // ── News Detection ──
  if (lower.includes("news") || lower.includes("headline") || lower.includes("latest") || lower.includes("breaking")) {
    const topic = extractNewsTopic(userPrompt);
    const newsData = await getNews(topic);
    if (newsData) {
      toolResults.push(`Tool [News]: ${newsData}`);
    }
  }

  // ── Dictionary / Define Detection ──
  // Catches: "define X", "meaning of X", "X meaning?", "X means?", "what does X mean",
  //          "synonym of X", "antonym of X", "definition of X", "spell X", "pronounce X"
  const isDictionaryQuery = (
    lower.includes("define") ||
    lower.includes("meaning of") ||
    lower.includes("definition") ||
    lower.includes("dictionary") ||
    lower.includes("synonym") ||
    lower.includes("antonym") ||
    lower.includes("pronounce") ||
    lower.includes("pronunciation") ||
    lower.includes("spell") ||
    lower.includes("spelling") ||
    (lower.includes("what does") && lower.includes("mean")) ||
    /\b\w+\s+means?\??\s*$/i.test(lower) ||   // "fabulous means?"
    /\b\w+\s+meaning\??\s*$/i.test(lower)      // "fabulous meaning?"
  );
  if (isDictionaryQuery) {
    const word = extractWord(userPrompt);
    if (word) {
      const defData = await getDictionary(word);
      if (defData) {
        toolResults.push(`Tool [Dictionary]: ${defData}`);
      }
    }
  }

  // ── Wikipedia / Facts Detection ──
  if (lower.includes("who is") || lower.includes("who was") || lower.includes("what is") || lower.includes("tell me about") || lower.includes("wikipedia") || lower.includes("history of") || lower.includes("explain")) {
    // Only trigger if no other tool already ran (avoid conflicts)
    if (toolResults.length === 0) {
      // Use deep search (with infobox extraction) for richer answers
      const wikiData = await wikiDeepSearch(userPrompt);
      if (wikiData) {
        toolResults.push(`Tool [Wikipedia]: ${wikiData}`);
      } else {
        // Fallback to short summary
        const topic = extractWikiTopic(userPrompt);
        if (topic && topic.length > 2) {
          const shortData = await getWikipediaSummary(topic);
          if (shortData) {
            toolResults.push(`Tool [Wikipedia]: ${shortData}`);
          }
        }
      }
    }
  }

  // ── Time / Timezone Detection ──
  if (lower.includes("time") || lower.includes("timezone") || lower.includes("clock") || lower.includes("date in")) {
    const timezone = extractTimezone(userPrompt);
    const timeData = getWorldTime(timezone);
    toolResults.push(`Tool [WorldClock]: ${timeData}`);
  }

  // ── Currency Conversion Detection ──
  if (lower.includes("currency") || lower.includes("exchange rate") || lower.includes("forex") || lower.includes("fx") || /\b(usd|eur|gbp|inr|jpy|cad|aud|cny|chf|krw|brl|mxn|sgd|hkd|nzd|sek|nok|dkk|zar|thb|myr|php|idr|try|pln|czk|huf|ron|bgn|hrk|isk|dollar|euro|pound|rupee|yen|yuan|franc|won|peso|baht|ringgit|lira|rand)\s+(to|in|into|vs)\s+(usd|eur|gbp|inr|jpy|cad|aud|cny|chf|krw|brl|mxn|sgd|hkd|nzd|sek|nok|dkk|zar|thb|myr|php|idr|try|pln|czk|huf|ron|bgn|hrk|isk|dollar|dollars|euro|euros|pound|pounds|rupee|rupees|yen|yuan|franc|won|peso|baht|ringgit|lira|rand)\b/i.test(lower)) {
    const currencyData = await convertCurrency(userPrompt);
    if (currencyData) {
      toolResults.push(`Tool [Currency]: ${currencyData}`);
    }
  }

  // ── Unit Conversion Detection ──
  const conversionMatch = detectUnitConversion(userPrompt);
  if (conversionMatch) {
    toolResults.push(`Tool [UnitConverter]: ${conversionMatch}`);
  }

  // ── Math Detection ──
  if (lower.includes("calculate") || lower.includes("compute") || lower.includes("solve") || /\d+\s*[\+\-\*\/\^]\s*\d+/.test(userPrompt)) {
    const mathExpr = extractMathExpression(userPrompt);
    if (mathExpr) {
      try {
        const result = safeMathEval(mathExpr);
        toolResults.push(`Tool [Calculator]: ${mathExpr} = ${result}`);
      } catch {
        // Math eval failed, let the LLM handle it
      }
    }
  }

  // ── Web Search Fallback ──
  // If NO tool matched the query, use web search as a catch-all
  if (toolResults.length === 0) {
    const searchData = await webSearch(userPrompt);
    if (searchData) {
      toolResults.push(`Tool [WebSearch]: ${searchData}`);
    }
  }

  return toolResults;
}

// ─── Helper: Extract stock query from user prompt ──────────

function extractStockQuery(prompt: string): string | null {
  // Pattern 1: explicit ticker like "AAPL", "MSFT", "OTEX"
  const tickerMatch = prompt.match(/\b([A-Z]{2,5})\b/);

  // Pattern 2: "stock price of X", "X stock", "X present/current price"
  const patterns = [
    /(?:stock\s+price\s+of|price\s+of|stock\s+of)\s+(.+?)(?:\s+stock|\s+share|\?|$)/i,
    /(.+?)\s+(?:present|current|today|latest|live)\s+(?:stock|share)?\s*price/i,
    /(.+?)\s+stock\s+price/i,
    /(.+?)\s+share\s+price/i,
    /(?:stock|share|price).*?(?:of|for)\s+(.+?)(?:\?|$)/i,
    /^(.+?)\s+(?:stock|shares|ticker)/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match) {
      // Use the first capturing group that has content
      const name = (match[1] || match[2] || "").trim();
      if (name && name.length > 1 && name.length < 50) {
        // Clean up common filler words
        const cleaned = name
          .replace(/^(what|whats|what's|get|show|find|tell|me|the|about|is)\s+/gi, "")
          .replace(/\s+(today|now|currently|right now|please)$/gi, "")
          .trim();
        if (cleaned.length > 0) return cleaned;
      }
    }
  }

  // Fallback: if there's a clear ticker symbol
  if (tickerMatch) return tickerMatch[1];

  return null;
}

// ─── Helper: Extract city from weather query ───────────────

function extractCity(prompt: string): string | null {
  const patterns = [
    /weather\s+(?:in|at|for|of)\s+(.+?)(?:\?|$|today|tomorrow|now)/i,
    /(?:temperature|forecast|climate)\s+(?:in|at|for|of)\s+(.+?)(?:\?|$)/i,
    /(.+?)\s+weather/i,
    /(?:how|what).+?(?:weather|temperature).+?(?:in|at)\s+(.+?)(?:\?|$)/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match) {
      const city = (match[1] || match[2] || "").trim();
      if (city && city.length > 1 && city.length < 50) {
        return city.replace(/^(the|is)\s+/i, "").trim();
      }
    }
  }

  return null;
}

// ─── Helper: Extract math expression ───────────────────────

function extractMathExpression(prompt: string): string | null {
  // Look for obvious math expressions
  const patterns = [
    /(?:calculate|compute|solve|evaluate|what is|what's)\s+(.+?)(?:\?|$)/i,
    /(\d[\d\s\+\-\*\/\^\.\(\)]+\d)/,
    /(sqrt\(.+?\)|sin\(.+?\)|cos\(.+?\)|log\(.+?\))/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match && match[1]) {
      const expr = match[1].trim();
      // Validate it looks like math
      if (/\d/.test(expr) && /[\+\-\*\/\^\(\)]/.test(expr)) {
        return expr;
      }
    }
  }

  return null;
}

// ─── Safe Math Evaluator (browser version) ─────────────────

function safeMathEval(expr: string): number | string {
  const ALLOWED: Record<string, any> = {
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
    round: Math.round, ceil: Math.ceil, floor: Math.floor,
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    log: Math.log, log2: Math.log2, log10: Math.log10,
    exp: Math.exp, pow: Math.pow,
    pi: Math.PI, PI: Math.PI, e: Math.E, E: Math.E,
  };

  let cleaned = expr
    .replace(/\s+/g, "")
    .replace(/\*\*/g, "^")
    .replace(/×/g, "*")
    .replace(/÷/g, "/");

  if (!/^[0-9a-zA-Z_.+\-*/^%(),]+$/.test(cleaned)) {
    throw new Error("Invalid characters");
  }

  const dangerous = /\b(eval|function|return|var|let|const|import|require|process|global|window|document|this|constructor|prototype|__proto__)\b/i;
  if (dangerous.test(cleaned)) throw new Error("Blocked");

  cleaned = cleaned.replace(/\^/g, "**");

  const scopeEntries = Object.entries(ALLOWED);
  let body = cleaned;
  const sortedEntries = [...scopeEntries].sort((a, b) => b[0].length - a[0].length);
  for (const [name] of sortedEntries) {
    const idx = scopeEntries.findIndex(([k]) => k === name);
    const regex = new RegExp(`\\b${name}\\b`, "g");
    body = body.replace(regex, `_s[${idx}]`);
  }

  const scopeValues = scopeEntries.map(([, v]) => v);
  const fn = new Function("_s", `"use strict"; return (${body});`);
  const result = fn(scopeValues);

  if (typeof result !== "number" || Number.isNaN(result)) {
    return "NaN";
  }
  return result;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  NEW TOOLS: News, Dictionary, Wikipedia, Time, Units, Architecture
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ─── News (via Wikimedia Current Events or free RSS) ───────
// Uses the free, no-key-needed GNews API alternative
// We use the free Currents API (currentsapi.services) or a
// simple RSS-to-JSON proxy for real headlines.

export async function getNews(topic: string | null): Promise<string | null> {
  try {
    // Use the free Wikimedia "featured article" + "on this day" for general news
    // For topic-specific, use Wikipedia search as a news proxy
    if (topic) {
      // Search Wikipedia for current events related to the topic
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if (data.extract) {
          return [
            `Latest information on "${topic}":`,
            data.extract,
            `(Source: Wikipedia)`,
          ].join("\n");
        }
      }
    }

    // General news: fetch today's featured content from Wikipedia
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const url = `https://en.wikipedia.org/api/rest_v1/feed/featured/${yyyy}/${mm}/${dd}`;
    const response = await fetch(url);

    if (!response.ok) return null;

    const data = await response.json();
    const headlines: string[] = [];

    // Today's featured article
    if (data.tfa) {
      headlines.push(`Featured: ${data.tfa.titles?.normalized || "Article"} — ${data.tfa.extract || ""}`);
    }

    // "On this day" events
    if (data.onthisday && data.onthisday.length > 0) {
      const events = data.onthisday.slice(0, 3);
      for (const event of events) {
        headlines.push(`On this day (${event.year}): ${event.text}`);
      }
    }

    // Most-read articles (trending)
    if (data.mostread?.articles) {
      const trending = data.mostread.articles.slice(0, 3);
      for (const article of trending) {
        if (article.titles?.normalized && article.extract) {
          headlines.push(`Trending: ${article.titles.normalized} — ${article.extract.slice(0, 150)}...`);
        }
      }
    }

    if (headlines.length === 0) return null;

    return [
      `Today's news and trending topics (${today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}):`,
      ...headlines,
      `(Source: Wikipedia Featured Content)`,
    ].join("\n");
  } catch (error) {
    console.warn("News fetch failed:", error);
    return null;
  }
}

// ─── Dictionary (Free Dictionary API) ──────────────────────
// Uses the completely free dictionaryapi.dev (no key needed)

export async function getDictionary(word: string): Promise<string | null> {
  try {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase().trim())}`;
    const response = await fetch(url);

    if (!response.ok) return null;

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const entry = data[0];
    const lines: string[] = [`Definition of "${entry.word}":`];

    if (entry.phonetic) {
      lines.push(`Pronunciation: ${entry.phonetic}`);
    }

    if (entry.meanings) {
      for (const meaning of entry.meanings.slice(0, 3)) {
        lines.push(`[${meaning.partOfSpeech}]`);
        for (const def of meaning.definitions.slice(0, 2)) {
          lines.push(`  - ${def.definition}`);
          if (def.example) {
            lines.push(`    Example: "${def.example}"`);
          }
        }
        if (meaning.synonyms?.length > 0) {
          lines.push(`  Synonyms: ${meaning.synonyms.slice(0, 5).join(", ")}`);
        }
      }
    }

    lines.push(`(Source: Free Dictionary API)`);
    return lines.join("\n");
  } catch (error) {
    console.warn("Dictionary lookup failed:", error);
    return null;
  }
}

// ─── Wikipedia Summary ─────────────────────────────────────
// Free Wikipedia REST API (no key needed)

export async function getWikipediaSummary(topic: string): Promise<string | null> {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`;
    const response = await fetch(url);

    if (!response.ok) return null;

    const data = await response.json();
    if (!data.extract) return null;

    return [
      `${data.titles?.normalized || topic}:`,
      data.extract,
      data.description ? `Description: ${data.description}` : "",
      `(Source: Wikipedia)`,
    ]
      .filter(Boolean)
      .join("\n");
  } catch (error) {
    console.warn("Wikipedia fetch failed:", error);
    return null;
  }
}

// ─── World Clock / Time Zone ───────────────────────────────
// No API needed — uses built-in Intl.DateTimeFormat

export function getWorldTime(timezone: string | null): string {
  const zones: Record<string, string> = {
    "new york": "America/New_York", "nyc": "America/New_York", "est": "America/New_York", "eastern": "America/New_York",
    "los angeles": "America/Los_Angeles", "la": "America/Los_Angeles", "pst": "America/Los_Angeles", "pacific": "America/Los_Angeles", "california": "America/Los_Angeles",
    "chicago": "America/Chicago", "cst": "America/Chicago", "central": "America/Chicago",
    "denver": "America/Denver", "mst": "America/Denver", "mountain": "America/Denver",
    "london": "Europe/London", "uk": "Europe/London", "gmt": "Europe/London", "bst": "Europe/London",
    "paris": "Europe/Paris", "france": "Europe/Paris", "cet": "Europe/Paris",
    "berlin": "Europe/Berlin", "germany": "Europe/Berlin",
    "tokyo": "Asia/Tokyo", "japan": "Asia/Tokyo", "jst": "Asia/Tokyo",
    "shanghai": "Asia/Shanghai", "china": "Asia/Shanghai", "beijing": "Asia/Shanghai", "cst asia": "Asia/Shanghai",
    "mumbai": "Asia/Kolkata", "india": "Asia/Kolkata", "ist": "Asia/Kolkata", "kolkata": "Asia/Kolkata", "delhi": "Asia/Kolkata",
    "dubai": "Asia/Dubai", "uae": "Asia/Dubai", "gst": "Asia/Dubai",
    "singapore": "Asia/Singapore", "sgt": "Asia/Singapore",
    "sydney": "Australia/Sydney", "australia": "Australia/Sydney", "aest": "Australia/Sydney",
    "toronto": "America/Toronto", "canada": "America/Toronto",
    "moscow": "Europe/Moscow", "russia": "Europe/Moscow",
    "seoul": "Asia/Seoul", "korea": "Asia/Seoul",
    "bangkok": "Asia/Bangkok", "thailand": "Asia/Bangkok",
    "istanbul": "Europe/Istanbul", "turkey": "Europe/Istanbul",
    "utc": "UTC", "gmt+0": "UTC",
  };

  const now = new Date();
  const results: string[] = [];

  if (timezone) {
    const tz = zones[timezone.toLowerCase().trim()] || timezone.trim();
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "long", year: "numeric", month: "long", day: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: true, timeZoneName: "long",
      });
      results.push(`Current time in ${timezone}: ${formatter.format(now)}`);
    } catch {
      results.push(`Unknown timezone "${timezone}". Showing UTC instead.`);
      const utcFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        weekday: "long", year: "numeric", month: "long", day: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: true, timeZoneName: "long",
      });
      results.push(`UTC: ${utcFormatter.format(now)}`);
    }
  } else {
    // Show multiple timezones
    const showZones = [
      { label: "Your Local Time", tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
      { label: "UTC", tz: "UTC" },
      { label: "New York (EST/EDT)", tz: "America/New_York" },
      { label: "London (GMT/BST)", tz: "Europe/London" },
      { label: "Tokyo (JST)", tz: "Asia/Tokyo" },
      { label: "India (IST)", tz: "Asia/Kolkata" },
    ];
    results.push("Current time around the world:");
    for (const z of showZones) {
      try {
        const fmt = new Intl.DateTimeFormat("en-US", {
          timeZone: z.tz, hour: "2-digit", minute: "2-digit", second: "2-digit",
          hour12: true, weekday: "short", month: "short", day: "numeric",
        });
        results.push(`  ${z.label}: ${fmt.format(now)}`);
      } catch {
        // skip invalid timezone
      }
    }
  }

  results.push("(Source: System clock)");
  return results.join("\n");
}

// ─── Unit Converter ────────────────────────────────────────
// Base-unit conversion system: every unit maps to a base unit per category.
// Any unit can convert to any other unit in the same category by going
// through the base: value → base → target.

// Each entry: [category, baseUnit, factorToBase] or for temperature: special
interface UnitDef {
  category: string;
  base: string;
  toBase: (v: number) => number;
  fromBase: (v: number) => number;
  displayName: string;
}

const UNIT_DEFS: Record<string, UnitDef> = {
  // ── Length (base: meter) ──
  mm:   { category: 'length', base: 'm', toBase: v => v * 0.001,   fromBase: v => v * 1000, displayName: 'mm' },
  cm:   { category: 'length', base: 'm', toBase: v => v * 0.01,    fromBase: v => v * 100, displayName: 'cm' },
  m:    { category: 'length', base: 'm', toBase: v => v,           fromBase: v => v, displayName: 'm' },
  km:   { category: 'length', base: 'm', toBase: v => v * 1000,    fromBase: v => v / 1000, displayName: 'km' },
  in:   { category: 'length', base: 'm', toBase: v => v * 0.0254,  fromBase: v => v / 0.0254, displayName: 'in' },
  ft:   { category: 'length', base: 'm', toBase: v => v * 0.3048,  fromBase: v => v / 0.3048, displayName: 'ft' },
  yd:   { category: 'length', base: 'm', toBase: v => v * 0.9144,  fromBase: v => v / 0.9144, displayName: 'yd' },
  mi:   { category: 'length', base: 'm', toBase: v => v * 1609.344,fromBase: v => v / 1609.344, displayName: 'mi' },
  nmi:  { category: 'length', base: 'm', toBase: v => v * 1852,    fromBase: v => v / 1852, displayName: 'nmi' },

  // ── Mass (base: gram) ──
  mg:   { category: 'mass', base: 'g', toBase: v => v * 0.001,    fromBase: v => v * 1000, displayName: 'mg' },
  g:    { category: 'mass', base: 'g', toBase: v => v,            fromBase: v => v, displayName: 'g' },
  kg:   { category: 'mass', base: 'g', toBase: v => v * 1000,     fromBase: v => v / 1000, displayName: 'kg' },
  oz:   { category: 'mass', base: 'g', toBase: v => v * 28.3495,  fromBase: v => v / 28.3495, displayName: 'oz' },
  lb:   { category: 'mass', base: 'g', toBase: v => v * 453.592,  fromBase: v => v / 453.592, displayName: 'lb' },
  ton:  { category: 'mass', base: 'g', toBase: v => v * 907185,   fromBase: v => v / 907185, displayName: 'ton' },
  tonne:{ category: 'mass', base: 'g', toBase: v => v * 1000000,  fromBase: v => v / 1000000, displayName: 'tonne' },

  // ── Volume (base: liter) ──
  ml:   { category: 'volume', base: 'l', toBase: v => v * 0.001,   fromBase: v => v * 1000, displayName: 'ml' },
  l:    { category: 'volume', base: 'l', toBase: v => v,           fromBase: v => v, displayName: 'l' },
  gal:  { category: 'volume', base: 'l', toBase: v => v * 3.78541, fromBase: v => v / 3.78541, displayName: 'gal' },
  cup:  { category: 'volume', base: 'l', toBase: v => v * 0.236588,fromBase: v => v / 0.236588, displayName: 'cup' },
  tsp:  { category: 'volume', base: 'l', toBase: v => v * 0.00492892, fromBase: v => v / 0.00492892, displayName: 'tsp' },
  tbsp: { category: 'volume', base: 'l', toBase: v => v * 0.0147868,  fromBase: v => v / 0.0147868, displayName: 'tbsp' },
  floz: { category: 'volume', base: 'l', toBase: v => v * 0.0295735,  fromBase: v => v / 0.0295735, displayName: 'fl oz' },

  // ── Temperature (special) ──
  celsius:    { category: 'temperature', base: 'celsius', toBase: v => v,                 fromBase: v => v, displayName: '°C' },
  fahrenheit: { category: 'temperature', base: 'celsius', toBase: v => (v - 32) * 5 / 9,  fromBase: v => v * 9 / 5 + 32, displayName: '°F' },
  kelvin:     { category: 'temperature', base: 'celsius', toBase: v => v - 273.15,        fromBase: v => v + 273.15, displayName: 'K' },

  // ── Speed (base: m/s) ──
  mph:  { category: 'speed', base: 'ms', toBase: v => v * 0.44704,  fromBase: v => v / 0.44704, displayName: 'mph' },
  kmh:  { category: 'speed', base: 'ms', toBase: v => v * 0.277778, fromBase: v => v / 0.277778, displayName: 'km/h' },
  ms:   { category: 'speed', base: 'ms', toBase: v => v,            fromBase: v => v, displayName: 'm/s' },
  knot: { category: 'speed', base: 'ms', toBase: v => v * 0.514444, fromBase: v => v / 0.514444, displayName: 'knot' },

  // ── Area (base: sq meter) ──
  sqm:  { category: 'area', base: 'sqm', toBase: v => v,            fromBase: v => v, displayName: 'sq m' },
  sqft: { category: 'area', base: 'sqm', toBase: v => v * 0.092903, fromBase: v => v / 0.092903, displayName: 'sq ft' },
  acre: { category: 'area', base: 'sqm', toBase: v => v * 4046.86,  fromBase: v => v / 4046.86, displayName: 'acre' },
  ha:   { category: 'area', base: 'sqm', toBase: v => v * 10000,    fromBase: v => v / 10000, displayName: 'ha' },

  // ── Digital (base: byte) ──
  byte: { category: 'digital', base: 'byte', toBase: v => v,              fromBase: v => v, displayName: 'byte' },
  kb:   { category: 'digital', base: 'byte', toBase: v => v * 1024,       fromBase: v => v / 1024, displayName: 'KB' },
  mb:   { category: 'digital', base: 'byte', toBase: v => v * 1048576,    fromBase: v => v / 1048576, displayName: 'MB' },
  gb:   { category: 'digital', base: 'byte', toBase: v => v * 1073741824, fromBase: v => v / 1073741824, displayName: 'GB' },
  tb:   { category: 'digital', base: 'byte', toBase: v => v * 1099511627776, fromBase: v => v / 1099511627776, displayName: 'TB' },
};

// Comprehensive alias map → canonical unit key
const UNIT_ALIASES: Record<string, string> = {
  // Length
  mm: 'mm', millimeter: 'mm', millimetre: 'mm', millimeters: 'mm', millimetres: 'mm',
  cm: 'cm', centimeter: 'cm', centimetre: 'cm', centimeters: 'cm', centimetres: 'cm',
  cent: 'cm', cents: 'cm',  // "cent" as length unit = centimeter
  m: 'm', meter: 'm', metre: 'm', meters: 'm', metres: 'm',
  km: 'km', kilometer: 'km', kilometre: 'km', kilometers: 'km', kilometres: 'km',
  in: 'in', inch: 'in', inches: 'in', '"': 'in',
  ft: 'ft', foot: 'ft', feet: 'ft', "'": 'ft',
  yd: 'yd', yard: 'yd', yards: 'yd',
  mi: 'mi', mile: 'mi', miles: 'mi',
  nmi: 'nmi', 'nautical mile': 'nmi', 'nautical miles': 'nmi',

  // Mass
  mg: 'mg', milligram: 'mg', milligrams: 'mg',
  g: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  ton: 'ton', tons: 'ton', 'short ton': 'ton',
  tonne: 'tonne', tonnes: 'tonne', 'metric ton': 'tonne', 'metric tons': 'tonne',

  // Volume
  ml: 'ml', milliliter: 'ml', millilitre: 'ml', milliliters: 'ml', millilitres: 'ml',
  l: 'l', liter: 'l', litre: 'l', liters: 'l', litres: 'l',
  gal: 'gal', gallon: 'gal', gallons: 'gal',
  cup: 'cup', cups: 'cup',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  'fl oz': 'floz', floz: 'floz', 'fluid ounce': 'floz', 'fluid ounces': 'floz',

  // Temperature
  '°c': 'celsius', celsius: 'celsius', centigrade: 'celsius',
  '°f': 'fahrenheit', fahrenheit: 'fahrenheit',
  k: 'kelvin', kelvin: 'kelvin',

  // Speed
  mph: 'mph',
  'km/h': 'kmh', kmh: 'kmh', kph: 'kmh', 'kmph': 'kmh',
  'm/s': 'ms', 'ms': 'ms',
  knot: 'knot', knots: 'knot',

  // Area
  'sq m': 'sqm', 'sq meter': 'sqm', 'sq meters': 'sqm', 'square meter': 'sqm', 'square meters': 'sqm', 'square metre': 'sqm', 'square metres': 'sqm', sqm: 'sqm',
  'sq ft': 'sqft', 'sq feet': 'sqft', 'square feet': 'sqft', 'square foot': 'sqft', sqft: 'sqft',
  acre: 'acre', acres: 'acre',
  ha: 'ha', hectare: 'ha', hectares: 'ha',

  // Digital
  byte: 'byte', bytes: 'byte',
  kb: 'kb', kilobyte: 'kb', kilobytes: 'kb',
  mb: 'mb', megabyte: 'mb', megabytes: 'mb',
  gb: 'gb', gigabyte: 'gb', gigabytes: 'gb',
  tb: 'tb', terabyte: 'tb', terabytes: 'tb',
};

function normalizeUnit(u: string): string | null {
  const unit = u.toLowerCase().trim();
  return UNIT_ALIASES[unit] || null;
}

function convert(value: number, from: string, to: string): number | null {
  const fromDef = UNIT_DEFS[from];
  const toDef = UNIT_DEFS[to];
  if (!fromDef || !toDef) return null;
  if (fromDef.category !== toDef.category) return null; // Can't convert across categories

  // Convert: source → base → target
  const baseValue = fromDef.toBase(value);
  return toDef.fromBase(baseValue);
}

function detectUnitConversion(prompt: string): string | null {
  const lower = prompt.toLowerCase();

  // General patterns: "X unit to unit" or "convert X unit to unit"
  // Handles both "1 km to cm" and "1km to cm" (no space before unit)
  const patterns = [
    /convert\s+(\d+\.?\d*)\s+(.*?)\s+(?:to|in|into)\s+(.*?)(?:\?|!|\.|$)/i,
    /(\d+\.?\d*)\s*((?:sq(?:uare)?\s+)?[a-z\/°"']+(?:\s+[a-z]+)?)\s+(?:to|in|into)\s+((?:sq(?:uare)?\s+)?[a-z\/°"']+(?:\s+[a-z]+)?)(?:\?|!|\.|$)?/i,
  ];

  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (match) {
      const value = parseFloat(match[1]);
      const fromRaw = match[2].trim();
      const toRaw = match[3].trim();
      const from = normalizeUnit(fromRaw);
      const to = normalizeUnit(toRaw);
      if (from && to && from !== to) {
        const result = convert(value, from, to);
        if (result !== null) {
          const fromDef = UNIT_DEFS[from];
          const toDef = UNIT_DEFS[to];
          const formatted = result % 1 === 0 ? result.toString() : result.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
          return `${value} ${fromDef?.displayName ?? from} = ${formatted} ${toDef?.displayName ?? to}`;
        }
      }
    }
  }

  return null;
}

// ─── Currency Conversion (Frankfurter API — ECB rates) ────
// Free, no key needed, CORS-enabled, updated daily by European Central Bank

const CURRENCY_NAMES: Record<string, string> = {
  usd: "USD", dollar: "USD", dollars: "USD", "us dollar": "USD",
  eur: "EUR", euro: "EUR", euros: "EUR",
  gbp: "GBP", pound: "GBP", pounds: "GBP", sterling: "GBP", "british pound": "GBP",
  inr: "INR", rupee: "INR", rupees: "INR", "indian rupee": "INR",
  jpy: "JPY", yen: "JPY", "japanese yen": "JPY",
  cad: "CAD", "canadian dollar": "CAD",
  aud: "AUD", "australian dollar": "AUD",
  cny: "CNY", yuan: "CNY", renminbi: "CNY", rmb: "CNY",
  chf: "CHF", "swiss franc": "CHF", franc: "CHF",
  krw: "KRW", won: "KRW", "korean won": "KRW",
  brl: "BRL", real: "BRL", "brazilian real": "BRL",
  mxn: "MXN", peso: "MXN", "mexican peso": "MXN",
  sgd: "SGD", "singapore dollar": "SGD",
  hkd: "HKD", "hong kong dollar": "HKD",
  nzd: "NZD", "new zealand dollar": "NZD",
  sek: "SEK", krona: "SEK", "swedish krona": "SEK",
  nok: "NOK", krone: "NOK", "norwegian krone": "NOK",
  dkk: "DKK", "danish krone": "DKK",
  zar: "ZAR", rand: "ZAR", "south african rand": "ZAR",
  thb: "THB", baht: "THB", "thai baht": "THB",
  myr: "MYR", ringgit: "MYR", "malaysian ringgit": "MYR",
  php: "PHP", "philippine peso": "PHP",
  idr: "IDR", rupiah: "IDR", "indonesian rupiah": "IDR",
  try: "TRY", lira: "TRY", "turkish lira": "TRY",
  pln: "PLN", zloty: "PLN", "polish zloty": "PLN",
  czk: "CZK", koruna: "CZK", "czech koruna": "CZK",
  huf: "HUF", forint: "HUF", "hungarian forint": "HUF",
  ron: "RON", leu: "RON", "romanian leu": "RON",
  bgn: "BGN", lev: "BGN", "bulgarian lev": "BGN",
  isk: "ISK", "icelandic krona": "ISK",
};

function resolveCurrency(text: string): string | null {
  const t = text.toLowerCase().trim();
  return CURRENCY_NAMES[t] || (t.length === 3 ? t.toUpperCase() : null);
}

export async function convertCurrency(prompt: string): Promise<string | null> {
  try {
    // Pattern: "100 USD to INR", "convert 50 euros to dollars", "USD to INR"
    const patterns = [
      /(?:convert\s+)?(\d+\.?\d*)\s+(.+?)\s+(?:to|in|into)\s+(.+?)(?:\?|\s|$)/i,
      /(.+?)\s+(?:to|in|into)\s+(.+?)\s+(?:exchange|rate|conversion)/i,
      /(?:exchange\s*rate|rate)\s+(?:of|for)?\s*(.+?)\s+(?:to|in|into|vs|versus)\s+(.+?)(?:\?|\s|$)/i,
      /(.+?)\s+(?:to|vs|versus)\s+(.+?)\s+(?:exchange|rate)/i,
    ];

    let amount = 1;
    let fromCur: string | null = null;
    let toCur: string | null = null;

    // Try patterns with amount
    const amountMatch = prompt.match(/(?:convert\s+)?(\d+\.?\d*)\s+(.+?)\s+(?:to|in|into)\s+(.+?)(?:\?|\s*$)/i);
    if (amountMatch) {
      amount = parseFloat(amountMatch[1]);
      fromCur = resolveCurrency(amountMatch[2]);
      toCur = resolveCurrency(amountMatch[3]);
    }

    // Try patterns without amount
    if (!fromCur || !toCur) {
      const rateMatch = prompt.match(/(.+?)\s+(?:to|in|into|vs|versus)\s+(.+?)(?:\?|\s*$)/i);
      if (rateMatch) {
        // Clean trailing noise words: "inr today" → "inr", "dollars now" → "dollars"
        const cleanFrom = rateMatch[1].replace(/^.*?(\w+)\s*$/, "$1").replace(/\s+(today|now|rate|current|latest|live|please)$/gi, "").trim();
        const cleanTo = rateMatch[2].replace(/\s+(today|now|rate|current|latest|live|please)$/gi, "").trim();
        const f = resolveCurrency(cleanFrom);
        const t = resolveCurrency(cleanTo);
        if (f && t) {
          fromCur = f;
          toCur = t;
        }
      }
    }

    if (!fromCur || !toCur) return null;
    if (fromCur === toCur) return `${amount} ${fromCur} = ${amount} ${toCur} (same currency)`;

    const url = `https://api.frankfurter.dev/v1/latest?base=${fromCur}&symbols=${toCur}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const rate = data.rates?.[toCur];
    if (!rate) return null;

    const converted = amount * rate;
    return [
      `Currency Conversion (as of ${data.date}):`,
      `${amount} ${fromCur} = ${converted.toFixed(2)} ${toCur}`,
      `Exchange Rate: 1 ${fromCur} = ${rate} ${toCur}`,
      `(Source: European Central Bank via Frankfurter API)`,
    ].join("\n");
  } catch (error) {
    console.warn("Currency conversion failed:", error);
    return null;
  }
}

// ─── Web Search (DuckDuckGo Instant Answer API) ───────────
// Free, no API key needed. Used as a fallback when no other tool matches.
// Uses DuckDuckGo's Instant Answer API which returns structured answers
// from Wikipedia, Stack Overflow, MDN, and other knowledge sources.

export async function webSearch(query: string): Promise<string | null> {
  try {
    // ── Stage 1: DuckDuckGo Instant Answer API (structured knowledge) ──
    const url = `/api/ddg/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const response = await fetch(url);

    if (response.ok) {
      const data = await response.json();
      const results: string[] = [];

      if (data.Abstract) {
        results.push(data.Abstract);
        if (data.AbstractSource) results.push(`(Source: ${data.AbstractSource})`);
      }
      if (data.Answer) results.push(`Answer: ${data.Answer}`);
      if (data.Definition) {
        results.push(`Definition: ${data.Definition}`);
        if (data.DefinitionSource) results.push(`(Source: ${data.DefinitionSource})`);
      }
      if (data.RelatedTopics && data.RelatedTopics.length > 0) {
        const topics = data.RelatedTopics.filter((t: any) => t.Text).slice(0, 3);
        if (topics.length > 0) {
          results.push("Related:");
          for (const t of topics) results.push(`  • ${t.Text}`);
        }
      }

      if (results.length > 0) return results.join("\n");
    }

    // ── Stage 2: Wikipedia deep search (structured infobox + full intro) ──
    // The REST summary API returns very short text. Instead, we:
    //   a) Search Wikipedia to find the best matching article
    //   b) Fetch the full intro wikitext (which includes the infobox)
    //   c) Extract key structured data (CEO, founder, HQ, etc.)
    const wikiDeepResult = await wikiDeepSearch(query);
    if (wikiDeepResult) return wikiDeepResult;

    // ── Stage 3: Wikipedia REST summary (short fallback) ──
    const wikiResult = await getWikipediaSummary(query);
    if (wikiResult) return wikiResult;

    return `Web search for "${query}" did not return results. The query may be too specific.`;
  } catch (error) {
    console.warn("Web search failed:", error);
    try {
      const wikiResult = await getWikipediaSummary(query);
      if (wikiResult) return wikiResult;
    } catch { /* ignore */ }
    return null;
  }
}

// ── Wikipedia Deep Search ──────────────────────────────────
// Searches Wikipedia, finds the best article, then fetches the
// full intro section including the infobox. Extracts structured
// data like CEO, founder, headquarters, key_people, etc.
// This is much richer than the REST /page/summary endpoint.

async function wikiDeepSearch(query: string): Promise<string | null> {
  try {
    // Step 0: Extract the key subject from the query for better Wikipedia search
    // "who is present CEO of opentext?" → "opentext"
    // "what is the capital of France?" → "France"
    // "tell me about quantum computing" → "quantum computing"
    const searchQuery = extractSearchSubject(query);
    console.log('[wikiDeepSearch] Query:', query, '→ Subject:', searchQuery);

    // Step 1: Search Wikipedia for the best matching article
    // Try with extracted subject first, then fall back to full query
    const queries = searchQuery !== query.trim()
      ? [searchQuery, query]
      : [query];

    let articles: any[] = [];
    for (const q of queries) {
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=3&format=json&utf8=1&origin=*`;
      const searchResp = await fetch(searchUrl);
      if (!searchResp.ok) continue;

      const searchData = await searchResp.json();
      const found = searchData?.query?.search;
      if (found && found.length > 0) {
        articles = found;
        break;
      }
    }

    if (articles.length === 0) return null;

    // Step 2: For the top result, fetch the full intro section (wikitext)
    const bestTitle = articles[0].title;
    const parseUrl = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(bestTitle)}&prop=wikitext&format=json&utf8=1&section=0&origin=*`;
    const parseResp = await fetch(parseUrl);
    if (!parseResp.ok) return null;

    const parseData = await parseResp.json();
    const wikitext = parseData?.parse?.wikitext?.['*'];
    if (!wikitext) return null;

    const results: string[] = [];
    results.push(`Wikipedia: ${bestTitle}`);
    results.push('');

    // Step 3: Extract infobox fields (key_people, CEO, founder, etc.)
    const infoboxFields: Record<string, string> = {};
    const fieldRegex = /\|\s*(\w[\w\s]*?)\s*=\s*(.+?)(?=\n\||\n\}\})/gs;
    let match;
    while ((match = fieldRegex.exec(wikitext)) !== null) {
      const key = match[1].trim().toLowerCase().replace(/\s+/g, '_');
      // Clean wikitext markup: [[link|text]] → text, {{unbulleted list|...}} → items
      let val = match[2].trim()
        .replace(/\{\{unbulleted list\|/gi, '')       // Remove {{unbulleted list| opener
        .replace(/\{\{(?:flatlist|plainlist)\|?/gi, '')  // Remove other list templates
        .replace(/\{\{(?:start date and age|start date)\|([^}]+)\}\}/gi, '$1')
        .replace(/\{\{(?:increase|decrease|steady)\}\}/gi, '')
        .replace(/\{\{(?:US\$|USD)\|([^}]+)\}\}/gi, 'US$ $1')
        .replace(/\{\{(?:ISIN|tsx|NASDAQ|URL)[^}]*\}\}/gi, '')
        .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')   // [[link|text]] → text
        .replace(/\[\[([^\]]+)\]\]/g, '$1')               // [[link]] → link
        .replace(/\{\{[^}]*\}\}/g, '')                     // Remove remaining {{...}}
        .replace(/\}\}+/g, '')                              // Remove orphaned }}
        .replace(/&nbsp;/gi, ' ')                           // HTML entity
        .replace(/\|(?:df|mf|link|display|first)=\w*/g, '')   // Strip template params like |df=yes
        .replace(/'{2,3}/g, '')                             // Bold/italic
        .replace(/\|/g, ', ')                               // Remaining | separators → comma
        .replace(/,\s*,/g, ',')                             // Collapse double commas
        .replace(/,\s*$/g, '')                              // Trailing comma
        .replace(/^\s*,\s*/g, '')                           // Leading comma
        .replace(/\s+/g, ' ')
        .trim();
      if (val && val.length > 0 && val.length < 500) {
        infoboxFields[key] = val;
      }
    }

    // Show relevant infobox data
    const importantFields = [
      ['key_people', 'Key People'],
      ['founder', 'Founder'],
      ['founders', 'Founders'],
      ['ceo', 'CEO'],
      ['chairman', 'Chairman'],
      ['president', 'President'],
      ['type', 'Type'],
      ['industry', 'Industry'],
      ['location', 'Location'],
      ['headquarters', 'Headquarters'],
      ['hq_location', 'Headquarters'],
      ['foundation', 'Founded'],
      ['founded', 'Founded'],
      ['revenue', 'Revenue'],
      ['num_employees', 'Employees'],
      ['products', 'Products'],
      ['website', 'Website'],
      ['area_served', 'Area Served'],
      ['parent', 'Parent Company'],
      ['subsid', 'Subsidiaries'],
      ['capital', 'Capital'],
      ['population', 'Population'],
      ['leader_name', 'Leader'],
      ['leader_title', 'Leader Title'],
      ['birth_date', 'Born'],
      ['death_date', 'Died'],
      ['nationality', 'Nationality'],
      ['occupation', 'Occupation'],
      ['known_for', 'Known For'],
      ['spouse', 'Spouse'],
      ['children', 'Children'],
      ['alma_mater', 'Education'],
      ['awards', 'Awards'],
    ];

    const infoboxLines: string[] = [];
    for (const [key, label] of importantFields) {
      if (infoboxFields[key]) {
        infoboxLines.push(`${label}: ${infoboxFields[key]}`);
      }
    }

    if (infoboxLines.length > 0) {
      results.push('--- Key Facts ---');
      results.push(...infoboxLines);
      results.push('');
    }

    // Step 4: Extract the plain text intro (after the infobox)
    // Use iterative approach to strip nested templates (handles {{a{{b}}c}})
    let cleanText = wikitext;
    let prevLen = 0;
    while (cleanText.length !== prevLen) {
      prevLen = cleanText.length;
      cleanText = cleanText.replace(/\{\{[^{}]*\}\}/gs, ''); // Strip innermost {{...}} each pass
    }
    const introText = cleanText
      .replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, '')   // Remove file/category links
      .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')             // [[link|text]] → text
      .replace(/\[\[([^\]]+)\]\]/g, '$1')                        // [[link]] → link
      .replace(/<ref[^>]*\/>/gi, '')                              // Remove self-closing refs
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')                // Remove refs with content
      .replace(/<[^>]+>/g, '')                                    // Remove HTML tags
      .replace(/&nbsp;/gi, ' ')                                  // HTML entities
      .replace(/'{2,3}/g, '')                                     // Remove bold/italic markup
      .replace(/\|[^|\n]*=[^|\n]*/g, '')                          // Remove leftover | key=val
      .replace(/\n{3,}/g, '\n\n')                                // Collapse blank lines
      .trim();

    if (introText.length > 50) {
      results.push(introText.slice(0, 1500));
    }

    // Also include search snippet from other results
    if (articles.length > 1) {
      results.push('');
      results.push('--- Related Articles ---');
      for (let i = 1; i < Math.min(articles.length, 3); i++) {
        const snippet = articles[i].snippet
          ?.replace(/<[^>]+>/g, '')
          ?.trim();
        if (snippet) {
          results.push(`• ${articles[i].title}: ${snippet}`);
        }
      }
    }

    results.push('');
    results.push('(Source: Wikipedia)');

    return results.join('\n');
  } catch (error) {
    console.warn('Wikipedia deep search failed:', error);
    return null;
  }
}

// ─── Helper: Extract search subject from natural language query ─
// Strips question words, filler, and grammar to get the core subject.
// "who is present CEO of opentext?" → "opentext"
// "what is the capital of France?" → "France"  
// "tell me about quantum computing" → "quantum computing"
// "how tall is the Eiffel Tower?" → "Eiffel Tower"

function extractSearchSubject(query: string): string {
  let subject = query.trim();

  // Remove trailing punctuation
  subject = subject.replace(/[?!.]+$/g, '').trim();

  // Strip leading question words and filler
  subject = subject
    .replace(/^(who|what|where|when|why|how|which|whose|whom)\s+(is|are|was|were|does|do|did|can|could|will|would|should|has|have|had)\s+(the\s+)?(present|current|new|latest|recent|former|previous|first|last|acting|interim)?\s*/i, '')
    .replace(/^(tell\s+me\s+about|explain|describe|define|search\s+for|look\s+up|find|show\s+me|give\s+me\s+info\s+on|info\s+on|information\s+about)\s+(the\s+)?/i, '')
    .replace(/^(what'?s?|who'?s?)\s+(the\s+)?/i, '')
    .trim();

  // Handle "X of Y" patterns — extract the Y (the subject entity)
  // "CEO of opentext" → "opentext", "capital of France" → "France"
  // But keep compound concepts: "history of computing" → "computing"
  const ofMatch = subject.match(/^(?:ceo|chief\s+executive\s+officer|president|founder|chairman|cto|cfo|coo|head|director|capital|population|currency|language|flag|anthem|leader|prime\s+minister|king|queen|mayor|governor)\s+of\s+(.+)/i);
  if (ofMatch) {
    subject = ofMatch[1].trim();
  }

  // Remove trailing filler words
  subject = subject.replace(/\s+(today|now|currently|right now|at present|these days|in \d{4})$/i, '').trim();

  // If empty after extraction, fall back to original
  if (!subject || subject.length < 2) {
    subject = query.replace(/[?!.]+$/g, '').trim();
  }

  return subject;
}

// ─── Extraction Helpers for New Tools ──────────────────────

function extractNewsTopic(prompt: string): string | null {
  const patterns = [
    /(?:news|headlines?|latest|breaking)\s+(?:about|on|for|regarding)\s+(.+?)(?:\?|$)/i,
    /(.+?)\s+(?:news|headlines?)/i,
    /(?:what'?s?\s+)?(?:the\s+)?latest\s+(?:on|about)\s+(.+?)(?:\?|$)/i,
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match && match[1]) {
      const topic = match[1].trim().replace(/^(the|about|on)\s+/gi, "").trim();
      if (topic.length > 1 && topic.length < 80) return topic;
    }
  }
  return null; // General news
}

function extractWord(prompt: string): string | null {
  const patterns = [
    /(?:define|definition\s+of|meaning\s+of)\s+[""']?(\w+)[""']?/i,
    /what\s+does\s+[""']?(\w+)[""']?\s+mean/i,
    /what\s+is\s+(?:the\s+meaning\s+of\s+)?[""']?(\w+)[""']?/i,
    /(?:synonym|antonym|synonyms?|antonyms?)\s+(?:of|for)\s+[""']?(\w+)[""']?/i,
    /(?:pronounce|pronunciation\s+of|spell|spelling\s+of)\s+[""']?(\w+)[""']?/i,
    /[""']?(\w+)[""']?\s+means?\??\s*$/i,      // "fabulous means?"
    /[""']?(\w+)[""']?\s+meaning\??\s*$/i,      // "fabulous meaning?"
    /[""']?(\w+)[""']?\s+definition\??\s*$/i,   // "fabulous definition?"
    /[""']?(\w+)[""']?\s+synonyms?\??\s*$/i,    // "fabulous synonyms?"
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match && match[1] && match[1].length > 1) {
      return match[1];
    }
  }
  return null;
}

function extractWikiTopic(prompt: string): string | null {
  const patterns = [
    /(?:who\s+is|who\s+was)\s+(.+?)(?:\?|$)/i,
    /(?:what\s+is|what\s+are)\s+(.+?)(?:\?|$)/i,
    /tell\s+me\s+about\s+(.+?)(?:\?|$)/i,
    /(?:history\s+of|explain)\s+(.+?)(?:\?|$)/i,
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match && match[1]) {
      const topic = match[1].trim()
        .replace(/^(the|a|an)\s+/gi, "")
        .replace(/\s+(please|for me|briefly)$/gi, "")
        .trim();
      if (topic.length > 1 && topic.length < 80) return topic;
    }
  }
  return null;
}

function extractTimezone(prompt: string): string | null {
  const patterns = [
    /(?:time|clock|date)\s+(?:in|at|for)\s+(.+?)(?:\?|$|right now|now|currently)/i,
    /(?:what\s+time\s+is\s+it)\s+(?:in|at)\s+(.+?)(?:\?|$)/i,
    /(.+?)\s+(?:time|timezone|clock)/i,
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match && match[1]) {
      const tz = match[1].trim().replace(/^(the|current)\s+/gi, "").trim();
      if (tz.length > 1 && tz.length < 40) return tz;
    }
  }
  return null;
}
