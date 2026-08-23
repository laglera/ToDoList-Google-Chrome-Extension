"use strict";

// Abre el panel lateral al pulsar el icono de la extensión, en vez de un popup
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

/**
 * Clave en storage.session con el id de la ventana de marcadores abierta.
 * No vale una variable suelta: el service worker se duerme y perdería la referencia,
 * y storage.session ya se limpia solo al cerrar el navegador.
 */
const BOOKMARKS_WINDOW_KEY = "bookmarksWindowId";

/** Ventana normal desde la que se abrieron los marcadores: allí se abrirán los enlaces */
const OPENER_KEY = "bookmarksOpenerWindowId";

const BOOKMARKS_WINDOW = { width: 940, height: 660 };

/** Si la ventana sigue viva la trae al frente; si no, devuelve null */
async function focusExistingWindow() {
  const data = await chrome.storage.session.get(BOOKMARKS_WINDOW_KEY);
  const windowId = data[BOOKMARKS_WINDOW_KEY];
  if (typeof windowId !== "number") return null;

  try {
    const existing = await chrome.windows.get(windowId);
    await chrome.windows.update(existing.id, { focused: true, drawAttention: true });
    return existing.id;
  } catch {
    // La cerró el usuario: el id guardado ya no sirve
    await chrome.storage.session.remove(BOOKMARKS_WINDOW_KEY);
    return null;
  }
}

/** Centra la ventana sobre la que el usuario está mirando, no sobre la pantalla entera */
function centeredPosition(opener) {
  if (!opener?.width || !opener?.height) return {};
  return {
    left: Math.max(0, Math.round(opener.left + (opener.width - BOOKMARKS_WINDOW.width) / 2)),
    top: Math.max(0, Math.round(opener.top + (opener.height - BOOKMARKS_WINDOW.height) / 2)),
  };
}

async function openBookmarksWindow() {
  if (await focusExistingWindow()) return;

  // El panel lateral vive dentro de una ventana normal: esa es la de origen
  let opener = null;
  try {
    const current = await chrome.windows.getLastFocused();
    if (current.type === "normal") opener = current;
  } catch {
    // Sin ventana de referencia, que Chrome decida dónde ponerla
  }

  const created = await chrome.windows.create({
    url: chrome.runtime.getURL("bookmarks.html"),
    type: "popup",
    focused: true,
    ...BOOKMARKS_WINDOW,
    ...centeredPosition(opener),
  });

  await chrome.storage.session.set({
    [BOOKMARKS_WINDOW_KEY]: created.id,
    ...(opener ? { [OPENER_KEY]: opener.id } : {}),
  });
}

chrome.windows.onRemoved.addListener(async (windowId) => {
  const data = await chrome.storage.session.get(BOOKMARKS_WINDOW_KEY);
  if (data[BOOKMARKS_WINDOW_KEY] === windowId) {
    await chrome.storage.session.remove(BOOKMARKS_WINDOW_KEY);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "open-bookmarks") return false;
  openBookmarksWindow()
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      console.error("No se pudo abrir la ventana de marcadores:", error);
      sendResponse({ ok: false });
    });
  return true; // la respuesta llega de forma asíncrona
});
