# 6. Red Neuronal GPU (`neural_network_gpu/`)

El proyecto incluye una red neuronal implementada en C++ con aceleración GPU vía OpenCL, diseñada para evaluar posiciones del tablero de forma más precisa que la evaluación heurística.

---

## 6.1 Arquitectura de la Red

### Topología

```
Input (4056 neuronas)
    │
    ▼
Dense Layer (512 neuronas) ── LeakyReLU + BatchNorm + Dropout
    │
    ▼
Dense Layer (256 neuronas) ── LeakyReLU + BatchNorm + Dropout
    │
    ▼
Dense Layer (128 neuronas) ── LeakyReLU + BatchNorm + Dropout
    │
    ▼
Dense Layer (64 neuronas) ── LeakyReLU + BatchNorm + Dropout
    │
    ▼
Output Layer (1 neurona) ── Tanh
```

### Dimensión de Entrada

```
Input = 13 × 13 × 24 = 4056 neuronas
```

Cada casilla del tablero (13×13 = 169) se codifica con 24 canales:
- 12 canales para piezas blancas (un canal por tipo de pieza).
- 12 canales para piezas negras (un canal por tipo de pieza).

```javascript
PIECE_CHANNEL = {
  king:0, queen:1, general:2, elephant:3, priest:4, horse:5,
  cannon:6, tower:7, carriage:8, archer:9, pawn:10, crossbow:11,
};
// Canal = offset (0 para blanco, 12 para negro) + PIECE_CHANNEL[tipo]
// Valor = 1.0 si la pieza está, 0.0 si no
```

### Salida

Un solo valor en el rango [-1, 1] (tanh):
- **+1:** Posición completamente ganadora para Negro.
- **-1:** Posición completamente ganadora para Blanco.
- **0:** Posición equilibrada.

---

## 6.2 Componentes del Módulo C++

### Archivos

| Archivo | Descripción |
|---------|-------------|
| `src/nn.h` | Definiciones de clases y structs |
| `src/nn.cpp` | Implementación de la red neuronal |
| `src/train.cpp` | Lógica de entrenamiento |
| `src/main.cpp` | Punto de entrada (lee JSON de stdin) |
| `src/nn_kernel.cl` | Kernels OpenCL para GPU |
| `nn_kernel.cl` | Copia del kernel en raíz del módulo |
| `Makefile` | Build script |
| `model.bin` | Modelo pre-entrenado |

### Clase `NeuralNetwork`

```cpp
class NeuralNetwork {
  // Construcción
  void add_layer(int input_size, int output_size, Activation act, float dropout);
  void set_loss(LossType loss);       // MSE, CROSS_ENTROPY, HUBER
  void set_optimizer(OptimizerType opt, float lr, float beta1, float beta2, float eps);
  void build();

  // Entrenamiento
  float train_batch(const float *X, const float *Y, int batch_size);
  void train_epoch(const float *X, const float *Y, int n_samples, int batch_size, bool shuffle);

  // Inferencia
  void predict(const float *X, float *output, int batch_size);
  void forward(const float *X, float *output, int batch_size);

  // Persistencia
  void save(const std::string &path);
  void load(const std::string &path);

  // Debug
  void print_summary() const;
};
```

### Struct `Layer`

Cada capa almacena:
- **Host:** `weights`, `bias`, `bn_gamma`, `bn_beta`, `bn_running_mean`, `bn_running_var`.
- **GPU (OpenCL):** `d_weights`, `d_bias`, `d_m_w`, `d_v_w` (momentos Adam), `d_input`, `d_output`, `d_z`, `d_delta`, `d_grad_w`, `d_grad_b`, `d_dropout_mask`.

### Funciones de Activación

```cpp
enum class Activation { NONE, RELU, LEAKY_RELU, SIGMOID, TANH, SOFTMAX };
```

### Tipos de Loss

```cpp
enum class LossType { MSE, CROSS_ENTROPY, HUBER };
// El proyecto usa HUBER (robusta a outliers)
```

### Optimizadores

```cpp
enum class OptimizerType { SGD, ADAM, ADAMW };
// El proyecto usa ADAMW (con decoupled weight decay)
```

---

## 6.3 Kernels OpenCL

Los kernels GPU realizan las operaciones computacionales:

| Kernel | Operación |
|--------|-----------|
| `k_matmul` | Multiplicación de matrices (forward pass) |
| `k_matmul_transposed` | Multiplicación con transpuesta (backward pass) |
| `k_relu`, `k_relu_deriv` | Activación ReLU y su derivada |
| `k_sigmoid`, `k_sigmoid_deriv` | Activación Sigmoid |
| `k_tanh_act`, `k_tanh_deriv` | Activación Tanh |
| `k_softmax` | Activación Softmax |
| `k_bias_add` | Suma de bias |
| `k_backprop_delta` | Cálculo de deltas en backpropagation |
| `k_grad_weight` | Gradientes de pesos |
| `k_grad_bias` | Gradientes de bias |
| `k_sgd_update` | Actualización SGD |
| `k_adam_update` | Actualización Adam/AdamW |
| `k_leaky_relu`, `k_leaky_relu_deriv` | LeakyReLU |
| `k_huber_loss`, `k_huber_deriv` | Huber Loss |
| `k_bn_forward`, `k_bn_backward` | BatchNorm |
| `k_dropout_forward`, `k_dropout_backward` | Dropout |
| `k_gradient_clip` | Clipping de gradientes |

---

## 6.4 Puente Node.js ↔ C++ (`nn-bridge.js`)

### Comunicación

El servidor Node.js se comunica con el binario C++ mediante:
- **stdin:** JSON con datos de entrada.
- **stdout:** Resultados (loss, predicciones, info).

### Funciones del Bridge

#### `trainFromGames(options)`

```javascript
trainFromGames({
  modelPath: 'neural_network_gpu/model.bin',
  epochs: 10,
  batchSize: 64,
  games: [...]  // Array de partidas con datos de entrenamiento
});
```

1. Asegura que los binarios estén compilados.
2. Construye targets con `buildTargets()`.
3. Lanza el proceso `nn_train` con los datos por stdin.
4. Parsea la salida (loss por época).

#### `predictScore(inputFloat32)`

Envía un vector de entrada (Float32Array de 4056 elementos) al binario para obtener una predicción.

#### `getModelInfo()`

Retorna información del modelo actual (arquitectura, tamaño, etc.).

#### `diagnoseGames(games)`

Diagnóstico pre-entrenamiento:
- Cuenta partidas decisivas vs empates.
- Mide cobertura de datos NN.
- Reporta distribución de status finales.

### Construcción de Targets

```javascript
function buildTargets(game) {
  // Normalización: tanh(evalScore / 300)  ← más agresiva que tanh(x/1000)
  //
  // Partida decisiva:
  //   target = (1 - resultWeight) × heuristic + resultWeight × resultSign
  //   resultWeight = 0.1 + 0.7 × progress  (crece a lo largo de la partida)
  //
  // Empate por límite de movimientos:
  //   Solo primera mitad, heurística × 0.25
  //
  // Empate real:
  //   Heurística × 0.5
}
```

---

## 6.5 Compilación

### Requisitos

- Compilador C++ con soporte C++17.
- OpenCL SDK (headers + libOpenCL).
- GPU compatible con OpenCL (ej: AMD RX 570).

### Makefile

```bash
cd neural_network_gpu
make nn_train    # Compila el binario de entrenamiento
make nn_gpu      # Compila el binario de inferencia
```

El Makefile genera los objetos en `build/` y el binario `nn_train` en la raíz del módulo.

---

## 6.6 Modelo Pre-entrenado

El archivo `model.bin` contiene el modelo pre-entrenado en formato binario. Incluye:
- Pesos y bias de cada capa.
- Parámetros de BatchNorm (gamma, beta, running_mean, running_var).
- Metadatos de arquitectura.
