# MemLab 16 MiB

Simulador interactivo de **gestión de memoria principal** sobre un espacio
direccionable de 16 MiB (`2^24` bytes, `0x000000`–`0xFFFFFF`), pensado como
material de estudio para sistemas operativos: particiones fijas, variables
y dinámicas, segmentación, algoritmos de ajuste, fragmentación interna/externa
y compactación.

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
métodos, agrupados en memoria contigua y no contigua:

### 1 · Particiones estáticas de tamaño fijo
Indicas el tamaño de cada partición en KiB; el simulador crea tantas
particiones iguales como quepan en la memoria de usuario. El sobrante
queda sin particionar. Un programa se carga en la primera partición
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

### 4 · Segmentación (memoria no contigua)

Cada programa se representa mediante seis segmentos lógicos numerados
desde 0: `.text`, `.rodata`, `.data`, `.bss`, `.stack` y `.heap`. Los cuatro
primeros son nombres habituales de secciones de un ejecutable; pila y
heap son regiones de memoria durante la ejecución. En el simulador las
seis son unidades asignables para mostrar la traducción lógica a física.

Al cargar un programa, cada segmento se asigna por **mejor ajuste** al
hueco libre más pequeño en el que cabe. Si falla cualquiera de los seis,
no se asigna ninguno. Cada clic en **Abrir instancia** intenta cargar una
copia independiente del programa. Las copias se nombran en secuencia
(por ejemplo, `Hoja de cálculo 1` y `Hoja de cálculo 2`) y cada una tiene
su propio botón **Eliminar**. Selecciona una instancia para ver sus seis
partes y su tabla de segmentación (número lógico, base física y tamaño).
El mapa resalta a la vez todos los bloques de esa instancia, aunque estén
separados. Al eliminarla se devuelven solo sus segmentos y se fusionan
los huecos adyacentes; las demás copias permanecen cargadas.

Los programas de ejemplo conservan sus tamaños originales: código se
desglosa en `.text` y `.rodata`, y datos en `.data` y `.bss`. Al añadir un
programa en segmentación puedes definir directamente los seis tamaños.

## Elementos de la interfaz

- **Mapa de memoria**: representa los 16 MiB como una columna de bloques
  apilados, cada uno con una altura proporcional a su tamaño real. Haz
  clic en un bloque para ver su rango de direcciones y, si está ocupado,
  el desglose interno de sus cuatro categorías en memoria contigua. En
  segmentación, señala los seis bloques de un programa seleccionado.
- **KPIs**: utilización de memoria, fragmentación interna, fragmentación
  externa o espacio libre disperso, tamaño del mayor bloque libre y
  cantidad de instancias cargadas.
- **Programas simulados**: catálogo de 8 programas de ejemplo, ampliable
  con programas propios. El catálogo permite abrir tantas instancias
  como admita la memoria. Debajo aparecen las instancias cargadas, cada
  una con su nombre numerado y su propio botón **Eliminar**.
- **Bitácora**: registro cronológico de toda acción relevante al usar
  el simulador — asignación, liberación, fusión de huecos contiguos,
  rechazo, compactación, cambios de configuración e inspección de
  bloques — donde cada línea explica qué ocurrió y, cuando corresponde,
  por qué (qué regla o condición del gestor lo motivó). Pensada como
  material de trazabilidad: se puede reconstruir, paso a paso, el
  razonamiento detrás de cada decisión de asignación de memoria.
- **Escenario de fragmentación**: botón que carga varios programas y
  libera algunos intercalados, para provocar fragmentación externa
  visible de inmediato (útil para ver el efecto de la compactación en
  particiones dinámicas).
- **Escenario no contiguo**: en segmentación, prepara huecos alrededor
  de otra instancia y carga `Hoja de cálculo 1` con segmentos físicos
  separados. También abre `Hoja de cálculo 2` para mostrar que dos copias
  del mismo programa tienen asignaciones independientes. El escenario
  reemplaza las instancias cargadas y conserva el catálogo de programas.

## Licencia

Sin licencia definida todavía — añade la que prefieras (MIT es una
opción común para este tipo de material educativo) antes de hacerlo
público si te importa dejarlo explícito.
