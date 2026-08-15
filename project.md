# Todo List — Extensión de Google Chrome

## Descripción
Extensión de Google Chrome que permite gestionar una lista de tareas pendientes directamente desde el navegador. El usuario puede crear tareas, marcarlas como completadas y eliminarlas.

## Funcionalidades
- [x] Crear una nueva tarea
- [x] Marcar una tarea como completada
- [x] Eliminar una tarea
- [x] Persistencia de las tareas entre sesiones (aunque se cierre el navegador)

## Stack tecnológico
- **HTML** — estructura del popup
- **CSS** — estilos de la interfaz
- **JavaScript (vanilla)** — lógica de la aplicación
- **Chrome Extensions API (Manifest V3)**
  - `chrome.storage.local` para persistir las tareas

## Estructura de archivos
```
todo-extension/
├── manifest.json     # Configuración de la extensión
├── popup.html        # Interfaz del popup
├── popup.css          # Estilos
├── popup.js          # Lógica (añadir, completar, eliminar, guardar)
└── icons/             # Iconos de la extensión (16, 48, 128 px)
```

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

## Flujo de uso
1. El usuario abre la extensión haciendo clic en el icono de la barra de Chrome.
2. Escribe una tarea en el input y pulsa "Añadir" (o Enter).
3. La tarea aparece en la lista.
4. Al hacer clic sobre una tarea (o su checkbox), se marca como completada (tachado/estilo distinto).
5. Al hacer clic en el icono de eliminar, la tarea desaparece de la lista y del storage.

## Posibles mejoras futuras
- Categorías o etiquetas por tarea
- Fechas límite y recordatorios
- ~~Modo oscuro~~ (hecho: se adapta al tema del sistema con `prefers-color-scheme`)
- Sincronización entre dispositivos (`chrome.storage.sync` en vez de `local`)
- Filtros (todas / pendientes / completadas)

## Instalación (modo desarrollador)
1. Abrir `chrome://extensions` en Chrome.
2. Activar el **Modo de desarrollador** (interruptor arriba a la derecha).
3. Pulsar **Cargar descomprimida** y seleccionar esta carpeta.
4. Fijar la extensión en la barra de herramientas y hacer clic en su icono.

## Estado
🟢 Implementado — las cuatro funcionalidades principales están operativas.
