# Documentación de Wéigōng (圍宮)

Documentación técnica completa del proyecto Wéigōng, un juego de estrategia por turnos en tablero 13×13 inspirado en el Xiangqi (ajedrez chino), desarrollado como aplicación web modular con motor de IA avanzado y red neuronal GPU.

---

## Tabla de Contenidos

| # | Sección | Archivo | Descripción |
|---|---------|---------|-------------|
| 1 | [Visión General](./01-vision-general.md) | `01-vision-general.md` | Concepto del juego, reglas, tablero, piezas |
| 2 | [Arquitectura del Proyecto](./02-arquitectura.md) | `02-arquitectura.md` | Estructura de carpetas, dependencias, stack |
| 3 | [Motor de Reglas](./03-motor-reglas.md) | `03-motor-reglas.md` | Lógica del tablero, movimientos, jaque, empate |
| 4 | [Sistema de Piezas](./04-sistema-piezas.md) | `04-sistema-piezas.md` | Cada pieza, movimiento, promoción, reserva |
| 5 | [Motor de IA](./05-motor-ia.md) | `05-motor-ia.md` | Búsqueda, evaluación, hashing, memoria |
| 6 | [Red Neuronal GPU](./06-red-neuronal.md) | `06-red-neuronal.md` | Arquitectura C++/OpenCL, entrenamiento, bridge |
| 7 | [Servidor y API](./07-servidor-api.md) | `07-servidor-api.md` | Express, endpoints, self-play, guardado |
| 8 | [Interfaz de Usuario](./08-interfaz-usuario.md) | `08-interfaz-usuario.md` | Gameplay, editor, timeline, herramientas dev |
| 9 | [Sistema de Depuración](./09-sistema-depuracion.md) | `09-sistema-depuracion.md` | Debug, CLI, profiling, panel del browser |
| 10 | [Guía de Desarrollo](./10-guia-desarrollo.md) | `10-guia-desarrollo.md` | Setup, scripts, testing, linting, contribuir |

---

## Inicio Rápido

```bash
# Clonar el repositorio
git clone https://github.com/El-Gabo-45/Weigong.git
cd Weigong

# Instalar dependencias
npm install

# Iniciar el servidor de desarrollo
npm start
# Abrir http://localhost:3000 en el navegador

# Ejecutar tests
npm test

# Lint
npm run lint
```

---

## Stack Tecnológico

| Componente | Tecnología |
|------------|------------|
| Frontend | HTML5, CSS3, JavaScript (ES Modules) |
| Backend | Node.js + Express 5 |
| IA | Minimax con Alpha-Beta, IDS, Aspiration Windows |
| Red Neuronal | C++ / OpenCL (GPU) |
| Testing | Jest 30 |
| Linting | ESLint 10 + Prettier |
| Compresión | pako (gzip) |
