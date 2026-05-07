#ifndef NN_H
#define NN_H

#include <CL/cl.h>
#include <vector>
#include <string>
#include <random>
#include <cmath>
#include <cstring>
#include <iostream>
#include <fstream>
#include <sstream>
#include <stdexcept>

enum class Activation { NONE, RELU, SIGMOID, TANH, SOFTMAX };
enum class LossType { MSE, CROSS_ENTROPY };
enum class OptimizerType { SGD, ADAM };

struct LayerConfig {
    int input_size;
    int output_size;
    Activation activation;
    float dropout_keep_prob;  // 1.0 = sin dropout
};

struct Layer {
    int input_size;
    int output_size;
    Activation activation;
    float dropout_keep_prob;

    // Pesos y bias (host)
    float *weights;
    float *bias;

    // Buffers GPU
    cl_mem d_weights;
    cl_mem d_bias;
    cl_mem d_m_w;  // momento Adam para weights
    cl_mem d_v_w;
    cl_mem d_m_b;  // momento Adam para bias
    cl_mem d_v_b;

    // Temporales GPU
    cl_mem d_input;
    cl_mem d_output;
    cl_mem d_z;       // pre-activación
    cl_mem d_delta;
    cl_mem d_grad_w;
    cl_mem d_grad_b;

    // Dropout
    cl_mem d_dropout_mask;

    // Adam step counter
    int t;
};

class NeuralNetwork {
public:
    NeuralNetwork(cl_device_id device, cl_context context, cl_command_queue queue);
    ~NeuralNetwork();

    // Construcción
    void add_layer(int input_size, int output_size,
                   Activation act = Activation::RELU,
                   float dropout_keep_prob = 1.0f);
    void set_loss(LossType loss);
    void set_optimizer(OptimizerType opt, float lr = 0.001f,
                       float beta1 = 0.9f, float beta2 = 0.999f,
                       float eps = 1e-8f);
    void build();

    // Entrenamiento
    float train_batch(const float *X, const float *Y, int batch_size);
    void train_epoch(const float *X, const float *Y, int n_samples, int batch_size, bool shuffle = true);

    // Inferencia
    void predict(const float *X, float *output, int batch_size);
    void forward(const float *X, float *output, int batch_size);

    // Guardar/Cargar
    void save(const std::string &path);
    void load(const std::string &path);

    // Getters
    int get_num_layers() const { return (int)layers.size(); }
    int get_output_size() const { return layers.empty() ? 0 : layers.back().output_size; }

private:
    cl_device_id device;
    cl_context context;
    cl_command_queue queue;
    cl_program program;

    // Kernels
    cl_kernel k_matmul;
    cl_kernel k_matmul_transposed;
    cl_kernel k_relu, k_relu_deriv;
    cl_kernel k_sigmoid, k_sigmoid_deriv;
    cl_kernel k_tanh_act, k_tanh_deriv;
    cl_kernel k_softmax;
    cl_kernel k_bias_add;
    cl_kernel k_backprop_delta;
    cl_kernel k_grad_weight;
    cl_kernel k_grad_bias;
    cl_kernel k_sgd_update;
    cl_kernel k_adam_update;
    cl_kernel k_element_mul;
    cl_kernel k_copy;
    cl_kernel k_dropout_mask;
    cl_kernel k_dropout_apply;
    cl_kernel k_cross_entropy_loss;
    cl_kernel k_mse_loss;

    std::vector<Layer> layers;
    LossType loss_type;
    OptimizerType optimizer_type;
    float learning_rate;
    float beta1, beta2, eps_adam;
    float l2_lambda;

    bool built;
    int global_step;  // para Adam
    int current_batch_size;

    // Buffers temporales
    cl_mem d_loss_buf;
    cl_mem d_seed;
    cl_mem d_target;

    // Compilación de kernels
    cl_program build_program(const std::string &source);
    std::string load_kernel_source();

    // Operaciones internas
    void init_layer_buffers(Layer &layer);
    void ensure_temp_buffers(int batch_size);
    void allocate_temp(int max_batch, int max_neurons);
    void run_kernel_1d(cl_kernel kernel, int n, cl_mem *args, int nargs);
    void set_kernel_arg(cl_kernel kernel, int idx, size_t size, const void *val);

    float compute_loss_host(const float *pred, const float *target, int size);
    void shuffle_data(float *X, float *Y, int n, int input_dim, int output_dim);

    // Random seed management
    unsigned int seed_state;
};

#endif // NN_H