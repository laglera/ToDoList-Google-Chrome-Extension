"use strict";

/**
 * Devuelve el mensaje traducido, o `fallback` si no hay traducción.
 * getMessage se llama sin el segundo argumento cuando no hay sustituciones:
 * pasarle un array vacío puede devolver cadena vacía.
 */
export function msg(key, fallback = "", ...substitutions) {
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
export function applyI18n(root = document) {
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
