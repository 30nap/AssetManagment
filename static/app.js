const STORAGE_KEY = "asset-dashboard-v1";
const MAX_HISTORY = 180;

// Deviation thresholds (percentage points, absolute).
const DEVIATION_OK = 2;
const DEVIATION_WARN = 5;
// A price older than this is flagged as stale in the asset table.
const STALE_PRICE_MS = 24 * 60 * 60 * 1000;

// Ordered so consecutive assets never land on neighbouring hues; with only two
// or three holdings the donut was previously two near-identical golds.
const colors = [
  "#f1b84b", "#7cb7ff", "#64d6a3", "#a78bfa", "#ff9f68",
  "#4dd4d4", "#ff7d7d", "#c9f27a", "#f6d27e", "#d7b3ff", "#e8e1d3",
];

// Live conversion rates are fetched from these refs on every refresh.
const RATE_REFS = {
  usdToIrr: { provider: "tgju", code: "price_dollar_rl" },
  eurToIrr: { provider: "tgju", code: "price_eur" },
};

const defaultState = {
  usdToIrr: 61000,
  eurToIrr: 66500,
  lastUpdated: null,
  priceStatus: "قیمت‌های اولیه قابل ویرایش هستند.",
  // Emergency cushion: an amount (toman) parked inside one of the assets.
  cushion: { amount: 0, assetId: null },
  // No seeded assets: the dashboard starts empty and the user adds what they
  // actually hold, from the market search or by hand.
  assets: [],
  history: [],
};

let state = loadState();
let chartCurrency = "IRR";
let searchTimer = null;
let searchToken = 0;

const elements = {
  assetsBody: document.querySelector("#assets-body"),
  assetsTableWrap: document.querySelector("#assets-table-wrap"),
  assetsEmpty: document.querySelector("#assets-empty"),
  rowTemplate: document.querySelector("#asset-row-template"),
  usdToIrr: document.querySelector("#usd-to-irr"),
  eurToIrr: document.querySelector("#eur-to-irr"),
  cushionAmount: document.querySelector("#cushion-amount"),
  cushionAsset: document.querySelector("#cushion-asset"),
  cushionNote: document.querySelector("#cushion-note"),
  refreshPrices: document.querySelector("#refresh-prices"),
  refreshLabel: document.querySelector("#refresh-prices .btn-label"),
  resetData: document.querySelector("#reset-data"),
  totalIrr: document.querySelector("#total-irr"),
  totalInvestable: document.querySelector("#total-investable"),
  totalCushion: document.querySelector("#total-cushion"),
  totalUsd: document.querySelector("#total-usd"),
  totalEur: document.querySelector("#total-eur"),
  targetSum: document.querySelector("#target-sum"),
  rebalanceAlert: document.querySelector("#rebalance-alert"),
  rebalanceAssets: document.querySelector("#rebalance-assets"),
  lastUpdated: document.querySelector("#last-updated"),
  priceStatus: document.querySelector("#price-status"),
  donut: document.querySelector("#donut"),
  donutTotal: document.querySelector("#donut-total"),
  allocationList: document.querySelector("#allocation-list"),
  chart: document.querySelector("#chart"),
  chartToggle: document.querySelector(".chart-toggle"),
  customTitle: document.querySelector("#custom-title"),
  customUnit: document.querySelector("#custom-unit"),
  customAmount: document.querySelector("#custom-amount"),
  customPrice: document.querySelector("#custom-price"),
  customCurrency: document.querySelector("#custom-currency"),
  customTarget: document.querySelector("#custom-target"),
  customDialog: document.querySelector("#custom-asset-dialog"),
  customAssetForm: document.querySelector("#custom-asset-form"),
  openCustomDialog: document.querySelector("#open-custom-dialog"),
  closeCustomDialog: document.querySelector("#close-custom-dialog"),
  marketDialog: document.querySelector("#market-dialog"),
  openMarketDialog: document.querySelector("#open-market-dialog"),
  closeMarketDialog: document.querySelector("#close-market-dialog"),
  marketSearch: document.querySelector("#market-search"),
  marketResults: document.querySelector("#market-results"),
  toastRegion: document.querySelector("#toast-region"),
};

/* ---------- State ---------- */

// Fields added after v1 shipped; old saved payloads simply don't have them.
function normalizeAsset(asset) {
  return {
    ...asset,
    amount: toNumber(asset.amount),
    price: toNumber(asset.price),
    target: toNumber(asset.target),
    icon: asset.icon || asset.title?.slice(0, 2) || "+",
    priceUpdatedAt: asset.priceUpdatedAt || null,
  };
}

function normalizeCushion(cushion) {
  return {
    amount: Math.max(0, toNumber(cushion?.amount)),
    assetId: cushion?.assetId || null,
  };
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return structuredClone(defaultState);

  try {
    const parsed = JSON.parse(saved);
    return {
      ...defaultState,
      ...parsed,
      assets: (parsed.assets || []).map(normalizeAsset),
      cushion: normalizeCushion(parsed.cushion),
      history: Array.isArray(parsed.history) ? parsed.history : [],
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
  if (currency === "USD" || currency === "EUR") {
    return new Intl.NumberFormat("fa-IR", {
      style: "currency",
      currency,
      maximumFractionDigits: value >= 1000 ? 0 : 2,
    }).format(value || 0);
  }
  return `${formatNumber(value)} تومان`;
}

function formatPercent(value, digits = 1) {
  return `${formatNumber(value, digits)}٪`;
}

function formatSignedPercent(value, digits = 1) {
  const sign = value >= 0 ? "+" : "−";
  return `${sign}${formatNumber(Math.abs(value), digits)}٪`;
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  elements.toastRegion.append(toast);
  requestAnimationFrame(() => toast.classList.add("is-visible"));
  setTimeout(() => {
    toast.classList.remove("is-visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, 3600);
}

/* ---------- Price freshness ---------- */

// "auto" would turn a 40-hour-old price into «پریروز»; "always" keeps it «۲ روز پیش».
const relativeTimeFormat = new Intl.RelativeTimeFormat("fa", { numeric: "always" });

// Returns { text, stale } for the "last priced N ago" line under each asset.
function freshness(asset) {
  // An asset you don't hold has no price worth nagging about.
  if (!asset.amount) return { text: "", stale: false };
  if (!asset.priceUpdatedAt) return { text: "⚠ قیمت هنوز بروزرسانی نشده", stale: true };

  const then = new Date(asset.priceUpdatedAt).getTime();
  if (!Number.isFinite(then)) return { text: "⚠ قیمت هنوز بروزرسانی نشده", stale: true };

  const elapsed = Date.now() - then;
  const minutes = Math.round(elapsed / 60000);
  let text;
  if (minutes < 1) text = "همین حالا";
  else if (minutes < 60) text = relativeTimeFormat.format(-minutes, "minute");
  else if (elapsed < STALE_PRICE_MS) text = relativeTimeFormat.format(-Math.round(elapsed / 3600000), "hour");
  else text = relativeTimeFormat.format(-Math.round(elapsed / 86400000), "day");

  const stale = elapsed >= STALE_PRICE_MS;
  return { text: stale ? `⚠ ${text}` : text, stale };
}

function renderFreshness() {
  state.assets.forEach((asset) => {
    const cell = elements.assetsBody.querySelector(`[data-asset-id="${asset.id}"] .asset-fresh`);
    if (!cell) return;
    const { text, stale } = freshness(asset);
    cell.textContent = text;
    cell.classList.toggle("is-stale", stale);
  });
}

/* ---------- Portfolio maths ---------- */

function getAssetValue(asset) {
  const valueIrr = asset.amount * convertToIrr(asset.price, asset.currency);
  return {
    irr: valueIrr,
    usd: state.usdToIrr ? valueIrr / state.usdToIrr : 0,
    eur: state.eurToIrr ? valueIrr / state.eurToIrr : 0,
  };
}

/**
 * The cushion is part of the *total* value, but it is taken out of the
 * denominator and out of the asset that holds it. Otherwise that asset always
 * reads above target and every rebalance is wrong.
 *
 *   investable   = total − cushion
 *   net(asset)   = value(asset) − (asset holds the cushion ? cushion : 0)
 *   actual%      = net(asset) / investable × 100
 */
function computePortfolio() {
  const rows = state.assets.map((asset, index) => {
    const values = getAssetValue(asset);
    return {
      asset,
      color: colors[index % colors.length],
      irr: values.irr,
      usd: values.usd,
      eur: values.eur,
      target: Math.max(0, toNumber(asset.target)),
    };
  });

  const totalIrr = rows.reduce((sum, row) => sum + row.irr, 0);
  const totalUsd = rows.reduce((sum, row) => sum + row.usd, 0);
  const totalEur = rows.reduce((sum, row) => sum + row.eur, 0);

  const host = rows.find((row) => row.asset.id === state.cushion.assetId);
  const requested = Math.max(0, toNumber(state.cushion.amount));
  // Never let the cushion exceed the asset that is supposed to hold it,
  // otherwise percentages would go negative.
  const cushion = host ? Math.min(requested, host.irr) : 0;
  const investable = totalIrr - cushion;

  const targetSum = rows.reduce((sum, row) => sum + row.target, 0);
  // Without a single target there is no plan to deviate from, so deviations
  // (and the rebalance banner) stay silent instead of flagging everything.
  const hasPlan = targetSum > 0;

  rows.forEach((row) => {
    row.netIrr = row === host ? row.irr - cushion : row.irr;
    row.actual = investable > 0 ? (row.netIrr / investable) * 100 : 0;
    row.deviation = row.actual - row.target;
    // Rows that are neither held nor planned stay out of the deviation report.
    row.tracked = hasPlan && (row.netIrr > 0 || row.target > 0);
  });

  return {
    rows,
    totalIrr,
    totalUsd,
    totalEur,
    cushion,
    requestedCushion: requested,
    cushionHost: host || null,
    investable,
    targetSum,
    hasPlan,
    offTarget: rows.filter((row) => row.tracked && Math.abs(row.deviation) > DEVIATION_WARN),
  };
}

function deviationClass(deviation) {
  const size = Math.abs(deviation);
  if (size < DEVIATION_OK) return "dev-ok";
  if (size <= DEVIATION_WARN) return "dev-warn";
  return "dev-alert";
}

/* ---------- Asset table ---------- */

function renderRows() {
  elements.assetsBody.innerHTML = "";

  state.assets.forEach((asset, index) => {
    const row = elements.rowTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.assetId = asset.id;
    const icon = row.querySelector(".asset-icon");
    icon.textContent = asset.icon;
    icon.style.color = colors[index % colors.length];
    row.querySelector(".asset-title").textContent = asset.title;
    row.querySelector(".asset-unit").textContent = asset.unit;

    const amountInput = row.querySelector(".amount-input");
    const priceInput = row.querySelector(".price-input");
    const priceCurrency = row.querySelector(".price-currency");
    const targetInput = row.querySelector(".target-input");

    amountInput.value = asset.amount;
    priceInput.value = asset.price;
    priceCurrency.value = asset.currency;
    targetInput.value = asset.target;

    amountInput.addEventListener("input", () => updateAsset(asset.id, { amount: toNumber(amountInput.value) }));
    priceInput.addEventListener("input", () =>
      updateAsset(asset.id, { price: toNumber(priceInput.value), priceUpdatedAt: new Date().toISOString() }),
    );
    priceCurrency.addEventListener("change", () => updateAsset(asset.id, { currency: priceCurrency.value }));
    targetInput.addEventListener("input", () => updateAsset(asset.id, { target: toNumber(targetInput.value) }));

    row.querySelector(".delete-asset").addEventListener("click", () => deleteAsset(asset.id));

    elements.assetsBody.append(row);
  });

  const isEmpty = state.assets.length === 0;
  elements.assetsTableWrap.hidden = isEmpty;
  elements.assetsEmpty.hidden = !isEmpty;

  renderCushionOptions();
  renderFreshness();
}

function renderCushionOptions() {
  const select = elements.cushionAsset;
  select.innerHTML = '<option value="">— انتخاب نشده —</option>';
  state.assets.forEach((asset) => {
    const option = document.createElement("option");
    option.value = asset.id;
    option.textContent = asset.title;
    select.append(option);
  });
  // The stored asset may have been deleted meanwhile.
  if (!state.assets.some((asset) => asset.id === state.cushion.assetId)) {
    state.cushion.assetId = null;
  }
  select.value = state.cushion.assetId || "";
}

function updateAsset(id, patch) {
  state.assets = state.assets.map((asset) => (asset.id === id ? { ...asset, ...patch } : asset));
  saveState();
  renderTotals();
  renderFreshness();
}

function deleteAsset(id) {
  const asset = state.assets.find((item) => item.id === id);
  if (!asset) return;
  if (!confirm(`دارایی «${asset.title}» حذف شود؟`)) return;

  state.assets = state.assets.filter((item) => item.id !== id);
  if (state.cushion.assetId === id) state.cushion.assetId = null;
  saveState();
  renderRows();
  renderTotals();
  showToast(`دارایی «${asset.title}» حذف شد.`, "info");
}

/* ---------- Manual custom asset ---------- */

function addCustomAsset() {
  const title = elements.customTitle.value.trim();
  const unit = elements.customUnit.value.trim() || "واحد";
  const amount = toNumber(elements.customAmount.value);
  const price = toNumber(elements.customPrice.value);
  const currency = elements.customCurrency.value;
  const target = Math.max(0, toNumber(elements.customTarget.value));

  if (!title) {
    elements.customTitle.focus();
    return;
  }

  state.assets.push({
    id: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title, unit, amount, price, currency, target,
    icon: title.slice(0, 2),
    priceUpdatedAt: new Date().toISOString(),
  });

  resetCustomAssetForm();
  saveState();
  renderRows();
  renderTotals();
  closeDialog(elements.customDialog);
  showToast(`دارایی «${title}» اضافه شد.`, "success");
}

function resetCustomAssetForm() {
  elements.customTitle.value = "";
  elements.customUnit.value = "";
  elements.customAmount.value = "";
  elements.customPrice.value = "";
  elements.customCurrency.value = "IRR";
  elements.customTarget.value = "";
}

/* ---------- Add from market (live search) ---------- */

function onMarketSearchInput() {
  const query = elements.marketSearch.value.trim();
  clearTimeout(searchTimer);

  if (query.length < 2) {
    elements.marketResults.innerHTML = '<p class="market-hint">حداقل دو حرف وارد کنید.</p>';
    return;
  }

  elements.marketResults.innerHTML = '<p class="market-hint">در حال جستجو...</p>';
  searchTimer = setTimeout(() => runMarketSearch(query), 300);
}

async function runMarketSearch(query) {
  const token = ++searchToken;
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`search failed: ${response.status}`);
    const data = await response.json();
    if (token !== searchToken) return; // a newer search superseded this one
    renderMarketResults(data.results || []);
  } catch {
    if (token !== searchToken) return;
    elements.marketResults.innerHTML = '<p class="market-hint">جستجو ناموفق بود؛ دوباره تلاش کنید.</p>';
  }
}

function renderMarketResults(results) {
  if (!results.length) {
    elements.marketResults.innerHTML = '<p class="market-hint">نتیجه‌ای پیدا نشد.</p>';
    return;
  }

  elements.marketResults.innerHTML = "";
  results.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "market-result";
    const symbol = item.symbol || item.name;
    const subtitle = item.name && item.name !== symbol ? `<small>${escapeHtml(item.name)}</small>` : "";
    const tag = item.category === "fund" ? `${item.market || ""} · صندوق` : item.market || "";
    button.innerHTML = `
      <span class="market-result-main">
        <strong>${escapeHtml(symbol)}</strong>
        ${subtitle}
      </span>
      <span class="market-tag">${escapeHtml(tag)}</span>
    `;
    button.addEventListener("click", () => addMarketAsset(item, button));
    elements.marketResults.append(button);
  });
}

async function addMarketAsset(item, button) {
  const id = `mkt-${item.provider}-${item.code}`;
  if (state.assets.some((asset) => asset.id === id)) {
    showToast("این دارایی قبلا اضافه شده است.", "info");
    return;
  }

  button.disabled = true;
  const asset = {
    id,
    title: item.symbol || item.name,
    unit: item.unit || "واحد",
    amount: 0,
    price: 0,
    currency: item.currency || "IRR",
    target: 0,
    icon: (item.symbol || item.name || "+").slice(0, 2),
    priceUpdatedAt: null,
    ref: { provider: item.provider, code: item.code },
  };

  // Pull a live price immediately so the row isn't empty.
  try {
    const quote = await fetchQuotes([{ id, provider: item.provider, code: item.code }]);
    const price = quote.results?.[id];
    if (price?.value) {
      asset.price = price.value;
      asset.currency = price.currency;
      asset.priceUpdatedAt = new Date().toISOString();
    }
  } catch {
    /* keep price 0; user can refresh later */
  }

  state.assets.push(asset);
  saveState();
  renderRows();
  renderTotals();
  closeDialog(elements.marketDialog);
  showToast(`«${asset.title}» با قیمت زنده اضافه شد.`, "success");
}

/* ---------- Totals, allocation ---------- */

function renderTotals() {
  state.usdToIrr = toNumber(elements.usdToIrr.value);
  state.eurToIrr = toNumber(elements.eurToIrr.value);
  state.cushion.amount = Math.max(0, toNumber(elements.cushionAmount.value));
  state.cushion.assetId = elements.cushionAsset.value || null;

  const portfolio = computePortfolio();

  portfolio.rows.forEach((item) => {
    const row = elements.assetsBody.querySelector(`[data-asset-id="${item.asset.id}"]`);
    if (!row) return;
    row.querySelector(".value-irr").textContent = formatMoney(item.irr, "IRR");
    row.querySelector(".value-usd").textContent = formatMoney(item.usd, "USD");
    row.querySelector(".value-eur").textContent = formatMoney(item.eur, "EUR");

    const actualCell = row.querySelector(".actual-cell");
    const deviationCell = row.querySelector(".deviation-cell");
    if (item.tracked) {
      actualCell.textContent = formatPercent(item.actual);
      deviationCell.textContent = formatSignedPercent(item.deviation);
      deviationCell.className = `deviation-cell ${deviationClass(item.deviation)}`;
    } else {
      actualCell.textContent = "—";
      deviationCell.textContent = "—";
      deviationCell.className = "deviation-cell dev-none";
    }
  });

  elements.totalIrr.textContent = formatMoney(portfolio.totalIrr, "IRR");
  elements.totalInvestable.textContent = formatMoney(portfolio.investable, "IRR");
  elements.totalCushion.textContent = formatMoney(portfolio.cushion, "IRR");
  elements.totalUsd.textContent = formatMoney(portfolio.totalUsd, "USD");
  elements.totalEur.textContent = formatMoney(portfolio.totalEur, "EUR");
  elements.donutTotal.textContent = formatNumber(portfolio.investable);
  elements.lastUpdated.textContent = state.lastUpdated
    ? `آخرین بروزرسانی: ${new Date(state.lastUpdated).toLocaleString("fa-IR")}`
    : "هنوز بروزرسانی نشده";
  elements.priceStatus.textContent = state.priceStatus;

  renderCushionNote(portfolio);
  renderTargetSum(portfolio);
  renderRebalanceAlert(portfolio);
  recordHistory(portfolio.totalIrr, portfolio.totalUsd, portfolio.totalEur);
  renderAllocation(portfolio);
  renderChart();
  saveState();
}

function renderCushionNote(portfolio) {
  const note = elements.cushionNote;
  if (!portfolio.requestedCushion) {
    note.textContent = "تعریف نشده است.";
    note.classList.remove("is-off");
    return;
  }
  if (!portfolio.cushionHost) {
    note.textContent = "دارایی میزبان انتخاب نشده؛ در محاسبه اعمال نمی‌شود.";
    note.classList.add("is-off");
    return;
  }
  if (portfolio.requestedCushion > portfolio.cushionHost.irr) {
    note.textContent = `ارزش «${portfolio.cushionHost.asset.title}» کمتر از بالشتک است؛ تا سقف همان دارایی اعمال شد.`;
    note.classList.add("is-off");
    return;
  }
  note.textContent = `نگهداری در «${portfolio.cushionHost.asset.title}»`;
  note.classList.remove("is-off");
}

function renderTargetSum(portfolio) {
  elements.targetSum.textContent = formatPercent(portfolio.targetSum);
  // Only flag a mismatch once the user has actually set targets.
  const off = portfolio.targetSum > 0 && Math.abs(portfolio.targetSum - 100) > 0.01;
  elements.targetSum.classList.toggle("is-off", off);
}

function renderRebalanceAlert(portfolio) {
  if (!portfolio.offTarget.length) {
    elements.rebalanceAlert.hidden = true;
    return;
  }
  elements.rebalanceAlert.hidden = false;
  elements.rebalanceAssets.textContent = portfolio.offTarget
    .map((item) => `${item.asset.title} (${formatSignedPercent(item.deviation)})`)
    .join("، ");
}

function renderAllocation(portfolio) {
  const active = portfolio.rows.filter((item) => item.netIrr > 0);

  if (!active.length || portfolio.investable <= 0) {
    elements.donut.style.background = "conic-gradient(rgba(255, 255, 255, 0.13) 0 100%)";
    elements.allocationList.innerHTML = '<p class="allocation-empty">برای دیدن ترکیب دارایی، مقدارها را وارد کنید.</p>';
    return;
  }

  let cursor = 0;
  const gradients = active.map((item) => {
    const start = cursor;
    cursor += (item.netIrr / portfolio.investable) * 100;
    return `${item.color} ${start}% ${cursor}%`;
  });

  elements.donut.style.background = `conic-gradient(${gradients.join(", ")})`;
  elements.allocationList.innerHTML = [...active]
    .sort((a, b) => b.netIrr - a.netIrr)
    .map((item) => `
        <div class="allocation-item">
          <span class="dot" style="background:${item.color}"></span>
          <span>${escapeHtml(item.asset.title)}</span>
          <strong>${formatPercent(item.actual)}</strong>
        </div>`)
    .join("");
}

/* ---------- History + chart ---------- */

// Local calendar day. toISOString() is UTC, so in Tehran (UTC+3:30) anything
// logged before 03:30 would carry the previous day's key and overwrite that
// snapshot instead of starting a new one.
function todayKey() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

function recordHistory(totalIrr, totalUsd, totalEur) {
  if (totalIrr <= 0) return;
  const day = todayKey(); // YYYY-MM-DD
  const entry = { t: day, irr: totalIrr, usd: totalUsd, eur: totalEur };
  const last = state.history[state.history.length - 1];

  if (last && last.t === day) {
    state.history[state.history.length - 1] = entry; // upsert today's snapshot
  } else {
    state.history.push(entry);
    if (state.history.length > MAX_HISTORY) state.history.shift();
  }
}

const CURRENCY_KEY = { IRR: "irr", USD: "usd", EUR: "eur" };

function renderChart() {
  const key = CURRENCY_KEY[chartCurrency];
  const points = state.history.map((h) => ({ t: h.t, v: h[key] || 0 }));

  if (!points.length) {
    elements.chart.innerHTML = '<p class="chart-empty">پس از وارد کردن دارایی‌ها، روند ارزش کل اینجا نمایش داده می‌شود.</p>';
    return;
  }
  if (points.length === 1) {
    elements.chart.innerHTML = `
      <p class="chart-empty">
        امروز اولین نقطه ثبت شد: <strong>${formatMoney(points[0].v, chartCurrency)}</strong><br />
        برای دیدن نمودار رشد، در روزهای آینده هم به داشبورد سر بزنید.
      </p>`;
    return;
  }

  const W = 800;
  const H = 260;
  const pad = { top: 24, right: 16, bottom: 34, left: 16 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const values = points.map((p) => p.v);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= min * 0.05 || 1; max += max * 0.05 || 1; }

  const x = (i) => pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v) => pad.top + innerH - ((v - min) / (max - min)) * innerH;

  const linePts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const areaPts = `${pad.left},${pad.top + innerH} ${linePts} ${pad.left + innerW},${pad.top + innerH}`;

  const first = points[0];
  const lastP = points[points.length - 1];
  const trendUp = lastP.v >= first.v;
  const stroke = trendUp ? "#64d6a3" : "#ff7d7d";

  // This line follows total value, which moves both when prices move and when
  // assets are added or removed, so it is a change in net worth, not a return.
  // A near-zero baseline (an early snapshot caught mid data-entry) would turn
  // the ratio into a meaningless thousands-of-percent figure, so past a 10x
  // swing we report the absolute change instead.
  const delta = lastP.v - first.v;
  const ratio = first.v > 0 ? delta / first.v : null;
  const changeText =
    ratio !== null && Math.abs(ratio) <= 10
      ? `${formatNumber(Math.abs(ratio) * 100, 1)}٪`
      : formatMoney(Math.abs(delta), chartCurrency);

  const lastX = x(points.length - 1);
  const lastY = y(lastP.v);

  elements.chart.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="chart-svg" role="img"
         aria-label="نمودار روند ارزش کل دارایی‌ها">
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${stroke}" stop-opacity="0.28" />
          <stop offset="100%" stop-color="${stroke}" stop-opacity="0" />
        </linearGradient>
      </defs>
      <polygon points="${areaPts}" fill="url(#chartFill)" />
      <polyline points="${linePts}" fill="none" stroke="${stroke}" stroke-width="2.5"
                stroke-linejoin="round" stroke-linecap="round" />
      <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="4.5" fill="${stroke}" />
    </svg>
    <div class="chart-meta">
      <div>
        <span>ارزش فعلی</span>
        <strong>${formatMoney(lastP.v, chartCurrency)}</strong>
      </div>
      <div class="chart-change ${trendUp ? "up" : "down"}">
        ${trendUp ? "▲" : "▼"} ${changeText}
        <small>تغییر ارزش کل از ${toFaDate(first.t)}</small>
      </div>
      <div class="chart-range">
        <span>کمینه ${formatMoney(min, chartCurrency)}</span>
        <span>بیشینه ${formatMoney(max, chartCurrency)}</span>
      </div>
    </div>`;
}

function setChartCurrency(currency) {
  chartCurrency = currency;
  elements.chartToggle.querySelectorAll(".chart-cur").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.currency === currency);
  });
  renderChart();
}

/* ---------- Online refresh ---------- */

async function fetchQuotes(items) {
  const response = await fetch("/api/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ items }),
  });
  if (!response.ok) throw new Error(`quote failed: ${response.status}`);
  return response.json();
}

async function refreshPrices() {
  elements.refreshPrices.disabled = true;
  elements.refreshPrices.classList.add("is-loading");
  elements.refreshLabel.textContent = "در حال بروزرسانی...";

  const items = [];
  for (const [rate, ref] of Object.entries(RATE_REFS)) {
    items.push({ id: `rate:${rate}`, ...ref });
  }
  state.assets.forEach((asset) => {
    if (asset.ref?.provider && asset.ref?.code) {
      items.push({ id: `asset:${asset.id}`, ...asset.ref });
    }
  });

  try {
    const data = await fetchQuotes(items);
    const results = data.results || {};
    const now = new Date().toISOString();
    let successful = 0;

    for (const [rate, ref] of Object.entries(RATE_REFS)) {
      const price = results[`rate:${rate}`];
      if (price?.value) {
        state[rate] = price.value;
        elements[rate].value = price.value;
        successful += 1;
      }
    }

    state.assets = state.assets.map((asset) => {
      const price = results[`asset:${asset.id}`];
      if (price?.value && price?.currency) {
        successful += 1;
        return { ...asset, price: price.value, currency: price.currency, priceUpdatedAt: now };
      }
      return asset;
    });

    const failed = items.length - successful;
    state.lastUpdated = now;
    state.priceStatus =
      failed === 0
        ? "همه نرخ‌ها با موفقیت بروزرسانی شدند."
        : `${successful} نرخ بروزرسانی شد و ${failed} نرخ در دسترس نبود.`;

    renderRows();
    renderTotals();
    showToast(state.priceStatus, failed === 0 ? "success" : "info");
  } catch {
    state.priceStatus = "بروزرسانی آنلاین ناموفق بود؛ نرخ‌ها را دستی وارد کنید.";
    renderTotals();
    showToast(state.priceStatus, "error");
  } finally {
    elements.refreshPrices.disabled = false;
    elements.refreshPrices.classList.remove("is-loading");
    elements.refreshLabel.textContent = "بروزرسانی آنلاین قیمت‌ها";
  }
}

/* ---------- Dialog helpers ---------- */

function openDialog(dialog) {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
  else dialog.removeAttribute("open");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]),
  );
}

function toFaDate(iso) {
  // Build from the parts: `new Date("2026-09-03")` is parsed as UTC midnight
  // and can render as the previous day west of Greenwich.
  const [year, month, day] = String(iso).split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString("fa-IR", {
    month: "short",
    day: "numeric",
  });
}

/* ---------- Wire up ---------- */

function bindEvents() {
  elements.usdToIrr.value = state.usdToIrr;
  elements.eurToIrr.value = state.eurToIrr;
  elements.cushionAmount.value = state.cushion.amount;
  elements.usdToIrr.addEventListener("input", renderTotals);
  elements.eurToIrr.addEventListener("input", renderTotals);
  elements.cushionAmount.addEventListener("input", renderTotals);
  elements.cushionAsset.addEventListener("change", renderTotals);
  elements.refreshPrices.addEventListener("click", refreshPrices);

  // Manual asset dialog
  elements.openCustomDialog.addEventListener("click", () => {
    openDialog(elements.customDialog);
    elements.customTitle.focus();
  });
  elements.closeCustomDialog.addEventListener("click", () => closeDialog(elements.customDialog));
  elements.customAssetForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addCustomAsset();
  });

  // Market search dialog
  elements.openMarketDialog.addEventListener("click", () => {
    openDialog(elements.marketDialog);
    elements.marketSearch.focus();
  });
  elements.closeMarketDialog.addEventListener("click", () => closeDialog(elements.marketDialog));
  elements.marketSearch.addEventListener("input", onMarketSearchInput);

  // Close dialogs on backdrop click / cancel buttons
  [elements.customDialog, elements.marketDialog].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
  });
  document.querySelectorAll("[data-dialog-close]").forEach((button) => {
    button.addEventListener("click", () => closeDialog(button.closest("dialog")));
  });

  // Chart currency toggle
  elements.chartToggle.addEventListener("click", (event) => {
    const button = event.target.closest(".chart-cur");
    if (button) setChartCurrency(button.dataset.currency);
  });

  elements.resetData.addEventListener("click", () => {
    if (!confirm("همه مقدارها، نرخ‌ها و تاریخچه پاک شوند؟")) return;
    state = structuredClone(defaultState);
    saveState();
    elements.usdToIrr.value = state.usdToIrr;
    elements.eurToIrr.value = state.eurToIrr;
    elements.cushionAmount.value = state.cushion.amount;
    renderRows();
    renderTotals();
    showToast("داده‌ها به حالت اولیه بازنشانی شد.", "info");
  });

  // Keep the "3 hours ago" labels honest without re-rendering the table.
  setInterval(renderFreshness, 60000);
}

bindEvents();
renderRows();
renderTotals();
