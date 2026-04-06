const STORAGE_KEY = "buildr2-state-v1";
const state = {
  profile: null,
  catalog: [],
  droidTypes: new Map(),
  droids: [],
  activeDroidId: null,
  activeSectionId: null
};

const elements = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  captureElements();
  await loadCatalog();
  bindEvents();
  loadPersistedProfile();
  initAuthUi();
  render();
}

function captureElements() {
  elements.authStatus = document.querySelector("#authStatus");
  elements.googleSignIn = document.querySelector("#googleSignIn");
  elements.guestModeButton = document.querySelector("#guestModeButton");
  elements.logoutButton = document.querySelector("#logoutButton");
  elements.newDroidButton = document.querySelector("#newDroidButton");
  elements.newDroidForm = document.querySelector("#newDroidForm");
  elements.newDroidName = document.querySelector("#newDroidName");
  elements.newDroidType = document.querySelector("#newDroidType");
  elements.droidList = document.querySelector("#droidList");
  elements.activeDroidTitle = document.querySelector("#activeDroidTitle");
  elements.sectionHint = document.querySelector("#sectionHint");
  elements.droidCanvas = document.querySelector("#droidCanvas");
  elements.sectionTitle = document.querySelector("#sectionTitle");
  elements.progressPill = document.querySelector("#progressPill");
  elements.sectionOptions = document.querySelector("#sectionOptions");
  elements.partsPanel = document.querySelector("#partsPanel");
}

async function loadCatalog() {
  const response = await fetch("./data/droid-types/index.json");
  const catalog = await response.json();
  state.catalog = catalog;

  const loadedTypes = await Promise.all(
    catalog.map(async (entry) => {
      const typeResponse = await fetch(`./data/droid-types/${entry.file.replace("./", "")}`);
      return typeResponse.json();
    })
  );

  loadedTypes.forEach((type) => {
    state.droidTypes.set(type.id, type);
  });
}

function bindEvents() {
  elements.guestModeButton.addEventListener("click", () => {
    if (!state.profile) {
      setGuestProfile();
    }
  });

  elements.logoutButton.addEventListener("click", () => {
    state.profile = null;
    state.droids = [];
    state.activeDroidId = null;
    state.activeSectionId = null;
    render();
  });

  elements.newDroidButton.addEventListener("click", () => {
    elements.newDroidForm.classList.toggle("hidden");
    if (!elements.newDroidForm.classList.contains("hidden")) {
      elements.newDroidName.focus();
    }
  });

  elements.newDroidForm.addEventListener("submit", (event) => {
    event.preventDefault();
    createDroid({
      name: elements.newDroidName.value.trim(),
      typeId: elements.newDroidType.value
    });
  });
}

function initAuthUi() {
  if (state.profile) {
    return;
  }

  const clientId = window.BUILDR_CONFIG?.googleClientId;
  if (clientId && window.google?.accounts?.id) {
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleGoogleCredential
    });

    window.google.accounts.id.renderButton(elements.googleSignIn, {
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "signin_with"
    });
  } else {
    elements.googleSignIn.innerHTML = "";
  }
}

function handleGoogleCredential(response) {
  const payload = decodeJwt(response.credential);
  if (!payload) {
    return;
  }

  state.profile = {
    id: `google:${payload.sub}`,
    name: payload.name || payload.email,
    email: payload.email,
    mode: "google"
  };

  loadWorkspaceState();
  render();
}

function decodeJwt(token) {
  try {
    const [, payload] = token.split(".");
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

function setGuestProfile() {
  state.profile = {
    id: "guest:local",
    name: "Local workshop",
    email: null,
    mode: "guest"
  };

  loadWorkspaceState();
  render();
}

function loadPersistedProfile() {
  const saved = readStorage();
  const lastProfile = saved.lastProfileId;
  if (!lastProfile) {
    return;
  }

  if (lastProfile === "guest:local") {
    setGuestProfile();
    return;
  }
}

function createDroid({ name, typeId }) {
  if (!state.profile || !name || !typeId) {
    return;
  }

  const type = state.droidTypes.get(typeId);
  const firstSection = type.sections[0]?.id ?? null;
  const droid = {
    id: crypto.randomUUID(),
    name,
    typeId,
    sectionSelections: {},
    optionSelections: buildDefaultOptions(type),
    printedParts: {}
  };

  state.droids.unshift(droid);
  state.activeDroidId = droid.id;
  state.activeSectionId = firstSection;
  persistWorkspaceState();

  elements.newDroidForm.reset();
  elements.newDroidForm.classList.add("hidden");
  render();
}

function buildDefaultOptions(type) {
  const selections = {};

  type.sections.forEach((section) => {
    if (!section.options?.length) {
      return;
    }

    selections[section.id] = {};
    section.options.forEach((option) => {
      selections[section.id][option.id] = option.defaultChoiceId;
    });
  });

  return selections;
}

function loadWorkspaceState() {
  const saved = readStorage();
  const workspace = saved.workspaces?.[state.profile.id] ?? {
    droids: [],
    activeDroidId: null,
    activeSectionId: null
  };

  state.droids = workspace.droids;
  state.activeDroidId = workspace.activeDroidId;
  state.activeSectionId = workspace.activeSectionId;
  normalizeActiveSelection();
}

function persistWorkspaceState() {
  if (!state.profile) {
    return;
  }

  const saved = readStorage();
  const nextState = {
    ...saved,
    lastProfileId: state.profile.id,
    workspaces: {
      ...(saved.workspaces ?? {}),
      [state.profile.id]: {
        droids: state.droids,
        activeDroidId: state.activeDroidId,
        activeSectionId: state.activeSectionId
      }
    }
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
}

function readStorage() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

function render() {
  renderAuth();
  renderNewDroidTypeOptions();
  renderDroidList();
  renderCanvas();
  renderSectionDetails();
}

function renderAuth() {
  if (!state.profile) {
    elements.authStatus.textContent = "Sign in with Google or continue locally.";
    elements.logoutButton.classList.add("hidden");
    elements.guestModeButton.classList.remove("hidden");
    return;
  }

  const label =
    state.profile.mode === "google"
      ? `${state.profile.name} (${state.profile.email})`
      : "Local-only workspace";

  elements.authStatus.textContent = label;
  elements.logoutButton.classList.remove("hidden");
  elements.guestModeButton.classList.add("hidden");
}

function renderNewDroidTypeOptions() {
  elements.newDroidType.innerHTML = state.catalog
    .map((entry) => {
      const type = state.droidTypes.get(entry.id);
      return `<option value="${type.id}">${type.name}</option>`;
    })
    .join("");
}

function renderDroidList() {
  if (!state.profile) {
    elements.droidList.innerHTML = `<div class="empty-state">Choose a login mode to save droids.</div>`;
    return;
  }

  if (!state.droids.length) {
    elements.droidList.innerHTML =
      '<div class="empty-state">No droids yet. Create one to start tracking printed parts.</div>';
    return;
  }

  elements.droidList.innerHTML = state.droids
    .map((droid) => {
      const type = state.droidTypes.get(droid.typeId);
      const progress = summarizeDroidProgress(droid, type);
      const activeClass = droid.id === state.activeDroidId ? "active" : "";

      return `
        <article class="droid-card ${activeClass}" data-droid-id="${droid.id}">
          <header>
            <div>
              <h3>${escapeHtml(droid.name)}</h3>
              <div class="meta">${escapeHtml(type.name)}</div>
            </div>
            <span class="badge ${progress.total > 0 && progress.done === progress.total ? "complete" : ""}">
              <span class="status-dot ${progress.total > 0 && progress.done === progress.total ? "complete" : ""}"></span>
              ${progress.done} / ${progress.total}
            </span>
          </header>
          <footer>
            <span class="meta">${type.sections.length} sections</span>
            <div>
              <button class="pill-button" data-open-droid="${droid.id}">Open</button>
              <button class="ghost-button" data-delete-droid="${droid.id}">Delete</button>
            </div>
          </footer>
        </article>
      `;
    })
    .join("");

  elements.droidList.querySelectorAll("[data-open-droid]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const droidId = event.currentTarget.dataset.openDroid;
      state.activeDroidId = droidId;
      normalizeActiveSelection();
      persistWorkspaceState();
      render();
    });
  });

  elements.droidList.querySelectorAll("[data-droid-id]").forEach((card) => {
    card.addEventListener("click", () => {
      state.activeDroidId = card.dataset.droidId;
      normalizeActiveSelection();
      persistWorkspaceState();
      render();
    });
  });

  elements.droidList.querySelectorAll("[data-delete-droid]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const droidId = event.currentTarget.dataset.deleteDroid;
      state.droids = state.droids.filter((droid) => droid.id !== droidId);

      if (state.activeDroidId === droidId) {
        state.activeDroidId = state.droids[0]?.id ?? null;
      }

      normalizeActiveSelection();
      persistWorkspaceState();
      render();
    });
  });
}

function summarizeDroidProgress(droid, type) {
  const allParts = type.sections.flatMap((section) => getVisibleParts(section, droid.optionSelections?.[section.id] ?? {}));
  const total = allParts.length;
  const done = allParts.filter((part) => droid.printedParts?.[part.id]).length;
  return { total, done };
}

function renderCanvas() {
  const droid = getActiveDroid();
  if (!droid) {
    elements.activeDroidTitle.textContent = "Pick a droid to begin";
    elements.sectionHint.textContent = "Hover and click a section to inspect parts.";
    elements.droidCanvas.classList.add("empty-state");
    elements.droidCanvas.textContent = "Select or create a droid to load its build map.";
    return;
  }

  const type = state.droidTypes.get(droid.typeId);
  elements.activeDroidTitle.textContent = droid.name;
  elements.sectionHint.textContent = type.description;
  elements.droidCanvas.classList.remove("empty-state");
  elements.droidCanvas.innerHTML = buildSvgMarkup(type, state.activeSectionId);

  elements.droidCanvas.querySelectorAll(".droid-region").forEach((region) => {
    region.addEventListener("click", () => {
      state.activeSectionId = region.dataset.sectionId;
      persistWorkspaceState();
      renderSectionDetails();
      updateActiveRegionState();
    });
  });
}

function buildSvgMarkup(type, activeSectionId) {
  const regions = type.visual.regions
    .map((region) => {
      const attrs = buildShapeAttributes(region);
      const activeClass = region.sectionId === activeSectionId ? "is-active" : "";
      const label = region.label
        ? `<text class="svg-label" x="${region.label.x}" y="${region.label.y}" text-anchor="middle">${region.label.text}</text>`
        : "";
      return `
        <g>
          <${region.type}
            class="droid-region ${activeClass}"
            data-section-id="${region.sectionId}"
            ${attrs}
          ></${region.type}>
          ${label}
        </g>
      `;
    })
    .join("");

  return `
    <svg class="droid-svg" viewBox="${type.visual.viewBox}" role="img" aria-label="${escapeHtml(type.name)} build map">
      <defs>
        <linearGradient id="shellGlow" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="rgba(255,255,255,0.9)" />
          <stop offset="100%" stop-color="rgba(13,124,134,0.08)" />
        </linearGradient>
      </defs>
      <rect x="58" y="36" width="204" height="460" rx="84" fill="url(#shellGlow)" opacity="0.45"></rect>
      ${regions}
    </svg>
  `;
}

function buildShapeAttributes(region) {
  if (region.type === "rect") {
    return `x="${region.x}" y="${region.y}" width="${region.width}" height="${region.height}" rx="${region.rx ?? 0}"`;
  }

  if (region.type === "circle") {
    return `cx="${region.cx}" cy="${region.cy}" r="${region.r}"`;
  }

  return `d="${region.d}"`;
}

function updateActiveRegionState() {
  elements.droidCanvas.querySelectorAll(".droid-region").forEach((node) => {
    node.classList.toggle("is-active", node.dataset.sectionId === state.activeSectionId);
  });
}

function renderSectionDetails() {
  const droid = getActiveDroid();
  if (!droid) {
    elements.sectionTitle.textContent = "Choose a section";
    elements.progressPill.textContent = "0 / 0 printed";
    elements.sectionOptions.innerHTML = "";
    elements.partsPanel.className = "parts-panel empty-state";
    elements.partsPanel.textContent = "Parts for the selected section will appear here.";
    return;
  }

  const type = state.droidTypes.get(droid.typeId);
  const section = type.sections.find((item) => item.id === state.activeSectionId) ?? type.sections[0];
  if (!section) {
    return;
  }

  state.activeSectionId = section.id;
  const selectedOptions = droid.optionSelections?.[section.id] ?? {};
  const visibleParts = getVisibleParts(section, selectedOptions);
  const completed = visibleParts.filter((part) => droid.printedParts?.[part.id]).length;

  elements.sectionTitle.textContent = section.label;
  elements.progressPill.textContent = `${completed} / ${visibleParts.length} printed`;

  renderSectionOptions(section, selectedOptions);
  renderParts(section, selectedOptions, droid);
}

function renderSectionOptions(section, selectedOptions) {
  if (!section.options?.length) {
    elements.sectionOptions.innerHTML = "";
    return;
  }

  elements.sectionOptions.innerHTML = section.options
    .map((option) => {
      const choices = option.choices
        .map((choice) => {
          const selected = selectedOptions[option.id] === choice.id ? "selected" : "";
          return `<option value="${choice.id}" ${selected}>${choice.label}</option>`;
        })
        .join("");

      return `
        <div class="option-card">
          <div class="option-group">
            <label>
              ${option.label}
              <select data-option-id="${option.id}">
                ${choices}
              </select>
            </label>
          </div>
        </div>
      `;
    })
    .join("");

  elements.sectionOptions.querySelectorAll("[data-option-id]").forEach((select) => {
    select.addEventListener("change", (event) => {
      const activeDroid = getActiveDroid();
      const optionId = event.currentTarget.dataset.optionId;
      activeDroid.optionSelections[section.id][optionId] = event.currentTarget.value;
      persistWorkspaceState();
      renderSectionDetails();
      renderDroidList();
    });
  });
}

function renderParts(section, selectedOptions, droid) {
  const categories = ["main", "greebles"];
  const html = categories
    .map((categoryName) => {
      const parts = filterParts(section.categories?.[categoryName] ?? [], selectedOptions);
      if (!parts.length) {
        return `
          <div class="category-block">
            <h3>${titleCase(categoryName)}</h3>
            <div class="empty-state">No parts match the current options.</div>
          </div>
        `;
      }

      const cards = parts
        .map((part) => {
          const checked = droid.printedParts?.[part.id] ? "checked" : "";
          const files = (part.files ?? []).map((file) => `<code>${escapeHtml(file)}</code>`).join("");
          return `
            <article class="part-card">
              <header>
                <div>
                  <h4>${escapeHtml(part.name)}</h4>
                  <div class="meta">${escapeHtml(part.id)}</div>
                </div>
                <span class="badge ${checked ? "complete" : ""}">${checked ? "Printed" : "Pending"}</span>
              </header>
              ${part.notes ? `<div class="part-notes">${escapeHtml(part.notes)}</div>` : ""}
              ${files ? `<div class="part-files">${files}</div>` : ""}
              <label class="checkbox-row">
                Printed
                <input type="checkbox" data-part-id="${part.id}" ${checked} />
              </label>
            </article>
          `;
        })
        .join("");

      return `
        <section class="category-block">
          <h3>${titleCase(categoryName)}</h3>
          ${cards}
        </section>
      `;
    })
    .join("");

  elements.partsPanel.className = "parts-panel";
  elements.partsPanel.innerHTML = html;

  elements.partsPanel.querySelectorAll("[data-part-id]").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const partId = event.currentTarget.dataset.partId;
      droid.printedParts[partId] = event.currentTarget.checked;
      persistWorkspaceState();
      renderSectionDetails();
      renderDroidList();
    });
  });
}

function getVisibleParts(section, selectedOptions) {
  const categories = ["main", "greebles"];
  return categories.flatMap((name) => filterParts(section.categories?.[name] ?? [], selectedOptions));
}

function filterParts(parts, selectedOptions) {
  return parts.filter((part) => {
    if (!part.requirements) {
      return true;
    }

    return Object.entries(part.requirements).every(([optionId, allowedChoices]) =>
      allowedChoices.includes(selectedOptions[optionId])
    );
  });
}

function normalizeActiveSelection() {
  const activeDroid = getActiveDroid();
  if (!activeDroid) {
    state.activeDroidId = state.droids[0]?.id ?? null;
  }

  const current = getActiveDroid();
  if (!current) {
    state.activeSectionId = null;
    return;
  }

  const type = state.droidTypes.get(current.typeId);
  const sectionIds = new Set(type.sections.map((section) => section.id));
  if (!sectionIds.has(state.activeSectionId)) {
    state.activeSectionId = type.sections[0]?.id ?? null;
  }
}

function getActiveDroid() {
  return state.droids.find((droid) => droid.id === state.activeDroidId) ?? null;
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
