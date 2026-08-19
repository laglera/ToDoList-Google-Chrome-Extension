"use strict";

const STORAGE_KEY = "tasks";
const PROJECTS_KEY = "projects";
const THEME_KEY = "theme";

/** Id especial del filtro "Todas" (no es un proyecto real) */
const ALL_ID = "__all__";

const form = document.getElementById("new-task-form");
const input = document.getElementById("new-task-input");
const list = document.getElementById("task-list");
const counter = document.getElementById("counter");
const emptyState = document.getElementById("empty-state");
const template = document.getElementById("task-template");
const themeButton = document.getElementById("theme-button");
const projectsNav = document.getElementById("projects");
const railIconTemplate = document.getElementById("rail-icon-template");
const projectEditTemplate = document.getElementById("project-edit-template");

/** @type {{id: string, text: string, completed: boolean, projectId: string|null}[]} */
let tasks = [];

/** @type {{id: string, name: string, icon?: string|null}[]} */
let projects = [];

/** Proyecto activo: ALL_ID, null (sin proyecto) o el id de un proyecto */
let selectedProjectId = ALL_ID;

/** Tema elegido a mano ("light" | "dark"), o null si se sigue al sistema */
let theme = null;

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

/* --- Idioma --- */

/**
 * Devuelve el mensaje traducido, o `fallback` si no hay traducción.
 * getMessage se llama sin el segundo argumento cuando no hay sustituciones:
 * pasarle un array vacío puede devolver cadena vacía.
 */
function msg(key, fallback = "", ...substitutions) {
  const text = substitutions.length
    ? chrome.i18n.getMessage(key, substitutions)
    : chrome.i18n.getMessage(key);

  if (text) return text;
  console.warn(`i18n: falta el mensaje "${key}"; se usa el texto por defecto`);
  return fallback;
}

/**
 * Traduce el marcado: data-i18n rellena el texto y data-i18n-<attr> el atributo.
 * El texto que ya trae el HTML hace de red de seguridad, así que la interfaz
 * nunca queda en blanco aunque falte una traducción.
 */
function applyI18n(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    el.textContent = msg(el.dataset.i18n, el.textContent);
  }
  for (const attr of ["placeholder", "title", "aria-label"]) {
    const dataAttr = `data-i18n-${attr}`;
    for (const el of root.querySelectorAll(`[${dataAttr}]`)) {
      el.setAttribute(attr, msg(el.getAttribute(dataAttr), el.getAttribute(attr) ?? ""));
    }
  }
}

/* --- Persistencia --- */

async function loadTasks() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const stored = data[STORAGE_KEY];
  tasks = Array.isArray(stored) ? stored : [];
}

async function saveTasks() {
  await chrome.storage.local.set({ [STORAGE_KEY]: tasks });
}

async function loadProjects() {
  const data = await chrome.storage.local.get(PROJECTS_KEY);
  const stored = data[PROJECTS_KEY];
  projects = Array.isArray(stored) ? stored : [];
}

async function saveProjects() {
  await chrome.storage.local.set({ [PROJECTS_KEY]: projects });
}

/* --- Tema --- */

async function loadTheme() {
  const data = await chrome.storage.local.get(THEME_KEY);
  theme = data[THEME_KEY] === "light" || data[THEME_KEY] === "dark" ? data[THEME_KEY] : null;
}

/** Deja siempre un data-theme explícito para que el icono refleje el tema real */
function applyTheme() {
  const effective = theme ?? (systemDark.matches ? "dark" : "light");
  document.documentElement.dataset.theme = effective;
  themeButton.title =
    effective === "dark"
      ? msg("themeToLight", "Cambiar a tema claro")
      : msg("themeToDark", "Cambiar a tema oscuro");
  themeButton.setAttribute("aria-label", themeButton.title);
}

async function toggleTheme() {
  theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme();
  await chrome.storage.local.set({ [THEME_KEY]: theme });
}

/* --- Acciones --- */

async function addTask(text) {
  const projectId = selectedProjectId === ALL_ID ? null : selectedProjectId;
  tasks.push({ id: crypto.randomUUID(), text, completed: false, projectId });
  await saveTasks();
  renderTasks();
}

async function toggleTask(id) {
  const task = tasks.find((item) => item.id === id);
  if (!task) return;
  task.completed = !task.completed;
  await saveTasks();
  renderTasks();
}

async function deleteTask(id) {
  tasks = tasks.filter((item) => item.id !== id);
  await saveTasks();
  renderTasks();
}

async function editTask(id, text) {
  const task = tasks.find((item) => item.id === id);
  if (!task || task.text === text) return;
  task.text = text;
  await saveTasks();
  renderTasks();
}

/* --- Proyectos --- */

async function addProject(name, icon) {
  const project = { id: crypto.randomUUID(), name, icon: icon ?? null };
  projects.push(project);
  await saveProjects();
  selectedProjectId = project.id;
  isAddingProject = false;
  render();
}

async function updateProject(id, name, icon) {
  const project = projects.find((item) => item.id === id);
  if (!project) return;
  project.name = name;
  project.icon = icon;
  await saveProjects();
  editingProjectId = null;
  render();
}

async function deleteProject(id) {
  projects = projects.filter((project) => project.id !== id);
  await saveProjects();

  // Las tareas del proyecto borrado quedan sin proyecto, no se eliminan
  let tasksChanged = false;
  for (const task of tasks) {
    if (task.projectId === id) {
      task.projectId = null;
      tasksChanged = true;
    }
  }
  if (tasksChanged) await saveTasks();

  if (selectedProjectId === id) selectedProjectId = ALL_ID;
  if (editingProjectId === id) editingProjectId = null;
  render();
}

function selectProject(id) {
  if (selectedProjectId === id) return;
  selectedProjectId = id;
  render();
}

/** true mientras se muestra el campo para escribir el nombre del nuevo proyecto */
let isAddingProject = false;

/** Id del proyecto cuyo popover de edición (nombre + imagen) está abierto, o null */
let editingProjectId = null;

/**
 * El único popover flotante activo (campo "nuevo proyecto" o editor), o null.
 * Vive en <body>, no dentro de .rail: el riel necesita scroll vertical, y con overflow-y
 * distinto de "visible" los navegadores fuerzan también el recorte horizontal, así que
 * cualquier popover posicionado "fuera" del riel quedaría cortado si colgara de él.
 */
let activePopover = null;

function closeActivePopover() {
  if (!activePopover) return;
  document.removeEventListener("mousedown", activePopover.onOutsideClick, true);
  activePopover.el.remove();
  activePopover = null;
}

/** Añade `el` a <body>, lo sitúa junto a `anchorEl` y lo cierra al hacer click fuera de ambos */
function openPopover(el, anchorEl, onOutsideClose) {
  closeActivePopover();

  document.body.append(el);
  const rect = anchorEl.getBoundingClientRect();
  el.style.left = `${rect.right + 10}px`;
  el.style.top = `${rect.top + rect.height / 2}px`;

  const onOutsideClick = (event) => {
    if (el.contains(event.target) || anchorEl.contains(event.target)) return;
    onOutsideClose();
  };
  document.addEventListener("mousedown", onOutsideClick, true);
  activePopover = { el, onOutsideClick };
}

function openProjectEditor(id) {
  isAddingProject = false;
  editingProjectId = id;
  renderProjects();
}

function closeProjectEditor() {
  editingProjectId = null;
  renderProjects();
}

function renderProjects() {
  projectsNav.replaceChildren();
  closeActivePopover();

  projectsNav.append(buildAllRailIcon());

  if (projects.length > 0) {
    projectsNav.append(buildDivider());
    for (const project of projects) {
      projectsNav.append(buildProjectRailIcon(project));
    }
    projectsNav.append(buildDivider());
  }

  const addWrap = buildAddIcon();
  projectsNav.append(addWrap);

  if (isAddingProject) {
    const popover = buildProjectFormPopover(
      { name: "", icon: null },
      { onSave: (name, icon) => addProject(name, icon), onCancel: cancelAddingProject }
    );
    openPopover(popover, addWrap.querySelector(".rail-icon-add"), cancelAddingProject);
    focusPopoverName(popover);
  } else if (editingProjectId) {
    const project = projects.find((p) => p.id === editingProjectId);
    const projectIcon = projectsNav.querySelector(`.rail-icon[data-id="${editingProjectId}"]`);
    if (project && projectIcon) {
      const popover = buildProjectFormPopover(
        { name: project.name, icon: project.icon },
        { onSave: (name, icon) => updateProject(project.id, name, icon), onCancel: closeProjectEditor }
      );
      openPopover(popover, projectIcon.querySelector(".rail-icon__select"), closeProjectEditor);
      focusPopoverName(popover);
    } else {
      // El proyecto se borró (p.ej. desde otra ventana) mientras se editaba
      editingProjectId = null;
    }
  }
}

function cancelAddingProject() {
  isAddingProject = false;
  renderProjects();
}

function focusPopoverName(popover) {
  const nameInput = popover.querySelector(".project-edit__name");
  nameInput.focus();
  nameInput.select();
}

/** Iniciales para el icono de un proyecto: dos palabras -> sus iniciales, una palabra -> sus dos primeras letras */
function projectInitials(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

function buildAllIconGlyph() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("rail-icon__all-svg");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M4 6h16M4 12h16M4 18h16");
  svg.append(path);
  return svg;
}

/** Pinta la foto del proyecto si tiene, o sus iniciales si no */
function renderProjectAvatar(container, project) {
  container.replaceChildren();
  if (project.icon) {
    const img = document.createElement("img");
    img.src = project.icon;
    img.alt = "";
    container.append(img);
  } else {
    container.textContent = projectInitials(project.name);
  }
}

function buildAllRailIcon() {
  const icon = railIconTemplate.content.firstElementChild.cloneNode(true);
  icon.dataset.id = ALL_ID;
  icon.classList.toggle("rail-icon--active", selectedProjectId === ALL_ID);
  icon.querySelector(".rail-icon__label").append(buildAllIconGlyph());

  const label = msg("allProjects", "Todas");
  const selectBtn = icon.querySelector(".rail-icon__select");
  selectBtn.title = label;
  selectBtn.setAttribute("aria-label", label);

  icon.querySelector(".rail-icon__edit").remove();
  icon.querySelector(".rail-icon__delete").remove();

  applyI18n(icon);
  return icon;
}

function buildProjectRailIcon(project) {
  const icon = railIconTemplate.content.firstElementChild.cloneNode(true);
  icon.dataset.id = project.id;
  const isActive = selectedProjectId === project.id;
  icon.classList.toggle("rail-icon--active", isActive);

  renderProjectAvatar(icon.querySelector(".rail-icon__label"), project);

  const selectBtn = icon.querySelector(".rail-icon__select");
  selectBtn.title = project.name;
  selectBtn.setAttribute("aria-label", project.name);

  const editBtn = icon.querySelector(".rail-icon__edit");
  const deleteBtn = icon.querySelector(".rail-icon__delete");
  if (isActive) {
    editBtn.hidden = false;
    deleteBtn.hidden = false;
  } else {
    editBtn.remove();
    deleteBtn.remove();
  }

  applyI18n(icon);
  return icon;
}

function buildDivider() {
  const divider = document.createElement("span");
  divider.className = "rail__divider";
  divider.setAttribute("aria-hidden", "true");
  return divider;
}

function buildAddIcon() {
  const wrap = document.createElement("span");
  wrap.className = "rail-add";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "rail-icon-add";
  const label = msg("addProject", "Añadir proyecto");
  button.title = label;
  button.setAttribute("aria-label", label);
  button.textContent = "+";
  wrap.append(button);

  return wrap;
}

/**
 * Recorta la imagen a un cuadrado centrado y la reduce a `size`x`size`,
 * para no llenar chrome.storage.local de fotos a resolución completa.
 */
function resizeImageToDataUrl(file, size) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("No se pudo leer el archivo"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("El archivo no es una imagen válida"));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;

        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        canvas.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, size, size);

        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Popover con avatar + nombre, usado tanto para crear un proyecto como para renombrarlo
 * o cambiarle la imagen. `initial` son los valores de partida; `onSave`/`onCancel` deciden
 * qué hacer con el resultado (crear un proyecto nuevo o actualizar uno existente).
 */
function buildProjectFormPopover(initial, { onSave, onCancel }) {
  const popover = projectEditTemplate.content.firstElementChild.cloneNode(true);

  const avatarBtn = popover.querySelector(".project-edit__avatar");
  const avatarContent = popover.querySelector(".project-edit__avatar-content");
  const fileInput = popover.querySelector(".project-edit__file");
  const nameInput = popover.querySelector(".project-edit__name");
  const removeIconBtn = popover.querySelector(".project-edit__remove-icon");
  const cancelBtn = popover.querySelector(".project-edit__cancel");
  const saveBtn = popover.querySelector(".project-edit__save");

  nameInput.value = initial.name;

  // Cambios en memoria: no se guardan hasta pulsar "Guardar"
  let pendingIcon = initial.icon ?? null;

  function refreshAvatar() {
    renderProjectAvatar(avatarContent, { name: nameInput.value, icon: pendingIcon });
    removeIconBtn.hidden = !pendingIcon;
  }
  refreshAvatar();

  avatarBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    try {
      pendingIcon = await resizeImageToDataUrl(file, 128);
      refreshAvatar();
    } catch (error) {
      console.warn("No se pudo procesar la imagen del proyecto:", error);
    }
  });

  removeIconBtn.addEventListener("click", () => {
    pendingIcon = null;
    refreshAvatar();
  });

  nameInput.addEventListener("input", refreshAvatar);

  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  });

  function save() {
    const name = nameInput.value.trim().slice(0, 40);
    if (!name) {
      nameInput.focus();
      return;
    }
    onSave(name, pendingIcon);
  }

  cancelBtn.addEventListener("click", onCancel);
  saveBtn.addEventListener("click", save);

  applyI18n(popover);
  return popover;
}

/* --- Edición en línea --- */

/** Convierte el texto de la tarea en un campo editable y lo enfoca */
function startEditing(item) {
  const textEl = item.querySelector(".task__text");
  const original = textEl.textContent;

  textEl.contentEditable = "plaintext-only";
  item.classList.add("task--editing");
  textEl.focus();

  const range = document.createRange();
  range.selectNodeContents(textEl);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    textEl.removeEventListener("keydown", onKeydown);
    textEl.removeEventListener("blur", onBlur);
    textEl.contentEditable = "false";
    item.classList.remove("task--editing");

    const value = textEl.textContent.trim().slice(0, 200);
    if (save && value) {
      editTask(item.dataset.id, value);
    } else {
      textEl.textContent = original;
    }
  };

  function onKeydown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  }

  function onBlur() {
    finish(true);
  }

  textEl.addEventListener("keydown", onKeydown);
  textEl.addEventListener("blur", onBlur);
}

/* --- Renderizado --- */

function visibleTasks() {
  return selectedProjectId === ALL_ID
    ? tasks
    : tasks.filter((task) => task.projectId === selectedProjectId);
}

/** Reconstruye el riel y la lista de tareas; úsalo sólo cuando cambian los proyectos */
function render() {
  renderProjects();
  renderTasks();
}

/** Reconstruye sólo la lista de tareas, sin tocar el riel de proyectos */
function renderTasks() {
  list.replaceChildren();
  const filtered = visibleTasks();

  for (const task of filtered) {
    const item = template.content.firstElementChild.cloneNode(true);
    item.dataset.id = task.id;
    item.classList.toggle("task--completed", task.completed);

    const checkbox = item.querySelector(".task__checkbox");
    checkbox.checked = task.completed;

    // textContent (nunca innerHTML) para que el texto del usuario no se interprete como HTML
    item.querySelector(".task__text").textContent = task.text;

    // La etiqueta de proyecto sólo aporta información al ver "Todas" a la vez
    const projectBadge = item.querySelector(".task__project");
    const project = task.projectId && projects.find((p) => p.id === task.projectId);
    if (selectedProjectId === ALL_ID && project) {
      projectBadge.textContent = project.name;
      projectBadge.hidden = false;
    }

    applyI18n(item);
    list.append(item);
  }

  emptyState.hidden = filtered.length > 0;
  updateCounter(filtered);
}

function updateCounter(filtered) {
  if (filtered.length === 0) {
    counter.textContent = msg("noTasks", "Sin tareas");
    return;
  }

  const pending = filtered.filter((task) => !task.completed).length;
  if (pending === 0) {
    counter.textContent = msg("allDone", "¡Todo hecho!");
    return;
  }

  const total = String(filtered.length);
  counter.textContent = msg(
    pending === 1 ? "pendingOne" : "pendingMany",
    `${pending} pendiente${pending === 1 ? "" : "s"} de ${total}`,
    String(pending),
    total
  );
}

/* --- Eventos --- */

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  addTask(text);
});

// Delegación: un único listener para toda la lista
list.addEventListener("click", (event) => {
  const item = event.target.closest(".task");
  if (!item) return;

  // Mientras se edita, un clic para mover el cursor no debe marcar/desmarcar la tarea
  if (item.classList.contains("task--editing") && event.target.closest(".task__label")) {
    event.preventDefault();
    return;
  }

  if (event.target.closest(".task__delete")) {
    deleteTask(item.dataset.id);
  } else if (event.target.closest(".task__edit")) {
    startEditing(item);
  }
});

list.addEventListener("change", (event) => {
  if (!event.target.classList.contains("task__checkbox")) return;
  const item = event.target.closest(".task");
  if (item) toggleTask(item.dataset.id);
});

projectsNav.addEventListener("click", (event) => {
  if (event.target.closest(".rail-icon-add")) {
    isAddingProject = true;
    editingProjectId = null;
    renderProjects();
    return;
  }

  const editBtn = event.target.closest(".rail-icon__edit");
  if (editBtn) {
    openProjectEditor(editBtn.closest(".rail-icon").dataset.id);
    return;
  }

  const deleteBtn = event.target.closest(".rail-icon__delete");
  if (deleteBtn) {
    deleteProject(deleteBtn.closest(".rail-icon").dataset.id);
    return;
  }

  const select = event.target.closest(".rail-icon__select");
  if (select) selectProject(select.closest(".rail-icon").dataset.id);
});

themeButton.addEventListener("click", toggleTheme);

// Mientras no haya un tema elegido a mano, se sigue al del sistema en vivo
systemDark.addEventListener("change", () => {
  if (theme === null) applyTheme();
});

// Mantiene el panel sincronizado si el storage cambia desde otra ventana
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes[STORAGE_KEY]) {
    const value = changes[STORAGE_KEY].newValue;
    tasks = Array.isArray(value) ? value : [];
    renderTasks();
  }

  if (changes[PROJECTS_KEY]) {
    const value = changes[PROJECTS_KEY].newValue;
    projects = Array.isArray(value) ? value : [];
    if (selectedProjectId !== ALL_ID && !projects.some((p) => p.id === selectedProjectId)) {
      selectedProjectId = ALL_ID;
    }
    render();
  }

  if (changes[THEME_KEY]) {
    const value = changes[THEME_KEY].newValue;
    theme = value === "light" || value === "dark" ? value : null;
    applyTheme();
  }
});

/* --- Arranque --- */

(async () => {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  applyI18n();

  await loadTheme();
  applyTheme();
  await Promise.all([loadTasks(), loadProjects()]);
  render();
  input.focus();
})();
