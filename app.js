const STORAGE_KEY = "asset-dashboard-v1";

const colors = [
  "#f1b84b",
  "#f6d27e",
  "#7cb7ff",
  "#64d6a3",
  "#a78bfa",
  "#ff9f68",
  "#ff7d7d",
  "#4dd4d4",
  "#c9f27a",
  "#d7b3ff",
  "#e8e1d3",
];

const TGJU_BASE_URL = "https://www.tgju.org/profile/";
const TGJU_MARKETS = [
  { id: "gold18", slug: "geram18", name: "طلا ۱۸ عیار" },
  { id: "gold24", slug: "geram24", name: "طلا ۲۴ عیار" },
  { rate: "usdToIrr", slug: "price_dollar_rl", name: "دلار" },
  { id: "usdt", slug: "crypto-tether", name: "تتر" },
  { rate: "eurToIrr", slug: "price_eur", name: "یورو" },
  { id: "btc", slug: "crypto-bitcoin", name: "بیتکوین" },
  { id: "eth", slug: "crypto-ethereum", name: "اتریوم" },
  { id: "fullcoin", slug: "sekee", name: "سکه تمام" },
  { id: "halfcoin", slug: "nim", name: "نیم سکه" },
  { id: "quartercoin", slug: "rob", name: "ربع سکه" },
];

const defaultState = {
  usdToIrr: 61000,
  eurToIrr: 66500,
  lastUpdated: null,
  priceStatus: "قیمت‌های اولیه قابل ویرایش هستند.",
  assets: [
    { id: "gold18", title: "طلا ۱۸ عیار", unit: "گرم", amount: 0, price: 4575000, currency: "IRR", icon: "۱۸" },
    { id: "gold24", title: "طلا ۲۴ عیار", unit: "گرم", amount: 0, price: 6100000, currency: "IRR", icon: "۲۴" },
    { id: "usd", title: "دلار", unit: "دلار", amount: 0, price: 1, currency: "USD", icon: "$" },
    { id: "usdt", title: "تتر", unit: "USDT", amount: 0, price: 1, currency: "USD", icon: "₮" },
    { id: "eur", title: "یورو", unit: "یورو", amount: 0, price: 1, currency: "EUR", icon: "€" },
    { id: "btc", title: "بیتکوین", unit: "BTC", amount: 0, price: 69000, currency: "USD", icon: "₿" },
    { id: "eth", title: "اتریوم", unit: "ETH", amount: 0, price: 3700, currency: "USD", icon: "Ξ" },
    { id: "fullcoin", title: "سکه تمام", unit: "عدد", amount: 0, price: 41500000, currency: "IRR", icon: "س" },
    { id: "halfcoin", title: "نیم سکه", unit: "عدد", amount: 0, price: 23500000, currency: "IRR", icon: "ن" },
    { id: "quartercoin", title: "ربع سکه", unit: "عدد", amount: 0, price: 15000000, currency: "IRR", icon: "ر" },
    { id: "irr", title: "تومان", unit: "تومان", amount: 0, price: 1, currency: "IRR", icon: "ت" },
  ],
};

let state = loadState();

const elements = {
  assetsBody: document.querySelector("#assets-body"),
  rowTemplate: document.querySelector("#asset-row-template"),
  usdToIrr: document.querySelector("#usd-to-irr"),
  eurToIrr: document.querySelector("#eur-to-irr"),
  refreshPrices: document.querySelector("#refresh-prices"),
  resetData: document.querySelector("#reset-data"),
  totalIrr: document.querySelector("#total-irr"),
  totalUsd: document.querySelector("#total-usd"),
  totalEur: document.querySelector("#total-eur"),
  lastUpdated: document.querySelector("#last-updated"),
  priceStatus: document.querySelector("#price-status"),
  donut: document.querySelector("#donut"),
  donutTotal: document.querySelector("#donut-total"),
  allocationList: document.querySelector("#allocation-list"),
};

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return structuredClone(defaultState);
  }

  try {
    const parsed = JSON.parse(saved);
    const assetMap = new Map((parsed.assets || []).map((asset) => [asset.id, asset]));
    return {
      ...defaultState,
      ...parsed,
      assets: defaultState.assets.map((asset) => ({ ...asset, ...(assetMap.get(asset.id) || {}) })),
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function convertToIrr(price, currency) {
  if (currency === "USD") return price * state.usdToIrr;
  if (currency === "EUR") return price * state.eurToIrr;
  return price;
}

function formatNumber(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("fa-IR", { maximumFractionDigits }).format(value || 0);
}

function formatMoney(value, currency) {
  if (currency === "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: value >= 1000 ? 0 : 2,
    }).format(value || 0);
  }

  if (currency === "EUR") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: value >= 1000 ? 0 : 2,
    }).format(value || 0);
  }

  return `${formatNumber(value)} تومان`;
}

function renderRows() {
  elements.assetsBody.innerHTML = "";

  state.assets.forEach((asset, index) => {
    const row = elements.rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.assetId = asset.id;
    row.querySelector(".asset-icon").textContent = asset.icon;
    row.querySelector(".asset-icon").style.color = colors[index % colors.length];
    row.querySelector(".asset-title").textContent = asset.title;
    row.querySelector(".asset-unit").textContent = asset.unit;

    const amountInput = row.querySelector(".amount-input");
    const priceInput = row.querySelector(".price-input");
    const priceCurrency = row.querySelector(".price-currency");

    amountInput.value = asset.amount;
    priceInput.value = asset.price;
    priceCurrency.value = asset.currency;

    amountInput.addEventListener("input", () => updateAsset(asset.id, { amount: toNumber(amountInput.value) }));
    priceInput.addEventListener("input", () => updateAsset(asset.id, { price: toNumber(priceInput.value) }));
    priceCurrency.addEventListener("change", () => updateAsset(asset.id, { currency: priceCurrency.value }));

    elements.assetsBody.append(row);
  });
}

function updateAsset(id, patch) {
  state.assets = state.assets.map((asset) => (asset.id === id ? { ...asset, ...patch } : asset));
  saveState();
  renderTotals();
}

function getAssetValue(asset) {
  const valueIrr = asset.amount * convertToIrr(asset.price, asset.currency);
  return {
    irr: valueIrr,
    usd: state.usdToIrr ? valueIrr / state.usdToIrr : 0,
    eur: state.eurToIrr ? valueIrr / state.eurToIrr : 0,
  };
}

function renderTotals() {
  state.usdToIrr = toNumber(elements.usdToIrr.value);
  state.eurToIrr = toNumber(elements.eurToIrr.value);

  let totalIrr = 0;
  let totalUsd = 0;
  let totalEur = 0;
  const allocations = [];

  state.assets.forEach((asset, index) => {
    const values = getAssetValue(asset);
    totalIrr += values.irr;
    totalUsd += values.usd;
    totalEur += values.eur;
    allocations.push({ ...asset, color: colors[index % colors.length], value: values.irr });

    const row = elements.assetsBody.querySelector(`[data-asset-id="${asset.id}"]`);
    if (row) {
      row.querySelector(".value-irr").textContent = formatMoney(values.irr, "IRR");
      row.querySelector(".value-usd").textContent = formatMoney(values.usd, "USD");
      row.querySelector(".value-eur").textContent = formatMoney(values.eur, "EUR");
    }
  });

  elements.totalIrr.textContent = formatMoney(totalIrr, "IRR");
  elements.totalUsd.textContent = formatMoney(totalUsd, "USD");
  elements.totalEur.textContent = formatMoney(totalEur, "EUR");
  elements.donutTotal.textContent = formatNumber(totalIrr);
  elements.lastUpdated.textContent = state.lastUpdated
    ? `آخرین بروزرسانی: ${new Date(state.lastUpdated).toLocaleString("fa-IR")}`
    : "هنوز بروزرسانی نشده";
  elements.priceStatus.textContent = state.priceStatus;

  renderAllocation(allocations, totalIrr);
  saveState();
}

function renderAllocation(allocations, totalIrr) {
  const activeAllocations = allocations.filter((item) => item.value > 0);

  if (!activeAllocations.length || totalIrr <= 0) {
    elements.donut.style.background = "conic-gradient(rgba(255, 255, 255, 0.13) 0 100%)";
    elements.allocationList.innerHTML = '<p class="hero-copy">برای دیدن ترکیب دارایی، مقدارها را وارد کنید.</p>';
    return;
  }

  let cursor = 0;
  const gradients = activeAllocations.map((item) => {
    const start = cursor;
    const percent = (item.value / totalIrr) * 100;
    cursor += percent;
    return `${item.color} ${start}% ${cursor}%`;
  });

  elements.donut.style.background = `conic-gradient(${gradients.join(", ")})`;
  elements.allocationList.innerHTML = activeAllocations
    .sort((a, b) => b.value - a.value)
    .map((item) => {
      const percent = (item.value / totalIrr) * 100;
      return `
        <div class="allocation-item">
          <span class="dot" style="background:${item.color}"></span>
          <span>${item.title}</span>
          <strong>${formatNumber(percent, 1)}٪</strong>
        </div>
      `;
    })
    .join("");
}

function setAssetPrice(id, price, currency) {
  state.assets = state.assets.map((asset) => (asset.id === id ? { ...asset, price, currency } : asset));
}

async function refreshPrices() {
  elements.refreshPrices.disabled = true;
  elements.refreshPrices.textContent = "در حال بروزرسانی...";

  try {
    const results = await refreshAllTgjuPrices();
    const successful = results.successful;
    const failed = results.failed;
    state.lastUpdated = new Date().toISOString();
    state.priceStatus =
      failed === 0
        ? "همه نرخ‌ها از TGJU با موفقیت بروزرسانی شدند."
        : `${successful} نرخ از TGJU بروزرسانی شد و ${failed} نرخ در دسترس نبود.`;
    renderRows();
    renderTotals();
  } finally {
    elements.refreshPrices.disabled = false;
    elements.refreshPrices.textContent = "بروزرسانی آنلاین قیمت‌ها";
  }
}

async function refreshAllTgjuPrices() {
  try {
    const response = await fetch("/api/prices", { cache: "no-store" });
    if (!response.ok) throw new Error(`Local TGJU prices endpoint failed: ${response.status}`);
    const data = await response.json();
    const prices = data.prices || {};
    let successful = 0;
    let failed = 0;

    for (const market of TGJU_MARKETS) {
      const key = market.rate || market.id;
      const price = prices[key];

      if (price?.value && price?.currency) {
        applyTgjuPrice(market, price);
        successful += 1;
      } else {
        try {
          await refreshTgjuMarket(market);
          successful += 1;
        } catch {
          failed += 1;
        }
      }
    }

    return { successful, failed };
  } catch {
    const results = await Promise.allSettled(TGJU_MARKETS.map(refreshTgjuMarket));
    return {
      successful: results.filter((result) => result.status === "fulfilled").length,
      failed: results.filter((result) => result.status === "rejected").length,
    };
  }
}

async function refreshTgjuMarket(market) {
  const price = await fetchTgjuPrice(market);
  applyTgjuPrice(market, price);
}

function applyTgjuPrice(market, price) {
  if (market.rate) {
    state[market.rate] = price.value;
    elements[market.rate].value = price.value;
    return;
  }

  setAssetPrice(market.id, price.value, price.currency);
}

async function fetchTgjuPrice(market) {
  try {
    const response = await fetch(`/api/tgju/${encodeURIComponent(market.slug)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Local TGJU proxy failed: ${response.status}`);
    const data = await response.json();

    if (!data.value || !data.currency) {
      throw new Error("Local TGJU proxy returned an invalid price");
    }

    return { value: data.value, currency: data.currency };
  } catch (error) {
    if (location.protocol !== "http:" && location.protocol !== "https:") {
      throw error;
    }

    const sourceUrl = `${TGJU_BASE_URL}${market.slug}`;
    const text = await fetchTgjuText(sourceUrl);
    return parseTgjuCurrentPrice(text, market.name);
  }
}

async function fetchTgjuText(sourceUrl) {
  const urls = [
    sourceUrl,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(sourceUrl)}`,
    `https://r.jina.ai/${sourceUrl}`,
  ];

  let lastError;

  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`TGJU request failed: ${response.status}`);
      const text = await response.text();
      if (text.includes("در حال حاضر قیمت") || text.includes("نرخ فعلی") || text.includes("Last")) {
        return text;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("TGJU price text was not available");
}

function parseTgjuCurrentPrice(text, marketName) {
  const normalizedText = normalizeDigits(text).replace(/\s+/g, " ");
  const patterns = [
    /در حال حاضر قیمت هر .{1,80}? ([\d,.]+)\s*(ریال|تومان|دلار|یورو) می باشد/,
    /نرخ فعلی\s*:?\s*([\d,.]+)\s*(ریال|تومان|دلار|یورو)?/,
    /Last\s*:?\s*([\d,.]+)\s*(Rial|Dollar|USD|Euro|EUR)?/i,
  ];

  for (const pattern of patterns) {
    const match = normalizedText.match(pattern);
    if (!match) continue;

    const rawValue = parseLocalizedNumber(match[1]);
    const rawCurrency = match[2] || "";
    const currency = detectTgjuCurrency(rawCurrency, normalizedText);
    const isRial =
      /ریال|Rial/i.test(rawCurrency) || /واحد پولی\s*:\s*ریال|Moneda\s*:\s*Rial|Currency\s*:\s*Rial/i.test(normalizedText);
    const value = currency === "IRR" && isRial ? rawValue / 10 : rawValue;

    if (value > 0) {
      return { value: Math.round(value * 100) / 100, currency };
    }
  }

  throw new Error(`TGJU price for ${marketName} was not found`);
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

function detectTgjuCurrency(rawCurrency, text) {
  if (/دلار|Dollar|USD/i.test(rawCurrency)) return "USD";
  if (/یورو|Euro|EUR/i.test(rawCurrency)) return "EUR";
  if (/تومان|ریال/.test(rawCurrency)) return "IRR";
  if (/واحد پولی\s*:\s*ریال|Moneda\s*:\s*Rial|Currency\s*:\s*Rial/i.test(text)) return "IRR";
  return "IRR";
}

function bindEvents() {
  elements.usdToIrr.value = state.usdToIrr;
  elements.eurToIrr.value = state.eurToIrr;
  elements.usdToIrr.addEventListener("input", renderTotals);
  elements.eurToIrr.addEventListener("input", renderTotals);
  elements.refreshPrices.addEventListener("click", refreshPrices);
  elements.resetData.addEventListener("click", () => {
    if (!confirm("همه مقدارها و نرخ‌های ذخیره‌شده پاک شوند؟")) return;
    state = structuredClone(defaultState);
    saveState();
    elements.usdToIrr.value = state.usdToIrr;
    elements.eurToIrr.value = state.eurToIrr;
    renderRows();
    renderTotals();
  });
}

bindEvents();
renderRows();
renderTotals();
