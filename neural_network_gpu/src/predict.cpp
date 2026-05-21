/*
 * predict.cpp - Inference helper for GPU neural network model
 *
 * Usage: ./nn_predict <model_path> <input_bin>
 *
 * Input binary format:
 *   [int32 input_dim][float32 input_dim floats]
 *
 * Output (stdout): JSON with predicted score
 */

#include "nn.h"
#include <cstdio>
#include <cstdlib>
#include <vector>
#include <cstring>

static bool read_input_bin(const char *path, float *&X, int &input_dim) {
    FILE *f = fopen(path, "rb");
    if (!f) {
        fprintf(stderr, "Cannot open input file: %s\n", path);
        return false;
    }

    if (fread(&input_dim, sizeof(int), 1, f) != 1) {
        fprintf(stderr, "Failed to read input dimension\n");
        fclose(f);
        return false;
    }

    if (input_dim <= 0) {
        fprintf(stderr, "Invalid input dimension: %d\n", input_dim);
        fclose(f);
        return false;
    }

    X = new float[input_dim];
    size_t read = fread(X, sizeof(float), input_dim, f);
    fclose(f);

    if (read != (size_t)input_dim) {
        fprintf(stderr, "Expected %d floats, got %zu\n", input_dim, read);
        delete[] X;
        return false;
    }

    return true;
}

int main(int argc, char **argv) {
    if (argc < 3) {
        fprintf(stderr, "Uso: %s <model_path> <input_bin>\n", argv[0]);
        return 1;
    }

    const char *model_path = argv[1];
    const char *input_bin = argv[2];

    int input_dim = 0;
    float *X = nullptr;
    if (!read_input_bin(input_bin, X, input_dim)) {
        return 1;
    }

    cl_int cl_err;
    cl_uint num_platforms;
    cl_err = clGetPlatformIDs(0, nullptr, &num_platforms);
    if (cl_err != CL_SUCCESS || num_platforms == 0) {
        fprintf(stderr, "No OpenCL platforms available\n");
        delete[] X;
        return 1;
    }

    std::vector<cl_platform_id> platforms(num_platforms);
    clGetPlatformIDs(num_platforms, platforms.data(), nullptr);

    cl_platform_id platform = nullptr;
    for (auto p : platforms) {
        char name[256] = {};
        clGetPlatformInfo(p, CL_PLATFORM_NAME, sizeof(name), name, nullptr);
        if (strstr(name, "rusticl") || strstr(name, "Mesa") || strstr(name, "AMD") || strstr(name, "amd")) {
            platform = p;
            break;
        }
    }
    if (!platform) platform = platforms[0];

    cl_device_id device;
    cl_err = clGetDeviceIDs(platform, CL_DEVICE_TYPE_GPU, 1, &device, nullptr);
    if (cl_err != CL_SUCCESS) {
        cl_err = clGetDeviceIDs(platform, CL_DEVICE_TYPE_CPU, 1, &device, nullptr);
        if (cl_err != CL_SUCCESS) {
            fprintf(stderr, "No OpenCL device found\n");
            delete[] X;
            return 1;
        }
    }

    cl_context context = clCreateContext(nullptr, 1, &device, nullptr, nullptr, &cl_err);
    if (cl_err != CL_SUCCESS) {
        fprintf(stderr, "Failed to create OpenCL context\n");
        delete[] X;
        return 1;
    }

    cl_command_queue queue = clCreateCommandQueueWithProperties(context, device, nullptr, &cl_err);
    if (cl_err != CL_SUCCESS) {
        fprintf(stderr, "Failed to create command queue\n");
        clReleaseContext(context);
        delete[] X;
        return 1;
    }

    NeuralNetwork nn(device, context, queue);
    nn.add_layer(input_dim, 512, Activation::LEAKY_RELU, 0.8f);
    nn.add_layer(512, 256, Activation::LEAKY_RELU, 0.8f);
    nn.add_layer(256, 128, Activation::LEAKY_RELU, 0.8f);
    nn.add_layer(128, 64, Activation::LEAKY_RELU);
    nn.add_layer(64, 1, Activation::TANH);
    nn.set_loss(LossType::HUBER);
    nn.set_optimizer(OptimizerType::ADAMW, 0.001f, 0.9f, 0.999f, 1e-8f);
    nn.build();

    try {
        nn.load(model_path);
    } catch (const std::exception &e) {
        fprintf(stderr, "Failed to load model: %s\n", e.what());
        clReleaseCommandQueue(queue);
        clReleaseContext(context);
        delete[] X;
        return 1;
    }

    float output = 0.0f;
    nn.predict(X, &output, 1);

    printf("{\"score\": %.9g}\n", output);

    clReleaseCommandQueue(queue);
    clReleaseContext(context);
    delete[] X;
    return 0;
}
