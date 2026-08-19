"use strict";

const STORAGE_KEY = "tasks";
const THEME_KEY = "theme";

const form = document.getElementById("new-task-form");
const input = document.getElementById("new-task-input");
const list = document.getElementById("task-list");
const counter = document.getElementById("counter");
const emptyState = document.getElementById("empty-state");
const template = document.getElementById("task-template");
const themeButton = document.getElementById("theme-button");

/** @type {{id: string, text: string, completed: boolean}[]} */
let tasks = [];

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
  tasks.push({ id: crypto.randomUUID(), text, completed: false });
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

function render() {
  list.replaceChildren();

  for (const task of tasks) {
    const item = template.content.firstElementChild.cloneNode(true);
    item.dataset.id = task.id;
    item.classList.toggle("task--completed", task.completed);

    const checkbox = item.querySelector(".task__checkbox");
    checkbox.checked = task.completed;

    // textContent (nunca innerHTML) para que el texto del usuario no se interprete como HTML
    item.querySelector(".task__text").textContent = task.text;

    applyI18n(item);
    list.append(item);
  }

  emptyState.hidden = tasks.length > 0;
  updateCounter();
}

function updateCounter() {
  if (tasks.length === 0) {
    counter.textContent = msg("noTasks", "Sin tareas");
    return;
  }

  const pending = tasks.filter((task) => !task.completed).length;
  if (pending === 0) {
    counter.textContent = msg("allDone", "¡Todo hecho!");
    return;
  }

  const total = String(tasks.length);
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

themeButton.addEventListener("click", toggleTheme);

// Mientras no haya un tema elegido a mano, se sigue al del sistema en vivo
systemDark.addEventListener("change", () => {
  if (theme === null) applyTheme();
});

// Mantiene el popup sincronizado si el storage cambia desde otra ventana
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes[STORAGE_KEY]) {
    const value = changes[STORAGE_KEY].newValue;
    tasks = Array.isArray(value) ? value : [];
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
  await loadTasks();
  render();
  input.focus();
})();
