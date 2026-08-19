"use strict";

// Abre el panel lateral al pulsar el icono de la extensión, en vez de un popup
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
