# 2. Arquitectura del Proyecto

## 2.1 Estructura de Directorios

```
Weigong/
├── index.html                  # Punto de entrada del frontend
├── styles.css                  # Estilos globales (tablero, UI, modales)
├── package.json                # Dependencias y scripts npm
├── package-lock.json           # Lockfile de dependencias
├── eslint.config.js            # Configuración de ESLint 10
├── jest.config.cjs             # Configuración de Jest 30
├── LICENSE                     # Licencia MIT
├── README.md                   # README principal del proyecto
├── .gitignore                  # Ignora games/ y node_modules/
│
├── docs/                       # 📚 Documentación técnica (esta carpeta)
│
├── src/                        # 🧠 Código fuente principal
│   ├── main.js                 # Punto de entrada del frontend (ES Module)
│   ├── state.js                # Estado global del juego + referencias al DOM
│   ├── constants.js            # Constantes, enums, utilidades puras
│   ├── server.js               # Servidor Express (backend)
│   ├── debug.js                # Sistema profesional de depuración
│   ├── debug-cli.js            # CLI de depuración para Node.js
│   ├── nn-bridge.js            # Puente Node.js ↔ Red Neuronal C++/OpenCL
│   ├── selfplay.js             # Motor de self-play para entrenamiento
│   ├── selfplay-worker.js      # Worker thread para self-play paralelo
│   │
│   ├── rules/                  # ♟ Motor de reglas del juego
│   │   ├── index.js            # Re-exporta toda la API pública de reglas
│   │   ├── core.js             # Motor central: applyMove, getAllLegalMoves
│   │   ├── board.js            # Utilidades del tablero: layout, clonado, hashing
│   │   ├── moves.js            # Generación de movimientos pseudo-legales y legales
│   │   ├── check.js            # Detección de jaque, casillas atacadas
│   │   ├── state.js            # Estado de palacio: curse, timers, invasores
│   │   ├── archer.js           # Mecánica especial del arquero (emboscada)
│   │   └── game.js             # Fábrica del estado de juego (createGame, resetGame)
│   │
│   ├── ai/                     # 🤖 Motor de inteligencia artificial
│   │   ├── index.js            # Re-exporta toda la API pública de IA
│   │   ├── bot.js              # Controlador del bot (IDS + aspiration windows)
│   │   ├── search.js           # Búsqueda Minimax con Alpha-Beta + optimizaciones
│   │   ├── evaluation.js       # Función de evaluación posicional
│   │   ├── hashing.js          # Zobrist hashing + tabla de transposición
│   │   ├── moves.js            # makeMove/unmakeMove para búsqueda + SEE
│   │   └── memory.js           # Memoria adaptativa (aprendizaje online)
│   │
│   ├── ui/                     # 🎨 Interfaz de usuario
│   │   ├── gameplay.js         # Renderizado del tablero + interacción principal
│   │   ├── editor.js           # Editor libre del tablero
│   │   └── timeline.js         # Timeline de jugadas + navegación por plies
│   │
│   ├── tools/                  # 🛠 Herramientas de desarrollo (browser)
│   │   ├── tools-panel.js      # Panel flotante con pestañas
│   │   ├── attack-overlay.js   # Overlay de casillas atacadas
│   │   ├── search-tree.js      # Visualizador del árbol de búsqueda
│   │   ├── eval-heatmap.js     # Heatmap de evaluación
│   │   ├── dataset-inspector.js# Inspector de datasets de entrenamiento
│   │   ├── benchmark-suite.js  # Suite de benchmarks de rendimiento
│   │   ├── perft-visual.js     # Perft visual (conteo de nodos)
│   │   ├── nn-inspector.js     # Inspector de la red neuronal
│   │   └── replay-analyzer.js  # Analizador de replays
│   │
│   └── data/
│       └── ai-memory.json      # Datos persistentes de memoria adaptativa
│
├── neural_network_gpu/         # 🧪 Red neuronal en C++/OpenCL
│   ├── Makefile                # Build del binario nn_train
│   ├── model.bin               # Modelo pre-entrenado (binario)
│   ├── nn_kernel.cl            # Kernels OpenCL
│   ├── src/
│   │   ├── main.cpp            # Punto de entrada del entrenamiento
│   │   ├── nn.cpp              # Implementación de la red neuronal
│   │   ├── nn.h                # Definiciones de la red neuronal
│   │   ├── train.cpp           # Lógica de entrenamiento
│   │   └── nn_kernel.cl        # Kernels OpenCL (fuente)
│   └── build/
│       ├── nn.o                # Objeto compilado
│       └── train.o             # Objeto compilado
│
├── games/                      # 📂 Partidas guardadas (gitignored)
│   └── .gitkeep
│
└── tests/                      # 🧪 Tests unitarios (Jest)
    ├── board.test.js           # Tests del tablero
    ├── check.test.js           # Tests de jaque
    ├── core.test.js            # Tests del motor central
    ├── debug.test.js           # Tests del sistema de debug
    ├── evaluation.test.js      # Tests de evaluación
    ├── hashing.test.js         # Tests de Zobrist hashing
    ├── moves.test.js           # Tests de generación de movimientos
    └── utils.test.js           # Tests de utilidades
```

---

## 2.2 Dependencias

### Producción (`dependencies`)

| Paquete | Versión | Propósito |
|---------|---------|-----------|
| `express` | ^5.2.1 | Servidor HTTP para servir el frontend y la API REST |
| `node-fetch` | ^3.3.2 | HTTP client para comunicación entre componentes |
| `pako` | ^2.1.0 | Compresión/descompresión gzip para guardado de partidas |

### Desarrollo (`devDependencies`)

| Paquete | Versión | Propósito |
|---------|---------|-----------|
| `eslint` | ^10.3.0 | Linter de JavaScript |
| `@eslint/js` | ^10.0.1 | Configuración base de ESLint |
| `eslint-config-prettier` | ^10.1.8 | Deshabilita reglas de ESLint que conflictúan con Prettier |
| `globals` | ^17.6.0 | Variables globales para ESLint (browser + node) |
| `jest` | ^30.4.2 | Framework de testing |
| `prettier` | ^3.8.3 | Formateador de código |

---

## 2.3 Flujo de Datos

```
┌─────────────────────────────────────────────────────────┐
│                      FRONTEND                            │
│                                                          │
│  index.html ──→ main.js ──→ state.js (estado global)    │
│                    │                                     │
│                    ├──→ ui/gameplay.js (render + input)   │
│                    ├──→ ui/editor.js (editor libre)       │
│                    ├──→ ui/timeline.js (historial)        │
│                    └──→ tools/tools-panel.js (dev)        │
│                                                          │
│  El frontend usa ES Modules directamente en el browser.  │
│  pako se importa vía importmap desde CDN.                │
└────────────────────────┬────────────────────────────────-┘
                         │ HTTP (fetch)
                         ▼
┌─────────────────────────────────────────────────────────┐
│                      BACKEND                             │
│                                                          │
│  server.js (Express 5)                                   │
│    │                                                     │
│    ├── /api/memory      → ai-memory.json (lectura/esc.)  │
│    ├── /api/saveGame    → games/*.json (guardar partida)  │
│    ├── /api/learnFromGames → procesa games/ → memoria    │
│    ├── /api/memoryStats → estadísticas de memoria        │
│    ├── /api/bot         → chooseBlackBotMove()           │
│    ├── /api/evaluate    → evaluate() de una posición     │
│    ├── /api/nn/*        → red neuronal (train/predict)   │
│    ├── /api/selfplay    → inicia partidas automáticas    │
│    └── static files     → sirve index.html, src/, etc.   │
│                                                          │
│  El servidor también usa Worker Threads para self-play.   │
└────────────────────────┬────────────────────────────────-┘
                         │ spawn (child process)
                         ▼
┌─────────────────────────────────────────────────────────┐
│              RED NEURONAL (C++/OpenCL)                    │
│                                                          │
│  nn_train (binario compilado)                            │
│    Recibe JSON por stdin → Entrena/Predice               │
│    Salida: loss, predicciones, info del modelo            │
│                                                          │
│  Arquitectura: input → 512 → 256 → 128 → 64 → 1        │
│  Loss: Huber | Optimizer: AdamW | Activation: LeakyReLU  │
└─────────────────────────────────────────────────────────┘
```

---

## 2.4 Tipo de Módulos

El proyecto usa **ES Modules** (`"type": "module"` en `package.json`):

- Todo `import`/`export` usa sintaxis ESM.
- Los archivos del frontend se cargan directamente por el navegador con `<script type="module">`.
- El backend (Node.js) también usa ESM.
- La excepción es `jest.config.cjs` que usa CommonJS (requerido por Jest).

---

## 2.5 Import Map (Frontend)

El `index.html` define un `importmap` para resolver `pako` desde CDN:

```html
<script type="importmap">
{
  "imports": {
    "pako": "https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.esm.mjs"
  }
}
</script>
```

Esto permite que los módulos del frontend hagan `import pako from 'pako'` sin bundler.
