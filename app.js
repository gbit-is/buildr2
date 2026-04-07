const LAST_PROFILE_KEY = "buildr2-last-profile";
const LOCAL_WORKSPACE_KEY = "buildr2-guest-workspace";
const GOOGLE_PROFILE_KEY = "buildr2-google-profile";

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
  await loadPersistedProfile();
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
  elements.guestModeButton.addEventListener("click", async () => {
    if (!state.profile) {
      await setGuestProfile();
    }
  });

  elements.logoutButton.addEventListener("click", () => {
    state.profile = null;
    state.droids = [];
    state.activeDroidId = null;
    state.activeSectionId = null;
    localStorage.removeItem(LAST_PROFILE_KEY);
    localStorage.removeItem(GOOGLE_PROFILE_KEY);
    render();
  });

  elements.newDroidButton.addEventListener("click", () => {
    elements.newDroidForm.classList.toggle("hidden");
    if (!elements.newDroidForm.classList.contains("hidden")) {
      elements.newDroidName.focus();
    }
  });

  elements.newDroidForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await createDroid({
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

async function handleGoogleCredential(response) {
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

  localStorage.setItem(LAST_PROFILE_KEY, state.profile.id);
  localStorage.setItem(GOOGLE_PROFILE_KEY, JSON.stringify(state.profile));
  await loadWorkspaceState();
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

async function setGuestProfile() {
  state.profile = {
    id: "guest:local",
    name: "Local workshop",
    email: null,
    mode: "guest"
  };

  localStorage.setItem(LAST_PROFILE_KEY, state.profile.id);
  await loadWorkspaceState();
  render();
}

async function loadPersistedProfile() {
  const lastProfile = localStorage.getItem(LAST_PROFILE_KEY);
  if (!lastProfile) {
    return;
  }

  if (lastProfile === "guest:local") {
    await setGuestProfile();
    return;
  }

  if (lastProfile.startsWith("google:")) {
    const savedProfile = readStoredGoogleProfile();
    if (savedProfile?.id === lastProfile) {
      state.profile = savedProfile;
      await loadWorkspaceState();
      render();
      return;
    }

    localStorage.removeItem(LAST_PROFILE_KEY);
    localStorage.removeItem(GOOGLE_PROFILE_KEY);
  }
}

async function createDroid({ name, typeId }) {
  if (!state.profile || !name || !typeId) {
    return;
  }

  const type = state.droidTypes.get(typeId);
  const firstSection = type.sections[0]?.id ?? null;
  const droid = {
    id: crypto.randomUUID(),
    name,
    typeId,
    optionSelections: buildDefaultOptions(type),
    printedParts: {}
  };

  state.droids.unshift(droid);
  state.activeDroidId = droid.id;
  state.activeSectionId = firstSection;
  await persistWorkspaceState();

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

async function loadWorkspaceState() {
  if (!state.profile) {
    return;
  }

  const workspace =
    state.profile.mode === "guest"
      ? readLocalWorkspace()
      : await fetchWorkspace(state.profile.id);
  state.droids = workspace.droids ?? [];
  state.activeDroidId = workspace.activeDroidId ?? null;
  state.activeSectionId = workspace.activeSectionId ?? null;
  normalizeActiveSelection();
}

async function persistWorkspaceState() {
  if (!state.profile) {
    return;
  }

  const workspace = {
    droids: state.droids,
    activeDroidId: state.activeDroidId,
    activeSectionId: state.activeSectionId
  };

  if (state.profile.mode === "guest") {
    writeLocalWorkspace(workspace);
    return;
  }

  await saveWorkspace(state.profile.id, workspace);
}

async function fetchWorkspace(profileId) {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(profileId)}`);
  if (!response.ok) {
    throw new Error(`Failed to load workspace for ${profileId}`);
  }

  return response.json();
}

async function saveWorkspace(profileId, workspace) {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(profileId)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(workspace)
  });

  if (!response.ok) {
    throw new Error(`Failed to save workspace for ${profileId}`);
  }
}

function readLocalWorkspace() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_WORKSPACE_KEY)) ?? emptyWorkspace();
  } catch {
    return emptyWorkspace();
  }
}

function writeLocalWorkspace(workspace) {
  localStorage.setItem(LOCAL_WORKSPACE_KEY, JSON.stringify(workspace));
}

function readStoredGoogleProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(GOOGLE_PROFILE_KEY));
    if (!saved || saved.mode !== "google" || !saved.id) {
      return null;
    }

    return saved;
  } catch {
    return null;
  }
}

function emptyWorkspace() {
  return {
    droids: [],
    activeDroidId: null,
    activeSectionId: null
  };
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
    button.addEventListener("click", async (event) => {
      const droidId = event.currentTarget.dataset.openDroid;
      state.activeDroidId = droidId;
      normalizeActiveSelection();
      await persistWorkspaceState();
      render();
    });
  });

  elements.droidList.querySelectorAll("[data-droid-id]").forEach((card) => {
    card.addEventListener("click", async () => {
      state.activeDroidId = card.dataset.droidId;
      normalizeActiveSelection();
      await persistWorkspaceState();
      render();
    });
  });

  elements.droidList.querySelectorAll("[data-delete-droid]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const droidId = event.currentTarget.dataset.deleteDroid;
      state.droids = state.droids.filter((droid) => droid.id !== droidId);

      if (state.activeDroidId === droidId) {
        state.activeDroidId = state.droids[0]?.id ?? null;
      }

      normalizeActiveSelection();
      await persistWorkspaceState();
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
  elements.droidCanvas.innerHTML = buildImageMapMarkup(type, state.activeSectionId);

  elements.droidCanvas.querySelectorAll(".droid-hotspot").forEach((hotspot) => {
    hotspot.addEventListener("click", async () => {
      state.activeSectionId = hotspot.dataset.sectionId;
      await persistWorkspaceState();
      renderSectionDetails();
      updateActiveRegionState();
    });

    hotspot.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      state.activeSectionId = hotspot.dataset.sectionId;
      await persistWorkspaceState();
      renderSectionDetails();
      updateActiveRegionState();
    });
  });
}

function buildImageMapMarkup(type, activeSectionId) {
  const { image, hotspots } = type.visual;
  const hotspotMarkup = hotspots
    .map((hotspot) => {
      return buildHotspotShapeMarkup(hotspot, activeSectionId);
    })
    .join("");

  return `
    <div class="droid-image-map" style="--image-aspect:${image.width} / ${image.height};">
      <img class="droid-photo" src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt || type.name)}" />
      <svg
        class="droid-hotspots"
        viewBox="0 0 ${image.width} ${image.height}"
        aria-label="${escapeHtml(type.name)} selector"
        role="group"
      >
        ${hotspotMarkup}
      </svg>
    </div>
  `;
}

function buildHotspotShapeMarkup(hotspot, activeSectionId) {
  const isActive = hotspot.sectionId === activeSectionId ? "is-active" : "";
  const label = escapeHtml(hotspot.label || hotspot.sectionId);
  const shape = normalizeHotspotShape(hotspot);
  const shapeMarkup = renderHotspotShape(shape);
  const labelMarkup = renderHotspotLabel(shape, label);

  return `
    <g
      class="droid-hotspot ${isActive}"
      data-section-id="${hotspot.sectionId}"
      role="button"
      tabindex="0"
      aria-label="${label}"
    >
      <title>${label}</title>
      ${shapeMarkup}
      ${labelMarkup}
    </g>
  `;
}

function normalizeHotspotShape(hotspot) {
  if (hotspot.shape && hotspot.coords) {
    if (hotspot.shape === "rect") {
      const [x1, y1, x2, y2] = hotspot.coords;
      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      const right = Math.max(x1, x2);
      const bottom = Math.max(y1, y2);
      return {
        type: "rect",
        x: left,
        y: top,
        width: right - left,
        height: bottom - top
      };
    }

    if (hotspot.shape === "circle") {
      const [cx, cy, r] = hotspot.coords;
      return {
        type: "circle",
        cx,
        cy,
        r
      };
    }

    if (hotspot.shape === "poly") {
      return {
        type: "poly",
        points: hotspot.coords
      };
    }
  }

  return {
    type: "rect",
    x: hotspot.x,
    y: hotspot.y,
    width: hotspot.width,
    height: hotspot.height
  };
}

function renderHotspotShape(shape) {
  if (shape.type === "circle") {
    return `<circle class="hotspot-shape" cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}"></circle>`;
  }

  if (shape.type === "poly") {
    return `<polygon class="hotspot-shape" points="${shape.points.join(" ")}"></polygon>`;
  }

  return `<rect class="hotspot-shape" x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="24"></rect>`;
}

function renderHotspotLabel(shape, label) {
  const center = getShapeCenter(shape);
  const labelWidth = Math.max(108, label.length * 8 + 22);
  return `
    <g class="hotspot-label-group" aria-hidden="true">
      <rect class="hotspot-label-bg" x="${center.x - labelWidth / 2}" y="${center.y - 16}" width="${labelWidth}" height="32" rx="16"></rect>
      <text class="hotspot-label" x="${center.x}" y="${center.y + 4}" text-anchor="middle">${label}</text>
    </g>
  `;
}

function getShapeCenter(shape) {
  if (shape.type === "circle") {
    return { x: shape.cx, y: shape.cy };
  }

  if (shape.type === "poly") {
    const pairs = [];
    for (let index = 0; index < shape.points.length; index += 2) {
      pairs.push({ x: shape.points[index], y: shape.points[index + 1] });
    }

    const total = pairs.reduce(
      (accumulator, point) => ({
        x: accumulator.x + point.x,
        y: accumulator.y + point.y
      }),
      { x: 0, y: 0 }
    );

    return {
      x: total.x / pairs.length,
      y: total.y / pairs.length
    };
  }

  return {
    x: shape.x + shape.width / 2,
    y: shape.y + shape.height / 2
  };
}

function updateActiveRegionState() {
  elements.droidCanvas.querySelectorAll(".droid-hotspot").forEach((node) => {
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
    select.addEventListener("change", async (event) => {
      const activeDroid = getActiveDroid();
      const optionId = event.currentTarget.dataset.optionId;
      activeDroid.optionSelections[section.id][optionId] = event.currentTarget.value;
      await persistWorkspaceState();
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
    checkbox.addEventListener("change", async (event) => {
      const partId = event.currentTarget.dataset.partId;
      droid.printedParts[partId] = event.currentTarget.checked;
      await persistWorkspaceState();
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
