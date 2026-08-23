"use strict";

import { msg, applyI18n } from "./shared/i18n.js";
import { setupTheme } from "./shared/theme.js";

/* --- Claves de estado --- */

const VIEW_KEY = "bookmarksView";
const FOLDER_KEY = "bookmarksFolder";
const EXPANDED_KEY = "bookmarksExpanded";

/** Ventana desde la que se abrieron los marcadores; la escribe background.js en storage.session */
const OPENER_KEY = "bookmarksOpenerWindowId";

/** Nodos que se pintan de una tanda; el resto espera a "Mostrar más" */
const PAGE_SIZE = 200;

const folderTree = document.getElementById("folder-tree");
const breadcrumb = document.getElementById("breadcrumb");
const itemsEl = document.getElementById("items");
const emptyState = document.getElementById("empty-state");
const showMoreBtn = document.getElementById("show-more");
const searchInput = document.getElementById("search-input");
const searchCount = document.getElementById("search-count");
const themeButton = document.getElementById("theme-button");
const viewButton = document.getElementById("view-button");
const folderNodeTemplate = document.getElementById("folder-node-template");
const bookmarkTemplate = document.getElementById("bookmark-template");
const folderCardTemplate = document.getElementById("folder-card-template");
const menuTemplate = document.getElementById("menu-template");

/** @type {Map<string, chrome.bookmarks.BookmarkTreeNode>} */
let nodesById = new Map();

/** Carpetas de primer nivel de Chrome: barra de marcadores, otros marcadores, móvil */
let rootFolders = [];

let currentFolderId = null;

/** Ids de las carpetas desplegadas en el árbol lateral */
let expanded = new Set();

let query = "";
let limit = PAGE_SIZE;
let view = "grid";

/* --- Utilidades --- */

const isFolder = (node) => !node.url;

/**
 * Normaliza para comparar: sin mayúsculas ni acentos, de modo que "diseno"
 * encuentre "Diseño". Sólo para filtrar — el resaltado usa el texto original.
 */
function fold(text) {
  return (text ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Dominio legible de una URL, o la URL entera si no se puede interpretar */
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Iconos servidos desde la caché local de Chrome: ningún dato sale del navegador */
function faviconUrl(pageUrl, size = 32) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", String(size));
  return url.toString();
}

/** Cadena de carpetas desde la raíz hasta `id`, ambos incluidos */
function folderChain(id) {
  const chain = [];
  let node = nodesById.get(id);
  while (node && node.parentId) {
    chain.unshift(node);
    node = nodesById.get(node.parentId);
  }
  return chain;
}

/** Marcadores de cada carpeta, contando los de sus subcarpetas. Se llena al cargar el árbol. */
let bookmarkCounts = new Map();

const countBookmarks = (folder) => bookmarkCounts.get(folder.id) ?? 0;

function indexCounts(folder) {
  let total = 0;
  for (const child of folder.children ?? []) {
    total += isFolder(child) ? indexCounts(child) : 1;
  }
  bookmarkCounts.set(folder.id, total);
  return total;
}

/**
 * Escribe `text` en `el` envolviendo en <mark> lo que coincide con `needle`.
 * La comparación es sólo por mayúsculas/minúsculas y no por acentos: quitar los
 * diacríticos cambia la longitud del texto y desplazaría los índices del resaltado.
 * Un resultado encontrado por acento aparece igualmente, sólo que sin resaltar.
 */
function fillHighlighted(el, text, needle) {
  el.replaceChildren();
  if (!needle) {
    el.textContent = text;
    return;
  }

  const haystack = text.toLowerCase();
  const target = needle.toLowerCase();
  let from = 0;
  let at = haystack.indexOf(target);

  while (at !== -1) {
    if (at > from) el.append(text.slice(from, at));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(at, at + target.length);
    el.append(mark);
    from = at + target.length;
    at = haystack.indexOf(target, from);
  }

  if (from < text.length) el.append(text.slice(from));
}

/* --- Carga del árbol --- */

async function loadTree() {
  const [root] = await chrome.bookmarks.getTree();

  nodesById = new Map();
  const index = (node) => {
    nodesById.set(node.id, node);
    for (const child of node.children ?? []) index(child);
  };
  index(root);

  bookmarkCounts = new Map();
  indexCounts(root);

  // Chrome expone "Móvil" aunque nunca se haya usado: se oculta si está vacía
  const roots = (root.children ?? []).filter(isFolder);
  const withContent = roots.filter((folder) => (folder.children ?? []).length > 0);
  rootFolders = withContent.length > 0 ? withContent : roots;

  if (!currentFolderId || !nodesById.has(currentFolderId)) {
    currentFolderId = rootFolders[0]?.id ?? null;
  }
}

/* --- Estado persistido --- */

async function loadUiState() {
  const data = await chrome.storage.local.get([VIEW_KEY, FOLDER_KEY, EXPANDED_KEY]);
  view = data[VIEW_KEY] === "list" ? "list" : "grid";
  currentFolderId = typeof data[FOLDER_KEY] === "string" ? data[FOLDER_KEY] : null;
  expanded = new Set(Array.isArray(data[EXPANDED_KEY]) ? data[EXPANDED_KEY] : []);
}

function saveUiState() {
  chrome.storage.local.set({
    [VIEW_KEY]: view,
    [FOLDER_KEY]: currentFolderId,
    [EXPANDED_KEY]: [...expanded],
  });
}

/* --- Árbol lateral --- */

function renderTree() {
  folderTree.replaceChildren();

  // La carpeta abierta siempre queda a la vista, aunque esté anidada
  for (const ancestor of folderChain(currentFolderId).slice(0, -1)) {
    expanded.add(ancestor.id);
  }

  for (const folder of rootFolders) appendTreeNode(folder, 0);
}

function appendTreeNode(folder, depth) {
  const node = folderNodeTemplate.content.firstElementChild.cloneNode(true);
  const subfolders = (folder.children ?? []).filter(isFolder);
  const isExpanded = expanded.has(folder.id);

  node.dataset.id = folder.id;
  node.style.setProperty("--depth", String(depth));
  node.classList.toggle("tree-node--active", folder.id === currentFolderId);
  node.classList.toggle("tree-node--expanded", isExpanded);

  const twisty = node.querySelector(".tree-node__twisty");
  if (subfolders.length === 0) {
    twisty.classList.add("tree-node__twisty--empty");
  } else {
    const label = isExpanded ? msg("collapseFolder", "Plegar") : msg("expandFolder", "Desplegar");
    twisty.title = label;
    twisty.setAttribute("aria-label", label);
  }

  node.querySelector(".tree-node__name").textContent = folder.title;

  const count = countBookmarks(folder);
  node.querySelector(".tree-node__count").textContent = count > 0 ? String(count) : "";

  const select = node.querySelector(".tree-node__select");
  select.title = folder.title;

  folderTree.append(node);

  if (isExpanded) {
    for (const child of subfolders) appendTreeNode(child, depth + 1);
  }
}

/* --- Migas de pan --- */

function renderBreadcrumb() {
  breadcrumb.replaceChildren();

  if (query) {
    const crumb = document.createElement("span");
    crumb.className = "breadcrumb__crumb breadcrumb__crumb--current";
    crumb.textContent = msg("searchResults", "Resultados de la búsqueda");
    breadcrumb.append(crumb);
    return;
  }

  const chain = folderChain(currentFolderId);
  chain.forEach((folder, position) => {
    if (position > 0) {
      const sep = document.createElement("span");
      sep.className = "breadcrumb__sep";
      sep.textContent = "›";
      breadcrumb.append(sep);
    }

    const isCurrent = position === chain.length - 1;
    const crumb = document.createElement("button");
    crumb.type = "button";
    crumb.className = "breadcrumb__crumb";
    crumb.classList.toggle("breadcrumb__crumb--current", isCurrent);
    crumb.textContent = folder.title;
    crumb.title = folder.title;
    crumb.dataset.id = folder.id;
    if (isCurrent) crumb.disabled = true;
    breadcrumb.append(crumb);
  });
}

/* --- Tarjetas --- */

function buildHeading(key, fallback) {
  const heading = document.createElement("h2");
  heading.className = "items__heading";
  heading.textContent = msg(key, fallback);
  return heading;
}

function buildFolderCard(folder) {
  const card = folderCardTemplate.content.firstElementChild.cloneNode(true);
  card.dataset.id = folder.id;
  card.draggable = true;

  fillHighlighted(card.querySelector(".card__title"), folder.title, query);

  const count = countBookmarks(folder);
  card.querySelector(".card__sub").textContent =
    count === 1
      ? msg("itemOne", "1 marcador", "1")
      : msg("itemMany", `${count} marcadores`, String(count));

  card.title = folder.title;
  return card;
}

function buildBookmarkCard(bookmark, { showPath = false } = {}) {
  const card = bookmarkTemplate.content.firstElementChild.cloneNode(true);
  card.dataset.id = bookmark.id;
  card.href = bookmark.url;
  card.draggable = true;

  const host = hostOf(bookmark.url);
  const title = bookmark.title || host;
  fillHighlighted(card.querySelector(".card__title"), title, query);

  // En la búsqueda importa más dónde vive el marcador que su dominio
  const subEl = card.querySelector(".card__sub");
  if (showPath) {
    const parent = nodesById.get(bookmark.parentId);
    subEl.textContent = parent ? folderChain(parent.id).map((f) => f.title).join(" › ") : host;
  } else {
    fillHighlighted(subEl, host, query);
  }

  const img = card.querySelector(".card__favicon");
  img.src = faviconUrl(bookmark.url);
  img.addEventListener("error", () => {
    img.classList.add("card__favicon--failed");
    const initial = document.createElement("span");
    initial.className = "card__initial";
    initial.textContent = (host[0] ?? "?").toUpperCase();
    img.parentElement.append(initial);
  });

  card.title = `${title}\n${bookmark.url}`;
  return card;
}

/* --- Contenido --- */

function searchResults() {
  const needle = fold(query);
  const results = [];

  for (const node of nodesById.values()) {
    if (isFolder(node)) continue;
    const inTitle = fold(node.title).includes(needle);
    if (inTitle || fold(node.url).includes(needle)) {
      results.push({ node, inTitle });
    }
  }

  // Lo que coincide en el título va antes que lo que sólo coincide en la dirección
  results.sort((a, b) => {
    if (a.inTitle !== b.inTitle) return a.inTitle ? -1 : 1;
    return (a.node.title || a.node.url).localeCompare(b.node.title || b.node.url);
  });

  return results.map((result) => result.node);
}

function renderContent() {
  itemsEl.replaceChildren();

  if (query) {
    renderSearch();
    return;
  }

  searchCount.textContent = "";

  const folder = nodesById.get(currentFolderId);
  const children = folder?.children ?? [];
  const subfolders = children.filter(isFolder);
  const bookmarks = children.filter((child) => !isFolder(child));

  if (subfolders.length > 0) {
    itemsEl.append(buildHeading("foldersHeading", "Carpetas"));
    for (const child of subfolders) itemsEl.append(buildFolderCard(child));
  }

  const shown = bookmarks.slice(0, limit);
  if (shown.length > 0) {
    if (subfolders.length > 0) itemsEl.append(buildHeading("bookmarksHeading", "Marcadores"));
    for (const child of shown) itemsEl.append(buildBookmarkCard(child));
  }

  showMoreBtn.hidden = bookmarks.length <= limit;
  const isEmpty = children.length === 0;
  emptyState.hidden = !isEmpty;
  itemsEl.hidden = isEmpty;
  if (isEmpty) emptyState.textContent = msg("emptyFolder", "Esta carpeta está vacía.");
}

function renderSearch() {
  const results = searchResults();
  const shown = results.slice(0, limit);

  for (const bookmark of shown) {
    itemsEl.append(buildBookmarkCard(bookmark, { showPath: true }));
  }

  searchCount.textContent =
    results.length === 1
      ? msg("resultOne", "1 resultado", "1")
      : msg("resultMany", `${results.length} resultados`, String(results.length));

  showMoreBtn.hidden = results.length <= limit;
  const isEmpty = results.length === 0;
  emptyState.hidden = !isEmpty;
  itemsEl.hidden = isEmpty;
  if (isEmpty) emptyState.textContent = msg("noResults", "Ningún marcador coincide.");
}

function render() {
  document.body.dataset.view = view;
  renderTree();
  renderBreadcrumb();
  renderContent();
}

/* --- Navegación --- */

function openFolder(id) {
  if (currentFolderId === id && !query) return;
  currentFolderId = id;
  limit = PAGE_SIZE;

  // Entrar en una carpeta es salir de la búsqueda: si no, no se vería lo que se abre
  if (query) {
    query = "";
    searchInput.value = "";
  }

  saveUiState();
  render();
}

function toggleFolder(id) {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
  saveUiState();
  renderTree();
}

/* --- Abrir marcadores --- */

/**
 * Ventana normal donde abrir los enlaces: esta es de tipo "popup" y no tiene pestañas.
 * Se prefiere aquella desde la que se abrieron los marcadores.
 */
async function targetWindowId() {
  const data = await chrome.storage.session.get(OPENER_KEY);
  const saved = data[OPENER_KEY];

  if (typeof saved === "number") {
    try {
      const opener = await chrome.windows.get(saved);
      if (opener.type === "normal") return opener.id;
    } catch {
      // Se cerró: se busca otra
    }
  }

  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  if (windows.length === 0) return null;
  return (windows.find((win) => win.focused) ?? windows[windows.length - 1]).id;
}

/**
 * Un clic normal lleva al marcador y cierra esta ventana; con Ctrl/⌘ o el botón
 * central el marcador se abre detrás y aquí se sigue mirando la lista.
 */
async function openBookmark(url, { background }) {
  const windowId = await targetWindowId();

  if (windowId == null) {
    await chrome.windows.create({ url, focused: !background });
  } else {
    await chrome.tabs.create({ url, windowId, active: !background });
    if (!background) await chrome.windows.update(windowId, { focused: true });
  }

  if (!background) window.close();
}

/* --- Menú contextual --- */

let activeMenu = null;

function closeMenu() {
  if (!activeMenu) return;
  document.removeEventListener("mousedown", activeMenu.onOutsideClick, true);
  activeMenu.el.remove();
  activeMenu = null;
}

function openMenu(card, x, y) {
  closeMenu();

  const node = nodesById.get(card.dataset.id);
  if (!node) return;

  const menu = menuTemplate.content.firstElementChild.cloneNode(true);
  applyI18n(menu);

  // Una carpeta no se abre en una pestaña ni tiene dirección que copiar
  if (isFolder(node)) {
    for (const action of ["open", "copy"]) {
      menu.querySelector(`[data-action="${action}"]`).remove();
    }
  }

  menu.addEventListener("click", async (event) => {
    const action = event.target.closest(".menu__item")?.dataset.action;
    if (!action) return;
    closeMenu();

    if (action === "open") await openBookmark(node.url, { background: true });
    else if (action === "copy") await navigator.clipboard.writeText(node.url);
    else if (action === "rename") startRenaming(card, node);
    else if (action === "delete") await removeNode(node);
  });

  document.body.append(menu);

  // Se coloca en el cursor, pero sin salirse de la ventana
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(6, Math.min(x, window.innerWidth - rect.width - 6))}px`;
  menu.style.top = `${Math.max(6, Math.min(y, window.innerHeight - rect.height - 6))}px`;

  const onOutsideClick = (event) => {
    if (!menu.contains(event.target)) closeMenu();
  };
  document.addEventListener("mousedown", onOutsideClick, true);
  activeMenu = { el: menu, onOutsideClick };

  menu.querySelector(".menu__item")?.focus();
}

/* --- Editar y borrar --- */

/** Convierte el título de la tarjeta en un campo editable, como en la lista de tareas */
function startRenaming(card, node) {
  const titleEl = card.querySelector(".card__title");
  const original = node.title;

  titleEl.textContent = original;
  titleEl.contentEditable = "plaintext-only";
  card.draggable = false;
  titleEl.focus();

  const range = document.createRange();
  range.selectNodeContents(titleEl);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    titleEl.removeEventListener("keydown", onKeydown);
    titleEl.removeEventListener("blur", onBlur);
    titleEl.contentEditable = "false";
    card.draggable = true;

    const value = titleEl.textContent.trim();
    if (save && value && value !== original) {
      chrome.bookmarks.update(node.id, { title: value }).catch(console.error);
    } else {
      titleEl.textContent = original;
    }
  };

  function onKeydown(event) {
    event.stopPropagation(); // el atajo global de búsqueda no debe robar el foco
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

  titleEl.addEventListener("keydown", onKeydown);
  titleEl.addEventListener("blur", onBlur);
}

/** Borrar una carpeta se lleva por delante todo lo que contiene, así que se pregunta */
async function removeNode(node) {
  if (isFolder(node)) {
    const count = countBookmarks(node);
    const question =
      count > 0
        ? msg("confirmDeleteFolder", `¿Eliminar "${node.title}" y sus ${count} marcadores?`, node.title, String(count))
        : msg("confirmDeleteEmptyFolder", `¿Eliminar la carpeta "${node.title}"?`, node.title);
    if (!window.confirm(question)) return;
    await chrome.bookmarks.removeTree(node.id);
  } else {
    await chrome.bookmarks.remove(node.id);
  }
}

/* --- Mover con arrastrar y soltar --- */

/** Impide meter una carpeta dentro de sí misma o de una de sus descendientes */
function canMoveInto(nodeId, targetId) {
  if (nodeId === targetId) return false;
  let parent = nodesById.get(targetId);
  while (parent) {
    if (parent.id === nodeId) return false;
    parent = parent.parentId ? nodesById.get(parent.parentId) : null;
  }
  return true;
}

async function moveNode(nodeId, parentId) {
  const node = nodesById.get(nodeId);
  if (!node || node.parentId === parentId || !canMoveInto(nodeId, parentId)) return;
  await chrome.bookmarks.move(nodeId, { parentId });
}

/* --- Eventos --- */

folderTree.addEventListener("click", (event) => {
  const node = event.target.closest(".tree-node");
  if (!node) return;

  if (event.target.closest(".tree-node__twisty")) toggleFolder(node.dataset.id);
  else if (event.target.closest(".tree-node__select")) openFolder(node.dataset.id);
});

breadcrumb.addEventListener("click", (event) => {
  const crumb = event.target.closest(".breadcrumb__crumb");
  if (crumb && !crumb.disabled) openFolder(crumb.dataset.id);
});

itemsEl.addEventListener("click", (event) => {
  const card = event.target.closest(".card");
  if (!card) return;

  // Durante el renombrado, el clic sólo coloca el cursor
  if (card.querySelector('.card__title[contenteditable="plaintext-only"]')) {
    event.preventDefault();
    return;
  }

  if (card.classList.contains("card--folder")) {
    openFolder(card.dataset.id);
    return;
  }

  event.preventDefault(); // el <a> da la URL al navegador, pero abrimos nosotros
  const node = nodesById.get(card.dataset.id);
  if (node?.url) openBookmark(node.url, { background: event.ctrlKey || event.metaKey });
});

// Botón central: abrir detrás sin cerrar esta ventana
itemsEl.addEventListener("auxclick", (event) => {
  if (event.button !== 1) return;
  const card = event.target.closest(".card--bookmark");
  if (!card) return;
  event.preventDefault();
  const node = nodesById.get(card.dataset.id);
  if (node?.url) openBookmark(node.url, { background: true });
});

itemsEl.addEventListener("contextmenu", (event) => {
  const card = event.target.closest(".card");
  if (!card) return;
  event.preventDefault();
  openMenu(card, event.clientX, event.clientY);
});

itemsEl.addEventListener("dragstart", (event) => {
  const card = event.target.closest(".card");
  if (!card) return;
  event.dataTransfer.setData("text/plain", card.dataset.id);
  event.dataTransfer.effectAllowed = "move";
  card.classList.add("card--dragging");
});

itemsEl.addEventListener("dragend", (event) => {
  event.target.closest(".card")?.classList.remove("card--dragging");
});

folderTree.addEventListener("dragover", (event) => {
  if (!event.target.closest(".tree-node")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
});

folderTree.addEventListener("dragenter", (event) => {
  event.target.closest(".tree-node")?.classList.add("tree-node--drop-target");
});

folderTree.addEventListener("dragleave", (event) => {
  const node = event.target.closest(".tree-node");
  if (node && !node.contains(event.relatedTarget)) {
    node.classList.remove("tree-node--drop-target");
  }
});

folderTree.addEventListener("drop", (event) => {
  const node = event.target.closest(".tree-node");
  if (!node) return;
  event.preventDefault();
  node.classList.remove("tree-node--drop-target");

  const nodeId = event.dataTransfer.getData("text/plain");
  if (nodeId) moveNode(nodeId, node.dataset.id).catch(console.error);
});

let searchTimer = null;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    query = searchInput.value.trim();
    limit = PAGE_SIZE;
    renderBreadcrumb();
    renderContent();
  }, 120);
});

showMoreBtn.addEventListener("click", () => {
  limit += PAGE_SIZE;
  renderContent();
});

viewButton.addEventListener("click", () => {
  view = view === "grid" ? "list" : "grid";
  document.body.dataset.view = view;
  saveUiState();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (activeMenu) {
      closeMenu();
    } else if (searchInput.value) {
      searchInput.value = "";
      searchInput.dispatchEvent(new Event("input"));
    } else {
      window.close();
    }
    return;
  }

  // Enfocar la búsqueda al escribir, sin pisar los atajos del sistema
  const typing = event.target.matches("input, [contenteditable='plaintext-only']");
  if (((event.ctrlKey || event.metaKey) && event.key === "f") || (event.key === "/" && !typing)) {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
});

/* --- Sincronización con Chrome --- */

let refreshTimer = null;

/** Un solo repintado aunque Chrome dispare varios eventos seguidos (mover, reordenar…) */
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    await loadTree();
    render();
  }, 60);
}

for (const event of ["onCreated", "onRemoved", "onChanged", "onMoved", "onChildrenReordered"]) {
  chrome.bookmarks[event].addListener(scheduleRefresh);
}

/* --- Arranque --- */

(async () => {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  applyI18n();

  await setupTheme(themeButton);
  await loadUiState();
  await loadTree();
  render();

  searchInput.focus();
})();
