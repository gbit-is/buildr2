const state = {
  session: null,
  catalog: [],
  selectedTypeId: null,
  currentConfig: null,
  activeTab: "edit",
  expandedNodes: {}
};

const elements = {};
const DIRECT_PARTS_KEY = "__parts";

document.addEventListener("DOMContentLoaded", init);

async function init() {
  captureElements();
  bindEvents();
  await refreshSession();
  initGoogleButton();
}

function captureElements() {
  elements.adminStatus = document.querySelector("#adminStatus");
  elements.adminGoogleSignIn = document.querySelector("#adminGoogleSignIn");
  elements.adminLogoutButton = document.querySelector("#adminLogoutButton");
  elements.adminNotice = document.querySelector("#adminNotice");
  elements.adminWorkspace = document.querySelector("#adminWorkspace");
  elements.typePicker = document.querySelector("#typePicker");
  elements.typeMeta = document.querySelector("#typeMeta");
  elements.validateJsonButton = document.querySelector("#validateJsonButton");
  elements.saveConfigButton = document.querySelector("#saveConfigButton");
  elements.tabButtons = Array.from(document.querySelectorAll("[data-tab]"));
  elements.editTabPanel = document.querySelector("#editTabPanel");
  elements.importTabPanel = document.querySelector("#importTabPanel");
  elements.jsonTabPanel = document.querySelector("#jsonTabPanel");
  elements.editSection = document.querySelector("#editSection");
  elements.editPath = document.querySelector("#editPath");
  elements.editPathList = document.querySelector("#editPathList");
  elements.addFolderButton = document.querySelector("#addFolderButton");
  elements.addPartButton = document.querySelector("#addPartButton");
  elements.editTree = document.querySelector("#editTree");
  elements.importSection = document.querySelector("#importSection");
  elements.importPath = document.querySelector("#importPath");
  elements.importPathList = document.querySelector("#importPathList");
  elements.importVariantPanel = document.querySelector("#importVariantPanel");
  elements.importVariantGroups = document.querySelector("#importVariantGroups");
  elements.importText = document.querySelector("#importText");
  elements.appendImportButton = document.querySelector("#appendImportButton");
  elements.configEditor = document.querySelector("#configEditor");
}

function bindEvents() {
  elements.adminLogoutButton.addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    state.session = null;
    state.catalog = [];
    state.selectedTypeId = null;
    state.currentConfig = null;
    render();
  });

  elements.typePicker.addEventListener("change", async (event) => {
    state.selectedTypeId = event.currentTarget.value;
    await loadSelectedConfig();
  });

  elements.tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      renderTabs();
    });
  });

  elements.editSection.addEventListener("change", () => {
    syncPathInputs();
    renderEditTree();
  });

  elements.importSection.addEventListener("change", () => {
    syncPathInputs();
    renderImportVariantControls();
  });

  elements.addFolderButton.addEventListener("click", () => {
    addFolderPath();
  });

  elements.addPartButton.addEventListener("click", () => {
    addPartAtCurrentPath();
  });

  elements.appendImportButton.addEventListener("click", () => {
    appendImportParts();
  });

  elements.validateJsonButton.addEventListener("click", () => {
    validateJsonEditor();
  });

  elements.saveConfigButton.addEventListener("click", async () => {
    await saveCurrentConfig();
  });

  elements.editTree.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-toggle-node]");
    if (toggle) {
      const key = toggle.dataset.toggleNode;
      state.expandedNodes[key] = !isNodeExpanded(key);
      renderEditTree();
      return;
    }

    const deleteButton = event.target.closest("[data-delete-part]");
    if (deleteButton) {
      deletePart(deleteButton.dataset.deletePart, Number(deleteButton.dataset.partIndex));
    }
  });

  elements.editTree.addEventListener("input", (event) => {
    const target = event.target.closest("[data-part-field]");
    if (!target) {
      return;
    }

    updatePartField(
      target.dataset.partPath,
      Number(target.dataset.partIndex),
      target.dataset.partField,
      target.value
    );
  });
}

async function refreshSession() {
  const response = await fetch("/api/admin/session");
  const session = await response.json();
  state.session = session.authenticated ? session.user : null;

  if (session.authenticated) {
    await loadCatalog();
  }

  render(session);
}

function initGoogleButton() {
  const clientId = window.BUILDR_CONFIG?.googleClientId;
  if (!clientId || !window.google?.accounts?.id) {
    return;
  }

  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: handleGoogleCredential
  });

  window.google.accounts.id.renderButton(elements.adminGoogleSignIn, {
    theme: "outline",
    size: "large",
    shape: "pill",
    text: "signin_with"
  });
}

async function handleGoogleCredential(response) {
  const loginResponse = await fetch("/api/admin/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      credential: response.credential
    })
  });

  const payload = await loginResponse.json();
  if (!loginResponse.ok) {
    elements.adminStatus.textContent = payload.message || "Admin login failed.";
    return;
  }

  state.session = payload.user;
  await loadCatalog();
  render();
}

async function loadCatalog() {
  const response = await fetch("/api/admin/droid-types");
  const payload = await response.json();
  state.catalog = payload.items ?? [];
  state.selectedTypeId = state.selectedTypeId || state.catalog[0]?.id || null;
  if (state.selectedTypeId) {
    await loadSelectedConfig();
  }
}

async function loadSelectedConfig() {
  if (!state.selectedTypeId) {
    state.currentConfig = null;
    render();
    return;
  }

  const response = await fetch(`/api/admin/droid-types/${encodeURIComponent(state.selectedTypeId)}`);
  const payload = await response.json();
  if (!response.ok) {
    elements.adminStatus.textContent = payload.message || "Failed to load config.";
    return;
  }

  state.currentConfig = payload;
  syncEditorFromState();
  render();
}

function render(sessionInfo = null) {
  if (!state.session) {
    const adminEnabled = sessionInfo?.adminEnabled ?? true;
    elements.adminStatus.textContent = adminEnabled
      ? "Sign in with an allowed Google account."
      : "Admin mode is disabled on this server.";
    elements.adminLogoutButton.classList.add("hidden");
    elements.adminNotice.classList.remove("hidden");
    elements.adminWorkspace.classList.add("hidden");
    elements.configEditor.value = "";
    return;
  }

  elements.adminStatus.textContent = `${state.session.name} (${state.session.email})`;
  elements.adminLogoutButton.classList.remove("hidden");
  elements.adminNotice.classList.add("hidden");
  elements.adminWorkspace.classList.remove("hidden");

  renderTypePicker();
  renderTabs();
  renderConfigUi();
}

function renderTypePicker() {
  elements.typePicker.innerHTML = state.catalog
    .map((item) => {
      const selected = item.id === state.selectedTypeId ? "selected" : "";
      return `<option value="${item.id}" ${selected}>${escapeHtml(item.name)}</option>`;
    })
    .join("");
}

function renderTabs() {
  elements.tabButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === state.activeTab);
  });

  elements.editTabPanel.classList.toggle("hidden", state.activeTab !== "edit");
  elements.importTabPanel.classList.toggle("hidden", state.activeTab !== "import");
  elements.jsonTabPanel.classList.toggle("hidden", state.activeTab !== "json");
}

function renderConfigUi() {
  if (!state.currentConfig) {
    elements.typeMeta.textContent = "Select a droid type to begin editing.";
    elements.editTree.innerHTML = '<div class="admin-tree-empty">Select a droid type to load its config.</div>';
    return;
  }

  const { entry, filePath, config } = state.currentConfig;
  elements.typeMeta.textContent = `${entry.name} • ${filePath}`;

  const sections = config.sections ?? [];
  const optionsMarkup = sections
    .map((section) => `<option value="${section.id}">${escapeHtml(section.label)}</option>`)
    .join("");

  elements.editSection.innerHTML = optionsMarkup;
  elements.importSection.innerHTML = optionsMarkup;

  if (!elements.editSection.value && sections[0]) {
    elements.editSection.value = sections[0].id;
  }

  if (!elements.importSection.value && sections[0]) {
    elements.importSection.value = sections[0].id;
  }

  if (![...sections.map((section) => section.id)].includes(elements.editSection.value) && sections[0]) {
    elements.editSection.value = sections[0].id;
  }

  if (![...sections.map((section) => section.id)].includes(elements.importSection.value) && sections[0]) {
    elements.importSection.value = sections[0].id;
  }

  syncPathInputs();
  renderImportVariantControls();
  renderEditTree();
}

function syncEditorFromState() {
  if (!state.currentConfig?.config) {
    elements.configEditor.value = "";
    return;
  }

  elements.configEditor.value = `${JSON.stringify(state.currentConfig.config, null, 2)}\n`;
}

function validateJsonEditor() {
  const parsed = parseJsonEditor();
  if (!parsed) {
    return false;
  }

  state.currentConfig.config = parsed;
  syncEditorFromState();
  renderConfigUi();
  elements.adminStatus.textContent = "JSON is valid.";
  return true;
}

async function saveCurrentConfig() {
  if (!state.currentConfig) {
    return;
  }

  const parsed = parseJsonEditor();
  if (!parsed) {
    return;
  }

  const response = await fetch(`/api/admin/droid-types/${encodeURIComponent(state.selectedTypeId)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(parsed)
  });

  const payload = await response.json();
  if (!response.ok) {
    elements.adminStatus.textContent = payload.message || "Failed to save config.";
    return;
  }

  state.currentConfig.config = parsed;
  syncEditorFromState();
  renderConfigUi();
  elements.adminStatus.textContent = `Saved ${state.selectedTypeId} at ${payload.updatedAt}.`;
}

function parseJsonEditor() {
  try {
    return JSON.parse(elements.configEditor.value);
  } catch (error) {
    elements.adminStatus.textContent = `JSON error: ${error.message}`;
    state.activeTab = "json";
    renderTabs();
    return null;
  }
}

function syncPathInputs() {
  const editSection = getSelectedEditSection();
  const importSection = getSelectedImportSection();
  syncPathInput(elements.editPath, elements.editPathList, editSection);
  syncPathInput(elements.importPath, elements.importPathList, importSection);
}

function renderImportVariantControls() {
  const section = getSelectedImportSection();
  const options = section?.options ?? [];

  if (!options.length) {
    elements.importVariantPanel.classList.add("hidden");
    elements.importVariantGroups.innerHTML = "";
    return;
  }

  elements.importVariantPanel.classList.remove("hidden");
  elements.importVariantGroups.innerHTML = options
    .map((option) => {
      const groupName = `import-variant-${option.id}`;
      const choices = option.choices
        .map((choice) => {
          const checked = choice.id === option.defaultChoiceId ? "checked" : "";
          return `
            <label class="admin-v2-variant-choice">
              <input type="radio" name="${groupName}" value="${choice.id}" data-option-id="${option.id}" ${checked} />
              <span>${escapeHtml(choice.label)}</span>
            </label>
          `;
        })
        .join("");

      return `
        <section class="admin-v2-variant-group">
          <div class="admin-v2-variant-title">${escapeHtml(option.label)}</div>
          ${choices}
        </section>
      `;
    })
    .join("");
}

function syncPathInput(input, datalist, section) {
  const paths = listCategoryPaths(section?.categories);
  datalist.innerHTML = paths.map((path) => `<option value="${escapeHtml(path.join(" / "))}"></option>`).join("");

  const normalized = normalizePath(input.value);
  if (normalized.length) {
    input.value = normalized.join(" / ");
    return;
  }

  input.value = paths[0]?.join(" / ") || "main";
}

function renderEditTree() {
  const section = getSelectedEditSection();
  if (!section) {
    elements.editTree.innerHTML = '<div class="admin-tree-empty">Choose a section to start editing.</div>';
    return;
  }

  const markup = renderTreeEntries(section, section.categories ?? {}, []);
  elements.editTree.innerHTML = markup || '<div class="admin-tree-empty">No folders or parts in this section yet.</div>';
}

function renderTreeEntries(section, node, path) {
  if (!node || typeof node !== "object") {
    return "";
  }

  return Object.entries(node)
    .map(([name, value]) => {
      if (name === DIRECT_PARTS_KEY && Array.isArray(value)) {
        return value
          .map((part, index) => renderPartEditor(section, path, part, index, path.length))
          .join("");
      }

      return renderTreeNode(section, name, value, [...path, name]);
    })
    .join("");
}

function renderTreeNode(section, name, value, path) {
  const depth = Math.max(0, path.length - 1);
  const key = buildPathKey(section.id, path);
  const expanded = isNodeExpanded(key);

  if (Array.isArray(value)) {
    const partCount = value.length;
    const children = expanded
      ? value
          .map((part, index) => renderPartEditor(section, path, part, index, depth + 1))
          .join("")
      : "";

    return `
      <section class="admin-tree-group">
        <button type="button" class="admin-tree-folder-row" data-toggle-node="${escapeHtml(key)}" style="--tree-depth:${depth};">
          <div class="admin-tree-folder-main">
            <span class="admin-tree-toggle" aria-hidden="true">${expanded ? "▾" : "▸"}</span>
            <span class="admin-tree-folder-icon" aria-hidden="true">${expanded ? "[-]" : "[+]"}</span>
            <span class="admin-tree-folder-name">${escapeHtml(titleCase(name))}</span>
          </div>
          <span class="admin-tree-folder-count">${partCount} part${partCount === 1 ? "" : "s"}</span>
        </button>
        ${expanded ? `<div class="admin-tree-children">${children}</div>` : ""}
      </section>
    `;
  }

  const childCount = countNestedParts(value);
  const children = expanded ? renderTreeEntries(section, value, path) : "";
  return `
    <section class="admin-tree-group">
      <button type="button" class="admin-tree-folder-row" data-toggle-node="${escapeHtml(key)}" style="--tree-depth:${depth};">
        <div class="admin-tree-folder-main">
          <span class="admin-tree-toggle" aria-hidden="true">${expanded ? "▾" : "▸"}</span>
          <span class="admin-tree-folder-icon" aria-hidden="true">${expanded ? "[-]" : "[+]"}</span>
          <span class="admin-tree-folder-name">${escapeHtml(titleCase(name))}</span>
        </div>
        <span class="admin-tree-folder-count">${childCount} part${childCount === 1 ? "" : "s"}</span>
      </button>
      ${expanded ? `<div class="admin-tree-children">${children}</div>` : ""}
    </section>
  `;
}

function renderPartEditor(section, path, part, index, depth) {
  const pathLabel = path.join(" / ");
  const key = buildPathKey(section.id, path);
  return `
    <article class="admin-tree-part" style="--tree-depth:${depth};">
      <div class="admin-tree-part-main">
        <span class="admin-tree-file-icon" aria-hidden="true">[]</span>
        <div class="admin-tree-part-meta">
          <div class="admin-tree-part-name">${escapeHtml(part.name || "Unnamed part")}</div>
          <div class="admin-tree-part-id">${escapeHtml(part.id || "")}</div>
          <div class="admin-tree-path">${escapeHtml(pathLabel)}</div>
        </div>
      </div>
      <div class="admin-tree-part-actions">
        <button
          type="button"
          class="ghost-button"
          data-delete-part="${escapeHtml(key)}"
          data-part-index="${index}"
        >
          Delete
        </button>
      </div>
      <div class="admin-tree-editor" style="--tree-depth:${depth};">
        <div class="admin-tree-editor-grid">
          <label class="admin-inline-field">
            <span>ID</span>
            <input data-part-path="${escapeHtml(key)}" data-part-index="${index}" data-part-field="id" value="${escapeHtml(part.id || "")}" />
          </label>
          <label class="admin-inline-field">
            <span>Name</span>
            <input data-part-path="${escapeHtml(key)}" data-part-index="${index}" data-part-field="name" value="${escapeHtml(part.name || "")}" />
          </label>
          <label class="admin-inline-field">
            <span>Files</span>
            <input
              data-part-path="${escapeHtml(key)}"
              data-part-index="${index}"
              data-part-field="files"
              value="${escapeHtml((part.files || []).join(", "))}"
            />
          </label>
          <label class="admin-inline-field">
            <span>Quantity</span>
            <input
              type="number"
              min="1"
              step="1"
              data-part-path="${escapeHtml(key)}"
              data-part-index="${index}"
              data-part-field="quantity"
              value="${getQuantityValue(part)}"
            />
          </label>
        </div>
        <label class="admin-inline-field">
          <span>Notes</span>
          <textarea data-part-path="${escapeHtml(key)}" data-part-index="${index}" data-part-field="notes">${escapeHtml(
            part.notes || ""
          )}</textarea>
        </label>
      </div>
    </article>
  `;
}

function addFolderPath() {
  const config = getConfig();
  const section = getSelectedEditSection();
  const path = normalizePath(elements.editPath.value);
  if (!config || !section || !path.length) {
    elements.adminStatus.textContent = "Choose a section and path first.";
    return;
  }

  ensureFolderPath(section, path);
  updateStateConfig(config);
  elements.adminStatus.textContent = `Added folder path ${path.join(" / ")}.`;
}

function addPartAtCurrentPath() {
  const config = getConfig();
  const section = getSelectedEditSection();
  const path = normalizePath(elements.editPath.value);
  if (!config || !section || !path.length) {
    elements.adminStatus.textContent = "Choose a section and path first.";
    return;
  }

  const parts = getOrCreatePartsArray(section, path);
  parts.push({
    id: `new-part-${parts.length + 1}`,
    name: "New part",
    files: []
  });

  updateStateConfig(config);
  elements.adminStatus.textContent = `Added a part to ${path.join(" / ")}.`;
}

function appendImportParts() {
  const config = getConfig();
  const section = getSelectedImportSection();
  const path = normalizePath(elements.importPath.value);
  const requirements = buildImportRequirements();
  const lines = elements.importText.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!config || !section || !path.length || !lines.length) {
    elements.adminStatus.textContent = "Choose a section, choose a path, and paste at least one part line.";
    return;
  }

  const parts = getOrCreatePartsArray(section, path);
  lines.forEach((line) => {
    const [nameRaw, filesRaw = "", notesRaw = "", quantityRaw = ""] = line.split("|").map((item) => item.trim());
    if (!nameRaw) {
      return;
    }

    const nextPart = {
      id: slugify(nameRaw),
      name: nameRaw,
      files: filesRaw
        .split(",")
        .map((file) => file.trim())
        .filter(Boolean)
    };

    if (notesRaw) {
      nextPart.notes = notesRaw;
    }

    const quantity = parsePositiveQuantity(quantityRaw);
    if (quantity > 1) {
      nextPart.quantity = quantity;
    }

    if (requirements) {
      nextPart.requirements = cloneRequirements(requirements);
    }

    parts.push(nextPart);
  });

  elements.importText.value = "";
  updateStateConfig(config);
  elements.adminStatus.textContent = `Imported ${lines.length} line(s) into ${path.join(" / ")}.`;
}

function buildImportRequirements() {
  const checkedInputs = Array.from(elements.importVariantGroups.querySelectorAll('input[type="radio"]:checked'));
  if (!checkedInputs.length) {
    return null;
  }

  const requirements = {};
  checkedInputs.forEach((input) => {
    const optionId = input.dataset.optionId;
    if (!optionId) {
      return;
    }

    requirements[optionId] = [input.value];
  });

  return Object.keys(requirements).length ? requirements : null;
}

function cloneRequirements(requirements) {
  return Object.fromEntries(
    Object.entries(requirements).map(([optionId, values]) => [optionId, [...values]])
  );
}

function updatePartField(pathKey, index, field, rawValue) {
  const config = getConfig();
  const [sectionId, ...path] = parsePathKey(pathKey);
  const section = config?.sections?.find((item) => item.id === sectionId);
  const parts = getPartsAtPath(section, path);
  const part = parts[index];
  if (!part) {
    return;
  }

  if (field === "files") {
    part.files = rawValue
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  } else if (field === "quantity") {
    const quantity = parsePositiveQuantity(rawValue);
    if (quantity > 1) {
      part.quantity = quantity;
    } else {
      delete part.quantity;
    }
  } else if (field === "notes") {
    if (rawValue.trim()) {
      part.notes = rawValue;
    } else {
      delete part.notes;
    }
  } else {
    part[field] = rawValue;
  }

  updateStateConfig(config, false);
}

function deletePart(pathKey, index) {
  const config = getConfig();
  const [sectionId, ...path] = parsePathKey(pathKey);
  const section = config?.sections?.find((item) => item.id === sectionId);
  const parts = getPartsAtPath(section, path);
  if (!parts[index]) {
    return;
  }

  parts.splice(index, 1);
  updateStateConfig(config);
  elements.adminStatus.textContent = "Deleted part.";
}

function updateStateConfig(config, rerenderTree = true) {
  state.currentConfig.config = config;
  syncEditorFromState();
  syncPathInputs();
  if (rerenderTree) {
    renderEditTree();
  }
}

function getConfig() {
  return state.currentConfig?.config ?? null;
}

function getSelectedEditSection() {
  return getConfig()?.sections?.find((section) => section.id === elements.editSection.value) ?? null;
}

function getSelectedImportSection() {
  return getConfig()?.sections?.find((section) => section.id === elements.importSection.value) ?? null;
}

function normalizePath(value) {
  return String(value || "")
    .split(/\/|>/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function listCategoryPaths(categories, path = [], paths = []) {
  if (!categories || typeof categories !== "object") {
    return paths;
  }

  Object.entries(categories).forEach(([name, value]) => {
    if (name == DIRECT_PARTS_KEY && Array.isArray(value)) {
      if (path.length) {
        paths.push([...path]);
      }
      return;
    }

    const nextPath = [...path, name];
    paths.push(nextPath);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      listCategoryPaths(value, nextPath, paths);
    }
  });

  return paths;
}

function ensureFolderPath(section, path) {
  section.categories = section.categories || {};
  let node = section.categories;

  path.forEach((segment, index) => {
    const isLeaf = index === path.length - 1;
    if (isLeaf) {
      if (Array.isArray(node[segment])) {
        node[segment] = {
          [DIRECT_PARTS_KEY]: node[segment]
        };
      } else if (!node[segment]) {
        node[segment] = {};
      }
      return;
    }

    if (!node[segment] || Array.isArray(node[segment])) {
      node[segment] = {};
    }

    node = node[segment];
  });
}

function getOrCreatePartsArray(section, path) {
  section.categories = section.categories || {};
  let node = section.categories;

  path.forEach((segment, index) => {
    const isLeaf = index === path.length - 1;
    if (isLeaf) {
      if (Array.isArray(node[segment])) {
        return;
      }

      if (node[segment] && typeof node[segment] === "object") {
        node[segment][DIRECT_PARTS_KEY] = node[segment][DIRECT_PARTS_KEY] || [];
        return;
      }

      node[segment] = [];
      return;
    }

    if (!node[segment] || typeof node[segment] !== "object" || Array.isArray(node[segment])) {
      node[segment] = {};
    }

    node = node[segment];
  });

  const leaf = node[path[path.length - 1]];
  if (Array.isArray(leaf)) {
    return leaf;
  }

  if (leaf && typeof leaf === "object") {
    leaf[DIRECT_PARTS_KEY] = leaf[DIRECT_PARTS_KEY] || [];
    return leaf[DIRECT_PARTS_KEY];
  }

  return [];
}

function getPartsAtPath(section, path) {
  if (!section || !path.length) {
    return [];
  }

  let node = section.categories ?? {};
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    const value = node?.[segment];
    if (index === path.length - 1) {
      if (Array.isArray(value)) {
        return value;
      }

      if (value && typeof value === "object") {
        return Array.isArray(value[DIRECT_PARTS_KEY]) ? value[DIRECT_PARTS_KEY] : [];
      }

      return [];
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }
    node = value;
  }

  return [];
}

function countNestedParts(node) {
  if (Array.isArray(node)) {
    return node.length;
  }

  if (!node || typeof node !== "object") {
    return 0;
  }

  return Object.values(node).reduce((sum, child) => sum + countNestedParts(child), 0);
}

function buildPathKey(sectionId, path) {
  return [sectionId, ...path].join("/");
}

function parsePathKey(key) {
  return String(key || "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function isNodeExpanded(key) {
  if (!(key in state.expandedNodes)) {
    state.expandedNodes[key] = true;
  }

  return state.expandedNodes[key];
}

function getQuantityValue(part) {
  return parsePositiveQuantity(part?.quantity ?? 1);
}

function parsePositiveQuantity(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleCase(value) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
