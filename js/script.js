/* ============================================================
   MemLab 16 MiB — simulador de gestión de memoria
   ============================================================
   Simula un espacio de direcciones de 16 MiB (2^24 bytes,
   0x000000–0xFFFFFF) bajo multiprogramación con particiones,
   soportando cuatro métodos de gestión de memoria clásicos:

     1. Particiones ESTÁTICAS de tamaño FIJO
        Se divide la memoria de usuario en N particiones
        iguales al arrancar. Un proceso entra en la primera
        partición libre que le quepa. Genera fragmentación
        interna (espacio sobrante dentro de la partición).

     2. Particiones ESTÁTICAS de tamaño VARIABLE
        Igual que el método 1, pero con una tabla de
        particiones de tamaños distintos definida a mano.
        Permite elegir el algoritmo de ajuste (primero/
        mejor/peor) entre las particiones que quepan.

     3. Particiones DINÁMICAS
        No hay particiones fijas: se crean "huecos" a medida
        que se cargan y liberan procesos. No hay fragmentación
        interna, pero sí fragmentación EXTERNA (huecos libres
        no contiguos). Soporta compactación manual o automática
        para reunir los huecos en uno solo.

     4. SEGMENTACIÓN no contigua
        El programa tiene seis segmentos lógicos. Cada uno se
        asigna a un hueco físico por mejor ajuste, con una tabla
        que relaciona número, base y tamaño.

   No usa frameworks: es JS vainilla que manipula el DOM
   directamente. El estado vive en variables de módulo dentro
   del IIFE (mem, progs, bitacora, cfg) y cada mutación termina
   llamando a render() para redibujar toda la interfaz.

   Estructura del archivo:
     1. Modelo de datos y configuración inicial (cfg, BASE_PROGS)
     2. Utilidades de formato (hex, fmt, miles)
     3. Construcción de la memoria según el método elegido
     4. Asignación de procesos (cargar/liberar/elegir/fusionar)
     5. Compactación (solo aplica a particiones dinámicas)
     6. Cálculo de métricas (utilización, fragmentación)
     7. Renderizado (mapa, KPIs, tablas, detalle, bitácora)
     8. Escenarios predefinidos y manejadores de eventos
     9. Arranque de la simulación
   ============================================================ */

(function(){
  "use strict";

  /* ============ Modelo de datos ============
     KiB/MiB/TOTAL: unidades base. TOTAL = 16 MiB direccionables.
     BASE_PROGS: catálogo de programas "de ejemplo" que se
     siembran al arrancar (con cuatro categorías contiguas que
     se desglosan en seis segmentos para el método no contiguo).
     progs: catálogo de programas y sus instancias cargadas.
     cfg: configuración activa (método, algoritmo de ajuste,
     tamaño del S.O., tamaño de particiones, auto-compactación). */
  var KiB = 1024, MiB = 1048576, TOTAL = 16 * MiB;

  var COLORES = ["#3B6FE0","#0F8A79","#C2632A","#7B5BD6","#1E86B4","#B03A6E","#7E8B16","#8B5E34","#2B7FA1","#A24B4B"];

  var BASE_PROGS = [
    { nombre:"Editor de texto",   segs:{codigo:640,  datos:256,  pila:64,  heap:64   } },
    { nombre:"Compilador C",      segs:{codigo:1280, datos:512,  pila:128, heap:128  } },
    { nombre:"Navegador web",     segs:{codigo:1408, datos:1024, pila:256, heap:1152 } },
    { nombre:"Motor de base de datos", segs:{codigo:768, datos:1536, pila:128, heap:640 } },
    { nombre:"Terminal",          segs:{codigo:192,  datos:96,   pila:32,  heap:128  } },
    { nombre:"Render 3D",         segs:{codigo:1024, datos:2048, pila:256, heap:2816 } },
    { nombre:"Servicio de red",   segs:{codigo:224,  datos:128,  pila:32,  heap:384  } },
    { nombre:"Hoja de cálculo",   segs:{codigo:512,  datos:768,  pila:64,  heap:192  } }
  ];

  var SEGS = [
    { k:"codigo", n:"Código",  c:"s-cod" },
    { k:"datos",  n:"Datos",   c:"s-dat" },
    { k:"pila",   n:"Pila",    c:"s-pil" },
    { k:"heap",   n:"Montículo", c:"s-hea" }
  ];
  var SEG6 = [
    { k:"text", n:".text", c:"s-cod" },
    { k:"rodata", n:".rodata", c:"s-rod" },
    { k:"data", n:".data", c:"s-dat" },
    { k:"bss", n:".bss", c:"s-bss" },
    { k:"stack", n:".stack", c:"s-pil" },
    { k:"heap", n:".heap", c:"s-hea" }
  ];

  var cfg = {
    metodo:"fija",
    algo:"primero",
    so: 2 * MiB,
    tamFija: 2048 * KiB,
    variables: [512, 1024, 1536, 2048, 3072, 6144],
    autoCompact: false
  };

  var mem = [], progs = [], bitacora = [], reloj = 0, sel = null, selProg = null, selPlantilla = null;
  var uid = 1, pid = 1, plantillaNumero = 1;

  /* ============ Utilidades de formato ============
     hex(n)   → dirección en formato 0xRRGGBB (6 hex, mayúsculas)
     fmt(b)   → bytes legibles en KiB o MiB
     miles(n) → separador de miles para lectura humana
     prog(id) → busca un programa por su pid
     esc(s)   → escapa HTML para insertar texto de usuario sin XSS */
  function hex(n){ return "0x" + n.toString(16).toUpperCase().padStart(6,"0"); }
  function miles(n){ return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
  function fmt(bytes){
    if (bytes === 0) return "0 KiB";
    var k = bytes / KiB;
    if (k >= 1024){
      var m = k / 1024;
      return (Number.isInteger(m) ? m : (Math.round(m*100)/100)) + " MiB";
    }
    return miles(Number.isInteger(k) ? k : Math.round(k*10)/10) + " KiB";
  }
  function prog(id){ for (var i=0;i<progs.length;i++) if (progs[i].pid === id) return progs[i]; return null; }
  function plantillas(){ return progs.filter(function(p){ return !p.instancia; }); }
  function instancias(){ return progs.filter(function(p){ return p.instancia; }); }
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"})[c]; }); }

  function addLog(tipo, texto){
    reloj++;
    bitacora.unshift({ t:reloj, tipo:tipo, texto:texto });
    if (bitacora.length > 80) bitacora.pop();
  }

  function seisSegmentos(segs){
    var rod = Math.floor(segs.codigo / 4), bss = Math.floor(segs.datos / 4);
    return { text:segs.codigo - rod, rodata:rod, data:segs.datos - bss,
      bss:bss, stack:segs.pila, heap:segs.heap };
  }
  function nuevoPrograma(nombre, segs, seg6){
    var total = 0;
    for (var i=0;i<SEGS.length;i++) total += segs[SEGS[i].k];
    return {
      pid: pid++,
      etq: "P" + plantillaNumero,
      nombre: nombre,
      segs: segs,
      seg6: seg6 || seisSegmentos(segs),
      size: total * KiB,
      color: COLORES[(plantillaNumero++ - 1) % COLORES.length],
      estado: "cola",
      base: null,
      blk: null,
      tabla: [],
      instancia: false,
      cargas: 0
    };
  }

  function nuevaInstancia(plantilla){
    var numero = plantilla.cargas + 1;
    return Object.assign({}, plantilla, {
      pid:pid, etq:plantilla.etq + "." + numero,
      nombre:plantilla.nombre + " " + numero,
      plantilla:plantilla.pid, instancia:true,
      estado:"cola", base:null, blk:null, tabla:[]
    });
  }

  function registrarInstancia(plantilla, instancia){
    plantilla.cargas++;
    pid++;
    progs.push(instancia);
    return instancia;
  }

  function sembrarProgramas(){
    progs = []; pid = 1; plantillaNumero = 1;
    for (var i=0;i<BASE_PROGS.length;i++){
      progs.push(nuevoPrograma(BASE_PROGS[i].nombre, Object.assign({}, BASE_PROGS[i].segs)));
    }
  }

  /* ============ Construcción de memoria ============
     construirMemoria() reconstruye el arreglo `mem` desde cero
     cada vez que cambia el método o la configuración:
       - Siempre reserva el bloque de S.O. al inicio (base 0).
       - Método "fija": tantas particiones como quepan del
         tamaño definido por el usuario (tamFija()).
       - Método "variable": una partición por cada tamaño en
         cfg.variables, en el orden dado.
       - Métodos "dinamica" y "segmentacion": un único hueco
         gigante que se parte a medida que se asigna memoria.
       - Si sobra espacio sin cubrir por las particiones, se
         marca como "reservado" (no utilizable).
     Las instancias cargadas se cierran al reconstruir la memoria;
     sus plantillas permanecen en el catálogo. */
  function tamFija(){
    return cfg.tamFija;
  }

  function construirMemoria(motivo){
    var cerradas = instancias().length;
    mem = [];
    mem.push({ id:uid++, base:0, size:cfg.so, tipo:"so", pid:null, fija:true });
    var base = cfg.so, i;

    if (cfg.metodo === "fija"){
      var ps = tamFija();
      var cantidad = Math.floor((TOTAL - cfg.so) / ps);
      for (i=0;i<cantidad;i++){
        mem.push({ id:uid++, base:base, size:ps, tipo:"particion", idx:i+1, pid:null, fija:true });
        base += ps;
      }
    } else if (cfg.metodo === "variable"){
      for (i=0;i<cfg.variables.length;i++){
        var s = cfg.variables[i] * KiB;
        if (base + s > TOTAL) break;
        mem.push({ id:uid++, base:base, size:s, tipo:"particion", idx:i+1, pid:null, fija:true });
        base += s;
      }
    } else {
      mem.push({ id:uid++, base:base, size:TOTAL - base, tipo:"hueco", pid:null, fija:false });
      base = TOTAL;
    }

    if (base < TOTAL) mem.push({ id:uid++, base:base, size:TOTAL - base, tipo:"reservado", pid:null, fija:true });

    progs = plantillas();
    for (i=0;i<progs.length;i++){ progs[i].estado = "cola"; progs[i].base = null; progs[i].blk = null; progs[i].tabla = []; }
    sel = null; selProg = null; selPlantilla = null;
    if (motivo) addLog("config", motivo + (cerradas ? " · " + cerradas + " instancias cargadas se cerraron." : ""));
  }

  /* ============ Asignación de procesos ============
     libres()  → bloques candidatos a recibir un proceso.
     elegir()  → aplica el algoritmo de ajuste:
                   - "fija": siempre la primera (todas miden igual).
                   - "primero": primer bloque que quepa.
                   - "mejor": el bloque libre más pequeño que
                     aún así quepa el proceso (minimiza el resto).
                   - "peor": el bloque libre más grande (deja
                     restos más grandes y reutilizables).
     cargar()  → intenta meter un proceso en memoria. Si no cabe
                 en ningún bloque y el método es dinámico con
                 auto-compactación activada, compacta primero y
                 reintenta. Si aún así no cabe, el proceso queda
                 "rechazado" y se explica el motivo en la bitácora
                 (frag. interna vs. frag. externa según el método).
                 En particiones dinámicas, si el hueco elegido es
                 más grande que el proceso, se parte en dos: el
                 proceso ocupa el tamaño exacto y el resto queda
                 como un nuevo hueco libre (sin fragmentación
                 interna, a diferencia de las particiones fijas).
     liberar() → libera el bloque de un proceso cargado. En
                 particiones dinámicas, el bloque vuelve a ser
                 "hueco" y se intenta fusionar con huecos vecinos
                 (fusionar()), que es la única forma de reducir
                 la fragmentación externa sin compactar. La bitácora
                 registra si hubo fusión, porque es el evento que
                 explica por qué la fragmentación externa bajó sin
                 haber compactado.
     fusionar()→ combina huecos contiguos en uno solo y devuelve
                 cuántas fusiones hizo, para que quien llama pueda
                 explicar el efecto en la bitácora. */
  function libres(){
    return mem.filter(function(b){ return b.pid === null && (b.tipo === "particion" || b.tipo === "hueco"); });
  }


  function elegir(cands, algoritmo){
    if (cfg.metodo === "fija") return cands[0];
    var ajuste = algoritmo || cfg.algo;
    if (ajuste === "primero") return cands[0];
    var best = cands[0];
    for (var i=1;i<cands.length;i++){
      if (ajuste === "mejor" ? cands[i].size < best.size : cands[i].size > best.size) best = cands[i];
    }
    return best;
  }


  function nombreBloque(b){
    if (b.tipo === "so") return "sistema operativo";
    if (b.tipo === "hueco") return "hueco " + hex(b.base);
    if (b.tipo === "segmento") return "segmento " + b.seg + " " + SEG6[b.seg].n;
    if (b.tipo === "reservado") return "zona no particionada";
    return "partición " + b.idx;
  }

  function cargar(id, silencioso){
    var plantilla = prog(id);
    if (!plantilla || plantilla.instancia) return null;
    var p = nuevaInstancia(plantilla);
    if (cfg.metodo === "segmentacion"){
      return cargarSegmentado(p, silencioso) ? registrarInstancia(plantilla, p) : null;
    }
    var l = libres();
    var cands = l.filter(function(b){ return b.size >= p.size; });

    if (!cands.length && cfg.metodo === "dinamica" && cfg.autoCompact){
      var totalLibre = l.reduce(function(a,b){ return a + b.size; }, 0);
      if (totalLibre >= p.size){
        compactar(true);
        l = libres();
        cands = l.filter(function(b){ return b.size >= p.size; });
      }
    }

    if (!cands.length){
      var mayor = l.length ? Math.max.apply(null, l.map(function(b){ return b.size; })) : 0;
      var libreTotal = l.reduce(function(a,b){ return a + b.size; }, 0);
      var razon;
      if (cfg.metodo === "fija"){
        razon = p.etq + " (" + fmt(p.size) + ") rechazado · las particiones miden " + fmt(tamFija()) +
                (mayor >= p.size ? "" : (libreTotal >= p.size ? " y no se pueden combinar" : " y todas están ocupadas"));
      } else if (cfg.metodo === "variable"){
        razon = p.etq + " (" + fmt(p.size) + ") rechazado · mayor partición libre " + fmt(mayor) +
                (libreTotal >= p.size ? " · hay " + fmt(libreTotal) + " libres pero en particiones separadas" : "");
      } else {
        razon = p.etq + " (" + fmt(p.size) + ") rechazado · mayor hueco " + fmt(mayor) +
                (libreTotal > mayor ? " · " + fmt(libreTotal) + " libres repartidos en " + l.length + " huecos → fragmentación externa; compacta para cargarlo" : "");
      }
      p.estado = "rechazado";
      addLog("rechazo", razon);
      return null;
    }

    var b = elegir(cands);
    var etiqAlgo = cfg.metodo === "fija" ? "primera partición libre" :
      (cfg.algo === "primero" ? "primer ajuste" : cfg.algo === "mejor" ? "mejor ajuste" : "peor ajuste");

    if (b.fija){
      b.pid = p.pid;
    } else {
      if (b.size > p.size){
        var resto = { id:uid++, base:b.base + p.size, size:b.size - p.size, tipo:"hueco", pid:null, fija:false };
        b.size = p.size;
        mem.splice(mem.indexOf(b) + 1, 0, resto);
      }
      b.tipo = "proceso"; b.pid = p.pid;
    }
    p.estado = "cargado"; p.base = b.base; p.blk = b.id;
    var fi = b.size - p.size;
    if (!silencioso){
      addLog("asigna", p.etq + " → " + nombreBloque(b) + " · " + hex(b.base) + "–" + hex(b.base + b.size - 1) +
        " · " + etiqAlgo + (fi > 0 ? " · frag. interna " + fmt(fi) : " · sin frag. interna"));
    }
    return registrarInstancia(plantilla, p);
  }

  function cargarSegmentado(p, silencioso){
    var borrador = mem.map(function(b){ return Object.assign({}, b); });
    var tabla = [];
    var nextUid = uid;
    for (var i=0;i<SEG6.length;i++){
      var size = p.seg6[SEG6[i].k] * KiB;
      if (size === 0){ tabla.push({ numero:i, base:null, size:0, blk:null }); continue; }
      var candidatos = borrador.filter(function(b){ return b.tipo === "hueco" && b.size >= size; });
      if (!candidatos.length){
        p.estado = "rechazado";
        addLog("rechazo", p.etq + " rechazado: " + SEG6[i].n + " (" + fmt(size) +
          ") no cabe en ningún hueco. No se asignó ningún segmento del programa.");
        return false;
      }
      var b = elegir(candidatos, "mejor");
      if (b.size > size){
        borrador.splice(borrador.indexOf(b) + 1, 0, {
          id:nextUid++, base:b.base + size, size:b.size - size, tipo:"hueco", pid:null, fija:false
        });
        b.size = size;
      }
      b.tipo = "segmento"; b.pid = p.pid; b.seg = i;
      tabla.push({ numero:i, base:b.base, size:size, blk:b.id });
    }
    mem = borrador;
    uid = nextUid;
    p.estado = "cargado"; p.base = null; p.blk = null; p.tabla = tabla;
    if (!silencioso) addLog("asigna", p.etq + " cargado: seis segmentos por mejor ajuste; consulta su tabla de segmentación para relacionar direcciones lógicas y físicas.");
    return true;
  }

  function liberar(id, silencioso){
    var p = prog(id);
    if (!p || !p.instancia || p.estado !== "cargado") return;
    if (cfg.metodo === "segmentacion"){
      var segmentos = mem.filter(function(b){ return b.pid === p.pid; });
      segmentos.forEach(function(b){ b.pid = null; b.seg = null; b.tipo = "hueco"; });
      var uniones = fusionar();
      olvidarInstancia(p);
      if (!silencioso) addLog("libera", p.etq + " · " + esc(p.nombre) + " elimina sus " + segmentos.length + " segmentos físicos; " + uniones + " huecos vecinos se fusionan.");
      return;
    }
    var b = null;
    for (var i=0;i<mem.length;i++) if (mem[i].pid === p.pid) b = mem[i];
    if (!b) return;
    var donde = nombreBloque(b), rango = hex(b.base) + "–" + hex(b.base + b.size - 1);
    b.pid = null;
    var fusiones = 0;
    if (!b.fija){ b.tipo = "hueco"; fusiones = fusionar(); }
    olvidarInstancia(p);
    if (!silencioso){
      var msg = p.etq + " termina y libera " + donde + " · " + rango;
      if (fusiones > 0){
        msg += " · el hueco resultante se fusiona con " + fusiones + (fusiones === 1 ? " hueco vecino" : " huecos vecinos") +
          " por ser contiguos → baja la fragmentación externa sin necesidad de compactar";
      }
      addLog("libera", msg);
    }
  }

  function olvidarInstancia(p){
    var indice = progs.indexOf(p);
    if (indice !== -1) progs.splice(indice, 1);
    if (selProg === p.pid){ selProg = null; selPlantilla = cfg.metodo === "segmentacion" ? p.plantilla : null; }
  }

  function fusionar(){
    var fusiones = 0;
    for (var i=0;i<mem.length-1;){
      if (mem[i].tipo === "hueco" && mem[i+1].tipo === "hueco"){
        mem[i].size += mem[i+1].size;
        mem.splice(i+1, 1);
        fusiones++;
      } else i++;
    }
    return fusiones;
  }

  /* Compactación: solo tiene sentido en particiones dinámicas,
     porque las particiones fijas/variables no se pueden mover
     (sus límites están predefinidos). Reubica todos los procesos
     ocupados de forma contigua a partir del final del bloque de
     S.O., eliminando toda la fragmentación externa y dejando un
     único hueco grande al final. auto=true cuando la llama
     cargar() automáticamente al no encontrar espacio. */
  function compactar(auto){
    if (cfg.metodo !== "dinamica"){
      addLog("nota", "La compactación sólo aplica a particiones dinámicas: las estáticas no se pueden reubicar.");
      return;
    }
    var ocupados = mem.filter(function(b){ return b.tipo === "proceso" && b.pid !== null; })
                      .sort(function(a,b){ return a.base - b.base; });
    if (!ocupados.length){ addLog("nota", "Nada que compactar: no hay procesos cargados."); return; }
    var antes = libres().length;
    var base = cfg.so, movidos = 0;
    for (var i=0;i<ocupados.length;i++){
      if (ocupados[i].base !== base) movidos++;
      ocupados[i].base = base;
      var p = prog(ocupados[i].pid);
      if (p) p.base = base;
      base += ocupados[i].size;
    }
    var so = mem.filter(function(b){ return b.tipo === "so"; });
    mem = so.concat(ocupados);
    if (base < TOTAL) mem.push({ id:uid++, base:base, size:TOTAL - base, tipo:"hueco", pid:null, fija:false });
    addLog("compacta", (auto ? "Compactación automática · " : "Compactación · ") + movidos + " de " + ocupados.length +
      " procesos reubicados, " + antes + " huecos → 1 hueco de " + fmt(TOTAL - base) + " en " + hex(base));
  }

  /* ============ Métricas ============
     Calcula, a partir del estado actual de `mem` y `progs`:
       - usado / usuario: bytes ocupados vs. bytes disponibles
         para procesos (TOTAL menos el S.O.).
       - fragInt: suma de espacio perdido dentro de particiones
         ocupadas (solo aplica a fija/variable).
       - fragExt: memoria libre que no puede usarse por estar
         repartida en varios huecos no contiguos (en dinámica,
         es libreTotal menos el hueco más grande; en fija/
         variable, toda partición libre cuenta como frag.
         externa porque no se pueden combinar).
       - util: porcentaje de utilización de la memoria de usuario. */
  function metricas(){
    var usuario = TOTAL - cfg.so, usado = 0, fragInt = 0, i, p;
    for (i=0;i<mem.length;i++){
      if (mem[i].pid !== null){
        p = prog(mem[i].pid);
        if (p){
          if (cfg.metodo === "segmentacion") usado += mem[i].size;
          else { usado += p.size; fragInt += mem[i].size - p.size; }
        }
      }
    }
    var l = libres();
    var libreTotal = l.reduce(function(a,b){ return a + b.size; }, 0);
    var mayor = l.length ? Math.max.apply(null, l.map(function(b){ return b.size; })) : 0;
    var reservado = mem.filter(function(b){ return b.tipo === "reservado"; })
                       .reduce(function(a,b){ return a + b.size; }, 0);
    var fragExt = (cfg.metodo === "dinamica" || cfg.metodo === "segmentacion") ? libreTotal - mayor : libreTotal;
    return {
      usuario: usuario, usado: usado, fragInt: fragInt, libreTotal: libreTotal,
      mayor: mayor, huecos: l.length, reservado: reservado, fragExt: fragExt,
      cargados: instancias().length,
      cola: plantillas().length,
      util: usuario ? usado / usuario : 0
    };
  }

  /* ============ Renderizado ============
     render() es el único punto de entrada que redibuja toda la
     interfaz tras cualquier cambio de estado. Se apoya en
     funciones especializadas por sección: controles, KPIs, el
     mapa de bloques, el panel de detalle, la tabla de programas
     y la bitácora. No hay virtual DOM: cada función regenera su
     innerHTML por completo (aceptable dado el tamaño reducido
     del estado). */
  var $ = function(s){ return document.querySelector(s); };

  function render(){
    renderControles();
    renderKPIs();
    renderMapa();
    renderDetalle();
    renderProgs();
    renderLog();
  }

  function renderControles(){
    var t = document.querySelectorAll(".tab");
    for (var i=0;i<t.length;i++) t[i].setAttribute("aria-pressed", String(t[i].dataset.metodo === cfg.metodo));
    var a = document.querySelectorAll("#algo button");
    for (i=0;i<a.length;i++){
      a[i].setAttribute("aria-pressed", String(a[i].dataset.algo === (cfg.metodo === "segmentacion" ? "mejor" : cfg.algo)));
      a[i].disabled = cfg.metodo === "fija" || cfg.metodo === "segmentacion";
    }

    $("#f-fijas").hidden = cfg.metodo !== "fija";
    $("#f-variables").hidden = cfg.metodo !== "variable";
    $("#f-dinamica").hidden = cfg.metodo !== "dinamica";
    $("#f-segmentacion").hidden = cfg.metodo !== "segmentacion";
    $("#algo").setAttribute("aria-disabled", String(cfg.metodo === "fija" || cfg.metodo === "segmentacion"));
    $("#algo-hint").innerHTML = cfg.metodo === "fija"
      ? "No aplica: todas las particiones miden lo mismo, así que el gestor toma la primera libre."
      : cfg.metodo === "segmentacion" ? "Segmentación usa siempre mejor ajuste para cada uno de los seis segmentos."
      : (cfg.metodo === "variable"
        ? "Se elige entre las particiones libres que <em>quepan</em>: la primera, la más ajustada o la más grande."
        : "Se elige entre los huecos libres que quepan. Peor ajuste deja restos grandes; mejor ajuste, restos diminutos.");

    var ps = tamFija();
    var cantidad = Math.floor((TOTAL - cfg.so) / ps);
    $("#fijas-hint").innerHTML = "Se crean <b class=\"mono\">" + cantidad + "</b> particiones de " + fmt(ps) +
      ". Sobrante sin particionar: " + fmt((TOTAL - cfg.so) % ps) + ".";
    var sumaVar = cfg.variables.reduce(function(a,b){ return a + b; }, 0);
    $("#var-hint").innerHTML = "Suma: <b class=\"mono\">" + fmt(sumaVar * KiB) + "</b> de " + fmt(TOTAL - cfg.so) +
      " disponibles" + (sumaVar * KiB < TOTAL - cfg.so ? " · el resto queda sin particionar." : ".");
    $("#cfg-note").textContent = cfg.metodo === "fija" ? "método 1" : cfg.metodo === "variable" ? "método 2" : cfg.metodo === "dinamica" ? "método 3" : "método 4";
    $("#btn-compactar").disabled = cfg.metodo !== "dinamica";
    $("#auto-compact").checked = cfg.autoCompact;
    $("#np-contigua-fields").hidden = cfg.metodo === "segmentacion";
    $("#np-segmentacion-fields").hidden = cfg.metodo !== "segmentacion";
    $("#np-seg-note").hidden = cfg.metodo !== "segmentacion";
    $("#btn-escenario-nc").hidden = cfg.metodo !== "segmentacion";
    $("#legend-segmento").hidden = cfg.metodo !== "segmentacion";
    $("#detalle-title").textContent = cfg.metodo === "segmentacion" ? "Programa y tabla de segmentación" : "Bloque seleccionado";
    $("#detalle-note").textContent = cfg.metodo === "segmentacion" ? "segmento lógico → base física" : "distribución interna de segmentos";
    $("#progs-base-heading").textContent = cfg.metodo === "segmentacion" ? "Bases" : "Base";
    $("#prog-seglegend").innerHTML = cfg.metodo === "segmentacion"
      ? SEG6.map(function(s){ return '<span><i class="' + s.c + '"></i>' + s.n + '</span>'; }).join("")
      : '<span><i class="s-cod"></i>Código</span><span><i class="s-dat"></i>Datos</span><span><i class="s-pil"></i>Pila</span><span><i class="s-hea"></i>Montículo (heap)</span>';

    var chips = cfg.variables.map(function(k, i){
      return '<span class="chip">' + miles(k) + ' KiB<button data-i="' + i + '" aria-label="Quitar partición de ' + k + ' KiB">&times;</button></span>';
    }).join("");
    $("#var-chips").innerHTML = chips || '<span class="hint">Sin particiones definidas.</span>';
  }

  function renderKPIs(){
    var m = metricas();
    var pct = Math.round(m.util * 100);
    var html = "";
    html += kpi("Utilización", pct + "%", fmt(m.usado) + " de " + fmt(m.usuario), "", pct);
    html += kpi("Frag. interna", fmt(m.fragInt), (cfg.metodo === "dinamica" || cfg.metodo === "segmentacion") ? "nula: cada bloque se ajusta al tamaño" : "dentro de particiones asignadas", "warn");
    html += kpi(cfg.metodo === "segmentacion" ? "Libre dispersa" : "Frag. externa", fmt(m.fragExt), (cfg.metodo === "dinamica" || cfg.metodo === "segmentacion")
      ? m.huecos + (m.huecos === 1 ? " hueco libre" : " huecos libres")
      : "particiones libres no combinables", "ext");
    html += kpi("Mayor bloque libre", fmt(m.mayor), cfg.metodo === "segmentacion" ? "límite para cada segmento" : "límite para el próximo proceso");
    html += kpi("Instancias", String(m.cargados), m.cola + " programas en catálogo");
    $("#kpis").innerHTML = html;
  }
  function kpi(k, v, s, cls, meter){
    return '<div class="kpi ' + (cls || "") + '"><span class="k">' + k + '</span><span class="v">' + v + '</span>' +
      (meter !== undefined ? '<span class="meter"><i style="width:' + Math.min(100, meter) + '%"></i></span>' : "") +
      '<span class="s">' + s + '</span></div>';
  }

  function renderMapa(){
    var html = "", i;
    for (i=0;i<mem.length;i++){
      var b = mem[i];
      var p = b.pid !== null ? prog(b.pid) : null;
      var clase = b.tipo === "so" ? "so" : b.tipo === "reservado" ? "reservado" : (p ? "ocupado" : "libre");
      var fi = p && cfg.metodo !== "segmentacion" ? b.size - p.size : 0;
      var etq;
      if (b.tipo === "so") etq = "Sistema operativo";
      else if (b.tipo === "reservado") etq = "No particionado";
      else if (p) etq = cfg.metodo === "segmentacion" ? p.etq + " · S" + b.seg + " " + SEG6[b.seg].n : p.etq + " · " + p.nombre;
      else if (b.tipo === "particion") etq = "Partición " + b.idx + " libre";
      else etq = "Hueco libre";

      html += '<button class="blk ' + clase + (cfg.metodo === "segmentacion" && p && selProg === p.pid ? " related" : "") + '" data-id="' + b.id + '"' +
        ' aria-pressed="' + (sel === b.id || (cfg.metodo === "segmentacion" && p && selProg === p.pid)) + '" style="flex-grow:' + b.size + (p ? ';--pc:' + p.color : "") + '"' +
        ' title="' + esc(etq) + " — " + hex(b.base) + "–" + hex(b.base + b.size - 1) + " (" + fmt(b.size) + ')">' +
          '<span class="in" style="flex-grow:' + (p && cfg.metodo !== "segmentacion" ? p.size : b.size) + '">' +
            '<span class="l1"><span class="addr">' + hex(b.base) + " → " + hex(b.base + b.size - 1) +
            '</span><span class="sz">' + fmt(b.size) + '</span></span>' +
            '<span class="l2">' + esc(etq) + '</span>' +
          '</span>' +
          (fi > 0 ? '<span class="ifrag" style="flex-grow:' + fi + '"><span>frag. interna ' + fmt(fi) + '</span></span>' : "") +
        '</button>';
    }
    var cont = $("#mapa");
    cont.innerHTML = html;
    var m = metricas();
    $("#map-note").textContent = mem.length + " bloques · " + fmt(m.libreTotal) + " libres";

    var hijos = cont.children;
    for (i=0;i<hijos.length;i++){
      var h = hijos[i].offsetHeight;
      hijos[i].classList.toggle("tight", h < 40);
      hijos[i].classList.toggle("micro", h < 20);
    }
  }

  function renderDetalle(){
    if (cfg.metodo === "segmentacion"){
      renderDetalleSegmentacion();
      return;
    }
    var b = null, i;
    for (i=0;i<mem.length;i++) if (mem[i].id === sel) b = mem[i];
    var box = $("#detalle");
    if (!b){
      box.innerHTML = '<p class="empty">Toca un bloque del mapa para ver sus direcciones y, si está ocupado, el reparto interno de sus segmentos.</p>';
      return;
    }
    var p = b.pid !== null ? prog(b.pid) : null;
    var lim = b.base + b.size - 1;
    var html = '<dl class="dl">';
    html += '<dt>Bloque</dt><dd style="font-family:\'IBM Plex Sans\',sans-serif">' +
      (b.tipo === "so" ? "Sistema operativo (residente)" :
       b.tipo === "reservado" ? "Zona no particionada" :
       b.tipo === "particion" ? "Partición " + b.idx + (p ? " (estática)" : " (estática, libre)") :
       (p ? "Partición dinámica" : "Hueco libre")) + '</dd>';
    html += '<dt>Rango</dt><dd>' + hex(b.base) + " – " + hex(lim) + '</dd>';
    html += '<dt>Tamaño</dt><dd>' + fmt(b.size) + " (" + miles(b.size) + " B)" + '</dd>';
    if (p){
      html += '<dt>Proceso</dt><dd style="font-family:\'IBM Plex Sans\',sans-serif">' + p.etq + " · " + esc(p.nombre) + '</dd>';
      html += '<dt>Registro base</dt><dd>' + hex(p.base) + '</dd>';
      html += '<dt>Registro límite</dt><dd>' + hex(p.size) + " (" + fmt(p.size) + ")" + '</dd>';
      var fi = b.size - p.size;
      html += '<dt>Frag. interna</dt><dd style="color:' + (fi ? "var(--warn)" : "inherit") + '">' + fmt(fi) +
        (fi ? " · " + hex(b.base + p.size) + " – " + hex(lim) : "") + '</dd>';
    }
    html += "</dl>";

    if (p){
      html += '<div class="tblscroll" style="margin-top:12px"><table class="tbl"><thead><tr>' +
        '<th>Segmento</th><th style="text-align:right">Tamaño</th><th style="text-align:right">Desplazamiento</th><th style="text-align:right">Direcciones</th>' +
        '</tr></thead><tbody>';
      var off = 0;
      for (i=0;i<SEGS.length;i++){
        var s = SEGS[i], sz = p.segs[s.k] * KiB;
        html += '<tr><td><span class="pname"><span class="dot" style="--pc:var(--' +
          (s.k === "codigo" ? "seg-cod" : s.k === "datos" ? "seg-dat" : s.k === "pila" ? "seg-pil" : "seg-hea") +
          ')"></span><span class="txt"><b>' + s.n + '</b></span></span></td>' +
          '<td class="num">' + fmt(sz) + '</td>' +
          '<td class="num">+' + hex(off).slice(2) + '</td>' +
          '<td class="num">' + hex(p.base + off) + " – " + hex(p.base + off + sz - 1) + '</td></tr>';
        off += sz;
      }
      html += '</tbody></table></div>';
      html += '<div style="margin-top:12px">' + segbar(p, true) + '</div>';
    }
    box.innerHTML = html;
  }

  function renderDetalleSegmentacion(){
    var box = $("#detalle"), p = selProg !== null ? prog(selProg) : (selPlantilla !== null ? prog(selPlantilla) : null);
    if (!p){
      box.innerHTML = '<p class="empty">Selecciona un programa completo en la tabla. Verás sus seis partes, la tabla de segmentación y sus posiciones en el mapa físico.</p>';
      return;
    }
    var html = '<p class="segment-intro"><strong>' + p.etq + ' · ' + esc(p.nombre) + '</strong> · ' + fmt(p.size) +
      ' · <span class="pill ' + (p.instancia ? "cargado" : "cola") + '">' + (p.instancia ? "Instancia cargada" : "En catálogo") + '</span></p>';
    html += '<div class="segment-grid" aria-label="Seis segmentos del programa">';
    for (var i=0;i<SEG6.length;i++){
      var s = SEG6[i];
      html += '<div class="segment-part"><span class="segment-index">S' + i + '</span><i class="' + s.c + '"></i><strong>' + s.n + '</strong><span>' + fmt(p.seg6[s.k] * KiB) + '</span></div>';
    }
    html += '</div><h3 class="segment-title">Tabla de segmentación</h3>';
    html += '<p class="hint">Dirección lógica = número de segmento + desplazamiento. La base indica dónde comienza ese segmento en memoria física.</p>';
    html += '<div class="tblscroll"><table class="tbl segment-table"><thead><tr><th>N.º / dirección lógica</th><th>Segmento</th><th>Base física</th><th>Tamaño (límite)</th></tr></thead><tbody>';
    for (i=0;i<SEG6.length;i++){
      var entry = p.tabla[i];
      html += '<tr><td class="mono">' + i + '</td><td>' + SEG6[i].n + '</td><td class="mono">' +
        (entry && entry.base !== null ? hex(entry.base) : '—') + '</td><td class="mono">' + fmt(p.seg6[SEG6[i].k] * KiB) + '</td></tr>';
    }
    html += '</tbody></table></div>';
    html += '<p class="hint segment-foot">' + (p.instancia ?
      'Los bloques resaltados en el mapa pertenecen a este programa; sus bases pueden estar separadas.' :
      'Carga una instancia para obtener sus bases físicas y señalar sus segmentos en el mapa.') + '</p>';
    box.innerHTML = html;
  }

  function segbar(p, ancho){
    var total = p.size / KiB, out = '<span class="segbar" style="' + (ancho ? "min-width:100%" : "") + '" aria-hidden="true">';
    var lista = cfg.metodo === "segmentacion" ? SEG6 : SEGS;
    var valores = cfg.metodo === "segmentacion" ? p.seg6 : p.segs;
    for (var i=0;i<lista.length;i++){
      out += '<i class="' + lista[i].c + '" style="flex:' + valores[lista[i].k] + '" title="' + lista[i].n + " " + miles(valores[lista[i].k]) + ' KiB"></i>';
    }
    return out + "</span>" + (total ? "" : "");
  }

  function renderProgs(){
    var catalogo = plantillas(), activas = instancias(), html = "", i;
    var lista = cfg.metodo === "segmentacion" ? SEG6 : SEGS;
    for (i=0;i<catalogo.length;i++){
      var plantilla = catalogo[i];
      var valores = cfg.metodo === "segmentacion" ? plantilla.seg6 : plantilla.segs;
      var segTxt = lista.map(function(s){ return s.n + " " + miles(valores[s.k]) + " KiB"; }).join(" · ");
      var copias = activas.filter(function(p){ return p.plantilla === plantilla.pid; }).length;
      html += '<tr class="' + (selPlantilla === plantilla.pid ? "on" : "") + '">' +
        '<td><span class="pname" style="--pc:' + plantilla.color + '"><span class="dot"></span><span class="txt">' +
        (cfg.metodo === "segmentacion" ? '<button class="program-select" data-select-template="' + plantilla.pid + '">' + esc(plantilla.nombre) + '</button>' : '<b>' + esc(plantilla.nombre) + '</b>') +
        '<span class="tag">' + plantilla.etq + ' · catálogo</span></span></span></td>' +
        '<td title="' + segTxt + '" style="min-width:100px">' + segbar(plantilla) + '</td>' +
        '<td class="num">' + fmt(plantilla.size) + '</td><td class="num">—</td>' +
        '<td class="num">' + copias + ' activa' + (copias === 1 ? '' : 's') + '</td>' +
        '<td style="text-align:right"><button class="btn sm primary" data-cargar="' + plantilla.pid + '">Abrir instancia</button></td></tr>';
    }
    html += '<tr class="instance-divider"><td colspan="6">Instancias cargadas · ' + activas.length + '</td></tr>';
    if (!activas.length) html += '<tr><td colspan="6" class="empty">Aún no hay instancias en memoria.</td></tr>';
    for (i=0;i<activas.length;i++){
      var p = activas[i];
      var segmentos = cfg.metodo === "segmentacion" ? p.seg6 : p.segs;
      var detalle = lista.map(function(s){ return s.n + " " + miles(segmentos[s.k]) + " KiB"; }).join(" · ");
      html += '<tr class="instance-row ' + (selProg === p.pid || (p.blk && p.blk === sel) ? "on" : "") + '">' +
        '<td><span class="pname" style="--pc:' + p.color + '"><span class="dot"></span><span class="txt">' +
        '<button class="program-select" data-select-prog="' + p.pid + '">' + esc(p.nombre) + '</button>' +
        '<span class="tag">' + p.etq + ' · instancia</span></span></span></td>' +
        '<td title="' + detalle + '" style="min-width:100px">' + segbar(p) + '</td>' +
        '<td class="num">' + fmt(p.size) + '</td>' +
        '<td class="num">' + (cfg.metodo === "segmentacion" ? "tabla" : hex(p.base)) + '</td>' +
        '<td><span class="pill cargado">Cargada</span></td>' +
        '<td style="text-align:right"><button class="btn sm" data-liberar="' + p.pid + '">Eliminar</button></td></tr>';
    }
    $("#tabla-progs").querySelector("tbody").innerHTML = html;
    $("#prog-note").textContent = catalogo.length + " programas · " + activas.length + " instancias cargadas";
  }

  function renderLog(){
    var html = "", i;
    for (i=0;i<bitacora.length;i++){
      var e = bitacora[i];
      html += '<div class="row ' + e.tipo + '"><span class="t">t' + String(e.t).padStart(3,"0") + '</span>' +
        '<span class="k">' + e.tipo + '</span><span class="txt">' + e.texto + '</span></div>';
    }
    $("#log").innerHTML = html || '<div class="row nota"><span class="t">t000</span><span class="k">nota</span><span class="txt">Sin eventos.</span></div>';
  }

  /* ============ Escenarios predefinidos ============
     cargarTodos() / liberarTodos(): atajos para llenar o vaciar
     la memoria de una vez.
     escenarioFragmentacion(): reinicia la simulación y carga
     procesos en orden, liberando los impares para dejar huecos
     intercalados — así se ve fragmentación externa "en vivo" y,
     en el caso de particiones dinámicas, se sugiere compactar. */
  function cargarTodos(){
    var n = 0, catalogo = plantillas();
    for (var i=0;i<catalogo.length;i++) if (cargar(catalogo[i].pid)) n++;
    addLog("nota", "Planificador: " + n + " instancias nuevas admitidas en esta pasada.");
    render();
  }

  function liberarTodos(){
    var cargados = instancias();
    for (var i=0;i<cargados.length;i++) liberar(cargados[i].pid);
    addLog("nota", "Planificador: " + cargados.length + " instancias eliminadas; ver arriba el detalle de cada liberación.");
    render();
  }

  function escenarioFragmentacion(){
    sembrarProgramas();
    construirMemoria(null);
    bitacora = []; reloj = 0;
    addLog("nota", "Escenario: se admiten trabajos por orden de llegada y luego terminan algunos intercalados.");
    var cargados = [], catalogo = plantillas();
    for (var i=0;i<catalogo.length;i++){
      if (catalogo[i].size <= (TOTAL - cfg.so)){
        var instancia = cargar(catalogo[i].pid);
        if (instancia) cargados.push(instancia.pid);
      }
    }
    for (var j=1;j<cargados.length;j+=2) liberar(cargados[j]);
    var pendientes = catalogo.slice()
                          .sort(function(a,b){ return b.size - a.size; });
    var m = metricas();
    if (pendientes.length){
      var p = pendientes[0];
      addLog("nota", "Quedan " + fmt(m.libreTotal) + " libres en " + m.huecos + " bloques, pero el mayor mide " +
        fmt(m.mayor) + ". Intenta cargar " + p.etq + " (" + fmt(p.size) + ")" +
        (cfg.metodo === "dinamica" ? " y luego compacta." : "."));
    }
    sel = null;
    render();
  }

  function escenarioNoContiguo(){
    if (cfg.metodo !== "segmentacion") return;
    construirMemoria(null);
    bitacora = []; reloj = 0;
    var catalogo = plantillas();
    catalogo.forEach(function(p){ p.cargas = 0; });
    var editor = catalogo.find(function(p){ return p.nombre === "Editor de texto"; });
    var compilador = catalogo.find(function(p){ return p.nombre === "Compilador C"; });
    var hoja = catalogo.find(function(p){ return p.nombre === "Hoja de cálculo"; });
    var temporal = cargar(editor.pid);
    cargar(compilador.pid);
    liberar(temporal.pid);
    var dispersa = cargar(hoja.pid);
    cargar(hoja.pid);
    selProg = dispersa.pid; selPlantilla = null; sel = null;
    addLog("nota", "Escenario no contiguo: " + esc(dispersa.nombre) +
      " está cargada con segmentos a ambos lados de Compilador C 1. La segunda instancia de Hoja de cálculo ocupa memoria propia.");
    render();
  }

  function reiniciar(){
    sembrarProgramas();
    construirMemoria(null);
    bitacora = []; reloj = 0; sel = null; selProg = null; selPlantilla = null;
    addLog("config", "Sistema iniciado · 16 MiB · S.O. " + fmt(cfg.so) + " · " +
      (cfg.metodo === "fija" ? Math.floor((TOTAL - cfg.so) / tamFija()) + " particiones de " + fmt(tamFija()) :
       cfg.metodo === "variable" ? cfg.variables.length + " particiones variables" :
       cfg.metodo === "segmentacion" ? "segmentación con mejor ajuste" : "particiones dinámicas"));
    render();
  }

  /* ============ Manejadores de eventos ============
     Conecta cada control de la UI (pestañas de método, botones
     de algoritmo, selects de configuración, formulario para
     añadir programas, clicks sobre bloques del mapa) con las
     funciones del modelo, y termina cada uno llamando a
     render() para reflejar el cambio. */
  document.querySelectorAll(".tab").forEach(function(t){
    t.addEventListener("click", function(){
      if (cfg.metodo === t.dataset.metodo) return;
      cfg.metodo = t.dataset.metodo;
      construirMemoria("Método: " + t.querySelector(".tt").textContent.replace(/^\d+ · /, "") +
        " · se reconstruye la memoria y se eliminan las instancias cargadas.");
      render();
    });
  });
  var ALGO_POR_QUE = {
    primero: "recorre los bloques libres en orden y usa el primero que alcance, sin comparar el resto contra otros candidatos",
    mejor:   "compara todos los bloques que alcanzan y elige el más pequeño posible, minimizando el resto que queda libre en esa asignación",
    peor:    "compara todos los bloques que alcanzan y elige el más grande, dejando un resto mayor y en principio más reutilizable después"
  };
  document.querySelectorAll("#algo button").forEach(function(b){
    b.addEventListener("click", function(){
      cfg.algo = b.dataset.algo;
      addLog("config", "Algoritmo de asignación → " + b.textContent.toLowerCase() + " · " + ALGO_POR_QUE[cfg.algo] + ".");
      render();
    });
  });
  $("#so-size").addEventListener("change", function(){
    cfg.so = parseInt(this.value, 10) * MiB;
    construirMemoria("S.O. ocupa ahora " + fmt(cfg.so) + " (" + hex(0) + "–" + hex(cfg.so - 1) + ").");
    render();
  });
  $("#fijas-size").addEventListener("change", function(){
    var k = Number(this.value);
    var max = (TOTAL - cfg.so) / KiB;
    if (!Number.isInteger(k) || k < 64 || k > max){
      this.value = String(cfg.tamFija / KiB);
      addLog("nota", "El tamaño debe ser un número entero entre 64 y " + miles(max) + " KiB.");
      renderLog(); return;
    }
    cfg.tamFija = k * KiB;
    construirMemoria("Se crean " + Math.floor((TOTAL - cfg.so) / cfg.tamFija) + " particiones de " + fmt(tamFija()) + ".");
    render();
  });
  $("#var-chips").addEventListener("click", function(e){
    var b = e.target.closest("button[data-i]");
    if (!b) return;
    var i = parseInt(b.dataset.i, 10);
    var k = cfg.variables[i];
    cfg.variables.splice(i, 1);
    construirMemoria("Se elimina la partición de " + miles(k) + " KiB.");
    render();
  });
  $("#var-add").addEventListener("click", function(){
    var inp = $("#var-new"), k = parseInt(inp.value, 10);
    if (!k || k < 64){ inp.focus(); return; }
    var suma = cfg.variables.reduce(function(a,b){ return a + b; }, 0);
    if ((suma + k) * KiB > TOTAL - cfg.so){
      addLog("nota", "No cabe: quedan " + fmt(TOTAL - cfg.so - suma * KiB) + " sin particionar.");
      renderLog(); return;
    }
    cfg.variables.push(k);
    cfg.variables.sort(function(a,b){ return a - b; });
    inp.value = "";
    construirMemoria("Se añade una partición de " + miles(k) + " KiB.");
    render();
  });
  $("#btn-compactar").addEventListener("click", function(){ compactar(false); render(); });
  $("#auto-compact").addEventListener("change", function(){
    cfg.autoCompact = this.checked;
    addLog("config", "Compactación automática " + (this.checked ? "activada" : "desactivada") + ".");
    render();
  });
  $("#btn-cargar-todos").addEventListener("click", cargarTodos);
  $("#btn-liberar-todos").addEventListener("click", liberarTodos);
  $("#btn-escenario").addEventListener("click", escenarioFragmentacion);
  $("#btn-escenario-nc").addEventListener("click", escenarioNoContiguo);
  $("#btn-reset").addEventListener("click", reiniciar);

  $("#tabla-progs").addEventListener("click", function(e){
    var c = e.target.closest("button[data-cargar]"), l = e.target.closest("button[data-liberar]");
    var s = e.target.closest("button[data-select-prog]"), t = e.target.closest("button[data-select-template]");
    if (c){
      var instancia = cargar(parseInt(c.dataset.cargar, 10));
      if (instancia){
        if (cfg.metodo === "segmentacion"){ selProg = instancia.pid; selPlantilla = null; sel = null; }
        else sel = instancia.blk;
      }
      render();
    }
    else if (l){ liberar(parseInt(l.dataset.liberar, 10)); render(); }
    else if (s){
      var p = prog(parseInt(s.dataset.selectProg, 10));
      if (!p) return;
      selProg = p.pid; selPlantilla = null; sel = cfg.metodo === "segmentacion" ? null : p.blk;
      renderMapa(); renderDetalle(); renderProgs();
    }
    else if (t){ selPlantilla = parseInt(t.dataset.selectTemplate, 10); selProg = null; sel = null; renderMapa(); renderDetalle(); renderProgs(); }
  });
  $("#mapa").addEventListener("click", function(e){
    var b = e.target.closest(".blk");
    if (!b) return;
    var id = parseInt(b.dataset.id, 10);
    if (cfg.metodo === "segmentacion"){
      var segmento = mem.find(function(x){ return x.id === id; });
      selProg = segmento && segmento.pid !== null ? segmento.pid : null;
      selPlantilla = null;
      sel = id;
      renderMapa(); renderDetalle(); renderProgs();
      return;
    }
    var deseleccion = sel === id;
    sel = deseleccion ? null : id;
    if (!deseleccion){
      var blk = null, i;
      for (i=0;i<mem.length;i++) if (mem[i].id === id) blk = mem[i];
      if (blk){
        var p = blk.pid !== null ? prog(blk.pid) : null;
        addLog("consulta", "Inspección de " + nombreBloque(blk) + " · " + hex(blk.base) + "–" + hex(blk.base + blk.size - 1) +
          " (" + fmt(blk.size) + ")" + (p ? " · ocupado por " + p.etq + ": se abre el desglose de sus segmentos" : " · sin proceso asignado"));
      }
    }
    renderMapa(); renderDetalle(); renderProgs(); renderLog();
  });
  $("#np-add").addEventListener("click", function(){
    var nombre = ($("#np-nombre").value || "").trim() || "Programa " + (plantillas().length + 1);
    var segs, exactos = null;
    if (cfg.metodo === "segmentacion"){
      exactos = {};
      for (var i=0;i<SEG6.length;i++){
        var campo = $("#np-" + SEG6[i].k);
        var valor = Number(campo.value);
        if (!Number.isInteger(valor) || valor < 1){ campo.focus(); $("#np-hint").textContent = "Cada segmento debe medir al menos 1 KiB."; return; }
        exactos[SEG6[i].k] = valor;
      }
      segs = { codigo:exactos.text + exactos.rodata, datos:exactos.data + exactos.bss,
        pila:exactos.stack, heap:exactos.heap };
    } else {
      segs = {
        codigo: Math.max(8, parseInt($("#np-cod").value, 10) || 0),
        datos:  Math.max(0, parseInt($("#np-dat").value, 10) || 0),
        pila:   Math.max(0, parseInt($("#np-pil").value, 10) || 0),
        heap:   Math.max(0, parseInt($("#np-hea").value, 10) || 0)
      };
    }
    var p = nuevoPrograma(nombre, segs, exactos);
    if (p.size > TOTAL - cfg.so){
      $("#np-hint").textContent = "Un proceso no puede exceder " + fmt(TOTAL - cfg.so) + ".";
      pid--; plantillaNumero--; return;
    }
    progs.push(p);
    $("#np-hint").textContent = p.etq + " añadido: " + fmt(p.size) + " en " + (cfg.metodo === "segmentacion" ? 6 : 4) + " partes.";
    $("#np-nombre").value = "";
    addLog("nota", p.etq + " · " + esc(nombre) + " se añade al catálogo con " + fmt(p.size) + ".");
    render();
  });

  /* ============ Arranque ============
     Siembra el catálogo de programas de ejemplo, construye la
     memoria con la configuración por defecto (particiones
     fijas, 7 particiones, S.O. de 2 MiB) y carga algunos
     programas iniciales para que el simulador no arranque
     vacío. */
  function arranque(){
    sembrarProgramas();
    construirMemoria(null);
    addLog("config", "Sistema iniciado · 16 MiB (" + hex(0) + "–" + hex(TOTAL - 1) + ") · S.O. " + fmt(cfg.so) +
      " · " + Math.floor((TOTAL - cfg.so) / tamFija()) + " particiones iguales de " + fmt(tamFija()));
    ["Editor de texto","Compilador C","Terminal","Hoja de cálculo"].forEach(function(n){
      var plantilla = plantillas().find(function(p){ return p.nombre === n; });
      if (plantilla) cargar(plantilla.pid);
    });
    for (var i=0;i<mem.length;i++) if (mem[i].pid !== null){ sel = mem[i].id; break; }
    render();
  }

  arranque();
})();
