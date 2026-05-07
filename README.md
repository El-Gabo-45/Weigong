# Wéigōng (圍宮) - 13x13 Strategy Game

Local single-player strategy game inspired by Xiangqi. Developed as a modular web project.

---

## 🚀 How to Run / Cómo abrirlo

Run a local server in the project folder:
Ejecuta un servidor local en la carpeta del proyecto:

```bash
# Option 1: Python
python3 -m http.server 8000

# Option 2: Node.js (npm)
npm start
```

Then open in your browser / Luego abre:
- `http://localhost:8000`
- `http://localhost:3000`

---

## 📂 Project Structure / Archivos

- `index.html` — Main entry point / Entrada principal.
- `styles.css` — Board and UI styles / Tablero y UI.
- `src/constants.js` — Constants and utilities / Constantes y utilidades.
- `src/rules/` — Core game engine / Motor de reglas.
- `src/ai/` — Game AI / IA del juego.
- `neural_network_gpu/` — Neural Network implementation / Red neuronal.
- `src/main.js` — Interaction and rendering / Interacción y render.
- `src/ui/` — UI components / Interfaz.

---

## 📝 Features / Notas del Juego

The game is ready for local play with the following features:
La base está lista para jugar en local con:

- **13×13 Board** / Tablero de 13×13.
- **Initial Setup** / Piezas iniciales configuradas.
- **Turn-based Gameplay** / Turnos por color.
- **Capture and Reserve system** / Sistema de captura y reserva.
- **Optional Promotion** / Promoción opcional.
- **Special Archer Mode** / Arquero con modo especial en la orilla.
- **Detection Systems** / Detección de jaque, ahogado y condiciones de palacio.
