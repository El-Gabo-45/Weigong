# Wéigōng (圍宮) Documentation

Complete technical documentation for the Wéigōng project, a turn-based strategy game on a 13×13 board inspired by Xiangqi (Chinese chess), developed as a modular web application with an advanced AI engine and GPU neural network.

---

## Table of Contents

| # | Section | File | Description |
|---|---------|------|-------------|
| 1 | [Overview](./01-overview.md) | `01-overview.md` | Game concept, rules, board, pieces |
| 2 | [Project Architecture](./02-architecture.md) | `02-architecture.md` | Folder structure, dependencies, stack |
| 3 | [Rules Engine](./03-rules-engine.md) | `03-rules-engine.md` | Board logic, moves, check, draw |
| 4 | [Piece System](./04-piece-system.md) | `04-piece-system.md` | Each piece, movement, promotion, reserve |
| 5 | [AI Engine](./05-ai-engine.md) | `05-ai-engine.md` | Search, evaluation, hashing, memory |
| 6 | [GPU Neural Network](./06-neural-network.md) | `06-neural-network.md` | C++/OpenCL architecture, training, bridge |
| 7 | [Server & API](./07-server-api.md) | `07-server-api.md` | Express, endpoints, self-play, saving |
| 8 | [User Interface](./08-user-interface.md) | `08-user-interface.md` | Gameplay, editor, timeline, dev tools |
| 9 | [Debug System](./09-debug-system.md) | `09-debug-system.md` | Debug, CLI, profiling, browser panel |
| 10 | [Development Guide](./10-development-guide.md) | `10-development-guide.md` | Setup, scripts, testing, linting, contributing |

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/El-Gabo-45/Weigong.git
cd Weigong

# Install dependencies
npm install

# Start the development server
npm start
# Open http://localhost:3000 in your browser

# Run tests
npm test

# Lint
npm run lint
```

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Frontend | HTML5, CSS3, JavaScript (ES Modules) |
| Backend | Node.js + Express 5 |
| AI | Minimax with Alpha-Beta, IDS, Aspiration Windows |
| Neural Network | C++ / OpenCL (GPU) |
| Testing | Jest 30 |
| Linting | ESLint 10 + Prettier |
| Compression | pako (gzip) |
