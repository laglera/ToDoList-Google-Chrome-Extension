"use strict";

import { msg } from "./i18n.js";

export const THEME_KEY = "theme";

/** Tema elegido a mano ("light" | "dark"), o null si se sigue al sistema */
let theme = null;

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

/** Botón cuyo texto accesible describe el tema al que se cambiará */
let themeButton = null;

function normalize(value) {
  return value === "light" || value === "dark" ? value : null;
}

/** Deja siempre un data-theme explícito para que el icono refleje el tema real */
export function applyTheme() {
  const effective = theme ?? (systemDark.matches ? "dark" : "light");
  document.documentElement.dataset.theme = effective;

  if (!themeButton) return;
  themeButton.title =
    effective === "dark"
      ? msg("themeToLight", "Cambiar a tema claro")
      : msg("themeToDark", "Cambiar a tema oscuro");
  themeButton.setAttribute("aria-label", themeButton.title);
}

export async function toggleTheme() {
  theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme();
  await chrome.storage.local.set({ [THEME_KEY]: theme });
}

/** Aplica el tema guardado a `button` y lo mantiene al día ante cambios del sistema o de otra vista */
export async function setupTheme(button) {
  themeButton = button;

  const data = await chrome.storage.local.get(THEME_KEY);
  theme = normalize(data[THEME_KEY]);
  applyTheme();

  button?.addEventListener("click", toggleTheme);

  // Mientras no haya un tema elegido a mano, se sigue al del sistema en vivo
  systemDark.addEventListener("change", () => {
    if (theme === null) applyTheme();
  });

  // El tema se comparte entre el panel y la ventana de marcadores
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[THEME_KEY]) return;
    theme = normalize(changes[THEME_KEY].newValue);
    applyTheme();
  });
}
