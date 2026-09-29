import { $, esc, STATUSES } from "./util.js";
import { state } from "./data.js";

let period = "90d";
let report = "overview";

const dateFor = (repair) => repair.dateReceivedLab || repair.orderCreated || repair.dateOut || "";
const parseDate = (value) => value ? new Date(`${value.slice(0, 10)}T00:00:00`) : null;
const numberOrNull = (value) => value === "" || value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const currency = (value) => new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", maximumFractionDigits: 0 }).format(value);
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const displayNumber = (value, suffix = "") => value == null ? "—" : `${new Intl.NumberFormat("en-NZ", { maximumFractionDigits: 1 }).format(value)}${suffix}`;

function repairsInPeriod() {
  if (period === "all") return state.repairs;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (period === "year") start.setMonth(0, 1);
  else start.setDate(start.getDate() - Number.parseInt(period, 10) + 1);
  return state.repairs.filter((repair) => {
    const date = parseDate(dateFor(repair));
    return date && date >= start;
  });
}

function metric(label, value, detail) {
  return `<div class="dashboard-metric"><div class="dashboard-metric-label">${esc(label)}</div><strong>${esc(value)}</strong><div class="muted">${esc(detail)}</div></div>`;
}

function chart(title, entries, format = (value) => String(value)) {
  const max = Math.max(0, ...entries.map((entry) => entry.value));
  const rows = entries.length ? entries.map((entry) => {
    const width = max ? Math.max(entry.value ? 3 : 0, (entry.value / max) * 100) : 0;
    return `<div class="dashboard-bar-row"><span class="dashboard-bar-label" title="${esc(entry.label)}">${esc(entry.label)}</span><div class="dashboard-bar-track"><div class="dashboard-bar" style="width:${width}%"></div></div><b>${esc(format(entry.value))}</b></div>`;
  }).join("") : `<div class="empty">No data for this period.</div>`;
  return `<section class="dashboard-section"><h2>${esc(title)}</h2><div class="dashboard-bars">${rows}</div></section>`;
}

function groupBy(repairs, getLabel, getValue = () => 1) {
  const groups = new Map();
  for (const repair of repairs) {
    const label = getLabel(repair) || "Not recorded";
    groups.set(label, (groups.get(label) || 0) + getValue(repair));
  }
  return [...groups].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function monthGroups(repairs, valueFor = () => 1, dateSelector = dateFor) {
  const groups = new Map();
  for (const repair of repairs) {
    const date = parseDate(dateSelector(repair));
    if (!date) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const current = groups.get(key) || { label: date.toLocaleDateString("en-NZ", { month: "short", year: "2-digit" }), value: 0 };
    current.value += valueFor(repair);
    groups.set(key, current);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([, entry]) => entry);
}

function overview(repairs) {
  const open = repairs.filter((repair) => repair.status !== "Completed").length;
  const completed = repairs.filter((repair) => repair.dateReceivedLab && repair.dateOut).map((repair) => {
    const days = (parseDate(repair.dateOut) - parseDate(repair.dateReceivedLab)) / 864e5;
    return days >= 0 ? days : null;
  }).filter((days) => days != null);
  const costs = repairs.map((repair) => numberOrNull(repair.materialCost)).filter((value) => value != null);
  const statuses = STATUSES.map((status) => ({ label: status, value: repairs.filter((repair) => repair.status === status).length }));
  const payments = groupBy(repairs, (repair) => repair.paymentStatus || "Not recorded");
  const products = groupBy(repairs.filter((repair) => repair.productName), (repair) => repair.productName).slice(0, 6);

  return `<div class="dashboard-metrics">
      ${metric("Repairs", repairs.length, "records in selected period")}
      ${metric("Open", open, "not marked completed")}
      ${metric("Avg. turnaround", displayNumber(average(completed), " days"), `${completed.length} completed records with dates`)}
      ${metric("Recorded material cost", currency(costs.reduce((sum, value) => sum + value, 0)), `${costs.length} repairs with a cost entered`)}
    </div>
    <div class="dashboard-report-grid">${chart("Repairs by status", statuses)}${chart("Payment status", payments)}${chart("Most common products", products)}</div>`;
}

function timeReport(repairs) {
  const minutes = repairs.map((repair) => numberOrNull(repair.repairTime)).filter((value) => value != null);
  const completed = repairs.filter((repair) => repair.dateReceivedLab && repair.dateOut).map((repair) => {
    return (parseDate(repair.dateOut) - parseDate(repair.dateReceivedLab)) / 864e5;
  }).filter((days) => days >= 0);
  const monthly = monthGroups(repairs);
  const finishedByMonth = monthGroups(repairs.filter((repair) => repair.status === "Completed"), () => 1, (repair) => repair.dateOut);
  return `<div class="dashboard-metrics">
      ${metric("Logged repair time", `${displayNumber(minutes.reduce((sum, value) => sum + value, 0) / 60, " h")}`, `${minutes.length} repairs with time recorded`)}
      ${metric("Average repair time", displayNumber(average(minutes), " min"), "among records with time entered")}
      ${metric("Average turnaround", displayNumber(average(completed), " days"), "received-to-completed calendar days")}
    </div>
    <div class="dashboard-report-grid">${chart("Repairs by month", monthly)}${chart("Completed repairs by month", finishedByMonth)}</div>`;
}

function costsReport(repairs) {
  const recorded = repairs.map((repair) => ({ repair, cost: numberOrNull(repair.materialCost) })).filter((entry) => entry.cost != null);
  const total = recorded.reduce((sum, entry) => sum + entry.cost, 0);
  const monthly = monthGroups(recorded.map((entry) => entry.repair), (repair) => numberOrNull(repair.materialCost) || 0);
  const byProduct = groupBy(recorded.map((entry) => entry.repair).filter((repair) => repair.productName), (repair) => repair.productName, (repair) => numberOrNull(repair.materialCost) || 0).slice(0, 8);
  const byClass = groupBy(recorded.map((entry) => entry.repair), (repair) => repair.item, (repair) => numberOrNull(repair.materialCost) || 0).slice(0, 8);
  const unrecorded = repairs.length - recorded.length;
  return `<div class="dashboard-metrics">
      ${metric("Recorded material cost", currency(total), "not a full operating-cost or revenue figure")}
      ${metric("Repairs with cost", recorded.length, "cost entered")}
      ${metric("No cost recorded", unrecorded, "blank cost is excluded from totals")}
    </div>
    <div class="dashboard-report-grid">${chart("Material cost by month", monthly, currency)}${chart("Recorded material cost by product", byProduct, currency)}${chart("Recorded material cost by repair class", byClass, currency)}</div>`;
}

function mixReport(repairs) {
  const classes = groupBy(repairs, (repair) => repair.item).slice(0, 10);
  const categories = groupBy(repairs, (repair) => repair.category).slice(0, 10);
  const products = groupBy(repairs.filter((repair) => repair.productName), (repair) => repair.productName).slice(0, 10);
  return `<div class="dashboard-report-grid dashboard-report-grid-three">${chart("Repair class", classes)}${chart("Product category", categories)}${chart("Product", products)}</div>`;
}

const reports = {
  overview: ["Overview", overview],
  time: ["Time", timeReport],
  costs: ["Costs", costsReport],
  mix: ["Repair mix", mixReport],
};

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
  const repairs = repairsInPeriod();
  const [title, renderReport] = reports[report];
  $("content").innerHTML = `
    <div class="dashboard-toolbar">
      <div><h1>Dashboard</h1><p class="muted">${repairs.length} repairs · dates use lab received date, then order date</p></div>
      <div class="dashboard-actions">
        <label class="dashboard-period-label" for="dashboard-period">Period</label>
        <select id="dashboard-period">
          <option value="30d" ${period === "30d" ? "selected" : ""}>Last 30 days</option>
          <option value="90d" ${period === "90d" ? "selected" : ""}>Last 90 days</option>
          <option value="365d" ${period === "365d" ? "selected" : ""}>Last 12 months</option>
          <option value="year" ${period === "year" ? "selected" : ""}>Year to date</option>
          <option value="all" ${period === "all" ? "selected" : ""}>All records</option>
        </select>
        <button id="dashboard-export" class="ghost" type="button">Export CSV</button>
      </div>
    </div>
    <div class="segmented dashboard-tabs" role="tablist" aria-label="Dashboard reports">
      ${Object.entries(reports).map(([key, [label]]) => `<button type="button" role="tab" data-report="${key}" aria-selected="${report === key}" class="${report === key ? "active" : ""}">${label}</button>`).join("")}
    </div>
    <div class="dashboard-report" aria-label="${esc(title)} report">${renderReport(repairs)}</div>
    <p class="dashboard-note">Date ranges exclude records without a usable received, order, or completion date. Costs show entered raw material cost only.</p>`;

  $("dashboard-period").onchange = (event) => { period = event.target.value; renderDashboard(); };
  $("dashboard-export").onclick = () => exportCsv(repairs);
  $("content").querySelectorAll("[data-report]").forEach((button) => {
    button.onclick = () => { report = button.dataset.report; renderDashboard(); };
  });
}