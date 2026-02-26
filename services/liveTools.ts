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
  if (lower.includes("define") || lower.includes("meaning of") || lower.includes("definition") || lower.includes("what does") && lower.includes("mean")) {
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
      const topic = extractWikiTopic(userPrompt);
      if (topic && topic.length > 2) {
        const wikiData = await getWikipediaSummary(topic);
        if (wikiData) {
          toolResults.push(`Tool [Wikipedia]: ${wikiData}`);
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
// Handles common conversions — no API needed

function detectUnitConversion(prompt: string): string | null {
  const lower = prompt.toLowerCase();

  // Pattern: "X unit to unit" or "convert X unit to unit"
  const patterns = [
    /(\d+\.?\d*)\s*(km|kilometer|kilometres?|miles?|mi)\s+(?:to|in|into)\s+(km|kilometer|kilometres?|miles?|mi)/i,
    /(\d+\.?\d*)\s*(kg|kilogram|kilograms?|lbs?|pounds?)\s+(?:to|in|into)\s+(kg|kilogram|kilograms?|lbs?|pounds?)/i,
    /(\d+\.?\d*)\s*(°?[fc]|fahrenheit|celsius|centigrade)\s+(?:to|in|into)\s+(°?[fc]|fahrenheit|celsius|centigrade)/i,
    /(\d+\.?\d*)\s*(meters?|metres?|m|feet|ft|foot)\s+(?:to|in|into)\s+(meters?|metres?|m|feet|ft|foot)/i,
    /(\d+\.?\d*)\s*(liters?|litres?|l|gallons?|gal)\s+(?:to|in|into)\s+(liters?|litres?|l|gallons?|gal)/i,
    /(\d+\.?\d*)\s*(cm|centimeters?|centimetres?|inches?|in)\s+(?:to|in|into)\s+(cm|centimeters?|centimetres?|inches?|in)/i,
    /(\d+\.?\d*)\s*(oz|ounces?|grams?|g)\s+(?:to|in|into)\s+(oz|ounces?|grams?|g)/i,
    /(\d+\.?\d*)\s*(mph|km\/h|kmh|kph)\s+(?:to|in|into)\s+(mph|km\/h|kmh|kph)/i,
    /convert\s+(\d+\.?\d*)\s*(.*?)\s+(?:to|in|into)\s+(.*?)(?:\?|$)/i,
  ];

  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (match) {
      const value = parseFloat(match[1]);
      const from = normalizeUnit(match[2]);
      const to = normalizeUnit(match[3]);
      if (from && to && from !== to) {
        const result = convert(value, from, to);
        if (result !== null) {
          return `${value} ${from} = ${result.toFixed(4)} ${to}`;
        }
      }
    }
  }

  return null;
}

function normalizeUnit(u: string): string | null {
  const unit = u.toLowerCase().trim().replace(/s$/, "");
  const map: Record<string, string> = {
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
}

function convert(value: number, from: string, to: string): number | null {
  const conversions: Record<string, Record<string, (v: number) => number>> = {
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

  return conversions[from]?.[to]?.(value) ?? null;
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
