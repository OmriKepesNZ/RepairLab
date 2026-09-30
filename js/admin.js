// Admin-only tools. RLS and the admin-users Edge Function enforce access server-side.
import { $, esc, showBanner } from "./util.js";
import { state, loadCategories, listCustomProducts, updateCustomProduct, deleteCustomProduct, listAdminUsers, createAdminUser } from "./data.js";

let tab = "products";
let categories = [];
let products = [];
let users = [];
let loading = false;
let loadError = "";
let initialized = false;

const categoryOptions = (selected) =>
  `<option value="">Choose category…</option>${categories.map((category) => `<option value="${esc(category)}" ${category === selected ? "selected" : ""}>${esc(category)}</option>`).join("")}`;

const productPanel = () => `
  <section class="admin-section" aria-labelledby="admin-products-heading">
    <div class="admin-section-heading"><div><h3 id="admin-products-heading">Custom products</h3><p class="muted">${products.length} products</p></div><button type="button" class="ghost" data-admin-refresh>Refresh</button></div>
    ${loading ? `<div class="empty">Loading products…</div>` : loadError ? `<div class="empty">${esc(loadError)}</div>` : products.length ? `
      <div class="table-wrap"><table class="admin-table"><thead><tr><th>Code</th><th>Product name</th><th>Category</th><th></th></tr></thead><tbody>
        ${products.map((product) => `<tr data-product-row data-code="${esc(product.code)}">
          <td><code>${esc(product.code)}</code></td>
          <td><input aria-label="Product name" data-product-label value="${esc(product.label)}" required></td>
          <td><select aria-label="Product category" data-product-category required>${categoryOptions(product.category)}</select></td>
          <td class="admin-row-actions"><button type="button" class="ghost small" data-product-save>Save</button><button type="button" class="danger small" data-product-delete>Delete</button></td>
        </tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">No custom products yet.</div>`}
  </section>`;

const usersPanel = () => `
  <section class="admin-section" aria-labelledby="admin-users-heading">
    <div class="admin-section-heading"><div><h3 id="admin-users-heading">User accounts</h3><p class="muted">${users.length} accounts</p></div><button type="button" class="ghost" data-admin-refresh>Refresh</button></div>
    <form id="admin-create-user" class="admin-create-user">
      <div class="admin-create-grid">
        <label class="field"><span>Name</span><input name="name" autocomplete="name" required></label>
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
        <label class="field"><span>Initial password</span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
        <label class="field"><span>Access level</span><select name="role"><option value="staff">Staff</option><option value="admin">Admin</option></select></label>
      </div>
      <button type="submit" class="primary" data-create-user-button>Create account</button>
    </form>
    ${loading ? `<div class="empty">Loading accounts…</div>` : loadError ? `<div class="empty">${esc(loadError)}</div>` : `
      <div class="table-wrap"><table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Access</th></tr></thead><tbody>
        ${users.map((user) => `<tr><td>${esc(user.name || "—")}</td><td>${esc(user.email)}</td><td>${user.role === "admin" ? "Admin" : "Staff"}</td></tr>`).join("") || `<tr><td colspan="3">No user accounts found.</td></tr>`}
      </tbody></table></div>`}
  </section>`;

export function renderAdmin() {
  if (!state.isAdmin) return `<div class="empty">Administrator access is required.</div>`;
  return `
    <div class="admin-view">
      <div class="admin-heading"><h2>Admin</h2><div class="segmented admin-tabs" aria-label="Admin sections">
        <button type="button" data-admin-tab="products" class="${tab === "products" ? "active" : ""}">Custom products</button>
        <button type="button" data-admin-tab="users" class="${tab === "users" ? "active" : ""}">User accounts</button>
      </div></div>
      ${tab === "products" ? productPanel() : usersPanel()}
    </div>`;
}

function repaint() {
  if (state.view === "admin") $("content").innerHTML = renderAdmin();
}

export async function loadAdminData() {
  if (!state.isAdmin) return;
  loading = true;
  loadError = "";
  repaint();
  try {
    const [loadedCategories, loadedProducts, loadedUsers] = await Promise.all([
      loadCategories(), listCustomProducts(), listAdminUsers(),
    ]);
    categories = loadedCategories;
    products = loadedProducts;
    users = loadedUsers;
  } catch (err) {
    loadError = err.message || "Could not load admin data.";
  } finally {
    loading = false;
    repaint();
  }
}

export function initAdmin() {
  if (initialized) return;
  initialized = true;
  const content = $("content");

  content.addEventListener("click", async (event) => {
    if (state.view !== "admin" || !state.isAdmin) return;
    const tabButton = event.target.closest("[data-admin-tab]");
    if (tabButton) {
      tab = tabButton.dataset.adminTab;
      repaint();
      return;
    }
    if (event.target.closest("[data-admin-refresh]")) {
      await loadAdminData();
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