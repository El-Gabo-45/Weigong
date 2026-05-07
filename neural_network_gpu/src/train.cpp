/*
 * train.cpp - Entrenamiento de red neuronal GPU invocado desde Node.js
 * 
 * Uso: ./nn_train <model_path> <epochs> <batch_size>
 * 
 * Entrada (stdin): JSON con arrays de inputs (4056 floats) y outputs (score float)
 * Salida (stdout): JSON con métricas de entrenamiento
 */

#include "nn.h"
#include <cstdio>
#include <cmath>
#include <cstring>
#include <vector>
#include <chrono>
#include <sstream>

// Leer JSON de stdin con formato: {"inputs": [[f1,f2,...],[...]], "scores": [s1, s2, ...]}
static bool read_training_data(std::vector<float*> &inputs, std::vector<float> &scores,
                                int &input_dim, int &output_dim, int &n_samples) {
    // Leer todo stdin como string
    std::stringstream ss;
    std::string line;
    while (std::getline(std::cin, line)) {
        ss << line;
    }
    std::string json = ss.str();
    if (json.empty()) return false;

    // Find "inputs": and "scores":
    size_t inputs_key = json.find("\"inputs\"");
    size_t scores_key = json.find("\"scores\"");
    if (inputs_key == std::string::npos || scores_key == std::string::npos) return false;

    // Find the opening '[' of the inputs array (after the colon)
    size_t inputs_start = json.find('[', inputs_key);
    if (inputs_start == std::string::npos) return false;

    // Find inputs array end using bracket counting
    int depth = 1;
    size_t inputs_end = inputs_start + 1;
    while (depth > 0 && inputs_end < json.size()) {
        if (json[inputs_end] == '[') depth++;
        else if (json[inputs_end] == ']') depth--;
        inputs_end++;
    }
    if (depth != 0) return false;

    // Now parse sub-arrays between inputs_start and inputs_end
    // Each sub-array is [f1,f2,f3,...]
    size_t p = inputs_start + 1;
    while (p < inputs_end) {
        // Skip to next '['
        p = json.find('[', p);
        if (p == std::string::npos || p >= inputs_end) break;

        // Find matching ']'
        size_t sub_start = p + 1;
        depth = 1;
        p++;
        while (depth > 0 && p < inputs_end) {
            if (json[p] == '[') depth++;
            else if (json[p] == ']') depth--;
            if (depth > 0) p++;
        }
        if (depth != 0) break;

        std::string arr_str = json.substr(sub_start, p - sub_start);

        // Parse floats separated by commas
        std::vector<float> vals;
        size_t num_start = 0;
        while (num_start < arr_str.size()) {
            // Skip non-digit/non-minus characters (commas, spaces)
            while (num_start < arr_str.size() && !(isdigit(arr_str[num_start]) || arr_str[num_start] == '-' || arr_str[num_start] == '.'))
                num_start++;
            if (num_start >= arr_str.size()) break;

            size_t num_end = num_start;
            while (num_end < arr_str.size() && (isdigit(arr_str[num_end]) || arr_str[num_end] == '-' || arr_str[num_end] == '.' || arr_str[num_end] == 'e' || arr_str[num_end] == 'E' || arr_str[num_end] == '+'))
                num_end++;

            float val = (float)atof(arr_str.substr(num_start, num_end - num_start).c_str());
            vals.push_back(val);
            num_start = num_end;
        }

        if (!vals.empty()) {
            float *in = new float[vals.size()];
            for (size_t j = 0; j < vals.size(); j++) in[j] = vals[j];
            inputs.push_back(in);
            if (input_dim == 0) input_dim = (int)vals.size();
        }
        p++;
    }

    // Parse scores array
    size_t scores_start = json.find('[', scores_key);
    if (scores_start == std::string::npos) return false;
    size_t s = scores_start + 1;
    while (s < json.size() && json[s] != ']') {
        // Skip whitespace/commas
        while (s < json.size() && (json[s] == ',' || json[s] == ' ' || json[s] == '\n' || json[s] == '\t'))
            s++;
        if (s >= json.size() || json[s] == ']') break;

        // Read number
        size_t num_start = s;
        while (s < json.size() && (isdigit(json[s]) || json[s] == '-' || json[s] == '.' || json[s] == 'e' || json[s] == 'E' || json[s] == '+'))
            s++;

        float val = (float)atof(json.substr(num_start, s - num_start).c_str());
        scores.push_back(val);
    }

    n_samples = (int)inputs.size();
    output_dim = 1;

    return n_samples > 0 && (int)scores.size() == n_samples;
}

int main(int argc, char **argv) {
    if (argc < 4) {
        fprintf(stderr, "Uso: %s <model_path> <epochs> <batch_size>\n", argv[0]);
        fprintf(stderr, "Lee datos JSON de stdin\n");
        return 1;
    }

    const char *model_path = argv[1];
    int epochs = atoi(argv[2]);
    int batch_size = atoi(argv[3]);
    if (epochs < 1) epochs = 10;
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

    cl_context context = clCreateContext(nullptr, 1, &device, nullptr, nullptr, &cl_err);
    if (cl_err != CL_SUCCESS) { fprintf(stderr, "Context failed\n"); return 1; }

    cl_command_queue queue = clCreateCommandQueueWithProperties(context, device, nullptr, &cl_err);
    if (cl_err != CL_SUCCESS) { fprintf(stderr, "Queue failed\n"); return 1; }

    // Leer datos
    std::vector<float*> inputs;
    std::vector<float> scores;
    int input_dim = 0, output_dim = 1, n_samples = 0;

    if (!read_training_data(inputs, scores, input_dim, output_dim, n_samples)) {
        fprintf(stderr, "Failed to parse training data from stdin\n");
        return 1;
    }

    fprintf(stderr, "Loaded %d samples (input_dim=%d)\n", n_samples, input_dim);

    // Crear modelo: input_dim -> 256 -> 128 -> 1
    NeuralNetwork nn(device, context, queue);
    nn.add_layer(input_dim, 256, Activation::RELU);
    nn.add_layer(256, 128, Activation::RELU);
    nn.add_layer(128, output_dim, Activation::TANH);
    nn.set_loss(LossType::MSE);
    nn.set_optimizer(OptimizerType::ADAM, 0.001f);
    nn.build();

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

    // Aplanar datos para entrenamiento
    float *X_flat = new float[n_samples * input_dim];
    float *Y_flat = new float[n_samples * output_dim];
    for (int i = 0; i < n_samples; i++) {
        memcpy(X_flat + i * input_dim, inputs[i], input_dim * sizeof(float));
        Y_flat[i] = scores[i];
    }

    // Entrenar
    auto start = std::chrono::high_resolution_clock::now();
    
    // Output JSON header
    printf("{\"epochs\": %d, \"samples\": %d, \"input_dim\": %d, \"results\": [\n", epochs, n_samples, input_dim);

    float prev_mse = 0;
    for (int epoch = 1; epoch <= epochs; epoch++) {
        nn.train_epoch(X_flat, Y_flat, n_samples, batch_size, true);

        if (epoch % std::max(1, epochs/10) == 0 || epoch == 1 || epoch == epochs) {
            // Evaluar
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

            // Early stopping
            if (epoch > 10 && fabs(prev_mse - mse) < 1e-8 && mse < 0.01) {
                printf("\n], \"early_stop\": %d}\n", epoch);
                break;
            }
            prev_mse = mse;
        }
    }

    printf("\n], \"final_mse\": %.6f}\n", prev_mse);

    auto end = std::chrono::high_resolution_clock::now();
    float ms = std::chrono::duration<float, std::milli>(end - start).count();
    fprintf(stderr, "Training time: %.2f ms\n", ms);

    // Guardar modelo
    try {
        nn.save(model_path);
        fprintf(stderr, "Model saved: %s\n", model_path);
    } catch (const std::exception &e) {
        fprintf(stderr, "Save error: %s\n", e.what());
    }

    // Limpiar
    for (auto p : inputs) delete[] p;
    delete[] X_flat;
    delete[] Y_flat;

    clReleaseCommandQueue(queue);
    clReleaseContext(context);

    return 0;
}