// ============================================================
// Neural Network OpenCL Kernels - Optimized for RX 570 (Polaris)
// ============================================================

// ----------------------------------------------------------
// MATMUL: C = A * B  (optimizado con tiling)
// A: MxK, B: KxN, C: MxN
// Work-group: 16x16 tiles
// ----------------------------------------------------------
__kernel void matmul(
    __global const float *A,
    __global const float *B,
    __global float *C,
    const int M, const int K, const int N)
{
    const int TILE_SIZE = 16;
    const int row = get_local_id(0);
    const int col = get_local_id(1);
    const int globalRow = get_global_id(0);
    const int globalCol = get_global_id(1);

    __local float Atile[TILE_SIZE][TILE_SIZE];
    __local float Btile[TILE_SIZE][TILE_SIZE];

    float acc = 0.0f;
    int numTiles = (K + TILE_SIZE - 1) / TILE_SIZE;

    for (int t = 0; t < numTiles; t++) {
        int tiledRow = t * TILE_SIZE + row;
        int tiledCol = t * TILE_SIZE + col;

        // Cargar Atile
        if (globalRow < M && tiledCol < K)
            Atile[row][col] = A[globalRow * K + tiledCol];
        else
            Atile[row][col] = 0.0f;

        // Cargar Btile
        if (tiledRow < K && globalCol < N)
            Btile[row][col] = B[tiledRow * N + globalCol];
        else
            Btile[row][col] = 0.0f;

        barrier(CLK_LOCAL_MEM_FENCE);

        // Producto punto local
        for (int i = 0; i < TILE_SIZE; i++)
            acc += Atile[row][i] * Btile[i][col];

        barrier(CLK_LOCAL_MEM_FENCE);
    }

    if (globalRow < M && globalCol < N)
        C[globalRow * N + globalCol] = acc;
}

// ----------------------------------------------------------
// MATMUL_TRANSPOSED: C = A * B^T
// ----------------------------------------------------------
__kernel void matmul_transposed(
    __global const float *A,
    __global const float *B,
    __global float *C,
    const int M, const int K, const int N)
{
    const int TILE_SIZE = 16;
    const int row = get_local_id(0);
    const int col = get_local_id(1);
    const int globalRow = get_global_id(0);
    const int globalCol = get_global_id(1);

    __local float Atile[TILE_SIZE][TILE_SIZE];
    __local float Btile[TILE_SIZE][TILE_SIZE];

    float acc = 0.0f;
    int numTiles = (K + TILE_SIZE - 1) / TILE_SIZE;

    for (int t = 0; t < numTiles; t++) {
        int tiledRow = t * TILE_SIZE + row;
        int tiledCol = t * TILE_SIZE + col;

        if (globalRow < M && tiledCol < K)
            Atile[row][col] = A[globalRow * K + tiledCol];
        else
            Atile[row][col] = 0.0f;

        // B transpuesto: B^T[col][row] = B[row][col]
        if (tiledRow < K && globalCol < N)
            Btile[row][col] = B[globalCol * K + tiledRow];
        else
            Btile[row][col] = 0.0f;

        barrier(CLK_LOCAL_MEM_FENCE);

        for (int i = 0; i < TILE_SIZE; i++)
            acc += Atile[row][i] * Btile[i][col];

        barrier(CLK_LOCAL_MEM_FENCE);
    }

    if (globalRow < M && globalCol < N)
        C[globalRow * N + globalCol] = acc;
}

// ----------------------------------------------------------
// ACTIVATION: ReLU
// ----------------------------------------------------------
__kernel void relu(__global float *x, const int size) {
    int i = get_global_id(0);
    if (i < size)
        x[i] = fmax(0.0f, x[i]);
}

// ----------------------------------------------------------
// ACTIVATION: ReLU derivative
// ----------------------------------------------------------
__kernel void relu_deriv(
    __global const float *x,
    __global float *out,
    const int size)
{
    int i = get_global_id(0);
    if (i < size)
        out[i] = x[i] > 0.0f ? 1.0f : 0.0f;
}

// ----------------------------------------------------------
// ACTIVATION: Sigmoid / Logistic
// ----------------------------------------------------------
__kernel void sigmoid(__global float *x, const int size) {
    int i = get_global_id(0);
    if (i < size)
        x[i] = 1.0f / (1.0f + exp(-x[i]));
}

// ----------------------------------------------------------
// ACTIVATION: Sigmoid derivative: sigmoid(x) * (1 - sigmoid(x))
// ----------------------------------------------------------
__kernel void sigmoid_deriv(
    __global const float *x,
    __global float *out,
    const int size)
{
    int i = get_global_id(0);
    if (i < size) {
        float s = 1.0f / (1.0f + exp(-x[i]));
        out[i] = s * (1.0f - s);
    }
}

// ----------------------------------------------------------
// ACTIVATION: Tanh
// ----------------------------------------------------------
__kernel void tanh_act(__global float *x, const int size) {
    int i = get_global_id(0);
    if (i < size)
        x[i] = tanh(x[i]);
}

// ----------------------------------------------------------
// ACTIVATION: Tanh derivative: 1 - tanh(x)^2
// ----------------------------------------------------------
__kernel void tanh_deriv(
    __global const float *x,
    __global float *out,
    const int size)
{
    int i = get_global_id(0);
    if (i < size) {
        float t = tanh(x[i]);
        out[i] = 1.0f - t * t;
    }
}

// ----------------------------------------------------------
// SOFTMAX (estable numéricamente)
// ----------------------------------------------------------
__kernel void softmax(
    __global const float *input,
    __global float *output,
    const int cols,
    const int rows)
{
    int row = get_global_id(0);
    if (row >= rows) return;

    int base = row * cols;

    // Encontrar max para estabilidad numérica
    float max_val = input[base];
    for (int i = 1; i < cols; i++) {
        if (input[base + i] > max_val)
            max_val = input[base + i];
    }

    // Exponentes y suma
    float sum = 0.0f;
    for (int i = 0; i < cols; i++) {
        float e = exp(input[base + i] - max_val);
        output[base + i] = e;
        sum += e;
    }

    // Normalizar
    if (sum > 0.0f) {
        for (int i = 0; i < cols; i++)
            output[base + i] /= sum;
    }
}

// ----------------------------------------------------------
// BIAS ADD: output[i] = input[i] + bias[i % biasSize]
// ----------------------------------------------------------
__kernel void bias_add(
    __global float *output,
    __global const float *bias,
    const int size,
    const int biasSize)
{
    int i = get_global_id(0);
    if (i < size)
        output[i] += bias[i % biasSize];
}

// ----------------------------------------------------------
// BACKPROP: delta_output = delta_next * weights^T  (acumular error)
// delta_next: MxN_out, weights: N_out x N_in, delta_output: MxN_in
// ----------------------------------------------------------
__kernel void backprop_delta(
    __global const float *delta_next,
    __global const float *weights,
    __global float *delta_curr,
    const int M,    // batch size
    const int N_in, // input size (current layer)
    const int N_out // output size (next layer)
)
{
    int row = get_global_id(0);  // sample in batch
    int col = get_global_id(1);  // neuron in current layer
    if (row >= M || col >= N_in) return;

    float sum = 0.0f;
    for (int k = 0; k < N_out; k++) {
        // weights[k * N_in + col] es weight de k->col
        sum += delta_next[row * N_out + k] * weights[k * N_in + col];
    }
    delta_curr[row * N_in + col] = sum;
}

// ----------------------------------------------------------
// GRADIENT WEIGHT: dW = A^T * delta (acumular gradientes)
// A: M x K, delta: M x N, dW: K x N
// ----------------------------------------------------------
__kernel void grad_weight(
    __global const float *A,
    __global const float *delta,
    __global float *dW,
    const int M, const int K, const int N)
{
    int row = get_global_id(0);  // K
    int col = get_global_id(1);  // N
    if (row >= K || col >= N) return;

    float sum = 0.0f;
    for (int i = 0; i < M; i++)
        sum += A[i * K + row] * delta[i * N + col];
    dW[row * N + col] = sum;
}

// ----------------------------------------------------------
// GRADIENT BIAS: db = sum(delta, axis=0)
// ----------------------------------------------------------
__kernel void grad_bias(
    __global const float *delta,
    __global float *db,
    const int M, const int N)
{
    int col = get_global_id(0);
    if (col >= N) return;

    float sum = 0.0f;
    for (int i = 0; i < M; i++)
        sum += delta[i * N + col];
    db[col] = sum;
}

// ----------------------------------------------------------
// SGD UPDATE: param -= lr * grad
// ----------------------------------------------------------
__kernel void sgd_update(
    __global float *param,
    __global const float *grad,
    const int size,
    const float lr)
{
    int i = get_global_id(0);
    if (i < size)
        param[i] -= lr * grad[i];
}

// ----------------------------------------------------------
// ADAM UPDATE: actualización con Adam optimizador
// ----------------------------------------------------------
__kernel void adam_update(
    __global float *param,
    __global const float *grad,
    __global float *m,      // 1er momento
    __global float *v,      // 2do momento
    const int size,
    const float lr,
    const float beta1,
    const float beta2,
    const float eps,
    const float corr1,      // 1 / (1 - beta1^t)
    const float corr2)      // 1 / (1 - beta2^t)
{
    int i = get_global_id(0);
    if (i >= size) return;

    float g = grad[i];
    float mt = beta1 * m[i] + (1.0f - beta1) * g;
    float vt = beta2 * v[i] + (1.0f - beta2) * g * g;

    m[i] = mt;
    v[i] = vt;

    float mt_hat = mt * corr1;
    float vt_hat = vt * corr2;

    param[i] -= lr * mt_hat / (sqrt(vt_hat) + eps);
}

// ----------------------------------------------------------
// MSE LOSS: output = 0.5 * (pred - target)^2 por muestra
// ----------------------------------------------------------
__kernel void mse_loss(
    __global const float *pred,
    __global const float *target,
    __global float *loss,
    const int size)
{
    int i = get_global_id(0);
    if (i < size) {
        float diff = pred[i] - target[i];
        loss[i] = 0.5f * diff * diff;
    }
}

// ----------------------------------------------------------
// CROSS-ENTROPY LOSS: -target * log(pred + epsilon)
// ----------------------------------------------------------
__kernel void cross_entropy_loss(
    __global const float *pred,
    __global const float *target,
    __global float *loss,
    const int size,
    const float epsilon)
{
    int i = get_global_id(0);
    if (i < size) {
        float p = clamp(pred[i], epsilon, 1.0f - epsilon);
        loss[i] = -target[i] * log(p);
    }
}

// ----------------------------------------------------------
// ELEMENT-WISE MULTIPLY: C = A * B
// ----------------------------------------------------------
__kernel void element_mul(
    __global const float *A,
    __global const float *B,
    __global float *C,
    const int size)
{
    int i = get_global_id(0);
    if (i < size)
        C[i] = A[i] * B[i];
}

// ----------------------------------------------------------
// ELEMENT-WISE ADD: C = A + B
// ----------------------------------------------------------
__kernel void element_add(
    __global const float *A,
    __global const float *B,
    __global float *C,
    const int size)
{
    int i = get_global_id(0);
    if (i < size)
        C[i] = A[i] + B[i];
}

// ----------------------------------------------------------
// ELEMENT-WISE SCALE: output = input * scalar
// ----------------------------------------------------------
__kernel void scale(
    __global float *data,
    const int size,
    const float scalar)
{
    int i = get_global_id(0);
    if (i < size)
        data[i] *= scalar;
}

// ----------------------------------------------------------
// COPY: dst = src
// ----------------------------------------------------------
__kernel void copy(
    __global const float *src,
    __global float *dst,
    const int size)
{
    int i = get_global_id(0);
    if (i < size)
        dst[i] = src[i];
}

// ----------------------------------------------------------
// SUM REDUCE (parcial): reduce array a sumas parciales
// ----------------------------------------------------------
__kernel void sum_reduce(
    __global const float *input,
    __global float *partial,
    const int size)
{
    int gid = get_global_id(0);
    int lid = get_local_id(0);
    int lsize = get_local_size(0);
    int base = gid * lsize;

    __local float cache[256];

    float sum = 0.0f;
    int end = min(base + lsize, size);
    for (int i = base + lid; i < end; i += lsize)
        sum += input[i];

    cache[lid] = sum;
    barrier(CLK_LOCAL_MEM_FENCE);

    // Reducción en árbol
    for (int s = lsize / 2; s > 0; s >>= 1) {
        if (lid < s)
            cache[lid] += cache[lid + s];
        barrier(CLK_LOCAL_MEM_FENCE);
    }

    if (lid == 0)
        partial[get_group_id(0)] = cache[0];
}

// ----------------------------------------------------------
// VECTOR DOT PRODUCT (para normalización de capas)
// ----------------------------------------------------------
__kernel void dot_product(
    __global const float *A,
    __global const float *B,
    __global float *C,
    const int M, const int N)
{
    int i = get_global_id(0);
    if (i >= M) return;

    float sum = 0.0f;
    for (int j = 0; j < N; j++)
        sum += A[i * N + j] * B[i * N + j];
    C[i] = sum;
}

// ----------------------------------------------------------
// LAYER NORM: y = (x - mean) / sqrt(var + eps) * gamma + beta
// ----------------------------------------------------------
__kernel void layer_norm(
    __global float *x,
    __global const float *gamma,
    __global const float *beta,
    const int rows,
    const int cols,
    const float eps)
{
    int row = get_global_id(0);
    if (row >= rows) return;

    int base = row * cols;

    // mean
    float mean = 0.0f;
    for (int i = 0; i < cols; i++)
        mean += x[base + i];
    mean /= cols;

    // variance
    float var = 0.0f;
    for (int i = 0; i < cols; i++) {
        float d = x[base + i] - mean;
        var += d * d;
    }
    var /= cols;

    float inv_std = rsqrt(var + eps);
    for (int i = 0; i < cols; i++)
        x[base + i] = (x[base + i] - mean) * inv_std * gamma[i] + beta[i];
}

// ----------------------------------------------------------
// DROPOUT MASK: genera máscara de Bernoulli
// ----------------------------------------------------------
__kernel void dropout_mask(
    __global float *mask,
    __global unsigned int *seed,
    const int size,
    const float keep_prob)
{
    int i = get_global_id(0);
    if (i >= size) return;

    unsigned int s = seed[0];
    s = (s * 1103515245U + 12345U) & 0x7fffffffU;
    seed[0] = s;

    float r = (float)s / 2147483648.0f;
    mask[i] = (r < keep_prob) ? (1.0f / keep_prob) : 0.0f;
}

// ----------------------------------------------------------
// DROPOUT APPLY: x *= mask
// ----------------------------------------------------------
__kernel void dropout_apply(
    __global float *x,
    __global const float *mask,
    const int size)
{
    int i = get_global_id(0);
    if (i < size)
        x[i] *= mask[i];
}