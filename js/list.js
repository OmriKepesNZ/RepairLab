// The List and Board views of all repairs.
import { $, esc, fmtDate, paymentPill, showBanner, statusPill, STATUSES } from "./util.js";
import { state, moveStatus } from "./data.js";
import { openRepair } from "./detail.js";

let completedExpanded = false;

function matchingRepairs(applyStatusFilter) {
  const text = $("search").value.trim().toLowerCase();
  const status = $("filter-status").value;
  return state.repairs.filter((r) => {
    if (applyStatusFilter && status && r.status !== status) return false;
    const searchable = [r.invoiceNumber, r.customerName, r.item, r.productName, r.description].join(" ").toLowerCase();
    return !text || searchable.includes(text);
  });
}

function tableHtml(repairs, emptyMessage = "No repairs to show.") {
  if (!repairs.length) return `<div class="table-wrap"><div class="empty">${esc(emptyMessage)}</div></div>`;
  const rows = repairs.map((r) => `
    <tr class="repair-row" draggable="true" data-id="${r.id}">
      <td><b>${esc(r.invoiceNumber)}</b></td>
      <td>${esc(r.customerName)}</td>
      <td>${esc(r.productName)}</td>
      <td>${statusPill(r.status)}</td>
      <td>${fmtDate(r.dateReceivedLab)}</td>
      <td>${paymentPill(r.paymentStatus)}</td>
    </tr>`);
  return `<div class="table-wrap"><table>
    <thead><tr><th>Invoice</th><th>Customer</th><th>Product</th><th>Status</th><th>In lab</th><th>Payment</th></tr></thead>
    <tbody>${rows.join("")}</tbody></table></div>`;
}

function listHtml() {
  const repairs = matchingRepairs(true).filter((repair) => repair.status !== "Completed");
  return tableHtml(repairs, "No active repairs to show.");
}

function repairCard(repair) {
  return `
    <div class="card" draggable="true" data-id="${repair.id}">
      <b>${esc(repair.invoiceNumber)}</b> · ${esc(repair.customerName)}
      ${repair.productName ? `<div class="muted">${esc(repair.productName)}</div>` : ""}
      <div class="card-payment">${paymentPill(repair.paymentStatus)}</div>
    </div>`;
}

function boardHtml() {
  const repairs = matchingRepairs(false);
  const columns = STATUSES.filter((status) => status !== "Completed").map((status) => {
    const statusRepairs = repairs.filter((r) => r.status === status);
    return `<div class="col" data-status="${status}"><div class="col-head"><span>${status}</span><span>${statusRepairs.length}</span></div><div class="col-body">${statusRepairs.map(repairCard).join("")}</div></div>`;
  });
  return `<div class="board">${columns.join("")}</div>`;
}

function archiveHtml() {
  const searchActive = $("search").value.trim() !== "";
  const completedFilter = state.view === "list" && $("filter-status").value === "Completed";
  const completedVisible = completedExpanded || searchActive || completedFilter;
  const completed = matchingRepairs(false).filter((repair) => repair.status === "Completed");
  const archiveCount = state.repairs.filter((repair) => repair.status === "Completed").length;
  const archiveLabel = searchActive ? "Search results" : completedFilter ? "Filtered by status" : completedExpanded ? "Hide archive" : "View archive";
  const archiveRows = tableHtml(completed, "No completed repairs match this search.");
  return `<section class="archive-dropzone" data-status="Completed" aria-label="Completed archive">
      <div class="archive-message"><span class="archive-icon" aria-hidden="true"></span><p>Drag a repair here once it's picked up and paid — it's filed away, out of the active board.</p></div>
      <div class="archive-actions"><span class="archive-total">${archiveCount} archived</span><button type="button" class="archive-toggle" data-toggle-completed aria-expanded="${completedVisible}" aria-label="Completed archive, ${archiveCount} repairs${searchActive ? ", matching search" : ""}" ${searchActive || completedFilter ? "disabled" : ""}>${archiveLabel}</button></div>
      ${completedVisible ? `<div class="archive-list">${archiveRows}</div>` : ""}
    </section>`;
}

export function renderRepairs() {
  $("content").innerHTML = (state.view === "list" ? listHtml() : boardHtml()) + archiveHtml();
  const open = state.repairs.filter((r) => r.status !== "Completed").length;
  const unpaid = state.repairs.filter((r) => r.paymentStatus === "Unpaid").length;
  $("summary").textContent = `${state.repairs.length} repairs · ${open} open · ${unpaid} unpaid`;
}

// One-time wiring: clicks and drag-and-drop are handled on the container so they survive re-rendering.
export function initRepairViews() {
  const content = $("content");
  const repairFor = (el) => state.repairs.find((r) => r.id === el.dataset.id);
  const clearHighlights = () => content.querySelectorAll(".dragover, .dragging").forEach((el) => el.classList.remove("dragover", "dragging"));

  content.onclick = (e) => {
    const archiveToggle = e.target.closest("[data-toggle-completed]");
    if (archiveToggle) {
      if ($("search").value.trim()) return;
      completedExpanded = !completedExpanded;
      renderRepairs();
      return;
    }
    const item = e.target.closest("[data-id]");
    if (item) openRepair(repairFor(item));
  };
  content.ondragstart = (e) => {
    const repair = e.target.closest(".card, .repair-row");
    if (!repair) return;
    e.dataTransfer.setData("text/plain", repair.dataset.id);
    repair.classList.add("dragging");
  };
  content.ondragend = clearHighlights;
  content.ondragover = (e) => {
    const target = e.target.closest("[data-status]");
    if (!target) return;
    e.preventDefault();
    content.querySelectorAll(".dragover").forEach((el) => el.classList.remove("dragover"));
    target.classList.add("dragover");
  };
  content.ondrop = async (e) => {
    const target = e.target.closest("[data-status]");
    if (!target) return;
    e.preventDefault();
    clearHighlights();
    const repair = state.repairs.find((r) => r.id === e.dataTransfer.getData("text/plain"));
    if (!repair || repair.status === target.dataset.status) return;
    try { await moveStatus(repair, target.dataset.status); }
    catch (err) { showBanner("Could not move repair: " + err.message); }
  };
}
