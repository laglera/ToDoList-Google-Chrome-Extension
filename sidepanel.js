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

/** @type {{id: string, text: string, completed: boolean, projectId: string|null}[]} */
let tasks = [];

/** @type {{id: string, name: string}[]} */
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
  render();
}

async function toggleTask(id) {
  const task = tasks.find((item) => item.id === id);
  if (!task) return;
  task.completed = !task.completed;
  await saveTasks();
  render();
}

async function deleteTask(id) {
  tasks = tasks.filter((item) => item.id !== id);
  await saveTasks();
  render();
}

async function editTask(id, text) {
  const task = tasks.find((item) => item.id === id);
  if (!task || task.text === text) return;
  task.text = text;
  await saveTasks();
  render();
}

/* --- Proyectos --- */

async function addProject(name) {
  const project = { id: crypto.randomUUID(), name };
  projects.push(project);
  await saveProjects();
  selectedProjectId = project.id;
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
  render();
}

function selectProject(id) {
  if (selectedProjectId === id) return;
  selectedProjectId = id;
  render();
}

/** true mientras se muestra el campo para escribir el nombre del nuevo proyecto */
let isAddingProject = false;

function renderProjects() {
  projectsNav.replaceChildren();

  projectsNav.append(buildRailIcon(ALL_ID, msg("allProjects", "Todas"), false, true));

  if (projects.length > 0) {
    projectsNav.append(buildDivider());
    for (const project of projects) {
      projectsNav.append(buildRailIcon(project.id, project.name, true, false));
    }
    projectsNav.append(buildDivider());
  }

  projectsNav.append(buildAddIcon());
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

function buildRailIcon(id, label, deletable, isAllIcon) {
  const icon = railIconTemplate.content.firstElementChild.cloneNode(true);
  icon.dataset.id = id;
  icon.classList.toggle("rail-icon--active", selectedProjectId === id);

  const labelEl = icon.querySelector(".rail-icon__label");
  if (isAllIcon) {
    labelEl.append(buildAllIconGlyph());
  } else {
    labelEl.textContent = projectInitials(label);
  }

  const selectBtn = icon.querySelector(".rail-icon__select");
  selectBtn.title = label;
  selectBtn.setAttribute("aria-label", label);

  const deleteBtn = icon.querySelector(".rail-icon__delete");
  if (deletable && selectedProjectId === id) {
    deleteBtn.hidden = false;
  } else {
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

  if (isAddingProject) {
    const field = document.createElement("input");
    field.type = "text";
    field.className = "rail-project-input";
    field.placeholder = msg("newProjectPlaceholder", "Nombre del proyecto");
    field.maxLength = 40;
    wrap.append(field);
  }

  return wrap;
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

function render() {
  renderProjects();

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
    render();
    projectsNav.querySelector(".rail-project-input")?.focus();
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

function commitNewProject(event) {
  const name = event.target.value.trim().slice(0, 40);
  isAddingProject = false;
  if (name) {
    addProject(name);
  } else {
    render();
  }
}

projectsNav.addEventListener("keydown", (event) => {
  if (!event.target.classList.contains("rail-project-input")) return;
  if (event.key === "Enter") {
    event.preventDefault();
    commitNewProject(event);
  } else if (event.key === "Escape") {
    event.preventDefault();
    isAddingProject = false;
    render();
  }
});

projectsNav.addEventListener("focusout", (event) => {
  if (!isAddingProject || !event.target.classList.contains("rail-project-input")) return;
  commitNewProject(event);
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
    render();
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
