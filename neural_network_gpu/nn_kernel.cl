// ============================================================
// Neural Network OpenCL Kernels - Optimized for RX 570 (Polaris)
// Version 2.0 - BatchNorm, LeakyReLU, Gradient Clipping
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
// ACTIVATION: Leaky ReLU (alpha=0.01)
// ----------------------------------------------------------
__kernel void leaky_relu(__global float *x, const int size) {
    int i = get_global_id(0);
    if (i < size)
        x[i] = x[i] >= 0.0f ? x[i] : 0.01f * x[i];
}

// ----------------------------------------------------------
// ACTIVATION: Leaky ReLU derivative
// ----------------------------------------------------------
__kernel void leaky_relu_deriv(
    __global const float *x,
    __global float *out,
    const int size)
{
    int i = get_global_id(0);
    if (i < size)
        out[i] = x[i] >= 0.0f ? 1.0f : 0.01f;
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
// ACTIVATION: Sigmoid derivative
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
// ACTIVATION: Tanh derivative
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
// BIAS ADD: output[i] = output[i] + bias[i % biasSize]
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
// BATCH NORM FORWARD (training)
// y = gamma * (x - mean) / sqrt(var + eps) + beta
// Computes mean and variance per feature across batch
// Also accumulates running_mean and running_var
// Input: x (M x N), Output: y (M x N)
// Mean/var per feature: N elements
// ----------------------------------------------------------
__kernel void batch_norm_fwd(
    __global const float *x,
    __global float *y,
    __global float *running_mean,
    __global float *running_var,
    __global float *gamma,
    __global float *beta,
    __global float *save_mean,
    __global float *save_var,
    const int M,
    const int N,
    const float momentum,
    const float eps)
{
    int col = get_global_id(0); // feature index
    if (col >= N) return;

    // Compute mean for this feature
    float mean = 0.0f;
    for (int i = 0; i < M; i++)
        mean += x[i * N + col];
    mean /= (float)M;

    // Compute variance for this feature
    float var = 0.0f;
    for (int i = 0; i < M; i++) {
        float diff = x[i * N + col] - mean;
        var += diff * diff;
    }
    var /= (float)M;

    // Save for backward pass
    save_mean[col] = mean;
    save_var[col] = var;

    // Update running stats (for inference)
    running_mean[col] = momentum * running_mean[col] + (1.0f - momentum) * mean;
    running_var[col] = momentum * running_var[col] + (1.0f - momentum) * var;

    // Normalize and scale
    float inv_std = rsqrt(var + eps);
    float g = gamma[col];
    float b = beta[col];
    for (int i = 0; i < M; i++)
        y[i * N + col] = (x[i * N + col] - mean) * inv_std * g + b;
}

// ----------------------------------------------------------
// BATCH NORM FORWARD (inference)
// Uses running_mean and running_var
// ----------------------------------------------------------
__kernel void batch_norm_fwd_infer(
    __global const float *x,
    __global float *y,
    __global const float *running_mean,
    __global const float *running_var,
    __global const float *gamma,
    __global const float *beta,
    const int M,
    const int N,
    const float eps)
{
    int col = get_global_id(0); // feature index
    if (col >= N) return;

    float mean = running_mean[col];
    float inv_std = rsqrt(running_var[col] + eps);
    float g = gamma[col];
    float b = beta[col];

    for (int i = 0; i < M; i++)
        y[i * N + col] = (x[i * N + col] - mean) * inv_std * g + b;
}

// ----------------------------------------------------------
// BACKPROP: delta_output = delta_next * weights^T
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
        sum += delta_next[row * N_out + k] * weights[k * N_in + col];
    }
    delta_curr[row * N_in + col] = sum;
}

// ----------------------------------------------------------
// GRADIENT WEIGHT: dW = A^T * delta
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
    dW[row * N + col] = sum / (float)M; // promedio sobre batch
}

// ----------------------------------------------------------
// GRADIENT BIAS: db = mean(delta, axis=0)
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
    db[col] = sum / (float)M;
}

// ----------------------------------------------------------
// BATCH NORM BACKWARD
// Computes gradients for gamma, beta, and dx
// ----------------------------------------------------------
__kernel void batch_norm_bwd(
    __global const float *dy,
    __global const float *x,
    __global const float *save_mean,
    __global const float *save_var,
    __global const float *gamma,
    __global float *dx,
    __global float *dgamma,
    __global float *dbeta,
    const int M,
    const int N,
    const float eps)
{
    int col = get_global_id(0);
    if (col >= N) return;

    float mean = save_mean[col];
    float var = save_var[col];
    float inv_std = rsqrt(var + eps);
    float g = gamma[col];

    // dBeta and dGamma
    float sum_dy = 0.0f;
    float sum_dy_xhat = 0.0f;
    for (int i = 0; i < M; i++) {
        float x_hat = (x[i * N + col] - mean) * inv_std;
        sum_dy += dy[i * N + col];
        sum_dy_xhat += dy[i * N + col] * x_hat;
    }
    dgamma[col] = sum_dy_xhat;
    dbeta[col] = sum_dy;

    // dy normalized
    float factor1 = g * inv_std / (float)M;
    float factor2 = sum_dy_xhat * inv_std / ((float)M * (float)M);
    for (int i = 0; i < M; i++) {
        float x_hat = (x[i * N + col] - mean) * inv_std;
        dx[i * N + col] = factor1 * ((float)M * dy[i * N + col] - sum_dy - x_hat * sum_dy_xhat);
    }
}

// ----------------------------------------------------------
// SGD UPDATE: param -= lr * (grad)
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
// ADAM UPDATE
// ----------------------------------------------------------
__kernel void adam_update(
    __global float *param,
    __global const float *grad,
    __global float *m,
    __global float *v,
    const int size,
    const float lr,
    const float beta1,
    const float beta2,
    const float eps,
    const float corr1,
    const float corr2)
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
// WEIGHT DECAY (AdamW style): param -= lr * weight_decay * param
// ----------------------------------------------------------
__kernel void weight_decay(
    __global float *param,
    const int size,
    const float lr,
    const float wd)
{
    int i = get_global_id(0);
    if (i < size)
        param[i] -= lr * wd * param[i];
}

// ----------------------------------------------------------
// GRADIENT CLIPPING (global norm): clip each grad element
// Per-element clipping for simplicity
// ----------------------------------------------------------
__kernel void gradient_clip(
    __global float *grad,
    const int size,
    const float max_norm)
{
    int i = get_global_id(0);
    if (i >= size) return;

    // Simple per-element clipping - prevents any single gradient from being too large
    if (grad[i] > max_norm) grad[i] = max_norm;
    else if (grad[i] < -max_norm) grad[i] = -max_norm;
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
// HUBER LOSS: Smooth L1
// ----------------------------------------------------------
__kernel void huber_loss(
    __global const float *pred,
    __global const float *target,
    __global float *loss,
    const int size,
    const float delta)
{
    int i = get_global_id(0);
    if (i < size) {
        float diff = pred[i] - target[i];
        float abs_diff = fabs(diff);
        if (abs_diff <= delta)
            loss[i] = 0.5f * diff * diff;
        else
            loss[i] = delta * (abs_diff - 0.5f * delta);
    }
}

// ----------------------------------------------------------
// CROSS-ENTROPY LOSS
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
// LABEL SMOOTHING
// Replaces one-hot targets with smoothed targets
// ----------------------------------------------------------
__kernel void label_smooth(
    __global float *target,
    const int size,
    const int num_classes,
    const float smoothing)
{
    int i = get_global_id(0);
    if (i >= size) return;

    int row = i / num_classes;
    int col = i % num_classes;
    float val = target[i];
    // One-hot: val is 1.0 or 0.0
    target[i] = val * (1.0f - smoothing) + smoothing / (float)num_classes;
}

// ----------------------------------------------------------
// LAYER NORM (kept for compatibility)
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

    float mean = 0.0f;
    for (int i = 0; i < cols; i++)
        mean += x[base + i];
    mean /= cols;

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
// DROPOUT MASK
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
// DROPOUT APPLY
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