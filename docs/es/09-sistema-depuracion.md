# 9. Sistema de Depuración

El proyecto incluye un sistema profesional de depuración con panel browser, CLI de Node.js, profiling integrado y herramientas de análisis visual.

---

## 9.1 Módulo de Debug (`src/debug.js`)

### Características

- **Zero-cost cuando está deshabilitado:** Todos los branches verifican `_active` antes de ejecutar.
- **Profiling persistente:** Mide calls, total, avg, min, max por función.
- **Panel del browser:** Toggles por módulo, búsqueda de texto, filtro de nivel.
- **Integración CLI:** Vía `debug-cli.js` para debug en terminal.
- **Export JSON:** Exportación de datos de profiling.

### Módulos de Debug

| Módulo | Color | Descripción |
|--------|-------|-------------|
| `ai` | `#8ab4ff` | Motor de IA general |
| `rules` | `#65d38a` | Motor de reglas |
| `nn` | `#ff9f4a` | Red neuronal |
| `search` | `#c084fc` | Búsqueda minimax |
| `memory` | `#f9a8d4` | Memoria adaptativa |
| `selfplay` | `#34d399` | Auto-juego |
| `server` | `#fb923c` | Servidor Express |
| `ui` | `#94a3b8` | Interfaz de usuario |
| `perf` | `#fbbf24` | Performance/profiling |
| `bot` | `#a78bfa` | Controlador del bot |
| `moves` | `#6ee7b7` | Generación de movimientos |

### Activación

El debug se puede activar de múltiples formas:

#### En Node.js (variable de entorno)

```bash
DEBUG=ai,search node src/server.js
DEBUG=all node src/server.js
```

#### En el Browser (URL)

```
http://localhost:3000?debug=ai,search
http://localhost:3000?debug=all
```

#### En el Browser (localStorage)

```javascript
localStorage.setItem('dbg', 'ai,search');
```

### API del Logger

```javascript
import dbg from './debug.js';

const log = dbg('ai');

log('Evaluando posición...');                     // Info
log.warn('Búsqueda cancelada por timeout');        // Warning
log.error('Error en evaluación:', error);           // Error
log.assert(condition, 'Mensaje si falla');           // Assertion

// Profiling
const timer = log.perf.start('search');
// ... código a medir ...
timer.end();

// O envolver funciones
const wrappedFn = log.perf.wrapAsync('botMove', async () => { ... });
```

### Panel del Browser

Panel flotante que muestra:
- **Filtros:** Por módulo, nivel (info/warn/error), búsqueda de texto.
- **Líneas de log:** Con timestamp, módulo coloreado, nivel, mensaje.
- **Highlight:** Búsqueda de texto resalta coincidencias.
- **Estadísticas:** Contador de líneas visibles vs totales.
- **Buffer:** Máximo 500 líneas (FIFO).

### Profiling

```javascript
// Datos de profiling por label
_perfCounts[label]  // Número de llamadas
_perfTimes[label]   // Tiempo total acumulado
_perfMin[label]     // Tiempo mínimo
_perfMax[label]     // Tiempo máximo

// Promedio
avg = _perfTimes[label] / _perfCounts[label]
```

Exportable como JSON con `exportPerfData()`.

---

## 9.2 CLI de Debug (`src/debug-cli.js`)

### Ejecución

```bash
npm run debug
# o directamente
node src/debug-cli.js
```

### Funcionalidades

CLI interactiva para análisis sin browser:

| Comando | Descripción |
|---------|-------------|
| `eval` | Evalúa la posición actual |
| `moves [side]` | Lista movimientos legales |
| `perft [depth]` | Conteo de nodos por profundidad |
| `search [depth]` | Ejecuta búsqueda del bot |
| `hash` | Muestra el hash Zobrist actual |
| `board` | Imprime el tablero en ASCII |
| `memory` | Muestra estadísticas de memoria |
| `set [r] [c] [type] [side]` | Coloca una pieza |
| `clear` | Limpia el tablero |
| `reset` | Reinicia la posición |
| `help` | Lista de comandos |
| `exit` | Salir |

---

## 9.3 Herramientas de Desarrollo (`src/tools/`)

Panel flotante con 8 herramientas especializadas, accesible mediante `Ctrl+Shift+T` o `?tools` en la URL.

### 9.3.1 Attack Overlay (`attack-overlay.js`)

Superpone sobre el tablero las casillas atacadas por cada bando:
- Colores por bando (verde para blanco, púrpura para negro).
- Intensidad proporcional al número de atacantes.
- Toggle por bando.

### 9.3.2 Search Tree Viewer (`search-tree.js`)

Visualizador del árbol de búsqueda minimax:
- Muestra nodos expandidos con su score.
- Podas alpha-beta resaltadas.
- Profundidad ajustable.
- Movimiento principal (PV) resaltado.

### 9.3.3 Eval Heatmap (`eval-heatmap.js`)

Heatmap de evaluación por casilla:
- Muestra el bonus/penalización posicional de cada casilla.
- Código de colores: rojo (negativo) → verde (positivo).
- Actualización en tiempo real al mover piezas.

### 9.3.4 Dataset Inspector (`dataset-inspector.js`)

Inspector de datos de entrenamiento para la red neuronal:
- Visualiza los inputs (codificación del tablero).
- Muestra los targets (scores normalizados).
- Estadísticas de distribución.

### 9.3.5 Benchmark Suite (`benchmark-suite.js`)

Suite de benchmarks de rendimiento:
- Mide tiempo de evaluación.
- Mide tiempo de generación de movimientos.
- Mide tiempo de búsqueda a diferentes profundidades.
- Resultados en formato tabla con promedio, min, max.

### 9.3.6 Perft Visual (`perft-visual.js`)

Test de generación de movimientos (PERFormance Test):
- Cuenta nodos a cada profundidad.
- Verifica la corrección del generador de movimientos.
- Visualización de distribución por tipo de movimiento.

### 9.3.7 NN Inspector (`nn-inspector.js`)

Inspector de la red neuronal:
- Muestra la predicción actual para la posición.
- Comparación heurística vs NN.
- Visualización de la entrada codificada.

### 9.3.8 Replay Analyzer (`replay-analyzer.js`)

Analizador de replays de partidas guardadas:
- Carga partidas desde archivo.
- Evalúa cada movimiento con la función de evaluación.
- Detecta blunders, mistakes, brilliant moves.
- Gráfico de evaluación a lo largo de la partida.

---

## 9.4 Atajos de Teclado

| Atajo | Acción | Módulo |
|-------|--------|--------|
| `Ctrl+Shift+E` | Abrir/cerrar editor de tablero | Editor |
| `Ctrl+Shift+T` | Abrir/cerrar panel de herramientas | Tools |
| `?debug=...` | Activar módulos de debug | URL param |
| `?tools` | Auto-abrir panel de herramientas | URL param |
