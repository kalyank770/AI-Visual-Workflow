"""
MCP tool implementations and shared helpers.
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone, timedelta
from typing import Any, Callable

import httpx


def _noop_log(_: str) -> None:
    return


_log: Callable[[str], None] = _noop_log


def set_logger(logger: Callable[[str], None]) -> None:
    """Inject a logger from the orchestrator for consistent logging."""
    global _log
    _log = logger


HTTP_TIMEOUT = int(os.environ.get("HTTP_TIMEOUT", "10"))


def _http_get(url: str, headers: dict | None = None) -> Any | None:
    """Safe HTTP GET returning parsed JSON or None on failure."""
    try:
        h = {"User-Agent": "AIVisualWorkflow/2.0 (educational project; contact@example.com)"}
        if headers:
            h.update(headers)
        resp = httpx.get(url, headers=h, timeout=HTTP_TIMEOUT, follow_redirects=True)
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        _log(f"HTTP GET failed ({url[:80]}): {e}")
    return None


def _http_get_text(url: str) -> str | None:
    """Safe HTTP GET returning raw text or None on failure."""
    try:
        h = {"User-Agent": "AIVisualWorkflow/2.0 (educational project; contact@example.com)"}
        resp = httpx.get(url, headers=h, timeout=HTTP_TIMEOUT, follow_redirects=True)
        if resp.status_code == 200 and resp.text:
            return resp.text
    except Exception as e:
        _log(f"HTTP GET text failed ({url[:80]}): {e}")
    return None


# Well-known company -> ticker map (instant, no network needed)
_COMMON_TICKERS: dict[str, str] = {
    "apple": "AAPL", "microsoft": "MSFT", "google": "GOOGL", "alphabet": "GOOGL",
    "amazon": "AMZN", "meta": "META", "facebook": "META", "tesla": "TSLA",
    "nvidia": "NVDA", "amd": "AMD", "advanced micro devices": "AMD",
    "intel": "INTC", "netflix": "NFLX", "disney": "DIS", "walmart": "WMT",
    "coca cola": "KO", "coca-cola": "KO", "pepsi": "PEP", "pepsico": "PEP",
    "boeing": "BA", "ibm": "IBM", "oracle": "ORCL", "salesforce": "CRM",
    "adobe": "ADBE", "paypal": "PYPL", "uber": "UBER", "spotify": "SPOT",
    "snap": "SNAP", "pinterest": "PINS", "zoom": "ZM",
    "opentext": "OTEX", "open text": "OTEX", "otex": "OTEX",
    "berkshire hathaway": "BRK-B", "jpmorgan": "JPM", "jp morgan": "JPM",
    "goldman sachs": "GS", "bank of america": "BAC", "wells fargo": "WFC",
    "citigroup": "C", "visa": "V", "mastercard": "MA",
    "american express": "AXP", "nike": "NKE", "starbucks": "SBUX",
    "costco": "COST", "target": "TGT", "home depot": "HD",
    "exxon": "XOM", "exxonmobil": "XOM", "chevron": "CVX",
    "pfizer": "PFE", "moderna": "MRNA", "airbnb": "ABNB",
    "palantir": "PLTR", "snowflake": "SNOW", "crowdstrike": "CRWD",
    "shopify": "SHOP", "ford": "F", "general motors": "GM",
    "general electric": "GE", "3m": "MMM", "caterpillar": "CAT",
    "mcdonald's": "MCD", "mcdonalds": "MCD", "cisco": "CSCO",
    "qualcomm": "QCOM", "broadcom": "AVGO", "micron": "MU",
    "dell": "DELL", "hp": "HPQ", "sony": "SONY", "samsung": "SSNLF",
    "databricks": "DBX", "dropbox": "DBX", "twilio": "TWLO",
    "roku": "ROKU", "roblox": "RBLX", "coinbase": "COIN",
    "robinhood": "HOOD", "lucid": "LCID", "rivian": "RIVN",
    "nio": "NIO", "li auto": "LI", "xpeng": "XPEV",
}


def _resolve_ticker(query: str) -> str | None:
    """Resolve a company name or ticker to a Yahoo Finance ticker symbol."""
    stripped = query.strip()
    key = stripped.lower()

    if key in _COMMON_TICKERS:
        _log(f"Resolved '{query}' -> {_COMMON_TICKERS[key]} (common map)")
        return _COMMON_TICKERS[key]

    search_terms = [stripped]
    if not re.match(r"^[A-Z]{1,5}$", stripped):
        search_terms.extend([f"{stripped} corporation", f"{stripped} company", f"{stripped} inc"])
    for term in search_terms:
        data = _http_get(
            f"https://query2.finance.yahoo.com/v1/finance/search"
            f"?q={term}&quotesCount=5&newsCount=0&listsCount=0"
        )
        if not data:
            continue
        quotes = [
            q for q in data.get("quotes", [])
            if q.get("quoteType") in ("EQUITY", "ETF")
        ]
        if quotes:
            _log(f"Resolved '{query}' -> {quotes[0]['symbol']} (via '{term}')")
            return quotes[0]["symbol"]

    if re.match(r"^[A-Z]{1,4}$", stripped):
        _log(f"Resolved '{query}' -> {stripped} (assumed ticker, Yahoo search failed)")
        return stripped

    return None


def tool_stock_price(query: str) -> str | None:
    """Fetch real stock price from Yahoo Finance (free, no key)."""
    ticker = _resolve_ticker(query)
    if not ticker:
        _log(f"stock_price: no ticker found for '{query}'")
        return None
    data = _http_get(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=5d"
    )
    if not data:
        return None
    result = (data.get("chart") or {}).get("result", [None])[0]
    if not result:
        _log(f"stock_price: chart data empty for ticker '{ticker}'")
        return None
    meta = result["meta"]
    price = meta["regularMarketPrice"]
    prev = meta.get("chartPreviousClose", meta.get("previousClose", price))
    change = price - prev
    pct = (change / prev * 100) if prev else 0
    cur = meta.get("currency", "USD")
    name = meta.get("shortName", ticker)
    exchange = meta.get("exchangeName", "N/A")
    return (
        f"{name} ({ticker}) on {exchange}: {cur} {price:.2f} | "
        f"Change: {'+'if change>=0 else ''}{change:.2f} ({pct:+.2f}%) | "
        f"Prev Close: {cur} {prev:.2f}"
    )


def tool_weather(city: str) -> str | None:
    """Fetch real weather from Open-Meteo (free, no key)."""
    geo = _http_get(
        f"https://geocoding-api.open-meteo.com/v1/search?name={city}&count=1&language=en"
    )
    if not geo or not geo.get("results"):
        return None
    loc = geo["results"][0]
    lat, lon = loc["latitude"], loc["longitude"]
    name = loc.get("name", city)
    country = loc.get("country", "")
    weather = _http_get(
        f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
        f"&current=temperature_2m,relative_humidity_2m,apparent_temperature,"
        f"weather_code,wind_speed_10m"
        f"&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=3"
    )
    if not weather or "current" not in weather:
        return None
    cur = weather["current"]
    codes = {
        0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
        45: "Foggy", 48: "Rime fog", 51: "Light drizzle", 53: "Moderate drizzle",
        55: "Dense drizzle", 61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
        71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
        80: "Showers", 81: "Moderate showers", 82: "Heavy showers",
        95: "Thunderstorm", 96: "Thunderstorm with hail",
    }
    condition = codes.get(cur.get("weather_code", -1), f"Code {cur.get('weather_code')}")
    temp_f = cur["temperature_2m"] * 9 / 5 + 32
    feels_f = cur["apparent_temperature"] * 9 / 5 + 32
    daily = weather.get("daily", {})
    forecast = ""
    if daily.get("time"):
        days = []
        for i, date_str in enumerate(daily["time"][:3]):
            d = datetime.strptime(date_str, "%Y-%m-%d").strftime("%a %b %d")
            lo = daily["temperature_2m_min"][i]
            hi = daily["temperature_2m_max"][i]
            days.append(f"{d}: {lo}°C–{hi}°C")
        forecast = " | Forecast: " + "; ".join(days)
    return (
        f"Weather in {name}, {country}: {condition} | "
        f"{cur['temperature_2m']}°C ({temp_f:.0f}°F) | "
        f"Feels like {cur['apparent_temperature']}°C ({feels_f:.0f}°F) | "
        f"Humidity {cur['relative_humidity_2m']}% | "
        f"Wind {cur['wind_speed_10m']} km/h{forecast}"
    )


def tool_wikipedia(topic: str) -> str | None:
    """Fetch Wikipedia summary with infobox data for leadership info (free, no key)."""
    data = _http_get(
        f"https://en.wikipedia.org/api/rest_v1/page/summary/{topic.replace(' ', '_')}",
        headers={"Accept": "application/json"},
    )
    if not data or data.get("type") == "not_found":
        search = _http_get(
            f"https://en.wikipedia.org/w/api.php"
            f"?action=opensearch&search={topic}&limit=1&format=json"
        )
        if search and isinstance(search, list) and len(search) > 1 and search[1]:
            title = search[1][0]
            data = _http_get(
                f"https://en.wikipedia.org/api/rest_v1/page/summary/"
                f"{title.replace(' ', '_')}",
                headers={"Accept": "application/json"},
            )
    if not data or "extract" not in data:
        return None

    title = data.get("title", topic)
    extract = data["extract"]
    if len(extract) > 800:
        extract = extract[:800].rsplit(". ", 1)[0] + "."

    page_title = data.get("title", topic)
    infobox_data = _http_get(
        f"https://en.wikipedia.org/w/api.php"
        f"?action=query&prop=revisions&rvprop=content&rvslots=main&titles={page_title.replace(' ', '_')}"
        f"&format=json&formatversion=2"
    )

    leadership_info = ""
    if infobox_data and "query" in infobox_data and "pages" in infobox_data["query"]:
        pages = infobox_data["query"]["pages"]
        if pages and len(pages) > 0:
            content = pages[0].get("revisions", [{}])[0].get("slots", {}).get("main", {}).get("content", "")
            ceo_match = re.search(r"\|\s*(?:key_people|ceo|CEO|leader_name)\s*=\s*([^\n|]+)", content, re.IGNORECASE)
            if ceo_match:
                ceo_text = ceo_match.group(1).strip()
                ceo_text = re.sub(r"\[\[(?:[^\]]+\|)?([^\]]+)\]\]", r"\1", ceo_text)
                ceo_text = re.sub(r"{{[^}]+}}", "", ceo_text)
                ceo_text = re.sub(r"<[^>]+>", "", ceo_text)
                ceo_text = ceo_text.strip()
                if ceo_text and len(ceo_text) < 200:
                    leadership_info = f" | Leadership: {ceo_text}"

    return f"Wikipedia — {title}: {extract}{leadership_info}"


def tool_dictionary(word: str) -> str | None:
    """Fetch word definition from Free Dictionary API (free, no key)."""
    data = _http_get(f"https://api.dictionaryapi.dev/api/v2/entries/en/{word}")
    if not data or not isinstance(data, list):
        return None
    entry = data[0]
    phonetic = entry.get("phonetic", "")
    meanings = []
    for m in entry.get("meanings", [])[:3]:
        pos = m.get("partOfSpeech", "")
        defs = [d["definition"] for d in m.get("definitions", [])[:2]]
        if defs:
            meanings.append(f"{pos}: {'; '.join(defs)}")
    return f"{word} {phonetic}: " + " | ".join(meanings) if meanings else None


def tool_calculator(expr: str) -> str | None:
    """Safely evaluate a math expression (no code injection)."""
    expressions = [e.strip() for e in re.split(r"[;|]", expr) if e.strip()]
    results = []
    for item in expressions:
        cleaned = re.sub(r"[^0-9+\-*/().%^ ]", "", item)
        cleaned = cleaned.replace("^", "**")
        if not cleaned.strip():
            continue
        try:
            result = eval(
                cleaned,
                {"__builtins__": {}},
                {"abs": abs, "round": round, "min": min, "max": max},
            )
            results.append(f"{item} = {result}")
        except Exception:
            continue
    return " | ".join(results) if results else None


def tool_unit_converter(query: str) -> str | None:
    """Convert between common units of length."""
    unit_map = {
        "mm": 0.001, "millimeter": 0.001, "millimeters": 0.001,
        "cm": 0.01, "centimeter": 0.01, "centimeters": 0.01,
        "m": 1.0, "meter": 1.0, "meters": 1.0,
        "km": 1000.0, "kilometer": 1000.0, "kilometers": 1000.0,
        "in": 0.0254, "inch": 0.0254, "inches": 0.0254,
        "ft": 0.3048, "foot": 0.3048, "feet": 0.3048,
        "yd": 0.9144, "yard": 0.9144, "yards": 0.9144,
        "mi": 1609.344, "mile": 1609.344, "miles": 1609.344,
    }
    queries = [q.strip() for q in re.split(r"[;|]", query) if q.strip()]
    results = []
    for item in queries:
        match = re.search(
            r"(?P<amount>[-+]?\d*\.?\d+)\s*(?P<from>[a-zA-Z]+)\s*(?:to|in|into)\s*(?P<to>[a-zA-Z]+)",
            item,
            re.IGNORECASE,
        )
        if not match:
            continue
        amount = float(match.group("amount"))
        from_unit = match.group("from").lower()
        to_unit = match.group("to").lower()
        if from_unit not in unit_map or to_unit not in unit_map:
            continue
        meters = amount * unit_map[from_unit]
        converted = meters / unit_map[to_unit]
        results.append(f"{amount} {from_unit} = {converted:g} {to_unit}")
    return " | ".join(results) if results else None


def is_leadership_query(prompt: str) -> bool:
    """Detect leadership/executive queries that require live sources."""
    lower = prompt.lower()
    return bool(re.search(
        r"\b(ceo|chief\s+executive|cfo|cto|coo|president|founder|chairman|"
        r"executive|leadership|management\s+team|board\s+of\s+directors)\b",
        lower,
    ))


def _normalize_web_search_query(query: str) -> str:
    lower = query.lower()
    normalized = query.strip()

    if is_leadership_query(query):
        if "current" not in lower and "latest" not in lower:
            normalized = f"{normalized} current latest"
        if any(term in lower for term in ("opentext", "otex", "open text")):
            normalized = (
                f"{normalized} site:opentext.com OR site:investors.opentext.com"
            )
    elif any(term in lower for term in ("current", "latest", "recent", "today", "now")):
        if "latest" not in lower:
            normalized = f"{normalized} latest"

    return normalized


def _jina_proxy_url(url: str) -> str:
    clean = url.replace("https://", "").replace("http://", "")
    return f"https://r.jina.ai/http://{clean}"


def _extract_ceo_from_text(text: str) -> str | None:
    patterns = [
        (r"([A-Z][A-Za-z .'-]{2,60})\s+Interim\s+Chief\s+Executive\s+Officer", "Interim Chief Executive Officer"),
        (r"([A-Z][A-Za-z .'-]{2,60})\s+Chief\s+Executive\s+Officer", "Chief Executive Officer"),
        (r"Chief\s+Executive\s+Officer\s*[:\-]\s*([A-Z][A-Za-z .'-]{2,60})", "Chief Executive Officer"),
        (r"CEO\s*[:\-]\s*([A-Z][A-Za-z .'-]{2,60})", "Chief Executive Officer"),
    ]
    for pattern, title in patterns:
        match = re.search(pattern, text)
        if match:
            name = match.group(1).strip(" ,.-")
            if name:
                return f"{name} ({title})"
    return None


def _leadership_live_fallback(query: str) -> str | None:
    """Attempt to fetch leadership info from official or trusted pages."""
    lower = query.lower()
    urls: list[str] = []

    if any(term in lower for term in ("opentext", "otex", "open text")):
        urls = [
            "https://www.opentext.com/about/leadership",
            "https://investors.opentext.com/corporate-governance/management",
            "https://www.opentext.com/about/leadership/executive-team",
        ]
    else:
        ticker = _resolve_ticker(query)
        if ticker:
            urls = [
                f"https://www.reuters.com/markets/companies/{ticker}.O",
                f"https://www.reuters.com/markets/companies/{ticker}.TO",
            ]

    for url in urls:
        text = _http_get_text(url) or _http_get_text(_jina_proxy_url(url))
        if not text:
            continue
        ceo_info = _extract_ceo_from_text(text)
        if ceo_info:
            return f"Leadership (live): {ceo_info} (source: {url})"
    return None


def tool_web_search(query: str) -> str | None:
    """Search using DuckDuckGo Instant Answer API (free, no key)."""
    normalized_query = _normalize_web_search_query(query)
    data = _http_get(
        f"https://api.duckduckgo.com/"
        f"?q={normalized_query.replace(' ', '+')}&format=json&no_html=1&skip_disambig=1"
    )
    if not data:
        return None
    answer = data.get("Answer", "")
    if answer:
        return f"[DuckDuckGo] {answer}"
    abstract = data.get("AbstractText", "")
    source = data.get("AbstractSource", "")
    if abstract:
        if len(abstract) > 600:
            abstract = abstract[:600].rsplit(". ", 1)[0] + "."
        if is_leadership_query(normalized_query) and source.lower() == "wikipedia":
            fallback = _leadership_live_fallback(normalized_query)
            if fallback:
                return fallback
        return f"[{source}] {abstract}"
    topics = data.get("RelatedTopics", [])
    if topics:
        summaries = []
        for t in topics[:3]:
            text = t.get("Text", "")
            if text:
                summaries.append(text[:200])
        if summaries:
            return "Related: " + " | ".join(summaries)
    infobox = data.get("Infobox", {})
    if infobox and infobox.get("content"):
        facts = []
        for item in infobox["content"][:5]:
            label = item.get("label", "")
            value = item.get("value", "")
            if label and value:
                facts.append(f"{label}: {value}")
        if facts:
            return "[DuckDuckGo] " + " | ".join(facts)

    if is_leadership_query(normalized_query):
        fallback = _leadership_live_fallback(normalized_query)
        if fallback:
            return fallback

    return (
        "Web search query received: "
        f"'{normalized_query}'. For real-time results, please use a full-featured search engine."
    )


def tool_stock_analysis(query: str) -> str | None:
    """Fetch stock trend data from Yahoo Finance for prediction/forecast context."""
    ticker = _resolve_ticker(query)
    if not ticker:
        return None
    data = _http_get(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        f"?interval=1d&range=1mo"
    )
    if not data:
        return None
    result = (data.get("chart") or {}).get("result", [None])[0]
    if not result:
        return None
    meta = result["meta"]
    price = meta["regularMarketPrice"]
    prev = meta.get("chartPreviousClose", meta.get("previousClose", price))
    cur = meta.get("currency", "USD")
    name = meta.get("shortName", ticker)
    exchange = meta.get("exchangeName", "N/A")
    indicators = result.get("indicators", {}).get("quote", [{}])[0]
    closes = [c for c in (indicators.get("close") or []) if c is not None]
    trend_info = ""
    if len(closes) >= 5:
        recent_5 = closes[-5:]
        month_start = closes[0]
        month_end = closes[-1]
        month_change = month_end - month_start
        month_pct = (month_change / month_start * 100) if month_start else 0
        high_30d = max(closes)
        low_30d = min(closes)
        avg_30d = sum(closes) / len(closes)
        five_day_change = recent_5[-1] - recent_5[0]
        five_day_pct = (five_day_change / recent_5[0] * 100) if recent_5[0] else 0
        trend_dir = "upward" if month_pct > 1 else "downward" if month_pct < -1 else "sideways"
        trend_info = (
            f" | 30-Day Trend: {trend_dir} ({month_pct:+.2f}%) | "
            f"30-Day Range: {cur} {low_30d:.2f} - {cur} {high_30d:.2f} | "
            f"30-Day Avg: {cur} {avg_30d:.2f} | "
            f"5-Day Change: {five_day_pct:+.2f}%"
        )
    daily_change = price - prev
    daily_pct = (daily_change / prev * 100) if prev else 0
    return (
        f"{name} ({ticker}) on {exchange}: Current {cur} {price:.2f} | "
        f"Daily: {'+'if daily_change>=0 else ''}{daily_change:.2f} ({daily_pct:+.2f}%)"
        f"{trend_info}"
    )


def tool_world_clock(location: str) -> str:
    """Get current time for a timezone or city."""
    if ";" in location or "|" in location:
        locations = [l.strip() for l in re.split(r"[;|]", location) if l.strip()]
        outputs = [tool_world_clock(loc) for loc in locations]
        return " | ".join(outputs)
    offset_map = {
        "new york": -5, "nyc": -5, "est": -5, "eastern": -5,
        "chicago": -6, "cst": -6, "central": -6,
        "denver": -7, "mst": -7, "mountain": -7,
        "los angeles": -8, "la": -8, "pst": -8, "pacific": -8, "san francisco": -8,
        "london": 0, "gmt": 0, "utc": 0,
        "paris": 1, "berlin": 1, "cet": 1, "rome": 1, "madrid": 1,
        "cairo": 2, "johannesburg": 2, "istanbul": 3, "moscow": 3, "msk": 3,
        "dubai": 4, "abu dhabi": 4, "india": 5.5, "mumbai": 5.5, "delhi": 5.5,
        "ist": 5.5, "kolkata": 5.5, "bangalore": 5.5, "hyderabad": 5.5, "chennai": 5.5,
        "bangkok": 7, "jakarta": 7, "singapore": 8, "hong kong": 8,
        "beijing": 8, "shanghai": 8, "perth": 8,
        "tokyo": 9, "jst": 9, "seoul": 9, "kst": 9,
        "sydney": 11, "aest": 11, "melbourne": 11, "auckland": 13, "nzst": 13,
        "honolulu": -10, "hst": -10, "anchorage": -9, "akst": -9,
        "sao paulo": -3, "buenos aires": -3, "mexico city": -6,
        "waterloo": -5, "toronto": -5, "vancouver": -8, "ottawa": -5,
    }
    loc_lower = location.lower().strip()
    offset = offset_map.get(loc_lower)
    if offset is None:
        for name, off in offset_map.items():
            if name in loc_lower or loc_lower in name:
                offset = off
                break
    if offset is None:
        offset = 0
        location = f"{location} (defaulting to UTC)"
    now = datetime.now(timezone.utc) + timedelta(hours=offset)
    sign = "+" if offset >= 0 else ""
    return f"Time in {location}: {now.strftime('%Y-%m-%d %H:%M:%S')} (UTC{sign}{offset})"


_CURRENCY_CODES: dict[str, str] = {
    "usd": "USD", "dollar": "USD", "dollars": "USD", "us dollar": "USD",
    "eur": "EUR", "euro": "EUR", "euros": "EUR",
    "gbp": "GBP", "pound": "GBP", "pounds": "GBP", "sterling": "GBP",
    "inr": "INR", "rupee": "INR", "rupees": "INR", "indian rupee": "INR",
    "jpy": "JPY", "yen": "JPY",
    "cad": "CAD", "canadian dollar": "CAD",
    "aud": "AUD", "australian dollar": "AUD",
    "cny": "CNY", "yuan": "CNY", "chinese yuan": "CNY",
    "chf": "CHF", "franc": "CHF", "swiss franc": "CHF",
    "krw": "KRW", "won": "KRW", "korean won": "KRW",
    "brl": "BRL", "real": "BRL", "brazilian real": "BRL",
    "mxn": "MXN", "mexican peso": "MXN", "peso": "MXN",
    "sgd": "SGD", "singapore dollar": "SGD",
    "hkd": "HKD", "hong kong dollar": "HKD",
    "nzd": "NZD", "new zealand dollar": "NZD",
    "sek": "SEK", "swedish krona": "SEK",
    "nok": "NOK", "norwegian krone": "NOK",
    "dkk": "DKK", "danish krone": "DKK",
    "zar": "ZAR", "south african rand": "ZAR", "rand": "ZAR",
    "thb": "THB", "baht": "THB", "thai baht": "THB",
    "myr": "MYR", "ringgit": "MYR", "malaysian ringgit": "MYR",
    "php": "PHP", "peso": "PHP", "philippine peso": "PHP",
    "idr": "IDR", "rupiah": "IDR", "indonesian rupiah": "IDR",
    "try": "TRY", "lira": "TRY", "turkish lira": "TRY",
    "pln": "PLN", "zloty": "PLN", "polish zloty": "PLN",
    "czk": "CZK", "czech koruna": "CZK", "koruna": "CZK",
    "huf": "HUF", "hungarian forint": "HUF", "forint": "HUF",
    "ron": "RON", "romanian leu": "RON", "leu": "RON",
    "bgn": "BGN", "bulgarian lev": "BGN", "lev": "BGN",
    "hrk": "HRK", "croatian kuna": "HRK", "kuna": "HRK",
    "isk": "ISK", "icelandic krona": "ISK",
}


def tool_currency(from_currency: str, to_currency: str, amount: float = 1.0) -> str | None:
    """Convert currency using Exchange Rate API (free tier available)."""
    from_code = _CURRENCY_CODES.get(from_currency.lower(), from_currency.upper())
    to_code = _CURRENCY_CODES.get(to_currency.lower(), to_currency.upper())

    if not (len(from_code) == 3 and from_code.isupper() and len(to_code) == 3 and to_code.isupper()):
        _log(f"currency: invalid codes '{from_code}' -> '{to_code}'")
        return None

    apis = [
        f"https://api.exchangerate-api.com/v4/latest/{from_code}",
        f"https://openexchangerates.org/api/latest.json?base={from_code}&app_id=dummy",
        f"https://api.fixer.io/latest?base={from_code}&symbols={to_code}",
    ]

    for api_url in apis:
        try:
            data = _http_get(api_url)
            if not data:
                continue
            rate = None
            if "rates" in data and isinstance(data["rates"], dict):
                rate = data["rates"].get(to_code)
            elif "rates" in data and isinstance(data["rates"], dict):
                rate = data["rates"].get(to_code)
            elif "rates" in data and to_code in data["rates"]:
                rate = data["rates"][to_code]

            if rate and isinstance(rate, (int, float)):
                converted = amount * rate
                return (
                    f"{amount} {from_code} = {converted:.2f} {to_code} "
                    f"(rate: 1 {from_code} = {rate:.4f} {to_code})"
                )
        except Exception as e:
            _log(f"currency API {api_url[:40]}: {e}")
            continue

    _offline_rates = {
        ("USD", "EUR"): 0.92,
        ("EUR", "USD"): 1.09,
        ("USD", "INR"): 83.2,
        ("INR", "USD"): 0.012,
        ("EUR", "INR"): 90.5,
        ("INR", "EUR"): 0.011,
        ("EUR", "GBP"): 0.86,
        ("GBP", "EUR"): 1.16,
    }

    rate = _offline_rates.get((from_code, to_code))
    if rate:
        converted = amount * rate
        _log(f"currency: using offline fallback rate for {from_code}->{to_code}")
        return (
            f"{amount} {from_code} = {converted:.2f} {to_code} "
            f"(rate: 1 {from_code} = {rate:.4f} {to_code}) [offline rate - may be outdated]"
        )

    _log(f"currency: no rate found for {from_code}->{to_code}")
    return None


def execute_tool_call(tool_name: str, entity: str, original_prompt: str = "") -> str | None:
    """Execute a tool call by name. Returns formatted result string or None."""
    if tool_name == "wikipedia":
        has_time_sensitive = bool(
            re.search(
                r"\b(current|latest|recent|new|live|today|now|recently|this\s+(?:week|month|year)|upcoming|\d{4})\b",
                original_prompt.lower(),
            )
        )
        if has_time_sensitive:
            result = tool_web_search(original_prompt or entity)
            if result:
                return f"Tool [WebSearch]: {result}"
            return "Tool [WebSearch]: Web search attempted but no results returned."

    if not entity or not entity.strip():
        return None
    entity = entity.strip()

    if ";" in entity or "|" in entity:
        parts = [p.strip() for p in re.split(r"[;|]", entity) if p.strip()]
        label_map = {
            "stock_price": "StockPrice",
            "stock_analysis": "StockAnalysis",
            "weather": "Weather",
            "wikipedia": "Wikipedia",
            "dictionary": "Dictionary",
            "calculator": "Calculator",
            "unit_converter": "UnitConverter",
            "world_clock": "WorldClock",
            "currency": "Currency",
            "web_search": "WebSearch",
        }
        label = label_map.get(tool_name, tool_name)
        results: list[str] = []
        for part in parts:
            result = execute_tool_call(tool_name, part, original_prompt=original_prompt)
            if not result:
                continue
            prefix = f"Tool [{label}]: "
            if result.startswith(prefix):
                results.append(result[len(prefix):])
            else:
                results.append(result)
        if results:
            return f"Tool [{label}]: " + " | ".join(results)
        return None

    if tool_name == "stock_price":
        r = tool_stock_price(entity)
        return f"Tool [StockPrice]: {r}" if r else None
    if tool_name == "stock_analysis":
        r = tool_stock_analysis(entity)
        return f"Tool [StockAnalysis]: {r}" if r else None
    if tool_name == "weather":
        r = tool_weather(entity)
        return f"Tool [Weather]: {r}" if r else None
    if tool_name == "wikipedia":
        r = tool_wikipedia(entity)
        return f"Tool [Wikipedia]: {r}" if r else None
    if tool_name == "dictionary":
        r = tool_dictionary(entity)
        return f"Tool [Dictionary]: {r}" if r else None
    if tool_name == "calculator":
        r = tool_calculator(entity)
        return f"Tool [Calculator]: {r}" if r else None
    if tool_name == "unit_converter":
        r = tool_unit_converter(entity)
        return f"Tool [UnitConverter]: {r}" if r else None
    if tool_name == "world_clock":
        r = tool_world_clock(entity)
        return f"Tool [WorldClock]: {r}"
    if tool_name == "currency":
        parts = entity.split(",")
        if len(parts) == 2:
            from_cur = parts[0].strip()
            to_cur = parts[1].strip()
            r = tool_currency(from_cur, to_cur)
            return f"Tool [Currency]: {r}" if r else None
        return None
    if tool_name == "web_search":
        r = tool_web_search(entity)
        return f"Tool [WebSearch]: {r}" if r else None
    return None
