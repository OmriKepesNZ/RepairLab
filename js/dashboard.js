import { $, esc } from "./util.js";
import { state } from "./data.js";

let period = "90d";
const parseDate = (value) => value ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : null;
const dateFor = (repair) => repair.dateReceivedLab || repair.orderCreated || repair.dateOut || "";
const numberOrNull = (value) => value === "" || value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const currency = (value) => new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(value);
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const dateKey = (date) => date.toISOString().slice(0, 10);
const today = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
};

function completedInPeriod() {
  const end = today();
  const start = period === "all" ? null : new Date(end.getTime() - (Number.parseInt(period, 10) - 1) * 864e5);
  return state.repairs.filter((repair) => {
    const date = parseDate(repair.dateOut);
    return date && (!start || date >= start) && date <= end;
  });
}

function repairsForExport() {
  const end = today();
  const start = period === "all" ? null : new Date(end.getTime() - (Number.parseInt(period, 10) - 1) * 864e5);
  return state.repairs.filter((repair) => {
    const date = parseDate(dateFor(repair));
    return date && (!start || date >= start) && date <= end;
  });
}

function metric(label, value, suffix = "") {
  return `<article class="insights-metric"><strong>${esc(value)}${suffix ? `<span>${esc(suffix)}</span>` : ""}</strong><div>${esc(label)}</div></article>`;
}

function groupBy(repairs, getLabel) {
  const groups = new Map();
  for (const repair of repairs) {
    const label = getLabel(repair) || "Not recorded";
    groups.set(label, (groups.get(label) || 0) + 1);
  }
  return [...groups].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function mondayOf(date) {
  const start = new Date(date);
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  return start;
}

function weeklyTotals(repairs) {
  const now = today();
  const dates = repairs.map((repair) => parseDate(repair.dateOut)).filter(Boolean);
  if (!dates.length) return [];
  const days = period === "90d" ? 77 : period === "30d" ? 29 : null;
  const start = period === "all"
    ? mondayOf(new Date(Math.min(...dates.map((date) => date.getTime()))))
    : mondayOf(new Date(now.getTime() - days * 864e5));
  const end = mondayOf(now);
  const totals = new Map();
  for (const date of dates) {
    const key = dateKey(mondayOf(date));
    totals.set(key, (totals.get(key) || 0) + 1);
  }
  const weeks = [];
  for (const week = new Date(start); week <= end; week.setUTCDate(week.getUTCDate() + 7)) {
    const key = dateKey(week);
    weeks.push({ key, value: totals.get(key) || 0 });
  }
  const last = weeks.length - 1;
  return weeks.map((week, index) => {
    const ago = Math.floor((end - new Date(`${week.key}T00:00:00Z`)) / (7 * 864e5));
    return { ...week, label: index === last ? "Now" : index % 3 === 0 ? `${ago}w` : "" };
  });
}

function weeklyChart(weeks) {
  if (!weeks.length) return `<div class="insights-empty">No completed repairs in this period.</div>`;
  const max = Math.max(1, ...weeks.map((week) => week.value));
  const bars = weeks.map((week) => {
    const height = week.value ? Math.max(8, week.value / max * 100) : 0;
    return `<div class="week-column" title="${esc(week.value)} completed"><div class="week-bar-wrap"><div class="week-bar" style="height:${height}%"></div></div><span>${esc(week.label)}</span></div>`;
  }).join("");
  return `<div class="weekly-chart"><div class="weekly-bars">${bars}</div></div>`;
}

function breakdown(title, entries) {
  if (!entries.length) return `<section class="insights-panel breakdown-panel"><h2>${esc(title)}</h2><div class="insights-empty">No data yet.</div></section>`;
  const max = Math.max(1, ...entries.map((entry) => entry.value));
  const rows = entries.slice(0, 6).map((entry) => {
    const width = Math.max(entry.value ? 2 : 0, entry.value / max * 100);
    return `<div class="breakdown-row"><span title="${esc(entry.label)}">${esc(entry.label)}</span><div><i style="width:${width}%"></i></div><b>${esc(entry.value)}</b></div>`;
  }).join("");
  return `<section class="insights-panel breakdown-panel"><h2>${esc(title)}</h2><div class="breakdown-list">${rows}</div></section>`;
}

function warrantyLabel(item) {
  if (item === "CA11002" || /\bwarranty\b/i.test(item) && !/non[- ]warranty/i.test(item)) return "Warranty";
  if (item === "CA11001" || /^CA11001\./.test(item) || /non[- ]warranty/i.test(item)) return "Non-warranty";
  return "Not recorded";
}

function needsAttention() {
  return state.repairs
    .filter((repair) => repair.status === "Ready for Pickup" && ["Unpaid", "Partial"].includes(repair.paymentStatus))
    .sort((a, b) => (parseDate(a.dateOut)?.getTime() || 0) - (parseDate(b.dateOut)?.getTime() || 0))
    .slice(0, 5);
}

function exportCsv(repairs) {
  const columns = [
    ["Invoice", "invoiceNumber"], ["Customer", "customerName"], ["Report date", dateFor],
    ["Status", "status"], ["Payment", "paymentStatus"], ["Class", "item"], ["Product", "productName"],
    ["Category", "category"], ["Quantity", "qty"], ["Repair minutes", "repairTime"], ["Material cost", "materialCost"],
  ];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const content = [columns.map(([label]) => quote(label)).join(","), ...repairs.map((repair) => columns.map(([, key]) => quote(typeof key === "function" ? key(repair) : repair[key])).join(","))].join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  link.download = `repair-report-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function renderDashboard() {
  const repairs = completedInPeriod();
  const turnaround = repairs.map((repair) => {
    const received = parseDate(repair.dateReceivedLab || repair.orderCreated);
    const completed = parseDate(repair.dateOut);
    return received && completed ? (completed - received) / 864e5 : null;
  }).filter((days) => days != null && days >= 0);
  const repairTimes = repairs.map((repair) => numberOrNull(repair.repairTime)).filter((value) => value != null);
  const materials = repairs.map((repair) => numberOrNull(repair.materialCost)).filter((value) => value != null);
  const categories = groupBy(repairs, (repair) => repair.category).slice(0, 6);
  const products = groupBy(repairs.filter((repair) => repair.productName), (repair) => repair.productName).slice(0, 6);
  const warranty = groupBy(repairs, (repair) => warrantyLabel(repair.item));
  const attention = needsAttention();
  const periodButtons = [["30d", "30 days"], ["90d", "90 days"], ["all", "All time"]];
  $("content").innerHTML = `
    <section class="insights-page">
      <div class="insights-controls">
        <div class="segmented insights-period" role="group" aria-label="Insights period">
          ${periodButtons.map(([key, label]) => `<button type="button" data-period="${key}" aria-pressed="${period === key}" class="${period === key ? "active" : ""}">${label}</button>`).join("")}
        </div>
        <button id="dashboard-export" class="insights-export" type="button" title="Export report as CSV">Export CSV</button>
      </div>
      <div class="insights-metrics">
        ${metric("Repairs completed", repairs.length)}
        ${metric("Average days to complete", average(turnaround) == null ? "—" : average(turnaround).toFixed(1))}
        ${metric("Average repair time", average(repairTimes) == null ? "—" : Math.round(average(repairTimes)), "min")}
        ${metric("Materials cost", currency(materials.reduce((sum, value) => sum + value, 0)))}
      </div>
      <div class="insights-primary-grid">
        <section class="insights-panel weekly-panel"><h2>Completed per week</h2>${weeklyChart(weeklyTotals(repairs))}</section>
        <section class="insights-panel attention-panel"><h2>Needs attention</h2>${attention.length ? `<div class="attention-list">${attention.map((repair) => `<div class="attention-row"><strong>${esc(repair.productName || "Product not set")}</strong><span>Ready, but still unpaid</span></div>`).join("")}</div>` : `<div class="insights-empty">Nothing needs attention.</div>`}</section>
      </div>
      <div class="insights-breakdown-grid">
        ${breakdown("By category", categories)}
        ${breakdown("Most repaired", products)}
        ${breakdown("Warranty or not", warranty)}
      </div>
    </section>`;

  $("content").querySelectorAll("[data-period]").forEach((button) => {
    button.onclick = () => { period = button.dataset.period; renderDashboard(); };
  });
  $("dashboard-export").onclick = () => exportCsv(repairsForExport());
}