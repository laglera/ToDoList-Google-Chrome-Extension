"use strict";

const STORAGE_KEY = "tasks";

const form = document.getElementById("new-task-form");
const input = document.getElementById("new-task-input");
const list = document.getElementById("task-list");
const counter = document.getElementById("counter");
const emptyState = document.getElementById("empty-state");
const template = document.getElementById("task-template");

/** @type {{id: string, text: string, completed: boolean}[]} */
let tasks = [];

/* --- Persistencia --- */

async function loadTasks() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const stored = data[STORAGE_KEY];
  tasks = Array.isArray(stored) ? stored : [];
}

async function saveTasks() {
  await chrome.storage.local.set({ [STORAGE_KEY]: tasks });
}

/* --- Acciones --- */

async function addTask(text) {
  tasks.push({ id: crypto.randomUUID(), text, completed: false });
  await saveTasks();
  render();
}

async function toggleTask(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  await saveTasks();
  render();
}

async function deleteTask(id) {
  tasks = tasks.filter((t) => t.id !== id);
  await saveTasks();
  render();
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

    list.append(item);
  }

  emptyState.hidden = tasks.length > 0;
  updateCounter();
}

function updateCounter() {
  if (tasks.length === 0) {
    counter.textContent = "Sin tareas";
    return;
  }
  const pending = tasks.filter((t) => !t.completed).length;
  counter.textContent =
    pending === 0
      ? "¡Todo hecho!"
      : `${pending} pendiente${pending === 1 ? "" : "s"} de ${tasks.length}`;
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

  if (event.target.closest(".task__delete")) {
    deleteTask(item.dataset.id);
  }
});

list.addEventListener("change", (event) => {
  if (!event.target.classList.contains("task__checkbox")) return;
  const item = event.target.closest(".task");
  if (item) toggleTask(item.dataset.id);
});

// Mantiene el popup sincronizado si el storage cambia desde otra ventana
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORAGE_KEY]) return;
  const value = changes[STORAGE_KEY].newValue;
  tasks = Array.isArray(value) ? value : [];
  render();
});

/* --- Arranque --- */

(async () => {
  await loadTasks();
  render();
  input.focus();
})();
