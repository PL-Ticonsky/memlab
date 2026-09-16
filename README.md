# MemLab 16 MiB

Simulador interactivo de **gestión de memoria principal** sobre un espacio
direccionable de 16 MiB (`2^24` bytes, `0x000000`–`0xFFFFFF`), pensado como
material de estudio para sistemas operativos: particiones fijas, variables
y dinámicas, algoritmos de ajuste, fragmentación interna/externa y
compactación.

No tiene backend ni dependencias de build: es HTML + CSS + JavaScript
vainilla. Basta con abrir `index.html` en un navegador.

## Estructura del proyecto

```
memlab/
├── index.html      Markup y metadatos únicamente
├── css/
│   └── style.css    Toda la hoja de estilos (comentada por sección)
├── js/
│   └── script.js    Toda la lógica del simulador (comentada por sección)
└── README.md        Este archivo
```

La documentación detallada de *qué hace cada función* vive como
comentarios dentro de `style.css` y `script.js`, no aquí — este README
solo explica el panorama general y cómo usarlo.

## Cómo ejecutarlo

No requiere servidor ni instalación:

1. Descarga o clona el repositorio.
2. Abre `index.html` con doble clic, o sírvelo con cualquier servidor
   estático (por ejemplo `python3 -m http.server` desde la carpeta del
   proyecto, o publicándolo con **GitHub Pages** apuntando a `main`).

## Qué simula

El sistema modela 16 MiB de memoria física, de los cuales una porción
inicial (configurable: 1, 2 o 4 MiB) está reservada para el sistema
operativo. El resto ("memoria de usuario") se gestiona con uno de tres
métodos, seleccionables desde las pestañas superiores:

### 1 · Particiones estáticas de tamaño fijo
La memoria de usuario se divide en N particiones iguales al arrancar
(2 a 16, configurable). Un programa se carga en la primera partición
libre que le quepa. Si el programa es más pequeño que la partición,
el espacio sobrante es **fragmentación interna** (se pierde: nadie más
puede usarlo mientras esa partición esté ocupada).

### 2 · Particiones estáticas de tamaño variable
Igual que el método 1, pero con una tabla de particiones de tamaños
distintos que tú defines (añadiendo o quitando entradas en KiB). Aquí
sí aplica el algoritmo de ajuste:

- **Primer ajuste**: la primera partición libre donde el programa quepa.
- **Mejor ajuste**: la partición libre más pequeña que aún así le quepa
  (minimiza el desperdicio de esa asignación, pero puede dejar particiones
  pequeñas inutilizables a la larga).
- **Peor ajuste**: la partición libre más grande (deja restos más
  grandes, potencialmente más reutilizables después).

### 3 · Particiones dinámicas
No hay particiones predefinidas: se crean "huecos" a medida que los
programas se cargan y liberan, del tamaño exacto que cada uno necesita.
Por eso **no hay fragmentación interna** en este método. En cambio, con
el tiempo aparece **fragmentación externa**: memoria libre de sobra,
pero repartida en huecos pequeños y no contiguos, insuficiente para
admitir un programa grande aunque la suma total alcance.

Para resolverlo existe la **compactación**: reubica todos los procesos
cargados de forma contigua, dejando toda la memoria libre unida en un
solo bloque al final. Puede lanzarse manualmente o activarse en modo
automático (se dispara sola cuando un programa es rechazado por falta
de espacio contiguo, pero sí hay espacio total suficiente).

## Elementos de la interfaz

- **Mapa de memoria**: representa los 16 MiB como una columna de bloques
  apilados, cada uno con una altura proporcional a su tamaño real. Haz
  clic en un bloque para ver su rango de direcciones y, si está ocupado,
  el desglose interno de sus 4 segmentos (código, datos, pila, heap).
- **KPIs**: utilización de memoria, fragmentación interna, fragmentación
  externa, tamaño del mayor bloque libre disponible y conteo de procesos
  cargados vs. en cola.
- **Programas simulados**: cola de "trabajos" (8 programas de ejemplo
  predefinidos, más los que quieras añadir a mano) con botones para
  cargarlos o liberarlos individualmente.
- **Bitácora**: registro cronológico de cada evento del gestor de
  memoria (asignación, liberación, rechazo, compactación, cambios de
  configuración) con la explicación de por qué ocurrió.
- **Escenario de fragmentación**: botón que carga varios programas y
  libera algunos intercalados, para provocar fragmentación externa
  visible de inmediato (útil para ver el efecto de la compactación en
  particiones dinámicas).

## Licencia

Sin licencia definida todavía — añade la que prefieras (MIT es una
opción común para este tipo de material educativo) antes de hacerlo
público si te importa dejarlo explícito.
