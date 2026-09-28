// The repair pop-up: Cin7 details (fixed), lab fields (editable), comment, and history.
import { $, esc, fmtDate, fmtDateTime, today, describeChanges, showBanner, statusPill, STATUSES, PAYMENTS } from "./util.js";
import { state, createRepair, saveRepair, deleteRepair, searchProducts, loadCategories, newEvent, withLabDate } from "./data.js";

let openId = null; // the repair currently open, so its history can refresh live

const options = (list, selected, withBlank) =>
  (withBlank ? `<option value="">—</option>` : "") + list.map((v) => `<option ${v === selected ? "selected" : ""}>${v}</option>`).join("");

const field = (label, control, wide) => `<div class="field${wide ? " wide" : ""}"><label>${label}</label>${control}</div>`;
const numberOrBlank = (text) => (text === "" ? "" : Number(text));

// Shown for repairs that came from Cin7: plain text, nothing to edit.
const cin7Details = (r) => `
  <div class="facts">
    <div><span>Ordered</span>${fmtDate(r.orderCreated)}</div>
    <div><span>Class</span>${esc(r.item)}</div>
    <div><span>Qty</span>${esc(r.qty)}</div>
  </div>
  ${r.cin7Comments ? `<div class="cin7-comments">${esc(r.cin7Comments)}</div>` : ""}
  <div class="muted" style="margin-top:6px">From Cin7 — can't be edited here.</div>`;

// Shown for repairs entered by hand: the same details as inputs.
const manualDetails = (r) => `
  <div class="grid">
    ${field("Invoice number", `<input id="f-invoice" value="${esc(r.invoiceNumber)}">`)}
    ${field("Customer", `<input id="f-customer" value="${esc(r.customerName)}">`)}
    ${field("Order created", `<input id="f-created" type="date" value="${r.orderCreated || ""}">`)}
    ${field("Class", `<input id="f-class" list="classes" value="${esc(r.item)}"><datalist id="classes"><option value="Repair Non-Warranty"><option value="Repair Warranty"></datalist>`)}
    ${field("Qty", `<input id="f-qty" type="number" min="1" value="${r.qty || 1}">`)}
  </div>`;

const productBox = (r) => `
  <div class="product-row"><input id="f-product" autocomplete="off" placeholder="Type a name or SKU…" value="${esc(r.productName)}"><button type="button" class="ghost" id="f-product-clear">Clear</button></div>
  <div class="product-results" id="product-results"></div>`;

const renderRepairModal = (r, isNew, fromCin7) => `
  <div class="modal">
    <h2><span>${isNew ? "New repair" : `${esc(r.invoiceNumber)} · ${esc(r.customerName)}`}</span>${isNew ? "" : statusPill(r.status)}</h2>
    ${fromCin7 ? cin7Details(r) : manualDetails(r)}
    <h3>Lab</h3>
    <div class="grid">
      ${field("Status", `<select id="f-status">${options(STATUSES, r.status)}</select>`) }
      ${field("Payment", `<select id="f-payment">${options(PAYMENTS, r.paymentStatus)}</select>`) }
      ${field("Product (search Cin7 products)", productBox(r))}
      ${field("Category", `<input id="f-category" list="categories" autocomplete="off" placeholder="Search categories…" value="${esc(r.category)}"><datalist id="categories"></datalist>`) }
      ${field("Received in lab", `<input id="f-lab" type="date" value="${r.dateReceivedLab || ""}">`) }
      ${field("Date completed", `<input id="f-out" type="date" value="${r.dateOut || ""}">`) }
      ${field("Repair time (min)", `<input id="f-time" type="number" min="0" value="${r.repairTime ?? ""}">`) }
      ${field("Raw material cost", `<div class="money"><span>$</span><input id="f-cost" type="number" min="0" step="0.01" value="${r.materialCost ?? ""}"></div>`) }
      ${field("Repair description", `<textarea id="f-description">${esc(r.description)}</textarea>${r.cin7Comments ? `<button type="button" class="ghost small" id="copy-cin7">Copy from Cin7</button>` : ""}`, true)}
    </div>
    <div style="margin-top:12px">${field("Comment", `<textarea id="f-comment" placeholder="Add a comment (posted when you save)…"></textarea>`, true)}</div>
    <div class="actions">
      <div>${isNew ? "" : `<button class="danger" id="f-delete">Delete</button>`}</div>
      <div><button class="ghost" id="f-close">Close</button><button class="primary" id="f-save">Save</button></div>
    </div>
    ${isNew ? "" : `<button type="button" class="ghost small" id="history-toggle" style="margin-top:14px">Show history</button><div id="history" hidden style="margin-top:10px"></div>`}
  </div>`;

const collectRepairValues = (fromCin7, picker) => {
  const values = {
    status: $("f-status").value,
    dateReceivedLab: $("f-lab").value,
    productCode: picker.picked.code,
    productName: picker.picked.name,
    category: $("f-category").value.trim(),
    paymentStatus: $("f-payment").value,
    description: $("f-description").value.trim(),
    repairTime: numberOrBlank($("f-time").value),
    materialCost: numberOrBlank($("f-cost").value),
    dateOut: $("f-out").value,
  };
  if (!fromCin7) {
    Object.assign(values, {
      invoiceNumber: $("f-invoice").value.trim(),
      customerName: $("f-customer").value.trim(),
      orderCreated: $("f-created").value,
      item: $("f-class").value.trim(),
      qty: Number($("f-qty").value) || 1,
    });
  }
  return values;
};

const validateRepairValues = (values, fromCin7) => {
  if (!fromCin7 && (!values.invoiceNumber || !values.item)) return "Invoice number and class are required.";
  return null;
};

const saveRepairFromForm = async (r, isNew, fromCin7, picker, categories, close) => {
  const values = collectRepairValues(fromCin7, picker);
  const validationMessage = validateRepairValues(values, fromCin7);
  if (validationMessage) return showBanner(validationMessage);
  if (picker.hasUnpickedText()) return showBanner("Pick a product from the list, or clear the product field.");
  if (values.category && values.category !== r.category && categories.length && !categories.includes(values.category)) {
    return showBanner("Pick a category from the list.");
  }

  const comment = $("f-comment").value.trim();
  try {
    if (isNew) {
      await createRepair(values, [newEvent("event", "Repair added"), ...(comment ? [newEvent("comment", comment)] : [])]);
    } else {
      const changes = withLabDate(r, changedFields(r, values));
      const events = [];
      const summary = describeChanges(r, changes);
      if (summary) events.push(newEvent("event", summary));
      if (comment) events.push(newEvent("comment", comment));
      if (events.length) await saveRepair(r.id, changes, events);
    }
    close();
  } catch (err) { showBanner("Could not save: " + err.message); }
};

// Search-as-you-type over the Cin7 product list. Only a product picked from the list can be saved.
// Picking a product also fills in (and locks) its Cin7 category.
function setupProductPicker(r, categoryInput) {
  const picked = { code: r.productCode || "", name: r.productName || "" };
  const input = $("f-product"), results = $("product-results");
  categoryInput.disabled = Boolean(r.productCode && r.category);
  let timer;
  input.oninput = () => {
    clearTimeout(timer);
    const text = input.value.trim();
    if (text.length < 2) { results.style.display = "none"; return; }
    timer = setTimeout(async () => {
      try {
        const products = await searchProducts(text);
        results.innerHTML = products.length
          ? products.map((p) => `<div data-code="${esc(p.code)}" data-label="${esc(p.label)}" data-category="${esc(p.category)}">${esc(p.label)} <span class="muted">(${esc(p.code)})</span></div>`).join("")
          : `<div class="muted">No matching Cin7 products</div>`;
      } catch (err) { results.innerHTML = `<div>${esc(err.message)}</div>`; }
      results.style.display = "block";
    }, 250);
  };
  results.onclick = (e) => {
    const item = e.target.closest("[data-code]");
    if (!item) return;
    picked.code = item.dataset.code;
    picked.name = item.dataset.label;
    input.value = picked.name;
    results.style.display = "none";
    if (item.dataset.category) { categoryInput.value = item.dataset.category; categoryInput.disabled = true; }
  };
  $("f-product-clear").onclick = () => {
    picked.code = ""; picked.name = ""; input.value = ""; results.style.display = "none";
    if (categoryInput.disabled) { categoryInput.disabled = false; categoryInput.value = ""; }
  };
  return { picked, hasUnpickedText: () => input.value.trim() !== "" && input.value !== picked.name };
}

export function openRepair(repair) {
  const isNew = !repair;
  const r = repair || { status: "Received", paymentStatus: "Unpaid", dateReceivedLab: today() };
  const fromCin7 = Boolean(r.cin7Key);
  openId = r.id || null;

  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal">
    <h2><span>${isNew ? "New repair" : `${esc(r.invoiceNumber)} · ${esc(r.customerName)}`}</span>${isNew ? "" : statusPill(r.status)}</h2>
    ${fromCin7 ? cin7Details(r) : manualDetails(r)}
    <h3>Lab</h3>
    <div class="grid">
      ${field("Status", `<select id="f-status">${options(STATUSES, r.status)}</select>`)}
      ${field("Payment", `<select id="f-payment">${options(PAYMENTS, r.paymentStatus)}</select>`)}
      ${field("Product (search Cin7 products)", productBox(r))}
      ${field("Category", `<input id="f-category" list="categories" autocomplete="off" placeholder="Search categories…" value="${esc(r.category)}"><datalist id="categories"></datalist>`)}
      ${field("Received in lab", `<input id="f-lab" type="date" value="${r.dateReceivedLab || ""}">`)}
      ${field("Date completed", `<input id="f-out" type="date" value="${r.dateOut || ""}">`)}
      ${field("Repair time (min)", `<input id="f-time" type="number" min="0" value="${r.repairTime ?? ""}">`)}
      ${field("Raw material cost", `<div class="money"><span>$</span><input id="f-cost" type="number" min="0" step="0.01" value="${r.materialCost ?? ""}"></div>`)}
      ${field("Repair description", `<textarea id="f-description">${esc(r.description)}</textarea>${r.cin7Comments ? `<button type="button" class="ghost small" id="copy-cin7">Copy from Cin7</button>` : ""}`, true)}
    </div>
    <div style="margin-top:12px">${field("Comment", `<textarea id="f-comment" placeholder="Add a comment (posted when you save)…"></textarea>`, true)}</div>
    <div class="actions">
      <div>${isNew ? "" : `<button class="danger" id="f-delete">Delete</button>`}</div>
      <div><button class="ghost" id="f-close">Close</button><button class="primary" id="f-save">Save</button></div>
    </div>
    ${isNew ? "" : `<button type="button" class="ghost small" id="history-toggle" style="margin-top:14px">Show history</button><div id="history" hidden style="margin-top:10px"></div>`}
  </div>`;
  document.body.appendChild(back);

  const close = () => { openId = null; back.remove(); };
  back.onclick = (e) => { if (e.target === back) close(); };
  $("f-close").onclick = close;
  const categoryInput = $("f-category");
  const picker = setupProductPicker(r, categoryInput);
  let categories = [];
  loadCategories().then((list) => {
    categories = list;
    $("categories").innerHTML = list.map((c) => `<option value="${esc(c)}">`).join("");
  });
  if (r.cin7Comments) {
    $("copy-cin7").onclick = () => {
      const box = $("f-description");
      box.value = box.value ? box.value + "\n" + r.cin7Comments : r.cin7Comments;
    };
  }
  if (!isNew) {
    $("history-toggle").onclick = () => {
      const box = $("history");
      box.hidden = !box.hidden;
      $("history-toggle").textContent = box.hidden ? "Show history" : "Hide history";
    };
  }
  refreshHistory();

  if (!isNew) {
    $("f-delete").onclick = () => {
      if (!confirm("Delete this repair and its history?")) return;
      deleteRepair(r.id).then(() => close()).catch((err) => showBanner("Could not delete: " + err.message));
    };
  }

  $("f-save").onclick = () => saveRepairFromForm(r, isNew, fromCin7, picker, categories, close);
}

const changedFields = (before, values) =>
  Object.fromEntries(Object.entries(values).filter(([key, value]) => String(before[key] ?? "") !== String(value ?? "")));

// Called whenever data reloads, so an open repair shows new history straight away.
export function refreshHistory() {
  const box = $("history");
  const repair = state.repairs.find((r) => r.id === openId);
  if (!box || !repair) return;
  const events = [...repair.events].sort((a, b) => b.at.localeCompare(a.at));
  box.innerHTML = events.length
    ? `<div class="timeline">${events.map((e) => `
        <div class="event ${e.type}">
          <div class="text">${esc(e.text)}</div>
          <div class="who">${e.type === "comment" ? "Comment · " : ""}${esc(e.source || e.by || "Someone")} · ${fmtDateTime(e.at)}</div>
        </div>`).join("")}</div>`
    : `<div class="muted">No history yet.</div>`;
}
