# Juego 13x13 · local single player

Proyecto web en archivos separados.

## Cómo abrirlo
Ejecuta un servidor local en la carpeta del proyecto:

```bash
python3 -m http.server 8000
npm start
```

Luego abre:

```text
http://localhost:8000
```

## Archivos
- `index.html` — entrada principal.
- `styles.css` — tablero y UI.
- `src/constants.js` — constantes y utilidades.
- `src/rules.js` — motor de reglas.
- `src/main.js` — interacción y render.

## Nota
La base está lista para jugar en local, con:
- tablero 13×13,
- piezas iniciales,
- turnos por color,
- captura y reserva,
- promoción opcional,
- arquero con modo especial en la orilla,
- detección de jaque, ahogado y algunas condiciones de palacio.

