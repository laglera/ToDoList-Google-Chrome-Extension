# Todo List — Extensión de Google Chrome

## Descripción
Extensión de Google Chrome con dos vistas: un panel lateral para gestionar tareas y proyectos, y una ventana de marcadores que muestra todos los favoritos con carpetas y buscador, sin el desplegable estrecho de la barra de Chrome.

## Funcionalidades
- [x] Crear una nueva tarea
- [x] Marcar una tarea como completada
- [x] Eliminar una tarea
- [x] Persistencia de las tareas entre sesiones (aunque se cierre el navegador)
- [x] Proyectos con imagen, y tareas que se mueven entre ellos arrastrando
- [x] Ventana de marcadores: árbol de carpetas, rejilla o lista, buscador global y edición

## Stack tecnológico
- **HTML** — estructura de las dos vistas
- **CSS** — estilos de la interfaz
- **JavaScript (vanilla, módulos ES)** — lógica de la aplicación
- **Chrome Extensions API (Manifest V3)**
  - `chrome.storage.local` para persistir tareas, proyectos, tema y estado de la vista
  - `chrome.storage.session` para la ventana de marcadores abierta y la de origen
  - `chrome.bookmarks` para leer y editar los marcadores
  - `chrome.windows` / `chrome.tabs` para la ventana emergente y abrir enlaces

### Permisos
`storage`, `sidePanel`, `bookmarks` y `favicon`. Este último sirve los iconos desde la caché
local de Chrome (`/_favicon/?pageUrl=…`): no se pide ningún icono a servidores externos, así que
la lista de sitios guardados nunca sale del navegador.

## Estructura de archivos
```
todo-extension/
├── manifest.json      # Configuración de la extensión
├── background.js      # Abre el panel lateral y la ventana de marcadores
├── sidepanel.html     # Panel lateral: tareas y proyectos
├── sidepanel.css
├── sidepanel.js
├── bookmarks.html     # Ventana emergente de marcadores
├── bookmarks.css
├── bookmarks.js
├── shared/            # Lo que comparten las dos vistas
│   ├── base.css       # Reset, paleta y botones de icono
│   ├── i18n.js        # msg() y applyI18n()
│   └── theme.js       # Tema claro/oscuro sincronizado entre vistas
├── _locales/          # Textos traducidos (es, en, fr, de, it, pt_BR)
│   └── <idioma>/messages.json
└── icons/             # Iconos de la extensión (16, 48, 128 px)
```

## Adaptación automática al usuario
- **Tema:** sigue el modo claro/oscuro del sistema (`prefers-color-scheme`) y reacciona en vivo a los cambios. El botón de la cabecera permite forzar uno; la elección se guarda en `chrome.storage.local` bajo la clave `theme`.
- **Idioma:** la interfaz se traduce con `chrome.i18n` según el idioma de Chrome (heredado del sistema). Idiomas incluidos: español (por defecto), inglés, francés, alemán, italiano y portugués de Brasil. Cualquier otro idioma cae en español.
- Para añadir un idioma basta con copiar `_locales/es/messages.json` a `_locales/<código>/` y traducir los valores de `message`.

## Modelo de datos
Cada tarea se representa como un objeto:
```json
{
  "id": "identificador único",
  "text": "texto de la tarea",
  "completed": false
}
```
Las tareas se guardan como un array en `chrome.storage.local`.

## Ventana de marcadores
Se abre con el botón de marcador de la cabecera del panel lateral. Es una ventana emergente
(`chrome.windows.create` con `type: "popup"`) de 940x660, no una pestaña más: aparece centrada
sobre la ventana actual y sólo hay una a la vez — si ya está abierta, se trae al frente.

- **Izquierda:** árbol de carpetas plegable, con el total de marcadores de cada una. Las carpetas
  raíz vacías (p. ej. "Móvil" si no se usa Chrome en el teléfono) no se muestran.
- **Derecha:** migas de pan, buscador y el contenido de la carpeta, en rejilla o en lista.
- **Buscador:** filtra por título y por dirección sobre todos los marcadores, sin acentos ni
  mayúsculas, y muestra en qué carpeta vive cada resultado. Se llega a él con `/` o Ctrl/⌘+F.
- **Abrir:** un clic lleva al marcador en la ventana desde la que se abrieron los marcadores y
  cierra esta; con Ctrl/⌘ o el botón central se abre detrás y la lista sigue delante.
- **Editar:** el menú contextual permite abrir en pestaña nueva, copiar la dirección, renombrar
  (en línea) y eliminar. Borrar una carpeta con contenido pide confirmación.
- **Mover:** arrastrar un marcador o una carpeta sobre una carpeta del árbol lo mueve allí.
- Los cambios hechos desde cualquier otro sitio de Chrome se reflejan al momento
  (`chrome.bookmarks.onCreated`, `onRemoved`, `onChanged`, `onMoved`, `onChildrenReordered`).

El estado de la vista (carpeta abierta, carpetas desplegadas y rejilla/lista) se guarda, así que
al reabrir la ventana se vuelve donde se estaba.

## Flujo de uso
1. El usuario abre la extensión haciendo clic en el icono de la barra de Chrome.
2. Escribe una tarea en el input y pulsa Enter.
3. La tarea aparece en la lista.
4. Al hacer clic sobre una tarea (o su checkbox), se marca como completada (tachado/estilo distinto).
5. Al hacer clic en el icono de eliminar, la tarea desaparece de la lista y del storage.

## Posibles mejoras futuras
- Categorías o etiquetas por tarea
- Fechas límite y recordatorios
- ~~Modo oscuro~~ (hecho: se adapta al tema del sistema con `prefers-color-scheme`)
- Sincronización entre dispositivos (`chrome.storage.sync` en vez de `local`)
- Filtros (todas / pendientes / completadas)
- Convertir un marcador en tarea desde su menú contextual
- Reordenar marcadores dentro de una carpeta arrastrándolos

## Instalación (modo desarrollador)
1. Abrir `chrome://extensions` en Chrome.
2. Activar el **Modo de desarrollador** (interruptor arriba a la derecha).
3. Pulsar **Cargar descomprimida** y seleccionar esta carpeta.
4. Fijar la extensión en la barra de herramientas y hacer clic en su icono.

## Estado
🟢 Implementado — tareas, proyectos y la ventana de marcadores están operativos.
