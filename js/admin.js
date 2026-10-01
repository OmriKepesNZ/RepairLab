// Admin-only tools. RLS and the admin-users Edge Function enforce access server-side.
import { $, esc, showBanner } from "./util.js";
import { state, loadCategories, listCustomProducts, addProduct, updateCustomProduct, deleteCustomProduct, loadCin7RepairCodes, saveCin7RepairCodes, listAdminUsers, createAdminUser, updateAdminUserRole, forceSync } from "./data.js";

let categories = [];
let products = [];
let users = [];
let repairCodes = ["CA11001", "CA11002"];
let loading = false;
let productError = "";
let userError = "";
let codeError = "";
let syncStatus = "Orders sync automatically";
let addingProduct = false;
let inviteOpen = false;
let savingCodes = false;
let syncingCin7 = false;
let initialized = false;

const categoryOptions = (selected) =>
  `<option value="">Choose category…</option>${categories.map((category) => `<option value="${esc(category)}" ${category === selected ? "selected" : ""}>${esc(category)}</option>`).join("")}`;
const cin7SettingsError = (error) => {
  const message = error?.message || "Could not access Cin7 settings.";
  return message.includes("schema cache") || /cin7_settings.*does not exist/i.test(message)
    ? "Apply the Cin7 repair-codes migration to enable saving codes."
    : message;
};

const cin7Panel = () => `
  <section class="settings-card" aria-labelledby="settings-cin7-heading">
    <h2 id="settings-cin7-heading">Cin7</h2>
    <div class="settings-connection">
      <div><strong><span class="connection-indicator"></span>Connected</strong><p>${esc(syncStatus)}</p></div>
      <button type="button" class="settings-link" data-cin7-sync ${syncingCin7 ? "disabled" : ""}>${syncingCin7 ? "Syncing…" : "Sync now"}</button>
    </div>
    <div class="settings-code-setting">
      <div class="settings-description"><strong>Import orders that include</strong><span>New repairs appear when an order contains one of these product codes or prefixes.</span></div>
      <div class="settings-code-list">
        ${repairCodes.map((code, index) => `<div class="settings-code-row"><input data-repair-code data-code-index="${index}" aria-label="Cin7 repair product code ${index + 1}" value="${esc(code)}" placeholder="e.g. CA11001"><button type="button" class="settings-remove" data-code-remove="${index}" aria-label="Remove code">×</button></div>`).join("")}
        ${loading ? `<p class="settings-loading">Loading Cin7 settings…</p>` : codeError ? `<p class="settings-error">${esc(codeError)}</p>` : ""}
        <button type="button" class="settings-add-link" data-code-add>Add code</button>
      </div>
    </div>
  </section>`;

const productPanel = () => `
  <section class="settings-card" aria-labelledby="settings-products-heading">
    <h2 id="settings-products-heading">Custom products</h2>
    <p class="settings-intro">For things that aren't in Cin7, like old or unbranded items. They show up in the product search.</p>
    ${loading ? `<div class="settings-empty">Loading products…</div>` : productError ? `<div class="settings-error">${esc(productError)}</div>` : products.length ? `<div class="settings-product-list">
      ${products.map((product) => `<div class="settings-product-row" data-product-row data-code="${esc(product.code)}">
        <div class="settings-product-name"><input aria-label="Product name" data-product-label value="${esc(product.label)}" required><small>${esc(product.code)}</small></div>
        <select aria-label="Product category" data-product-category required>${categoryOptions(product.category)}</select>
        <div class="settings-row-actions"><button type="button" class="settings-row-save" data-product-save>Save</button><button type="button" class="settings-remove-text" data-product-delete>Delete</button></div>
      </div>`).join("")}
    </div>` : `<div class="settings-empty">No custom products yet.</div>`}
    ${addingProduct ? `<div class="settings-product-row settings-new-product"><div class="settings-product-name"><input data-new-product-label aria-label="New product name" placeholder="Product name" required></div><select data-new-product-category aria-label="New product category" required>${categoryOptions("")}</select><div class="settings-row-actions"><button type="button" class="settings-row-save" data-product-create>Add</button><button type="button" class="settings-remove-text" data-product-add-cancel>Cancel</button></div></div>` : `<button type="button" class="settings-add-link" data-product-add-open>Add custom product</button>`}
  </section>`;

const inviteForm = () => `
  <form id="admin-create-user" class="settings-invite-form">
    <label><span>Name</span><input name="name" autocomplete="name" required></label>
    <label><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
    <label><span>Initial password</span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
    <label><span>Access level</span><select name="role"><option value="staff">Staff</option><option value="admin">Admin</option></select></label>
    <button type="submit" class="primary" data-create-user-button>Invite</button>
  </form>`;

const usersPanel = () => `
  <section class="settings-card" aria-labelledby="settings-people-heading">
    <div class="settings-section-head"><h2 id="settings-people-heading">People</h2><span class="settings-count">${users.length}</span></div>
    ${loading ? `<div class="settings-empty">Loading people…</div>` : userError ? `<div class="settings-error">${esc(userError)}</div>` : `<div class="settings-people-list">
      ${users.map((user) => `<div class="settings-person"><div class="settings-person-name"><strong>${esc(user.name || "—")}</strong><span>${esc(user.email)}</span></div><div class="settings-role-state" role="group" aria-label="Access level for ${esc(user.name || user.email)}"><button type="button" class="${user.role === "admin" ? "selected" : ""}" data-user-role="admin" data-user-id="${esc(user.id)}">Admin</button><button type="button" class="${user.role === "staff" ? "selected" : ""}" data-user-role="staff" data-user-id="${esc(user.id)}">Staff</button></div></div>`).join("") || `<div class="settings-empty">No user accounts found.</div>`}
    </div>`}
    ${inviteOpen ? inviteForm() : `<button type="button" class="settings-add-link" data-invite-toggle>Invite someone</button>`}
  </section>`;

const preferencesPanel = () => `
  <section class="settings-card" aria-labelledby="settings-preferences-heading">
    <h2 id="settings-preferences-heading">Preferences</h2>
    <div class="settings-preference-row"><div class="settings-description"><strong>Flag repairs waiting longer than</strong><span>Shown in amber on the board</span></div><div class="settings-threshold"><input value="36" aria-label="Waiting threshold in days" readonly><span>days</span></div></div>
    <div class="settings-preference-row"><strong>Appearance</strong><div class="settings-static-segmented" aria-label="Appearance"><span class="selected">Auto</span><span>Light</span><span>Dark</span></div></div>
  </section>`;

export function renderAdmin() {
  if (!state.isAdmin) return `<div class="empty">Administrator access is required.</div>`;
  return `
    <div class="admin-view settings-view">
      ${cin7Panel()}
      ${productPanel()}
      ${usersPanel()}
      ${preferencesPanel()}
      <div class="settings-footer"><button type="button" class="primary" id="settings-save" ${loading || savingCodes ? "disabled" : ""}>${savingCodes ? "Saving…" : "Save"}</button></div>
    </div>`;
}

function repaint() {
  if (state.view === "admin") $("content").innerHTML = renderAdmin();
}

export async function loadAdminData() {
  if (!state.isAdmin) return;
  loading = true;
  productError = "";
  userError = "";
  codeError = "";
  repaint();
  const results = await Promise.allSettled([loadCategories(), listCustomProducts(), listAdminUsers(), loadCin7RepairCodes()]);
  const [categoryResult, productResult, userResult, codeResult] = results;
  categories = categoryResult.status === "fulfilled" ? categoryResult.value : [];
  products = productResult.status === "fulfilled" ? productResult.value : [];
  users = userResult.status === "fulfilled" ? userResult.value : [];
  repairCodes = codeResult.status === "fulfilled" ? codeResult.value : ["CA11001", "CA11002"];
  if (productResult.status === "rejected") productError = productResult.reason?.message || "Could not load custom products.";
  if (userResult.status === "rejected") userError = userResult.reason?.message || "Could not load people.";
  if (codeResult.status === "rejected") codeError = cin7SettingsError(codeResult.reason);
  loading = false;
  repaint();
}

export function initAdmin() {
  if (initialized) return;
  initialized = true;
  const content = $("content");

  content.addEventListener("click", async (event) => {
    if (state.view !== "admin" || !state.isAdmin) return;
    if (event.target.closest("[data-code-add]")) {
      repairCodes.push("");
      repaint();
      return;
    }
    const removeCode = event.target.closest("[data-code-remove]");
    if (removeCode) {
      repairCodes.splice(Number(removeCode.dataset.codeRemove), 1);
      repaint();
      return;
    }
    if (event.target.closest("#settings-save")) {
      const enteredCodes = [...content.querySelectorAll("[data-repair-code]")].map((input) => input.value.trim().toUpperCase());
      if (enteredCodes.some((code) => !code)) return showBanner("Enter a code or remove the empty row.");
      if (new Set(enteredCodes).size !== enteredCodes.length) return showBanner("Each Cin7 code can only be listed once.");
      savingCodes = true;
      codeError = "";
      repaint();
      try {
        repairCodes = await saveCin7RepairCodes(enteredCodes);
        showBanner("Cin7 repair codes saved.");
      } catch (err) {
        codeError = cin7SettingsError(err);
        showBanner("Could not save Cin7 repair codes: " + codeError);
      } finally {
        savingCodes = false;
        repaint();
      }
      return;
    }
    if (event.target.closest("[data-cin7-sync]")) {
      syncingCin7 = true;
      syncStatus = "Syncing orders and products…";
      repaint();
      try {
        await forceSync();
        syncStatus = "Last synced just now";
        showBanner("Cin7 sync completed.");
      } catch (err) {
        syncStatus = "Sync failed";
        showBanner("Could not sync Cin7: " + err.message);
      } finally {
        syncingCin7 = false;
        repaint();
      }
      return;
    }
    if (event.target.closest("[data-product-add-open]")) {
      addingProduct = true;
      repaint();
      return;
    }
    if (event.target.closest("[data-product-add-cancel]")) {
      addingProduct = false;
      repaint();
      return;
    }
    const addProductButton = event.target.closest("[data-product-create]");
    if (addProductButton) {
      const label = content.querySelector("[data-new-product-label]").value.trim();
      const category = content.querySelector("[data-new-product-category]").value;
      if (!label || !category) return showBanner("Enter a product name and choose a category.");
      addProductButton.disabled = true;
      try {
        await addProduct(label, category, `CUSTOM-${crypto.randomUUID()}`);
        addingProduct = false;
        showBanner("Custom product added.");
        await loadAdminData();
      } catch (err) {
        addProductButton.disabled = false;
        showBanner("Could not add product: " + err.message);
      }
      return;
    }
    if (event.target.closest("[data-invite-toggle]")) {
      inviteOpen = !inviteOpen;
      repaint();
      return;
    }
    const roleButton = event.target.closest("[data-user-role]");
    if (roleButton) {
      if (roleButton.classList.contains("selected")) return;
      const row = roleButton.closest(".settings-person");
      row.querySelectorAll("[data-user-role]").forEach((button) => { button.disabled = true; });
      try {
        await updateAdminUserRole(roleButton.dataset.userId, roleButton.dataset.userRole);
        showBanner("Access level updated.");
        await loadAdminData();
      } catch (err) {
        row.querySelectorAll("[data-user-role]").forEach((button) => { button.disabled = false; });
        showBanner("Could not update access level: " + err.message);
      }
      return;
    }
    const saveButton = event.target.closest("[data-product-save]");
    if (saveButton) {
      const row = saveButton.closest("[data-product-row]");
      const label = row.querySelector("[data-product-label]").value.trim();
      const category = row.querySelector("[data-product-category]").value;
      if (!label || !category) return showBanner("Enter a product name and choose a category.");
      saveButton.disabled = true;
      try {
        await updateCustomProduct(row.dataset.code, label, category);
        showBanner("Custom product updated.");
        await loadAdminData();
      } catch (err) {
        saveButton.disabled = false;
        showBanner("Could not update product: " + err.message);
      }
      return;
    }
    const deleteButton = event.target.closest("[data-product-delete]");
    if (deleteButton) {
      const row = deleteButton.closest("[data-product-row]");
      if (!confirm(`Delete custom product “${row.querySelector("[data-product-label]").value}”?`)) return;
      deleteButton.disabled = true;
      try {
        await deleteCustomProduct(row.dataset.code);
        showBanner("Custom product deleted.");
        await loadAdminData();
      } catch (err) {
        deleteButton.disabled = false;
        showBanner("Could not delete product: " + err.message);
      }
    }
  });

  content.addEventListener("input", (event) => {
    const input = event.target.closest("[data-repair-code]");
    if (!input) return;
    repairCodes[Number(input.dataset.codeIndex)] = input.value;
  });

  content.addEventListener("submit", async (event) => {
    if (event.target.id !== "admin-create-user" || state.view !== "admin" || !state.isAdmin) return;
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector("[data-create-user-button]");
    const values = new FormData(form);
    button.disabled = true;
    try {
      const user = await createAdminUser({
        name: values.get("name"),
        email: values.get("email"),
        password: values.get("password"),
        role: values.get("role"),
      });
      showBanner(`Account created for ${user.email}. Share the initial password securely.`);
      form.reset();
      await loadAdminData();
    } catch (err) {
      button.disabled = false;
      showBanner("Could not create account: " + err.message);
    }
  });
}