/*
 * train.cpp - Entrenamiento de red neuronal GPU invocado desde Node.js
 *
 * Uso: ./nn_train <model_path> <epochs> <batch_size> <data_bin>
 *
 * Entrada: archivo binario con formato:
 *   [int32 n_samples][int32 input_dim][float32 x n_samples*input_dim][float32 x n_samples]
 * Salida (stdout): JSON con métricas de entrenamiento
 */

#include "nn.h"
#include <cstdio>
#include <cmath>
#include <cstring>
#include <vector>
#include <chrono>

static bool read_training_data_bin(const char *path,
                                    float *&X_flat, float *&Y_flat,
                                    int &input_dim, int &n_samples) {
    FILE *f = fopen(path, "rb");
    if (!f) {
        fprintf(stderr, "Cannot open data file: %s\n", path);
        return false;
    }

    if (fread(&n_samples, sizeof(int), 1, f) != 1) { fclose(f); return false; }
    if (fread(&input_dim,  sizeof(int), 1, f) != 1) { fclose(f); return false; }

    if (n_samples <= 0 || input_dim <= 0) {
        fprintf(stderr, "Invalid header: n_samples=%d input_dim=%d\n", n_samples, input_dim);
        fclose(f);
        return false;
    }

    X_flat = new float[(size_t)n_samples * input_dim];
    Y_flat = new float[n_samples];

    size_t rx = fread(X_flat, sizeof(float), (size_t)n_samples * input_dim, f);
    size_t ry = fread(Y_flat, sizeof(float), n_samples, f);
    fclose(f);

    if (rx != (size_t)n_samples * input_dim || ry != (size_t)n_samples) {
        fprintf(stderr, "Read error: expected %zu+%d floats, got %zu+%zu\n",
                (size_t)n_samples * input_dim, n_samples, rx, ry);
        delete[] X_flat;
        delete[] Y_flat;
        return false;
    }

    return true;
}

int main(int argc, char **argv) {
    if (argc < 5) {
        fprintf(stderr, "Uso: %s <model_path> <epochs> <batch_size> <data_bin>\n", argv[0]);
        return 1;
    }

    const char *model_path = argv[1];
    int epochs     = atoi(argv[2]);
    int batch_size = atoi(argv[3]);
    const char *data_bin = argv[4];

    if (epochs < 1)     epochs = 10;
    if (batch_size < 1) batch_size = 64;

    // Inicializar OpenCL
    cl_int cl_err;
    cl_uint num_platforms;
    cl_err = clGetPlatformIDs(0, nullptr, &num_platforms);
    if (cl_err != CL_SUCCESS || num_platforms == 0) {
        fprintf(stderr, "No OpenCL platforms\n");
        return 1;
    }

    std::vector<cl_platform_id> platforms(num_platforms);
    clGetPlatformIDs(num_platforms, platforms.data(), nullptr);

    cl_device_id device;
    cl_platform_id platform = platforms[0];
    cl_err = clGetDeviceIDs(platform, CL_DEVICE_TYPE_GPU, 1, &device, nullptr);
    if (cl_err != CL_SUCCESS) {
        cl_err = clGetDeviceIDs(platform, CL_DEVICE_TYPE_CPU, 1, &device, nullptr);
        if (cl_err != CL_SUCCESS) {
            fprintf(stderr, "No OpenCL device\n");
            return 1;
        }
    }

    // Print device info so Node can see what's being used
    char dev_name[256] = {};
    clGetDeviceInfo(device, CL_DEVICE_NAME, sizeof(dev_name), dev_name, nullptr);
    fprintf(stderr, "Device: %s\n", dev_name);

    cl_context context = clCreateContext(nullptr, 1, &device, nullptr, nullptr, &cl_err);
    if (cl_err != CL_SUCCESS) { fprintf(stderr, "Context failed\n"); return 1; }

    cl_command_queue queue = clCreateCommandQueueWithProperties(context, device, nullptr, &cl_err);
    if (cl_err != CL_SUCCESS) { fprintf(stderr, "Queue failed\n"); return 1; }

    // Leer datos binarios
    float *X_flat = nullptr, *Y_flat = nullptr;
    int input_dim = 0, n_samples = 0;

    if (!read_training_data_bin(data_bin, X_flat, Y_flat, input_dim, n_samples)) {
        fprintf(stderr, "Failed to read binary data from %s\n", data_bin);
        return 1;
    }

    fprintf(stderr, "Loaded %d samples (input_dim=%d)\n", n_samples, input_dim);

    // Arquitectura: input_dim -> 512 -> 256 -> 128 -> 64 -> 1
    float drop_prob = 0.8f;
    NeuralNetwork nn(device, context, queue);
    nn.add_layer(input_dim, 512, Activation::LEAKY_RELU, drop_prob);
    nn.add_layer(512, 256, Activation::LEAKY_RELU, drop_prob);
    nn.add_layer(256, 128, Activation::LEAKY_RELU, drop_prob);
    nn.add_layer(128, 64,  Activation::LEAKY_RELU);
    nn.add_layer(64,  1,   Activation::TANH);
    nn.set_loss(LossType::HUBER);
    nn.set_optimizer(OptimizerType::ADAMW, 0.001f, 0.9f, 0.999f, 1e-8f);
    nn.build();
    nn.print_summary();

    // Intentar cargar modelo existente
    FILE *f = fopen(model_path, "rb");
    if (f) {
        fclose(f);
        try {
            nn.load(model_path);
            fprintf(stderr, "Loaded existing model: %s\n", model_path);
        } catch (...) {
            fprintf(stderr, "Could not load model, starting fresh\n");
        }
    }

    // Entrenar
    auto start = std::chrono::high_resolution_clock::now();

    printf("{\"epochs\": %d, \"samples\": %d, \"input_dim\": %d, \"results\": [\n",
           epochs, n_samples, input_dim);

    float prev_mse = 0;
    for (int epoch = 1; epoch <= epochs; epoch++) {
        nn.train_epoch(X_flat, Y_flat, n_samples, batch_size, true);

        if (epoch % std::max(1, epochs / 10) == 0 || epoch == 1 || epoch == epochs) {
            float *preds = new float[n_samples];
            nn.predict(X_flat, preds, n_samples);

            float mse = 0, max_err = 0;
            for (int i = 0; i < n_samples; i++) {
                float diff = preds[i] - Y_flat[i];
                mse += diff * diff;
                if (fabs(diff) > max_err) max_err = fabs(diff);
            }
            mse /= n_samples;

            printf("  {\"epoch\": %d, \"mse\": %.6f, \"rmse\": %.6f, \"max_err\": %.4f}",
                   epoch, mse, sqrt(mse), max_err);
            if (epoch < epochs) printf(",\n");

            delete[] preds;

            if (epoch > 10 && fabs(prev_mse - mse) < 1e-8 && mse < 0.01) {
                printf("\n], \"early_stop\": %d}\n", epoch);
                goto done;
            }
            prev_mse = mse;
        }
    }

    printf("\n], \"final_mse\": %.6f}\n", prev_mse);

done:
    auto end = std::chrono::high_resolution_clock::now();
    float ms = std::chrono::duration<float, std::milli>(end - start).count();
    fprintf(stderr, "Training time: %.2f ms\n", ms);

    try {
        nn.save(model_path);
        fprintf(stderr, "Model saved: %s\n", model_path);
    } catch (const std::exception &e) {
        fprintf(stderr, "Save error: %s\n", e.what());
    }

    delete[] X_flat;
    delete[] Y_flat;

    clReleaseCommandQueue(queue);
    clReleaseContext(context);

    return 0;
}