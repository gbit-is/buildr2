const state = {
  session: null,
  catalog: [],
  selectedTypeId: null,
  currentConfig: null,
  visiblePartRows: []
};

const elements = {};

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
  elements.typePickerPanel = document.querySelector("#typePickerPanel");
  elements.typePicker = document.querySelector("#typePicker");
  elements.typeMeta = document.querySelector("#typeMeta");
  elements.sectionSummary = document.querySelector("#sectionSummary");
  elements.tableTools = document.querySelector("#tableTools");
  elements.tableSection = document.querySelector("#tableSection");
  elements.tableVariantPanel = document.querySelector("#tableVariantPanel");
  elements.tableVariantGroups = document.querySelector("#tableVariantGroups");
  elements.tableCategory = document.querySelector("#tableCategory");
  elements.tableCategoryPaths = document.querySelector("#tableCategoryPaths");
  elements.partsTablePanel = document.querySelector("#partsTablePanel");
  elements.addPartButton = document.querySelector("#addPartButton");
  elements.bulkTools = document.querySelector("#bulkTools");
  elements.bulkSection = document.querySelector("#bulkSection");
  elements.bulkVariantPanel = document.querySelector("#bulkVariantPanel");
  elements.bulkVariantGroups = document.querySelector("#bulkVariantGroups");
  elements.bulkCategory = document.querySelector("#bulkCategory");
  elements.bulkCategoryPaths = document.querySelector("#bulkCategoryPaths");
  elements.bulkParts = document.querySelector("#bulkParts");
  elements.appendPartsButton = document.querySelector("#appendPartsButton");
  elements.configEditor = document.querySelector("#configEditor");
  elements.saveConfigButton = document.querySelector("#saveConfigButton");
}

function bindEvents() {
  elements.adminLogoutButton.addEventListener("click", async () => {
    await fetch("/api/admin/logout", {
      method: "POST"
    });
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

  elements.tableSection.addEventListener("change", () => {
    renderCategoryInputs();
    renderTableVariantControls();
    renderPartsTable();
  });

  elements.tableCategory.addEventListener("change", () => {
    renderPartsTable();
  });

  elements.bulkSection.addEventListener("change", () => {
    renderCategoryInputs();
    renderVariantControls();
  });

  elements.tableVariantGroups.addEventListener("change", () => {
    renderPartsTable();
  });

  elements.bulkVariantGroups.addEventListener("change", () => {
    // selections are read lazily when appending/importing
  });

  elements.tableVariantGroups.addEventListener("click", (event) => {
    handleVariantAction(event, "table");
  });

  elements.bulkVariantGroups.addEventListener("click", (event) => {
    handleVariantAction(event, "bulk");
  });

  elements.appendPartsButton.addEventListener("click", () => {
    appendBulkParts();
  });

  elements.addPartButton.addEventListener("click", () => {
    addPartRow();
  });

  elements.partsTablePanel.addEventListener("input", (event) => {
    handleTableInput(event);
  });

  elements.partsTablePanel.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-row]");
    if (!button) {
      return;
    }

    deletePartRow(Number(button.dataset.deleteRow));
  });

  elements.saveConfigButton.addEventListener("click", async () => {
    await saveCurrentConfig();
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
  render();
}

function render(sessionInfo = null) {
  if (!state.session) {
    const adminEnabled = sessionInfo?.adminEnabled ?? true;
    elements.adminStatus.textContent = adminEnabled
      ? "Sign in with an allowed Google account."
      : "Admin mode is disabled on this server.";
    elements.adminLogoutButton.classList.add("hidden");
    elements.typePickerPanel.classList.add("hidden");
    elements.tableTools.classList.add("hidden");
    elements.bulkTools.classList.add("hidden");
    elements.addPartButton.classList.add("hidden");
    elements.appendPartsButton.classList.add("hidden");
    elements.saveConfigButton.classList.add("hidden");
    elements.adminNotice.classList.remove("hidden");
    elements.configEditor.value = "";
    elements.configEditor.disabled = true;
    elements.sectionSummary.innerHTML = "";
    elements.partsTablePanel.innerHTML = "";
    state.visiblePartRows = [];
    elements.bulkVariantPanel.classList.add("hidden");
    elements.tableVariantPanel.classList.add("hidden");
    elements.bulkVariantGroups.innerHTML = "";
    elements.tableVariantGroups.innerHTML = "";
    return;
  }

  elements.adminStatus.textContent = `${state.session.name} (${state.session.email})`;
  elements.adminLogoutButton.classList.remove("hidden");
  elements.typePickerPanel.classList.remove("hidden");
  elements.tableTools.classList.remove("hidden");
  elements.bulkTools.classList.remove("hidden");
  elements.addPartButton.classList.remove("hidden");
  elements.appendPartsButton.classList.remove("hidden");
  elements.saveConfigButton.classList.remove("hidden");
  elements.adminNotice.classList.add("hidden");
  elements.configEditor.disabled = false;

  renderTypePicker();
  renderCurrentConfig();
}

function renderTypePicker() {
  elements.typePicker.innerHTML = state.catalog
    .map((item) => {
      const selected = item.id === state.selectedTypeId ? "selected" : "";
      return `<option value="${item.id}" ${selected}>${item.name}</option>`;
    })
    .join("");
}

function renderCurrentConfig() {
  if (!state.currentConfig) {
    elements.typeMeta.textContent = "Select a droid type to begin editing.";
    elements.sectionSummary.innerHTML = "";
    elements.configEditor.value = "";
    elements.bulkSection.innerHTML = "";
    elements.tableSection.innerHTML = "";
    elements.partsTablePanel.innerHTML = "";
    state.visiblePartRows = [];
    elements.bulkVariantPanel.classList.add("hidden");
    elements.tableVariantPanel.classList.add("hidden");
    elements.bulkVariantGroups.innerHTML = "";
    elements.tableVariantGroups.innerHTML = "";
    return;
  }

  const { entry, filePath, config } = state.currentConfig;
  elements.typeMeta.textContent = `${entry.name} • ${filePath}`;
  elements.configEditor.value = `${JSON.stringify(config, null, 2)}\n`;

  const sections = config.sections ?? [];
  elements.bulkSection.innerHTML = sections
    .map((section) => `<option value="${section.id}">${section.label}</option>`)
    .join("");
  elements.tableSection.innerHTML = sections
    .map((section) => `<option value="${section.id}">${section.label}</option>`)
    .join("");
  renderCategoryInputs();
  renderVariantControls();
  renderTableVariantControls();
  renderPartsTable();

  elements.sectionSummary.innerHTML = sections
    .map((section) => {
      const categorySummary = listCategoryLeafPaths(section.categories)
        .map((entry) => `${entry.display}: ${entry.parts.length}`)
        .join(" • ");
      const optionSummary = (section.options ?? [])
        .map((option) => `${option.label}: ${option.choices.map((choice) => choice.label).join(", ")}`)
        .join(" • ");
      return `
        <article>
          <strong>${escapeHtml(section.label)}</strong>
          <div class="meta">${escapeHtml(categorySummary || "No category paths yet")}</div>
          ${optionSummary ? `<div class="meta">${escapeHtml(optionSummary)}</div>` : ""}
        </article>
      `;
    })
    .join("");
}

function renderCategoryInputs() {
  const tableSection = getSelectedTableSection();
  const bulkSection = getSelectedBulkSection();
  syncCategoryInput(elements.tableCategory, elements.tableCategoryPaths, tableSection);
  syncCategoryInput(elements.bulkCategory, elements.bulkCategoryPaths, bulkSection);
}

function syncCategoryInput(input, datalist, section) {
  const paths = listCategoryLeafPaths(section?.categories);
  datalist.innerHTML = paths
    .map((entry) => `<option value="${escapeHtml(entry.display)}"></option>`)
    .join("");

  if (!input.value.trim()) {
    input.value = paths[0]?.display || "main";
    return;
  }

  const normalized = normalizeCategoryPath(input.value);
  if (!normalized.length) {
    input.value = paths[0]?.display || "main";
    return;
  }

  input.value = normalized.join(" / ");
}

function renderVariantControls() {
  const section = getSelectedBulkSection();
  const options = section?.options ?? [];

  if (!options.length) {
    elements.bulkVariantPanel.classList.add("hidden");
    elements.bulkVariantGroups.innerHTML = "";
    return;
  }

  elements.bulkVariantPanel.classList.remove("hidden");
  elements.bulkVariantGroups.innerHTML = renderVariantGroups("bulk", options);
}

function renderTableVariantControls() {
  const section = getSelectedTableSection();
  const options = section?.options ?? [];

  if (!options.length) {
    elements.tableVariantPanel.classList.add("hidden");
    elements.tableVariantGroups.innerHTML = "";
    return;
  }

  elements.tableVariantPanel.classList.remove("hidden");
  elements.tableVariantGroups.innerHTML = renderVariantGroups("table", options);
}

function renderVariantGroups(prefix, options) {
  return options
    .map((option) => {
      const groupName = `${prefix}-variant-${option.id}`;
      const choices = option.choices
        .map((choice) =>
          renderVariantChoiceLine(
            groupName,
            choice,
            choice.id === option.defaultChoiceId,
            option.id,
            option.choices.length > 1
          )
        )
        .join("");

      return `
        <section class="variant-group" data-option-id="${option.id}">
          <div class="variant-group-header">
            <div class="variant-group-title">${escapeHtml(option.label)}</div>
            <button
              type="button"
              class="pill-button variant-action-button"
              data-add-variant="${option.id}"
              data-source="${prefix}"
            >
              Add variant
            </button>
          </div>
          <div class="variant-choice-list">${choices}</div>
        </section>
      `;
    })
    .join("");
}

function renderVariantChoiceLine(groupName, choice, checked, optionId, canDelete) {
  return `
    <div class="variant-choice-line">
      <label class="variant-choice-select">
        <input type="radio" name="${groupName}" value="${choice.id}" data-option-id="${optionId}" ${checked ? "checked" : ""} />
        <span>${escapeHtml(choice.label)}</span>
      </label>
      <button
        type="button"
        class="ghost-button variant-delete-button"
        data-delete-variant="${optionId}:${choice.id}"
        ${canDelete ? "" : "disabled"}
      >
        Delete
      </button>
    </div>
  `;
}

function handleVariantAction(event, source) {
  const addButton = event.target.closest("[data-add-variant]");
  if (addButton) {
    addVariantChoice(addButton.dataset.addVariant, source);
    return;
  }

  const deleteButton = event.target.closest("[data-delete-variant]");
  if (deleteButton) {
    const [optionId, choiceId] = String(deleteButton.dataset.deleteVariant || "").split(":");
    if (optionId && choiceId) {
      deleteVariantChoice(optionId, choiceId, source);
    }
  }
}

function addVariantChoice(optionId, source) {
  const config = parseEditorConfig();
  const section = source === "table" ? getSelectedTableSection() : getSelectedBulkSection();
  if (!config || !section) {
    return;
  }

  const option = section.options?.find((item) => item.id === optionId);
  if (!option) {
    elements.adminStatus.textContent = "Variant option not found.";
    return;
  }

  const label = window.prompt(`New variant label for ${option.label}:`);
  if (!label) {
    return;
  }

  const trimmedLabel = label.trim();
  if (!trimmedLabel) {
    return;
  }

  let baseId = slugify(trimmedLabel);
  if (!baseId) {
    baseId = `variant-${option.choices.length + 1}`;
  }

  let nextId = baseId;
  let index = 2;
  const existingIds = new Set(option.choices.map((choice) => choice.id));
  while (existingIds.has(nextId)) {
    nextId = `${baseId}-${index}`;
    index += 1;
  }

  option.choices.push({
    id: nextId,
    label: trimmedLabel
  });

  updateEditorFromConfig(config);
  renderCurrentConfig();
  selectVariantChoice(source, optionId, nextId);
  elements.adminStatus.textContent = `Added variant "${trimmedLabel}" to ${option.label}. Save when ready.`;
}

function deleteVariantChoice(optionId, choiceId, source) {
  const config = parseEditorConfig();
  const section = source === "table" ? getSelectedTableSection() : getSelectedBulkSection();
  if (!config || !section) {
    return;
  }

  const option = section.options?.find((item) => item.id === optionId);
  if (!option) {
    elements.adminStatus.textContent = "Variant option not found.";
    return;
  }

  if ((option.choices?.length ?? 0) <= 1) {
    elements.adminStatus.textContent = "Each option must keep at least one variant.";
    return;
  }

  const choice = option.choices.find((item) => item.id === choiceId);
  if (!choice) {
    return;
  }

  option.choices = option.choices.filter((item) => item.id !== choiceId);
  if (option.defaultChoiceId === choiceId) {
    option.defaultChoiceId = option.choices[0]?.id ?? null;
  }

  removeVariantChoiceReferences(config, section.id, optionId, choiceId);
  updateEditorFromConfig(config);
  renderCurrentConfig();
  selectVariantChoice(source, optionId, option.defaultChoiceId);
  elements.adminStatus.textContent = `Deleted variant "${choice.label}" from ${option.label}. Save when ready.`;
}

function removeVariantChoiceReferences(config, sectionId, optionId, choiceId) {
  const section = config.sections?.find((item) => item.id === sectionId);
  if (!section) {
    return;
  }

  iterateCategoryParts(section.categories, (part) => {
    if (!part.requirements?.[optionId]) {
      return;
    }

    const nextChoices = part.requirements[optionId].filter((value) => value !== choiceId);
    if (nextChoices.length) {
      part.requirements[optionId] = nextChoices;
    } else {
      delete part.requirements[optionId];
    }

    if (!Object.keys(part.requirements).length) {
      delete part.requirements;
    }
  });
}

function selectVariantChoice(source, optionId, choiceId) {
  if (!choiceId) {
    return;
  }

  const container = source === "table" ? elements.tableVariantGroups : elements.bulkVariantGroups;
  const input = container.querySelector(
    `input[type="radio"][data-option-id="${CSS.escape(optionId)}"][value="${CSS.escape(choiceId)}"]`
  );
  if (input) {
    input.checked = true;
  }
}

function appendBulkParts() {
  const config = parseEditorConfig();
  if (!config) {
    return;
  }

  const sectionId = elements.bulkSection.value;
  const categoryPath = normalizeCategoryPath(elements.bulkCategory.value);
  const lines = elements.bulkParts.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!sectionId || !categoryPath.length || !lines.length) {
    elements.adminStatus.textContent = "Choose a section and paste at least one part line.";
    return;
  }

  const section = config.sections.find((item) => item.id === sectionId);
  if (!section) {
    elements.adminStatus.textContent = "Selected section was not found in the config.";
    return;
  }

  const parts = getOrCreateCategoryParts(section, categoryPath);
  const bulkRequirement = buildBulkRequirement(section);

  lines.forEach((line) => {
    const [nameRaw, filesRaw = "", notesRaw = "", quantityRaw = ""] = line.split("|").map((part) => part.trim());
    const name = nameRaw;
    if (!name) {
      return;
    }

    const files = filesRaw
      .split(",")
      .map((file) => file.trim())
      .filter(Boolean);

    const nextPart = {
      id: slugify(name),
      name
    };

    if (files.length) {
      nextPart.files = files;
    }

    if (notesRaw) {
      nextPart.notes = notesRaw;
    }

    const quantity = parsePositiveQuantity(quantityRaw);
    if (quantity > 1) {
      nextPart.quantity = quantity;
    }

    if (bulkRequirement) {
      nextPart.requirements = bulkRequirement;
    }

    parts.push(nextPart);
  });

  elements.configEditor.value = `${JSON.stringify(config, null, 2)}\n`;
  elements.bulkParts.value = "";
  state.currentConfig.config = config;
  renderCurrentConfig();
  elements.adminStatus.textContent = `Added ${lines.length} part line(s) to ${section.label} / ${categoryPath.join(" / ")}. Save when ready.`;
}

function buildBulkRequirement(section) {
  const options = section.options ?? [];
  if (!options.length) {
    return null;
  }

  return buildRequirementsFromContainer(elements.bulkVariantGroups);
}

function getSelectedBulkSection() {
  const config = parseEditorConfig(true);
  if (!config) {
    return null;
  }

  return config.sections?.find((section) => section.id === elements.bulkSection.value) ?? null;
}

function getSelectedTableSection() {
  const config = parseEditorConfig(true);
  if (!config) {
    return null;
  }

  return config.sections?.find((section) => section.id === elements.tableSection.value) ?? null;
}

function renderPartsTable() {
  const config = parseEditorConfig(true);
  const section = getSelectedTableSection();
  const categoryPath = normalizeCategoryPath(elements.tableCategory.value);
  state.visiblePartRows = [];

  if (!config || !section) {
    elements.partsTablePanel.innerHTML = '<div class="empty-state">Select a section to edit parts.</div>';
    return;
  }

  if (!categoryPath.length) {
    elements.partsTablePanel.innerHTML = '<div class="empty-state">Enter a category path like "main" or "greebles / psis".</div>';
    return;
  }

  const parts = getCategoryParts(section, categoryPath);
  const variantRequirement = buildTableRequirement(section);
  const rows = [];

  parts.forEach((part, index) => {
    if (!matchesTableVariant(part, variantRequirement)) {
      return;
    }

    state.visiblePartRows.push({
      sectionId: section.id,
      categoryPath,
      partIndex: index
    });

    rows.push(`
      <tr>
        <td><input data-row-index="${state.visiblePartRows.length - 1}" data-field="id" value="${escapeHtml(part.id || "")}" /></td>
        <td><input data-row-index="${state.visiblePartRows.length - 1}" data-field="name" value="${escapeHtml(part.name || "")}" /></td>
        <td><input data-row-index="${state.visiblePartRows.length - 1}" data-field="files" value="${escapeHtml((part.files || []).join(", "))}" /></td>
        <td><input type="number" min="1" step="1" data-row-index="${state.visiblePartRows.length - 1}" data-field="quantity" value="${getPartQuantityValue(part)}" /></td>
        <td><textarea data-row-index="${state.visiblePartRows.length - 1}" data-field="notes">${escapeHtml(part.notes || "")}</textarea></td>
        <td>${renderRequirementBadge(part.requirements, variantRequirement)}</td>
        <td class="row-actions"><button class="ghost-button" data-delete-row="${state.visiblePartRows.length - 1}">Delete</button></td>
      </tr>
    `);
  });

  if (!rows.length) {
    elements.partsTablePanel.innerHTML = '<div class="empty-state">No parts for this section/category/variant yet.</div>';
    return;
  }

  elements.partsTablePanel.innerHTML = `
    <table class="parts-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Name</th>
          <th>Files</th>
          <th>Qty</th>
          <th>Notes</th>
          <th>Variant</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows.join("")}
      </tbody>
    </table>
  `;
}

function matchesTableVariant(part, variantRequirement) {
  if (!variantRequirement) {
    return true;
  }

  if (!part.requirements) {
    return true;
  }

  return Object.entries(variantRequirement).every(([optionId, allowedChoices]) =>
    Array.isArray(part.requirements[optionId]) &&
    part.requirements[optionId].some((choice) => allowedChoices.includes(choice))
  );
}

function renderRequirementBadge(requirements, variantRequirement) {
  if (!requirements) {
    return '<span class="variant-chip">Shared</span>';
  }

  const [optionId, choices] = Object.entries(requirements)[0] ?? [];
  if (!optionId || !choices?.length) {
    return '<span class="variant-chip">Shared</span>';
  }

  const selected = variantRequirement?.[optionId]?.[0];
  const label = choices.join(", ");
  const chip = selected && choices.includes(selected) ? label : `${optionId}: ${label}`;
  return `<span class="variant-chip">${escapeHtml(chip)}</span>`;
}

function handleTableInput(event) {
  const target = event.target;
  const rowIndex = Number(target.dataset.rowIndex);
  const field = target.dataset.field;
  if (Number.isNaN(rowIndex) || !field) {
    return;
  }

  const config = parseEditorConfig(true);
  const rowRef = state.visiblePartRows[rowIndex];
  if (!config || !rowRef) {
    return;
  }

  const section = config.sections.find((item) => item.id === rowRef.sectionId);
  const part = getCategoryParts(section, rowRef.categoryPath)[rowRef.partIndex];
  if (!part) {
    return;
  }

  if (field === "files") {
    part.files = target.value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  } else if (field === "quantity") {
    const quantity = parsePositiveQuantity(target.value);
    if (quantity > 1) {
      part.quantity = quantity;
    } else {
      delete part.quantity;
    }
  } else if (field === "notes") {
    if (target.value.trim()) {
      part.notes = target.value;
    } else {
      delete part.notes;
    }
  } else {
    part[field] = target.value;
  }

  updateEditorFromConfig(config);
}

function addPartRow() {
  const config = parseEditorConfig();
  const section = getSelectedTableSection();
  const categoryPath = normalizeCategoryPath(elements.tableCategory.value);
  if (!config || !section || !categoryPath.length) {
    elements.adminStatus.textContent = "Choose a section and category before adding a row.";
    return;
  }

  const parts = getOrCreateCategoryParts(section, categoryPath);
  const nextPart = {
    id: `new-part-${parts.length + 1}`,
    name: "New part",
    files: []
  };

  const requirement = buildTableRequirement(section);
  if (requirement) {
    nextPart.requirements = requirement;
  }

  parts.push(nextPart);
  updateEditorFromConfig(config);
  renderCurrentConfig();
  elements.adminStatus.textContent = `Added a new part row to ${section.label} / ${categoryPath.join(" / ")}.`;
}

function deletePartRow(rowIndex) {
  const config = parseEditorConfig();
  const rowRef = state.visiblePartRows[rowIndex];
  if (!config || !rowRef) {
    return;
  }

  const section = config.sections.find((item) => item.id === rowRef.sectionId);
  const parts = getCategoryParts(section, rowRef.categoryPath);
  if (!parts) {
    return;
  }

  parts.splice(rowRef.partIndex, 1);
  updateEditorFromConfig(config);
  renderCurrentConfig();
  elements.adminStatus.textContent = "Deleted part row. Save when ready.";
}

function buildTableRequirement(section) {
  const options = section.options ?? [];
  if (!options.length) {
    return null;
  }

  return buildRequirementsFromContainer(elements.tableVariantGroups);
}

async function saveCurrentConfig() {
  if (!state.currentConfig) {
    return;
  }

  const config = parseEditorConfig();
  if (!config) {
    return;
  }

  const response = await fetch(`/api/admin/droid-types/${encodeURIComponent(state.selectedTypeId)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(config)
  });

  const payload = await response.json();
  if (!response.ok) {
    elements.adminStatus.textContent = payload.message || "Failed to save config.";
    return;
  }

  state.currentConfig.config = config;
  renderCurrentConfig();
  elements.adminStatus.textContent = `Saved ${state.selectedTypeId} at ${payload.updatedAt}.`;
}

function parseEditorConfigInternal(silent) {
  try {
    return JSON.parse(elements.configEditor.value);
  } catch (error) {
    if (!silent) {
      elements.adminStatus.textContent = `JSON error: ${error.message}`;
    }
    return null;
  }
}

function parseEditorConfig(silent = false) {
  return parseEditorConfigInternal(silent);
}

function updateEditorFromConfig(config) {
  elements.configEditor.value = `${JSON.stringify(config, null, 2)}\n`;
  state.currentConfig.config = config;
}

function parsePositiveQuantity(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function getPartQuantityValue(part) {
  return parsePositiveQuantity(part?.quantity ?? 1);
}

function buildRequirementsFromContainer(container) {
  const checkedInputs = Array.from(container.querySelectorAll('input[type="radio"]:checked'));
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

function normalizeCategoryPath(value) {
  return String(value || "")
    .split(/\/|>/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function listCategoryLeafPaths(categories, path = []) {
  if (!categories || typeof categories !== "object") {
    return [];
  }

  const entries = [];
  Object.entries(categories).forEach(([key, value]) => {
    const nextPath = [...path, key];
    if (Array.isArray(value)) {
      entries.push({
        path: nextPath,
        display: nextPath.join(" / "),
        parts: value
      });
      return;
    }

    if (value && typeof value === "object") {
      entries.push(...listCategoryLeafPaths(value, nextPath));
    }
  });

  return entries;
}

function getCategoryParts(section, categoryPath) {
  if (!section || !Array.isArray(categoryPath) || !categoryPath.length) {
    return [];
  }

  let node = section.categories ?? {};
  for (let index = 0; index < categoryPath.length; index += 1) {
    const segment = categoryPath[index];
    const value = node?.[segment];
    if (index === categoryPath.length - 1) {
      return Array.isArray(value) ? value : [];
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }

    node = value;
  }

  return [];
}

function getOrCreateCategoryParts(section, categoryPath) {
  section.categories = section.categories || {};
  let node = section.categories;

  categoryPath.forEach((segment, index) => {
    const isLeaf = index === categoryPath.length - 1;
    if (isLeaf) {
      if (!Array.isArray(node[segment])) {
        node[segment] = [];
      }
      return;
    }

    if (!node[segment] || typeof node[segment] !== "object" || Array.isArray(node[segment])) {
      node[segment] = {};
    }

    node = node[segment];
  });

  return node[categoryPath[categoryPath.length - 1]];
}

function iterateCategoryParts(categories, visit) {
  if (!categories || typeof categories !== "object") {
    return;
  }

  Object.values(categories).forEach((value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (value && typeof value === "object") {
      iterateCategoryParts(value, visit);
    }
  });
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
