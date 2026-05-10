/*
 * Neural Network GPU - Examples with OpenCL (EN/ES)
 * Optimized for AMD RX 570 (Polaris) via Mesa/Rusticl
 * Compile: make  |  Run: make run
 * ES: Ejemplos de red neuronal acelerada por GPU con OpenCL
 */

#include "nn.h"
#include <cstdio>
#include <cmath>
#include <chrono>
#include <vector>
#include <algorithm>

// ============================================================
// Utilidad: inicializar OpenCL
// ============================================================
static bool init_opencl(cl_device_id &device, cl_context &context,
                         cl_command_queue &queue) {
    cl_int err;

    // Obtener plataformas
    cl_uint num_platforms;
    err = clGetPlatformIDs(0, nullptr, &num_platforms);
    if (err != CL_SUCCESS || num_platforms == 0) {
        fprintf(stderr, "No OpenCL platforms found!\n");
        return false;
    }

    std::vector<cl_platform_id> platforms(num_platforms);
    clGetPlatformIDs(num_platforms, platforms.data(), nullptr);

    cl_platform_id platform = nullptr;
    for (auto p : platforms) {
        char name[256];
        clGetPlatformInfo(p, CL_PLATFORM_NAME, sizeof(name), name, nullptr);
        if (strstr(name, "rusticl") || strstr(name, "Mesa") || strstr(name, "AMD") || strstr(name, "amd")) {
            platform = p;
            break;
        }
    }
    if (!platform) platform = platforms[0];

    char plat_name[256], plat_vendor[256];
    clGetPlatformInfo(platform, CL_PLATFORM_NAME, sizeof(plat_name), plat_name, nullptr);
    clGetPlatformInfo(platform, CL_PLATFORM_VENDOR, sizeof(plat_vendor), plat_vendor, nullptr);
    printf("Platform: %s (%s)\n", plat_name, plat_vendor);

    // Obtener GPU
    err = clGetDeviceIDs(platform, CL_DEVICE_TYPE_GPU, 1, &device, nullptr);
    if (err != CL_SUCCESS) {
        fprintf(stderr, "No GPU device found! Trying CPU...\n");
        err = clGetDeviceIDs(platform, CL_DEVICE_TYPE_CPU, 1, &device, nullptr);
        if (err != CL_SUCCESS) {
            fprintf(stderr, "No OpenCL devices found!\n");
            return false;
        }
    }

    char dev_name[256];
    cl_uint compute_units;
    cl_ulong global_mem;
    cl_uint max_clock;
    clGetDeviceInfo(device, CL_DEVICE_NAME, sizeof(dev_name), dev_name, nullptr);
    clGetDeviceInfo(device, CL_DEVICE_MAX_COMPUTE_UNITS, sizeof(compute_units), &compute_units, nullptr);
    clGetDeviceInfo(device, CL_DEVICE_GLOBAL_MEM_SIZE, sizeof(global_mem), &global_mem, nullptr);
    clGetDeviceInfo(device, CL_DEVICE_MAX_CLOCK_FREQUENCY, sizeof(max_clock), &max_clock, nullptr);

    printf("Device  : %s\n", dev_name);
    printf("CUs     : %u\n", compute_units);
    printf("Clock   : %u MHz\n", max_clock);
    printf("VRAM    : %.1f GB\n", global_mem / (1024.0f * 1024.0f * 1024.0f));

    // Crear context y queue
    context = clCreateContext(nullptr, 1, &device, nullptr, nullptr, &err);
    if (err != CL_SUCCESS) {
        fprintf(stderr, "Failed to create OpenCL context!\n");
        return false;
    }

    queue = clCreateCommandQueueWithProperties(context, device, nullptr, &err);
    if (err != CL_SUCCESS) {
        fprintf(stderr, "Failed to create command queue!\n");
        return false;
    }

    return true;
}

// ============================================================
// Ejemplo 1: XOR (clásico) - clasificación no lineal
// ============================================================
void example_xor(cl_device_id device, cl_context context, cl_command_queue queue) {
    printf("\n========================================\n");
    printf("  EJEMPLO 1: XOR (Clasificación)\n");
    printf("========================================\n\n");

    // Datos XOR
    float X[] = {
        0.0f, 0.0f,
        0.0f, 1.0f,
        1.0f, 0.0f,
        1.0f, 1.0f
    };
    float Y[] = {
        0.0f,
        1.0f,
        1.0f,
        0.0f
    };
    int n_samples = 4;
    int input_dim = 2;
    int output_dim = 1;

    // Crear red: 2 -> 4 -> 1 (tanh)
    NeuralNetwork nn(device, context, queue);
    nn.add_layer(2, 4, Activation::TANH);
    nn.add_layer(4, 1, Activation::TANH);
    nn.set_loss(LossType::MSE);
    nn.set_optimizer(OptimizerType::ADAM, 0.01f);
    nn.build();

    printf("Red: 2 -> 4 -> 1 (tanh, ADAM)\n\n");

    // Entrenar
    auto start = std::chrono::high_resolution_clock::now();
    for (int epoch = 1; epoch <= 5000; epoch++) {
        nn.train_epoch(X, Y, n_samples, 4, false);
        if (epoch % 1000 == 0) {
            float pred[4];
            nn.predict(X, pred, 4);
            float mse = 0;
            for (int i = 0; i < 4; i++) mse += (pred[i] - Y[i]) * (pred[i] - Y[i]);
            mse /= 4;
            printf("  Epoch %5d | Loss: %.6f\n", epoch, mse);
        }
    }
    auto end = std::chrono::high_resolution_clock::now();
    float ms = std::chrono::duration<float, std::milli>(end - start).count();
    printf("\n  Tiempo de entrenamiento: %.2f ms\n", ms);

    // Evaluar
    printf("\n  Resultados XOR:\n");
    float pred[4];
    nn.predict(X, pred, 4);
    const char *labels[] = {"0,0", "0,1", "1,0", "1,1"};
    for (int i = 0; i < 4; i++) {
        printf("    %s -> %.4f (esperado: %.0f)\n",
               labels[i], pred[i], Y[i]);
    }
}

// ============================================================
// Ejemplo 2: Regresión (sin(x) + cos(x))
// ============================================================
void example_regression(cl_device_id device, cl_context context, cl_command_queue queue) {
    printf("\n========================================\n");
    printf("  EJEMPLO 2: Regresión (sin+cos)\n");
    printf("========================================\n\n");

    // Generar datos sintéticos
    int n_samples = 1000;
    int input_dim = 1;
    int output_dim = 1;
    float *X = new float[n_samples];
    float *Y = new float[n_samples];

    for (int i = 0; i < n_samples; i++) {
        float t = (float)i / n_samples * 4.0f * 3.14159f; // 2 ciclos
        X[i] = t / (4.0f * 3.14159f); // normalizado [0,1]
        Y[i] = 0.5f * (sin(t) + cos(t)) + 0.5f; // normalizado [0,1]
    }

    // Crear red: 1 -> 32 -> 32 -> 1
    NeuralNetwork nn(device, context, queue);
    nn.add_layer(1, 32, Activation::RELU);
    nn.add_layer(32, 32, Activation::RELU);
    nn.add_layer(32, 1, Activation::TANH); // tanh en la salida para rangos

    // Reescalar target a [-0.5, 0.5] para tanh
    float *Y_scaled = new float[n_samples];
    for (int i = 0; i < n_samples; i++)
        Y_scaled[i] = Y[i] - 0.5f;

    nn.set_loss(LossType::MSE);
    nn.set_optimizer(OptimizerType::ADAM, 0.001f);
    nn.build();

    printf("Red: 1 -> 32 -> 32 -> 1 (ReLU, ADAM)\n");
    printf("Muestras: %d\n\n", n_samples);

    // Entrenar
    auto start = std::chrono::high_resolution_clock::now();
    for (int epoch = 1; epoch <= 200; epoch++) {
        nn.train_epoch(X, Y_scaled, n_samples, 64, true);
        if (epoch % 20 == 0) {
            float pred[64];
            nn.predict(X, pred, std::min(64, n_samples));
            float mse = 0;
            for (int i = 0; i < std::min(64, n_samples); i++)
                mse += (pred[i] - Y_scaled[i]) * (pred[i] - Y_scaled[i]);
            mse /= std::min(64, n_samples);
            printf("  Epoch %3d | MSE: %.6f\n", epoch, mse);
        }
    }
    auto end = std::chrono::high_resolution_clock::now();
    float ms = std::chrono::duration<float, std::milli>(end - start).count();
    printf("\n  Tiempo de entrenamiento: %.2f ms (%.2f ms/epoch)\n", ms, ms / 200.0f);

    // Evaluar algunos puntos
    printf("\n  Muestras de la función aprendida:\n");
    float test_x[] = {0.0f, 0.1f, 0.25f, 0.5f, 0.75f, 0.9f, 1.0f};
    float pred[7];
    nn.predict(test_x, pred, 7);
    for (int i = 0; i < 7; i++) {
        float t = test_x[i] * 4.0f * 3.14159f;
        float expected = 0.5f * (sin(t) + cos(t)) + 0.5f;
        printf("    x=%.2f | pred=%.4f | real=%.4f\n",
               test_x[i], pred[i] + 0.5f, expected);
    }

    delete[] X;
    delete[] Y;
    delete[] Y_scaled;
}

// ============================================================
// Ejemplo 3: MNIST-like (clasificación multiclase)
// ============================================================
void example_multiclass(cl_device_id device, cl_context context, cl_command_queue queue) {
    printf("\n========================================\n");
    printf("  EJEMPLO 3: Clasificación multiclase\n");
    printf("========================================\n\n");

    // Generar 3 clusters Gaussianos en 2D
    int n_samples = 300;
    int input_dim = 2;
    int output_dim = 3;
    float *X = new float[n_samples * 2];
    float *Y = new float[n_samples * 3];

    srand(42);
    for (int i = 0; i < n_samples; i++) {
        int cls = i / 100; // 0, 1, 2
        float cx = (cls == 0) ? 0.0f : (cls == 1) ? 1.0f : 0.5f;
        float cy = (cls == 0) ? 0.0f : (cls == 1) ? 0.0f : 1.0f;
        float angle = (float)rand() / RAND_MAX * 2.0f * 3.14159f;
        float r = (float)rand() / RAND_MAX * 0.3f;
        X[i * 2 + 0] = cx + r * cos(angle);
        X[i * 2 + 1] = cy + r * sin(angle);
        for (int j = 0; j < 3; j++)
            Y[i * 3 + j] = (j == cls) ? 1.0f : 0.0f;
    }

    // Red: 2 -> 16 -> 16 -> 3 (softmax)
    NeuralNetwork nn(device, context, queue);
    nn.add_layer(2, 16, Activation::RELU);
    nn.add_layer(16, 16, Activation::RELU);
    nn.add_layer(16, 3, Activation::SOFTMAX);
    nn.set_loss(LossType::CROSS_ENTROPY);
    nn.set_optimizer(OptimizerType::ADAM, 0.005f);
    nn.build();

    printf("Red: 2 -> 16 -> 16 -> 3 (softmax, cross-entropy)\n");
    printf("Muestras: %d\n\n", n_samples);

    // Entrenar
    float *pred = new float[n_samples * 3];
    auto start = std::chrono::high_resolution_clock::now();
    for (int epoch = 1; epoch <= 500; epoch++) {
        nn.train_epoch(X, Y, n_samples, 32, true);
        if (epoch % 100 == 0) {
            nn.predict(X, pred, n_samples);
            int correct = 0;
    for (int i = 0; i < n_samples; i++) {
        int true_cls = i / 100;
        int pred_cls = 0;
        float max_val = pred[i * 3 + 0];
        for (int j = 1; j < 3; j++) {
                    if (pred[i * 3 + j] > max_val) {
                        max_val = pred[i * 3 + j];
                        pred_cls = j;
                    }
                }
                if (pred_cls == true_cls) correct++;
            }
            float acc = 100.0f * correct / n_samples;
            printf("  Epoch %3d | Accuracy: %.1f%%\n", epoch, acc);
        }
    }
    auto end = std::chrono::high_resolution_clock::now();
    float ms = std::chrono::duration<float, std::milli>(end - start).count();
    printf("\n  Tiempo de entrenamiento: %.2f ms\n", ms);

    delete[] pred;
    delete[] X;
    delete[] Y;
}

// ============================================================
// Ejemplo 4: Benchmark de throughput (grande)
// ============================================================
void example_large_network(cl_device_id device, cl_context context, cl_command_queue queue) {
    printf("\n========================================\n");
    printf("  EJEMPLO 4: Benchmark (capa grande)\n");
    printf("========================================\n\n");

    int batch_size = 128;
    int n_samples = 1024;
    int input_dim = 256;
    int hidden = 512;
    int output_dim = 10;

    float *X = new float[n_samples * input_dim];
    float *Y = new float[n_samples * output_dim];

    srand(123);
    for (int i = 0; i < n_samples * input_dim; i++)
        X[i] = (float)rand() / RAND_MAX;
    for (int i = 0; i < n_samples; i++) {
        int cls = i % output_dim;
        for (int j = 0; j < output_dim; j++)
            Y[i * output_dim + j] = (j == cls) ? 1.0f : 0.0f;
    }

    NeuralNetwork nn(device, context, queue);
    nn.add_layer(input_dim, hidden, Activation::RELU);
    nn.add_layer(hidden, hidden, Activation::RELU);
    nn.add_layer(hidden, output_dim, Activation::SOFTMAX);
    nn.set_loss(LossType::CROSS_ENTROPY);
    nn.set_optimizer(OptimizerType::ADAM, 0.001f);
    nn.build();

    printf("Red: %d -> %d -> %d -> %d\n", input_dim, hidden, hidden, output_dim);
    printf("Total parámetros: %d\n\n", input_dim * hidden + hidden + hidden * hidden + hidden + hidden * output_dim + output_dim);

    // Warmup
    nn.train_batch(X, Y, batch_size);

    // Benchmark
    int n_iters = 100;
    auto start = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < n_iters; i++) {
        nn.train_batch(X + (i % (n_samples / batch_size)) * batch_size * input_dim,
                        Y + (i % (n_samples / batch_size)) * batch_size * output_dim,
                        batch_size);
    }
    auto end = std::chrono::high_resolution_clock::now();
    float ms_total = std::chrono::duration<float, std::milli>(end - start).count();
    float ms_per_batch = ms_total / n_iters;

    printf("Benchmark (%d batches de %d):\n", n_iters, batch_size);
    printf("  Tiempo total:    %.1f ms\n", ms_total);
    printf("  Tiempo/batch:    %.2f ms\n", ms_per_batch);
    printf("  Throughput:      %.0f muestras/s\n",
           1000.0f * batch_size / ms_per_batch);
    printf("  Throughput:      %.0f batches/s\n", 1000.0f / ms_per_batch);

    delete[] X;
    delete[] Y;
}

// ============================================================
// Main
// ============================================================
int main(int argc, char **argv) {
    printf("========================================\n");
    printf("  RED NEURONAL ACELERADA POR GPU\n");
    printf("  OpenCL + Rusticl (AMD RX 570)\n");
    printf("========================================\n\n");

    // Inicializar OpenCL
    cl_device_id device;
    cl_context context;
    cl_command_queue queue;

    if (!init_opencl(device, context, queue)) {
        fprintf(stderr, "Failed to initialize OpenCL!\n");
        return 1;
    }

    // Copiar kernel a cwd si no existe
    FILE *f = fopen("nn_kernel.cl", "r");
    if (!f) {
        system("cp src/nn_kernel.cl . 2>/dev/null");
    } else {
        fclose(f);
    }

    bool test_mode = (argc > 1 && strcmp(argv[1], "--test") == 0);

    try {
        example_xor(device, context, queue);

        if (!test_mode) {
            example_regression(device, context, queue);
            example_multiclass(device, context, queue);
            example_large_network(device, context, queue);
        }

    } catch (const std::exception &e) {
        fprintf(stderr, "\nERROR: %s\n", e.what());
        return 1;
    }

    printf("\n========================================\n");
    printf("  TODOS LOS EJEMPLOS COMPLETADOS\n");
    printf("========================================\n");

    // Cleanup
    clReleaseCommandQueue(queue);
    clReleaseContext(context);

    return 0;
}