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
  elements.tableVariantOption = document.querySelector("#tableVariantOption");
  elements.tableVariantChoice = document.querySelector("#tableVariantChoice");
  elements.tableCategory = document.querySelector("#tableCategory");
  elements.partsTablePanel = document.querySelector("#partsTablePanel");
  elements.addPartButton = document.querySelector("#addPartButton");
  elements.bulkTools = document.querySelector("#bulkTools");
  elements.bulkSection = document.querySelector("#bulkSection");
  elements.bulkVariantPanel = document.querySelector("#bulkVariantPanel");
  elements.bulkVariantOption = document.querySelector("#bulkVariantOption");
  elements.bulkVariantChoice = document.querySelector("#bulkVariantChoice");
  elements.bulkCategory = document.querySelector("#bulkCategory");
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
    renderTableVariantControls();
    renderPartsTable();
  });

  elements.tableCategory.addEventListener("change", () => {
    renderPartsTable();
  });

  elements.tableVariantOption.addEventListener("change", () => {
    renderTableVariantChoiceOptions();
    renderPartsTable();
  });

  elements.tableVariantChoice.addEventListener("change", () => {
    renderPartsTable();
  });

  elements.bulkSection.addEventListener("change", () => {
    renderVariantControls();
  });

  elements.bulkVariantOption.addEventListener("change", () => {
    renderVariantChoiceOptions();
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
  renderVariantControls();
  renderTableVariantControls();
  renderPartsTable();

  elements.sectionSummary.innerHTML = sections
    .map((section) => {
      const mainCount = section.categories?.main?.length ?? 0;
      const greebleCount = section.categories?.greebles?.length ?? 0;
      const optionSummary = (section.options ?? [])
        .map((option) => `${option.label}: ${option.choices.map((choice) => choice.label).join(", ")}`)
        .join(" • ");
      return `
        <article>
          <strong>${escapeHtml(section.label)}</strong>
          <div class="meta">main: ${mainCount} • greebles: ${greebleCount}</div>
          ${optionSummary ? `<div class="meta">${escapeHtml(optionSummary)}</div>` : ""}
        </article>
      `;
    })
    .join("");
}

function renderVariantControls() {
  const section = getSelectedBulkSection();
  const options = section?.options ?? [];

  if (!options.length) {
    elements.bulkVariantPanel.classList.add("hidden");
    elements.bulkVariantOption.innerHTML = "";
    elements.bulkVariantChoice.innerHTML = "";
    return;
  }

  elements.bulkVariantPanel.classList.remove("hidden");
  elements.bulkVariantOption.innerHTML = options
    .map((option) => `<option value="${option.id}">${option.label}</option>`)
    .join("");
  renderVariantChoiceOptions();
}

function renderTableVariantControls() {
  const section = getSelectedTableSection();
  const options = section?.options ?? [];

  if (!options.length) {
    elements.tableVariantPanel.classList.add("hidden");
    elements.tableVariantOption.innerHTML = "";
    elements.tableVariantChoice.innerHTML = "";
    return;
  }

  elements.tableVariantPanel.classList.remove("hidden");
  elements.tableVariantOption.innerHTML = options
    .map((option) => `<option value="${option.id}">${option.label}</option>`)
    .join("");
  renderTableVariantChoiceOptions();
}

function renderTableVariantChoiceOptions() {
  const section = getSelectedTableSection();
  const optionId = elements.tableVariantOption.value;
  const option = section?.options?.find((item) => item.id === optionId) ?? section?.options?.[0];

  if (!option) {
    elements.tableVariantChoice.innerHTML = "";
    return;
  }

  elements.tableVariantOption.value = option.id;
  elements.tableVariantChoice.innerHTML = option.choices
    .map((choice) => {
      const selected = choice.id === option.defaultChoiceId ? "selected" : "";
      return `<option value="${choice.id}" ${selected}>${choice.label}</option>`;
    })
    .join("");
}

function renderVariantChoiceOptions() {
  const section = getSelectedBulkSection();
  const optionId = elements.bulkVariantOption.value;
  const option = section?.options?.find((item) => item.id === optionId) ?? section?.options?.[0];

  if (!option) {
    elements.bulkVariantChoice.innerHTML = "";
    return;
  }

  elements.bulkVariantOption.value = option.id;
  elements.bulkVariantChoice.innerHTML = option.choices
    .map((choice) => {
      const selected = choice.id === option.defaultChoiceId ? "selected" : "";
      return `<option value="${choice.id}" ${selected}>${choice.label}</option>`;
    })
    .join("");
}

function appendBulkParts() {
  const config = parseEditorConfig();
  if (!config) {
    return;
  }

  const sectionId = elements.bulkSection.value;
  const category = elements.bulkCategory.value;
  const lines = elements.bulkParts.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!sectionId || !category || !lines.length) {
    elements.adminStatus.textContent = "Choose a section and paste at least one part line.";
    return;
  }

  const section = config.sections.find((item) => item.id === sectionId);
  if (!section) {
    elements.adminStatus.textContent = "Selected section was not found in the config.";
    return;
  }

  section.categories = section.categories || {};
  section.categories[category] = section.categories[category] || [];
  const bulkRequirement = buildBulkRequirement(section);

  lines.forEach((line) => {
    const [nameRaw, filesRaw = "", notesRaw = ""] = line.split("|").map((part) => part.trim());
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

    if (bulkRequirement) {
      nextPart.requirements = bulkRequirement;
    }

    section.categories[category].push(nextPart);
  });

  elements.configEditor.value = `${JSON.stringify(config, null, 2)}\n`;
  elements.bulkParts.value = "";
  state.currentConfig.config = config;
  renderCurrentConfig();
  elements.adminStatus.textContent = `Added ${lines.length} part line(s) to ${section.label} / ${category}. Save when ready.`;
}

function buildBulkRequirement(section) {
  const options = section.options ?? [];
  if (!options.length) {
    return null;
  }

  const optionId = elements.bulkVariantOption.value;
  const choiceId = elements.bulkVariantChoice.value;
  if (!optionId || !choiceId) {
    return null;
  }

  return {
    [optionId]: [choiceId]
  };
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
  const category = elements.tableCategory.value;
  state.visiblePartRows = [];

  if (!config || !section) {
    elements.partsTablePanel.innerHTML = '<div class="empty-state">Select a section to edit parts.</div>';
    return;
  }

  const parts = section.categories?.[category] ?? [];
  const variantRequirement = buildTableRequirement(section);
  const rows = [];

  parts.forEach((part, index) => {
    if (!matchesTableVariant(part, variantRequirement)) {
      return;
    }

    state.visiblePartRows.push({
      sectionId: section.id,
      category,
      partIndex: index
    });

    rows.push(`
      <tr>
        <td><input data-row-index="${state.visiblePartRows.length - 1}" data-field="id" value="${escapeHtml(part.id || "")}" /></td>
        <td><input data-row-index="${state.visiblePartRows.length - 1}" data-field="name" value="${escapeHtml(part.name || "")}" /></td>
        <td><input data-row-index="${state.visiblePartRows.length - 1}" data-field="files" value="${escapeHtml((part.files || []).join(", "))}" /></td>
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
  const part = section?.categories?.[rowRef.category]?.[rowRef.partIndex];
  if (!part) {
    return;
  }

  if (field === "files") {
    part.files = target.value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
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
  const category = elements.tableCategory.value;
  if (!config || !section || !category) {
    elements.adminStatus.textContent = "Choose a section and category before adding a row.";
    return;
  }

  section.categories = section.categories || {};
  section.categories[category] = section.categories[category] || [];
  const nextPart = {
    id: `new-part-${section.categories[category].length + 1}`,
    name: "New part",
    files: []
  };

  const requirement = buildTableRequirement(section);
  if (requirement) {
    nextPart.requirements = requirement;
  }

  section.categories[category].push(nextPart);
  updateEditorFromConfig(config);
  renderCurrentConfig();
  elements.adminStatus.textContent = `Added a new part row to ${section.label} / ${category}.`;
}

function deletePartRow(rowIndex) {
  const config = parseEditorConfig();
  const rowRef = state.visiblePartRows[rowIndex];
  if (!config || !rowRef) {
    return;
  }

  const section = config.sections.find((item) => item.id === rowRef.sectionId);
  const parts = section?.categories?.[rowRef.category];
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

  const optionId = elements.tableVariantOption.value;
  const choiceId = elements.tableVariantChoice.value;
  if (!optionId || !choiceId) {
    return null;
  }

  return {
    [optionId]: [choiceId]
  };
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
