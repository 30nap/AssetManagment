const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs/promises");
const path = require("node:path");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const TGJU_BASE_URL = "https://www.tgju.org/profile/";
const CACHE_TTL = 60 * 1000;

const cache = new Map();
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const marketNames = {
  geram18: "طلا ۱۸ عیار",
  geram24: "طلا ۲۴ عیار",
  price_dollar_rl: "دلار",
  "crypto-tether": "تتر",
  price_eur: "یورو",
  "crypto-bitcoin": "بیت کوین",
  "crypto-ethereum": "اتریوم",
  sekee: "سکه تمام",
  nim: "نیم سکه",
  rob: "ربع سکه",
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname.startsWith("/api/tgju/")) {
      await handleTgjuRequest(url, response);
      return;
    }

    if (url.pathname === "/api/prices") {
      await handlePricesRequest(response);
      return;
    }

    await handleStaticRequest(url, response);
  } catch (error) {
    sendJson(response, 500, {
      error: error.message || "Internal server error",
      cause: error.cause?.message || error.code || null,
    });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use on ${HOST}. Stop the existing process or run with another port, for example: PORT=3001 npm start`,
    );
    process.exit(1);
  }

  throw error;
});

server.listen(PORT, HOST, () => {
  console.log(`Asset dashboard is running at http://${HOST}:${PORT}/`);
});

async function handleTgjuRequest(url, response) {
  const slug = decodeURIComponent(url.pathname.replace("/api/tgju/", ""));

  if (!/^[a-z0-9_-]+$/i.test(slug) || !marketNames[slug]) {
    sendJson(response, 400, { error: "Unknown TGJU market slug" });
    return;
  }

  const cached = cache.get(slug);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL) {
    sendJson(response, 200, { ...cached.data, cached: true });
    return;
  }

  const tgjuUrl = `${TGJU_BASE_URL}${slug}`;
  const html = await fetchTgjuPage(tgjuUrl);
  const parsed = parseTgjuPrice(html, marketNames[slug], slug);
  const data = { ...parsed, slug, source: tgjuUrl, updatedAt: new Date().toISOString() };

  cache.set(slug, { createdAt: Date.now(), data });
  sendJson(response, 200, data);
}

async function handlePricesRequest(response) {
  const cacheKey = "prices";
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL) {
    sendJson(response, 200, { ...cached.data, cached: true });
    return;
  }

  const source = "https://www.tgju.org/";
  const html = await fetchHomePage(source);
  const prices = parseHomePrices(html);
  const data = { prices, source, updatedAt: new Date().toISOString() };

  cache.set(cacheKey, { createdAt: Date.now(), data });
  sendJson(response, 200, data);
}

async function fetchHomePage(source) {
  try {
    return await fetchText(`https://r.jina.ai/${source}`, 10000);
  } catch {
    return fetchTgjuPage(source);
  }
}

async function handleStaticRequest(url, response) {
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const requestedPath = path.normalize(path.join(ROOT, pathname));

  if (!requestedPath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  const file = await fs.readFile(requestedPath);
  const ext = path.extname(requestedPath).toLowerCase();
  response.writeHead(200, { "content-type": mimeTypes[ext] || "application/octet-stream" });
  response.end(file);
}

async function fetchTgjuPage(url) {
  const urls = [url, `https://r.jina.ai/${url}`];
  let lastError;

  for (const candidateUrl of urls) {
    try {
      return await fetchText(candidateUrl, candidateUrl === url ? 5000 : 10000);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("TGJU request failed");
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "fa-IR,fa;q=0.9,en-US;q=0.7,en;q=0.6",
      "cache-control": "no-cache",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    };
    const response = await fetch(url, { signal: controller.signal, headers });

    if (!response.ok) {
      throw new Error(`${url} responded with ${response.status}`);
    }

    return await response.text();
  } catch (error) {
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseHomePrices(html) {
  const text = htmlToText(normalizeDigits(html));

  return {
    gold18: { value: parseIrrRow(text, "طلای 18 عیار"), currency: "IRR" },
    gold24: { value: parseIrrRow(text, "طلای 24 عیار"), currency: "IRR" },
    usdToIrr: { value: parseIrrRow(text, "دلار"), currency: "IRR" },
    usdt: { value: parseMarketCellToman(html, "crypto-tether", "market-price-irr") || parseIrrRow(text, "تتر"), currency: "IRR" },
    eurToIrr: { value: parseIrrRow(text, "یورو"), currency: "IRR" },
    btc: { value: parseMarketCellNumber(html, "crypto-bitcoin", "market-price") || parseCryptoUsdRow(text, "بیت کوین"), currency: "USD" },
    eth: { value: parseMarketCellNumber(html, "crypto-ethereum", "market-price") || parseCryptoUsdRow(text, "اتریوم"), currency: "USD" },
    fullcoin: { value: parseIrrRow(text, "سکه"), currency: "IRR" },
    halfcoin: { value: parseIrrRow(text, "نیم سکه"), currency: "IRR" },
    quartercoin: { value: parseIrrRow(text, "ربع سکه"), currency: "IRR" },
  };
}

function parseMarketCellToman(html, slug, className) {
  const rialValue = parseMarketCellNumber(html, slug, className);
  return rialValue > 0 ? Math.round(rialValue / 10) : 0;
}

function parseMarketCellNumber(html, slug, className) {
  const rowPattern = new RegExp(`<tr[^>]+data-market-row=["']${escapeRegex(slug)}["'][\\s\\S]*?<\\/tr>`, "i");
  const row = html.match(rowPattern)?.[0];
  if (!row) return 0;

  const cellPattern = /<td([^>]*)>([\s\S]*?)<\/td>/gi;
  let match;

  while ((match = cellPattern.exec(row))) {
    const classValue = match[1].match(/class=["']([^"']*)["']/i)?.[1] || "";
    const classList = classValue.split(/\s+/).filter(Boolean);
    if (classList.includes(className)) {
      return parseLocalizedNumber(htmlToText(match[2]));
    }
  }

  return 0;
}

function parseIrrRow(text, label) {
  const escapedLabel = escapeRegex(label).replace(/\s+/g, "\\s+");
  const patterns = [
    new RegExp(`${escapedLabel}\\s+\\|\\s+([\\d,.]+)\\s+\\|`),
    new RegExp(`${escapedLabel}\\s+([\\d,.]+)\\s+\\(`),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match ? parseLocalizedNumber(match[1]) : 0;
    if (value > 0) return Math.round(value / 10);
  }

  return 0;
}

function parseCryptoUsdRow(text, label) {
  const escapedLabel = escapeRegex(label).replace(/\s+/g, "\\s+");
  const patterns = [
    new RegExp(`${escapedLabel}\\s+\\|\\s+[\\d,.]+\\s+\\|\\s+([\\d,.]+)\\s+\\|`),
    new RegExp(`${escapedLabel}\\s+([\\d,.]+)\\s+\\(`),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match ? parseLocalizedNumber(match[1]) : 0;
    if (value > 0) return Math.round(value * 100) / 100;
  }

  return 0;
}

function fetchTextWithHttps(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        timeout: timeoutMs,
        headers: {
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "fa-IR,fa;q=0.9,en-US;q=0.7,en;q=0.6",
          "cache-control": "no-cache",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
        },
      },
      (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`${url} responded with ${response.statusCode}`));
          response.resume();
          return;
        }

        response.setEncoding("utf8");
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => resolve(body));
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error("TGJU request timed out"));
    });
    request.on("error", reject);
  });
}

function parseTgjuPrice(html, marketName, slug) {
  const text = htmlToText(normalizeDigits(html));
  const currency = isCrypto(slug) ? "USD" : "IRR";
  const value = isCrypto(slug) ? parseCryptoDollarPrice(text, marketName) : parseIrrPrice(text, marketName);

  if (!value) {
    throw new Error(`Could not find TGJU price for ${marketName}`);
  }

  return { value, currency };
}

function parseIrrPrice(text, marketName) {
  const escapedName = escapeRegex(marketName).replace(/\s+/g, "\\s+");
  const patterns = [
    new RegExp(`${escapedName}\\s+\\|\\s+([\\d,.]+)\\s+\\|`),
    new RegExp(`در حال حاضر قیمت هر[^\\d]{0,80}?([\\d,.]+)\\s*ریال`),
    new RegExp(`نرخ فعلی\\s*:?\\s*([\\d,.]+)\\s*ریال?`),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match ? parseLocalizedNumber(match[1]) : 0;
    if (value > 0) return Math.round(value / 10);
  }

  return 0;
}

function parseCryptoDollarPrice(text, marketName) {
  const escapedName = escapeRegex(marketName).replace(/\s+/g, "\\s+");
  const patterns = [
    new RegExp(`${escapedName}\\s+\\|\\s+[\\d,.]+\\s+\\|\\s+([\\d,.]+)\\s+\\|`),
    new RegExp(`قیمت دلاری\\s+([\\d,.]+)`),
    new RegExp(`در حال حاضر قیمت هر[^\\d]{0,80}?([\\d,.]+)\\s*دلار`),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match ? parseLocalizedNumber(match[1]) : 0;
    if (value > 0) return Math.round(value * 100) / 100;
  }

  return 0;
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&rlm;|&lrm;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDigits(value) {
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";

  return String(value).replace(/[۰-۹٠-٩]/g, (digit) => {
    const persianIndex = persianDigits.indexOf(digit);
    if (persianIndex >= 0) return String(persianIndex);
    return String(arabicDigits.indexOf(digit));
  });
}

function parseLocalizedNumber(value) {
  const cleaned = normalizeDigits(value).replace(/,/g, "").replace(/[^\d.]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCrypto(slug) {
  return slug.startsWith("crypto-");
}

function sendJson(response, status, data) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}
