# 6. GPU Neural Network (`neural_network_gpu/`)

The project includes a neural network implemented in C++ with GPU acceleration via OpenCL, designed to evaluate board positions more accurately than heuristic evaluation.

---

## 6.1 Network Architecture

### Topology

```
Input (4056 neurons)
    │
    ▼
Dense Layer (512 neurons) ── LeakyReLU + BatchNorm + Dropout
    │
    ▼
Dense Layer (256 neurons) ── LeakyReLU + BatchNorm + Dropout
    │
    ▼
Dense Layer (128 neurons) ── LeakyReLU + BatchNorm + Dropout
    │
    ▼
Dense Layer (64 neurons) ── LeakyReLU + BatchNorm + Dropout
    │
    ▼
Output Layer (1 neuron) ── Tanh
```

### Input Dimension

```
Input = 13 × 13 × 24 = 4056 neurons
```

Each board square (13×13 = 169) is encoded with 24 channels:
- 12 channels for white pieces (one channel per piece type).
- 12 channels for black pieces (one channel per piece type).

```javascript
PIECE_CHANNEL = {
  king:0, queen:1, general:2, elephant:3, priest:4, horse:5,
  cannon:6, tower:7, carriage:8, archer:9, pawn:10, crossbow:11,
};
// Channel = offset (0 for white, 12 for black) + PIECE_CHANNEL[type]
// Value = 1.0 if piece is present, 0.0 if not
```

### Output

A single value in the range [-1, 1] (tanh):
- **+1:** Completely winning position for Black.
- **-1:** Completely winning position for White.
- **0:** Balanced position.

---

## 6.2 C++ Module Components

### Files

| File | Description |
|------|-------------|
| `src/nn.h` | Class and struct definitions |
| `src/nn.cpp` | Neural network implementation |
| `src/train.cpp` | Training logic |
| `src/main.cpp` | Entry point (reads JSON from stdin) |
| `src/nn_kernel.cl` | OpenCL kernels for GPU |
| `nn_kernel.cl` | Kernel copy at module root |
| `Makefile` | Build script |
| `model.bin` | Pre-trained model (binary) |

### `NeuralNetwork` Class

```cpp
class NeuralNetwork {
  // Construction
  void add_layer(int input_size, int output_size, Activation act, float dropout);
  void set_loss(LossType loss);       // MSE, CROSS_ENTROPY, HUBER
  void set_optimizer(OptimizerType opt, float lr, float beta1, float beta2, float eps);
  void build();

  // Training
  float train_batch(const float *X, const float *Y, int batch_size);
  void train_epoch(const float *X, const float *Y, int n_samples, int batch_size, bool shuffle);

  // Inference
  void predict(const float *X, float *output, int batch_size);
  void forward(const float *X, float *output, int batch_size);

  // Persistence
  void save(const std::string &path);
  void load(const std::string &path);

  // Debug
  void print_summary() const;
};
```

### `Layer` Struct

Each layer stores:
- **Host:** `weights`, `bias`, `bn_gamma`, `bn_beta`, `bn_running_mean`, `bn_running_var`.
- **GPU (OpenCL):** `d_weights`, `d_bias`, `d_m_w`, `d_v_w` (Adam moments), `d_input`, `d_output`, `d_z`, `d_delta`, `d_grad_w`, `d_grad_b`, `d_dropout_mask`.

### Activation Functions

```cpp
enum class Activation { NONE, RELU, LEAKY_RELU, SIGMOID, TANH, SOFTMAX };
```

### Loss Types

```cpp
enum class LossType { MSE, CROSS_ENTROPY, HUBER };
// The project uses HUBER (robust to outliers)
```

### Optimizers

```cpp
enum class OptimizerType { SGD, ADAM, ADAMW };
// The project uses ADAMW (with decoupled weight decay)
```

---

## 6.3 OpenCL Kernels

GPU kernels perform the computational operations:

| Kernel | Operation |
|--------|-----------|
| `k_matmul` | Matrix multiplication (forward pass) |
| `k_matmul_transposed` | Transposed multiplication (backward pass) |
| `k_relu`, `k_relu_deriv` | ReLU activation and its derivative |
| `k_sigmoid`, `k_sigmoid_deriv` | Sigmoid activation |
| `k_tanh_act`, `k_tanh_deriv` | Tanh activation |
| `k_softmax` | Softmax activation |
| `k_bias_add` | Bias addition |
| `k_backprop_delta` | Backpropagation delta calculation |
| `k_grad_weight` | Weight gradients |
| `k_grad_bias` | Bias gradients |
| `k_sgd_update` | SGD update |
| `k_adam_update` | Adam/AdamW update |
| `k_leaky_relu`, `k_leaky_relu_deriv` | LeakyReLU |
| `k_huber_loss`, `k_huber_deriv` | Huber Loss |
| `k_bn_forward`, `k_bn_backward` | BatchNorm |
| `k_dropout_forward`, `k_dropout_backward` | Dropout |
| `k_gradient_clip` | Gradient clipping |

---

## 6.4 Node.js ↔ C++ Bridge (`nn-bridge.js`)

### Communication

The Node.js server communicates with the C++ binary via:
- **stdin:** JSON with input data.
- **stdout:** Results (loss, predictions, info).

### Bridge Functions

#### `trainFromGames(options)`

```javascript
trainFromGames({
  modelPath: 'neural_network_gpu/model.bin',
  epochs: 10,
  batchSize: 64,
  games: [...]  // Array of games with training data
});
```

1. Ensures binaries are compiled.
2. Builds targets with `buildTargets()`.
3. Launches the `nn_train` process with data via stdin.
4. Parses the output (loss per epoch).

#### `predictScore(inputFloat32)`

Sends an input vector (Float32Array of 4056 elements) to the binary to get a prediction.

#### `getModelInfo()`

Returns information about the current model (architecture, size, etc.).

#### `diagnoseGames(games)`

Pre-training diagnostic:
- Counts decisive games vs draws.
- Measures NN data coverage.
- Reports final status distribution.

### Target Construction

```javascript
function buildTargets(game) {
  // Normalization: tanh(evalScore / 300)  ← more aggressive than tanh(x/1000)
  //
  // Decisive game:
  //   target = (1 - resultWeight) × heuristic + resultWeight × resultSign
  //   resultWeight = 0.1 + 0.7 × progress  (grows throughout the game)
  //
  // Draw by move limit:
  //   Only first half, heuristic × 0.25
  //
  // Real draw:
  //   Heuristic × 0.5
}
```

---

## 6.5 Compilation

### Requirements

- C++ compiler with C++17 support.
- OpenCL SDK (headers + libOpenCL).
- OpenCL-compatible GPU (e.g., AMD RX 570).

### Makefile

```bash
cd neural_network_gpu
make nn_train    # Compiles the training binary
make nn_gpu      # Compiles the inference binary
```

The Makefile generates objects in `build/` and the `nn_train` binary at the module root.

---

## 6.6 Pre-trained Model

The `model.bin` file contains the pre-trained model in binary format. It includes:
- Weights and biases for each layer.
- BatchNorm parameters (gamma, beta, running_mean, running_var).
- Architecture metadata.
