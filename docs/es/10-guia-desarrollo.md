# 10. Guía de Desarrollo

Guía para configurar el entorno de desarrollo, ejecutar tests, y contribuir al proyecto.

---

## 10.1 Requisitos

### Software Necesario

| Software | Versión Mínima | Uso |
|----------|---------------|-----|
| Node.js | 18+ | Servidor, tests, tooling |
| npm | 9+ | Gestión de dependencias |
| Git | 2.30+ | Control de versiones |
| Navegador moderno | Chrome/Firefox/Edge | Frontend (ES Modules) |

### Opcional (para red neuronal GPU)

| Software | Versión | Uso |
|----------|---------|-----|
| Compilador C++ | C++17 | Compilar nn_train |
| OpenCL SDK | 1.2+ | Aceleración GPU |
| GPU compatible | OpenCL 1.2+ | Entrenamiento NN |

---

## 10.2 Instalación

```bash
# Clonar el repositorio
git clone https://github.com/El-Gabo-45/Weigong.git
cd Weigong

# Instalar dependencias
npm install
```

---

## 10.3 Scripts de NPM

### Producción y Desarrollo

| Script | Comando | Descripción |
|--------|---------|-------------|
| `npm start` | `node src/server.js` | Servidor en modo producción (puerto 3000) |
| `npm run dev` | `DEBUG=server,nn,selfplay node src/server.js` | Debug de servidor, NN, y self-play |
| `npm run dev:ai` | `DEBUG=ai,search,memory,perf node src/server.js` | Debug centrado en IA |
| `npm run dev:all` | `DEBUG=all node src/server.js` | Todos los módulos de debug |

### Testing

| Script | Comando | Descripción |
|--------|---------|-------------|
| `npm test` | `node --experimental-vm-modules node_modules/.bin/jest --verbose` | Ejecuta todos los tests |

### Calidad de Código

| Script | Comando | Descripción |
|--------|---------|-------------|
| `npm run lint` | `eslint src/ tests/` | Verifica estilo de código |
| `npm run format` | `prettier --write .` | Formatea todo el código |

### Debug CLI

| Script | Comando | Descripción |
|--------|---------|-------------|
| `npm run debug` | `node src/debug-cli.js` | CLI interactiva de depuración |

---

## 10.4 Testing

### Framework: Jest 30

Tests ubicados en `tests/`:

| Archivo | Cobertura |
|---------|-----------|
| `board.test.js` | Layout inicial, clonado de estado, hashing |
| `check.test.js` | Detección de jaque, casillas atacadas |
| `core.test.js` | applyMove, drops, promoción, fin de juego |
| `debug.test.js` | Sistema de debug, profiling |
| `evaluation.test.js` | Función de evaluación, componentes |
| `hashing.test.js` | Zobrist hashing, tabla de transposición |
| `moves.test.js` | Generación de movimientos por pieza |
| `utils.test.js` | Funciones utilitarias |

### Ejecución

```bash
# Todos los tests
npm test

# Test específico
npx jest tests/moves.test.js --verbose

# Con cobertura
npx jest --coverage
```

### Configuración de Jest (`jest.config.cjs`)

```javascript
module.exports = {
  transform: {},
  testEnvironment: 'node',
};
```

Nota: Jest se ejecuta con `--experimental-vm-modules` para soporte de ES Modules.

---

## 10.5 Linting y Formato

### ESLint (`eslint.config.js`)

Configuración flat (ESLint 10):
- Base: `@eslint/js` recommended.
- Globals: `browser` + `node`.
- Archivos: `**/*.{js,mjs,cjs}`.

```bash
# Verificar
npm run lint

# Corregir automáticamente
npx eslint src/ tests/ --fix
```

### Prettier

```bash
# Formatear todo
npm run format

# Verificar sin cambiar
npx prettier --check .
```

---

## 10.6 Servidor de Desarrollo

### Opción 1: Node.js (recomendado)

```bash
npm start           # Puerto 3000
# o
npm run dev         # Puerto 3000 + debug
```

Abre `http://localhost:3000` en el navegador.

### Opción 2: Servidor estático Python

```bash
python3 -m http.server 8000
```

Abre `http://localhost:8000`. Solo sirve archivos estáticos (sin API del bot, sin guardado de partidas).

---

## 10.7 Estructura del Código

### Convenciones

- **ES Modules:** Todo `import`/`export` usa sintaxis ESM.
- **Sin bundler:** Los módulos se cargan directamente en el browser.
- **Bilingüe:** Comentarios en español e inglés.
- **Constantes:** Definidas en `constants.js`, importadas donde se necesiten.
- **Estado global:** Centralizado en `state.js`.
- **UI pura:** Sin frameworks (vanilla JS + DOM manipulation).

### Patrones Comunes

#### Import de Módulos

```javascript
// Reglas del juego
import { createGame, applyMove, getAllLegalMoves } from './rules/index.js';

// IA
import { chooseBlackBotMove, evaluate, computeFullHash } from './ai/index.js';

// Constantes
import { SIDE, BOARD_SIZE, PIECE_DATA, isPalaceSquare } from './constants.js';
```

#### Crear una Pieza

```javascript
import { makePiece } from './rules/board.js';
const torre = makePiece('tower', 'white');
// { id: "uuid", type: "tower", side: "white", promoted: false, locked: false }
```

#### Evaluar una Posición

```javascript
import { evaluate, computeFullHash } from './ai/index.js';
const hash = computeFullHash(state);
const { score, metrics } = evaluate(state, hash);
// score > 0 → ventaja para Negro
// score < 0 → ventaja para Blanco
```

#### Obtener Movimientos Legales

```javascript
import { getAllLegalMoves } from './rules/index.js';
const moves = getAllLegalMoves(state, state.turn);
// [{ from: {r,c}, to: {r,c} }, { fromReserve: true, reserveIndex, to }, ...]
```

---

## 10.8 Variables de Entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `3000` | Puerto del servidor Express |
| `DEBUG` | (vacío) | Módulos de debug: `ai,search,memory,perf,nn,selfplay,server,ui,bot,moves,rules,all` |

---

## 10.9 Red Neuronal (Compilación)

Si se dispone de GPU compatible con OpenCL:

```bash
cd neural_network_gpu
make nn_train nn_gpu
```

Genera el binario `nn_train` que el servidor usa para entrenamiento e inferencia.

Sin GPU, el servidor funciona normalmente usando solo la evaluación heurística.

---

## 10.10 Flujo de Trabajo

### Agregar una Pieza Nueva

1. Agregar entrada en `PIECE_DATA` (`src/constants.js`).
2. Implementar movimiento en `pseudoMovesForPiece()` (`src/rules/moves.js`).
3. Agregar valor en `PIECE_VALUES` (`src/ai/moves.js`).
4. Actualizar `PIECE_CHANNEL` en `src/selfplay.js`.
5. Agregar notación en `getPieceSymbol()` (`src/ui/gameplay.js`).
6. Actualizar layout inicial en `initialLayout()` (`src/rules/board.js`).
7. Agregar tests en `tests/moves.test.js`.

### Modificar la Evaluación

1. Editar `evaluate()` en `src/ai/evaluation.js`.
2. Los componentes se suman/restan al score total.
3. Positivo = ventaja Negro, Negativo = ventaja Blanco.
4. Ejecutar tests: `npx jest tests/evaluation.test.js`.

### Agregar un Endpoint API

1. Agregar ruta en `src/server.js`.
2. Seguir el patrón existente (try/catch, JSON response).
3. Si usa game state, importar desde `./rules/index.js`.
