// The repair pop-up: Cin7 details (fixed), lab fields (editable), comment, and history.
import { $, esc, fmtDate, fmtDateTime, today, describeChanges, showBanner, STATUSES, PAYMENTS } from "./util.js";
import { state, createRepair, saveRepair, deleteRepair, searchProducts, addProduct, loadCategories, newEvent, withLabDate, moveStatus } from "./data.js";

let openId = null; // the repair currently open, so its history can refresh live

const options = (list, selected, withBlank) =>
  (withBlank ? `<option value="">—</option>` : "") + list.map((v) => `<option ${v === selected ? "selected" : ""}>${v}</option>`).join("");

const numberOrBlank = (text) => (text === "" ? "" : Number(text));
const statusLabel = (value) => ({ "Created in Cin7": "To do", "In Lab": "In lab", "In Progress": "In progress", "Ready for Pickup": "Ready for pickup", Completed: "Archived" })[value] || value;
const orderClassLabel = (value) => value === "CA11002" ? "Warranty repair" : /^CA11001(?:\.|$)/.test(value) ? "Non-warranty repair" : value || "—";
const currency = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", currencyDisplay: "narrowSymbol" });
const priceLabel = (value) => value === "" || value == null ? "—" : currency.format(Number(value));
const statusButtons = (current) => [...STATUSES.slice(0, 4), ...(current === "Completed" ? ["Completed"] : [])].map((value) => `<button type="button" class="status-option${current === value ? " active" : ""}" data-status="${esc(value)}">${esc(statusLabel(value))}</button>`).join("");
const labNotes = (repair) => {
  const comments = (repair.events || []).filter((event) => event.type === "comment").sort((a, b) => b.at.localeCompare(a.at));
  if (!comments.length) return "";
  return `<div class="drawer-activity lab-notes"><h3>Notes</h3><div class="timeline">${comments.map((event) => `
    <div class="event comment"><div class="text">${esc(event.text)}</div><div class="who">${esc(event.source || event.by || "Someone")} · ${fmtDateTime(event.at)}</div></div>`).join("")}</div></div>`;
};
const categoryBox = (r) => `
  <div class="category-picker">
    <div class="category-input-row"><input id="f-category" autocomplete="off" aria-autocomplete="list" aria-controls="category-options" aria-expanded="false" placeholder="${r.productCode ? "Search categories…" : "Select a product first"}" value="${esc(r.category)}" ${r.productCode ? "" : "disabled"}><button type="button" class="ghost category-toggle" id="f-category-toggle" aria-label="Show categories" title="Show categories" aria-expanded="false">▾</button></div>
    <div class="category-options" id="category-options" role="listbox" hidden></div>
  </div>`;

const drawerStatusRow = (r) => `
  <div class="drawer-section">
    <div class="drawer-label-row">
      <label class="drawer-label">Status</label>
    </div>
    <div class="status-picker" aria-label="Repair status">
      ${statusButtons(r.status)}
    </div>
    <select id="f-status" class="sr-only">${options(STATUSES, r.status)}</select>
  </div>
`;

const drawerInfoBlock = (r, isNew, fromCin7) => `
  <div class="drawer-header">
    <div>
      <h2>${isNew ? "New repair" : esc(r.productName || r.invoiceNumber || "Repair")}</h2>
      <div class="drawer-subtitle">${isNew ? "" : `${esc(r.customerName || "Customer")} · ${esc(r.invoiceNumber || "")}`}</div>
    </div>
    <button type="button" class="drawer-close" id="f-close" aria-label="Close repair">×</button>
  </div>

  ${fromCin7 ? `<div class="drawer-banner">Synced from Cin7. Order details are locked and update automatically.</div>` : ""}

  ${drawerStatusRow(r)}

  <div class="urgent-setting">
    <div><strong>Mark as urgent</strong><span>Pins it to the top of its column</span></div>
    <label class="urgent-toggle" aria-label="Mark this repair as urgent"><input id="f-urgent" type="checkbox" ${r.isUrgent ? "checked" : ""}><span class="urgent-switch"></span></label>
  </div>

  <div class="drawer-meta-grid">
    <div class="drawer-field">
      <label>Product</label>
      ${productBox(r)}
    </div>

    <div class="drawer-field">
      <label>Category</label>
      ${categoryBox(r)}
    </div>
  </div>

  <section class="drawer-section order-section">
    <div class="drawer-section-heading"><h3>Order</h3>${fromCin7 ? `<span class="order-source">Cin7</span>` : ""}</div>
    ${fromCin7 ? `
      <div class="drawer-order-grid">
        <div class="drawer-readonly"><label>Ordered</label><div>${esc(fmtDate(r.orderCreated))}</div></div>
        <div class="drawer-readonly"><label>Qty</label><div>${esc(r.qty || "—")}</div></div>
      </div>
      <div class="drawer-order-grid">
        <div class="drawer-readonly"><label>Class</label><div>${esc(orderClassLabel(r.item))}</div></div>
        <div class="drawer-readonly"><label>Price</label><div>${esc(priceLabel(r.cin7Price))}</div></div>
      </div>
      <div class="drawer-readonly drawer-wide"><label>Payment</label><div>${esc(r.paymentStatus || "Unpaid")}</div></div>
      ${r.cin7Comments ? `<div class="drawer-readonly drawer-wide"><label>Comment from Cin7</label><div>${esc(r.cin7Comments)}</div></div>` : ""}
    ` : `
      <div class="drawer-order-grid">
        <div class="drawer-field"><label>Invoice number</label><input id="f-invoice" value="${esc(r.invoiceNumber || "")}"></div>
        <div class="drawer-field"><label>Customer</label><input id="f-customer" value="${esc(r.customerName || "")}"></div>
      </div>
      <div class="drawer-order-grid">
        <div class="drawer-field"><label>Ordered</label><input id="f-created" type="date" value="${esc(r.orderCreated || "")}"></div>
        <div class="drawer-field"><label>Qty</label><input id="f-qty" type="number" min="1" value="${r.qty || 1}"></div>
      </div>
      <div class="drawer-order-grid">
        <div class="drawer-field"><label>Class</label><select id="f-class">${options(["Repair Non-Warranty", "Repair Warranty"], r.item, true)}</select></div>
        <div class="drawer-field"><label>Payment</label><select id="f-payment">${options(PAYMENTS, r.paymentStatus)}</select></div>
      </div>
    `}
  </section>

  <section class="drawer-section lab-section">
    <h3>Lab</h3>
    <div class="drawer-field drawer-field-wide">
      <div class="drawer-field-head"><label for="f-description">What needs doing</label>${r.cin7Comments ? `<button type="button" class="copy-cin7" id="copy-cin7">Copy from Cin7</button>` : ""}</div>
      <textarea id="f-description" placeholder="e.g. Replace zip">${esc(r.description)}</textarea>
    </div>
    <div class="drawer-order-grid drawer-lab-numbers">
      <div class="drawer-field"><label>Time (min)</label><input id="f-time" type="number" min="0" placeholder="0" value="${r.repairTime ?? ""}"></div>
      <div class="drawer-field"><label>Materials ($)</label><input id="f-cost" type="number" min="0" step="0.01" placeholder="0.00" value="${r.materialCost ?? ""}"></div>
    </div>
    <div class="drawer-order-grid">
      <div class="drawer-field"><label>Received in lab</label><input id="f-lab" type="date" value="${esc(r.dateReceivedLab || "")}"></div>
      <div class="drawer-field"><label>Date completed</label><input id="f-out" type="date" value="${esc(r.dateOut || "")}"></div>
    </div>
    <div class="drawer-field drawer-field-wide drawer-comment"><label>Add a note</label><textarea id="f-comment" placeholder="Saved with the repair"></textarea></div>
    ${isNew ? "" : labNotes(r)}
    ${isNew ? "" : `<div class="drawer-activity"><div class="drawer-activity-head"><h3>Activity</h3><button type="button" class="activity-toggle" id="activity-toggle" aria-expanded="false">View activity</button></div><div id="history" hidden></div></div>`}
  </section>
`;

const productBox = (r) => `
  <div class="product-picker">
    <div class="product-row"><input id="f-product" role="combobox" aria-autocomplete="list" aria-controls="product-results" aria-expanded="false" autocomplete="off" placeholder="Type a name or SKU…" value="${esc(r.productName)}"><button type="button" class="product-clear" id="f-product-clear" aria-label="Clear product" title="Clear product">×</button></div>
    <div class="product-results" id="product-results" role="listbox" hidden></div>
  </div>`;

const collectRepairValues = (fromCin7, picker) => {
  const values = {
    status: $("f-status").value,
    isUrgent: $("f-urgent").checked,
    dateReceivedLab: $("f-lab").value,
    productCode: picker.picked.code,
    productName: picker.picked.name,
    category: $("f-category").value.trim(),
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
      paymentStatus: $("f-payment").value,
    });
  }
  return values;
};

const validateRepairValues = (values, fromCin7) => {
  if (!fromCin7 && !values.invoiceNumber) return "Invoice number is required.";
  return null;
};

const saveRepairFromForm = async (r, isNew, fromCin7, picker, categoryPicker, categories, close) => {
  const values = collectRepairValues(fromCin7, picker);
  const validationMessage = validateRepairValues(values, fromCin7);
  if (validationMessage) return showBanner(validationMessage);
  if (picker.hasUnpickedText()) return showBanner("Pick a product from the list, or clear the product field.");
  if (picker.pendingProduct && (!categories.includes(values.category) || !categoryPicker.hasSelection())) return showBanner("Choose a category from the list before adding this product.");
  if (values.category && values.category !== r.category && categories.length && !categories.includes(values.category)) {
    return showBanner("Pick a category from the list.");
  }

  const comment = $("f-comment").value.trim();
  try {
    if (picker.pendingProduct) {
      const product = await addProduct(picker.pendingProduct.name, values.category, picker.pendingProduct.code);
      values.productCode = product.code;
      values.productName = product.label;
    }
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
function setupCategoryPicker(r, getCategories) {
  const input = $("f-category"), toggle = $("f-category-toggle"), menu = $("category-options");
  const selected = { value: input.value };
  const setEnabled = (enabled) => {
    input.disabled = !enabled;
    toggle.disabled = !enabled;
    input.placeholder = enabled ? "Search categories…" : "Select a product first";
  };
  setEnabled(Boolean(r.productCode && !r.category));

  const close = () => {
    menu.hidden = true;
    input.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-expanded", "false");
  };
  const render = () => {
    const query = input.value.trim().toLowerCase();
    const matches = getCategories().filter((category) => category.toLowerCase().includes(query));
    menu.innerHTML = matches.length
      ? matches.map((category) => `<button type="button" role="option" aria-selected="${category === selected.value}" data-category="${esc(category)}">${esc(category)}</button>`).join("")
      : `<div class="muted">No matching categories</div>`;
  };
  const open = () => {
    render();
    menu.hidden = false;
    input.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-expanded", "true");
  };

  input.onfocus = open;
  input.oninput = () => { selected.value = ""; open(); };
  toggle.onclick = () => menu.hidden ? open() : close();
  menu.onclick = (e) => {
    const option = e.target.closest("[data-category]");
    if (!option) return;
    selected.value = option.dataset.category;
    input.value = selected.value;
    close();
  };

  return {
    clear(enabled = false) {
      input.value = "";
      selected.value = "";
      setEnabled(enabled);
      close();
    },
    close,
    hasSelection: () => selected.value === input.value && Boolean(input.value),
    refresh: render,
    select(category, locked = false) {
      input.value = category;
      selected.value = category;
      setEnabled(!locked);
      close();
    },
    get disabled() { return input.disabled; },
  };
}

function setupProductPicker(r, categoryPicker) {
  const picked = { code: r.productCode || "", name: r.productName || "" };
  const input = $("f-product"), results = $("product-results");
  let pendingProduct = null;
  let timer;
  input.oninput = () => {
    clearTimeout(timer);
    const text = input.value.trim();
    if (text !== picked.name) {
      picked.code = ""; picked.name = ""; pendingProduct = null;
      categoryPicker.clear();
    }
    results.hidden = true;
    input.setAttribute("aria-expanded", "false");
    if (text.length < 2) return;
    timer = setTimeout(async () => {
      try {
        const products = await searchProducts(text);
        results.innerHTML = products.length
          ? products.map((p) => `<button type="button" class="product-result" role="option" data-code="${esc(p.code)}" data-label="${esc(p.label)}" data-category="${esc(p.category)}"><span class="product-result-name">${esc(p.label)}</span><span class="product-result-category">${esc(p.category || "")}</span></button>`).join("")
          : `<button type="button" class="product-result product-add" role="option" data-add-new="${esc(text)}"><span class="product-result-name">Use “${esc(text)}” as a custom product</span></button>`;
      } catch (err) { results.innerHTML = `<div class="product-result-message">${esc(err.message)}</div>`; }
      results.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }, 250);
  };
  results.onclick = (e) => {
    const add = e.target.closest("[data-add-new]");
    if (add) {
      const name = add.dataset.addNew.trim();
      const code = `CUSTOM-${crypto.randomUUID()}`;
      pendingProduct = { code, name };
      picked.code = code; picked.name = name;
      input.value = name;
      categoryPicker.clear(true);
      results.hidden = true;
      input.setAttribute("aria-expanded", "false");
      return;
    }
    const item = e.target.closest("[data-code]");
    if (!item) return;
    pendingProduct = null;
    picked.code = item.dataset.code;
    picked.name = item.dataset.label;
    input.value = picked.name;
    results.hidden = true;
    input.setAttribute("aria-expanded", "false");
    if (item.dataset.category) categoryPicker.select(item.dataset.category, true);
    else categoryPicker.clear(true);
  };
  $("f-product-clear").onclick = () => {
    pendingProduct = null;
    picked.code = ""; picked.name = ""; input.value = ""; results.hidden = true;
    input.setAttribute("aria-expanded", "false");
    categoryPicker.clear();
  };
  return { picked, get pendingProduct() { return pendingProduct; }, hasUnpickedText: () => input.value.trim() !== "" && input.value !== picked.name };
}

export function openRepair(repair) {
  const isNew = !repair;
  const r = repair || { status: "In Lab", paymentStatus: "Unpaid", dateReceivedLab: today() };
  const fromCin7 = Boolean(r.cin7Key);
  const isArchived = r.status === "Completed";
  openId = r.id || null;

  const back = document.createElement("div");
  back.className = "modal-back drawer-back";
  back.innerHTML = `<div class="modal drawer-modal">
    <div class="drawer-scroll">${drawerInfoBlock(r, isNew, fromCin7)}</div>
    <div class="drawer-footer">
      <div class="drawer-footer-actions">
        <button class="drawer-action-archive" id="f-archive" ${isNew ? "hidden" : ""}>${isArchived ? "Unarchive" : "Archive"}</button>
        ${fromCin7 ? "" : `<button class="danger drawer-action-delete" id="f-delete" ${isNew ? "hidden" : ""}>Delete</button>`}
      </div>
      <button class="primary drawer-action-save" id="f-save">Done</button>
    </div>
  </div>`;
  document.body.appendChild(back);

  const close = () => { openId = null; back.remove(); };
  const closeButton = $("f-close");
  if (closeButton) closeButton.onclick = close;

  document.querySelectorAll(".status-option").forEach((button) => {
    button.onclick = () => {
      const select = $("f-status");
      if (!select) return;
      select.value = button.dataset.status;
      document.querySelectorAll(".status-option").forEach((el) => el.classList.toggle("active", el === button));
    };
  });

  let categories = [];
  const categoryPicker = setupCategoryPicker(r, () => categories);
  const picker = setupProductPicker(r, categoryPicker);
  back.onclick = (e) => {
    if (e.target === back) close();
    else if (!e.target.closest(".category-picker")) categoryPicker.close();
  };
  loadCategories().then((list) => {
    categories = list;
    categoryPicker.refresh();
  });
  if (r.cin7Comments) {
    $("copy-cin7").onclick = () => {
      const box = $("f-description");
      box.value = box.value ? box.value + "\n" + r.cin7Comments : r.cin7Comments;
    };
  }
  if (!isNew) {
    $("activity-toggle").onclick = () => {
      const history = $("history");
      history.hidden = !history.hidden;
      const expanded = !history.hidden;
      $("activity-toggle").textContent = expanded ? "Hide activity" : "View activity";
      $("activity-toggle").setAttribute("aria-expanded", String(expanded));
    };
  }
  refreshHistory();

  if (!isNew) {
    $("f-archive").onclick = () => {
      const nextStatus = isArchived ? "Ready for Pickup" : "Completed";
      moveStatus(r, nextStatus).then(() => close()).catch((err) => showBanner(`Could not ${isArchived ? "unarchive" : "archive"}: ` + err.message));
    };
    if (!fromCin7) {
      $("f-delete").onclick = () => {
        if (!confirm("Delete this repair and its history?")) return;
        deleteRepair(r.id).then(() => close()).catch((err) => showBanner("Could not delete: " + err.message));
      };
    }
  }

  $("f-save").onclick = () => saveRepairFromForm(r, isNew, fromCin7, picker, categoryPicker, categories, close);
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
