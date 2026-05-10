// ═══════════════════════════════════════════════════════════
//  GPU-Accelerated Neural Network (EN/ES)
//  OpenCL-based with AdamW, BatchNorm, Dropout, LeakyReLU
//  Arquitectura: forward/backward en GPU, LR scheduling, gradient clipping
// ═══════════════════════════════════════════════════════════

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

// Activation functions available for layers
//  Funciones de activación disponibles para capas
enum class Activation { NONE, RELU, LEAKY_RELU, SIGMOID, TANH, SOFTMAX };

// Loss function types
//  Tipos de función de pérdida
enum class LossType { MSE, CROSS_ENTROPY, HUBER };

// Optimizer types: SGD, Adam, AdamW (with decoupled weight decay)
//  Tipos de optimizador
enum class OptimizerType { SGD, ADAM, ADAMW };

struct LayerConfig {
    int input_size;
    int output_size;
    Activation activation;
    float dropout_keep_prob;  // 1.0 = no dropout / sin dropout
    bool use_batch_norm;
};

// Per-layer data: weights, biases, Adam moments, BN params, GPU buffers
//  Datos por capa: pesos, sesgos, momentos Adam, BN, buffers GPU
struct Layer {
    int input_size;
    int output_size;
    Activation activation;
    float dropout_keep_prob;
    bool use_batch_norm;

    // Host-side weights and biases
    //  Pesos y sesgos en host
    float *weights;
    float *bias;

    // BatchNorm parameters (learnable scale/shift + running stats)
    //  Parámetros BatchNorm (escala/desplazamiento aprendibles + estadísticas móviles)
    float *bn_gamma;
    float *bn_beta;
    float *bn_running_mean;
    float *bn_running_var;

    // GPU buffers: weights and bias
    cl_mem d_weights;
    cl_mem d_bias;
    cl_mem d_m_w;  // Adam 1st moment for weights / 1er momento Adam para pesos
    cl_mem d_v_w;  // Adam 2nd moment for weights / 2do momento Adam para pesos
    cl_mem d_m_b;  // Adam 1st moment for bias
    cl_mem d_v_b;  // Adam 2nd moment for bias

    // BatchNorm GPU buffers
    cl_mem d_bn_gamma;
    cl_mem d_bn_beta;
    cl_mem d_bn_running_mean;
    cl_mem d_bn_running_var;
    cl_mem d_bn_x_centered;   // x - mean (saved for backward)
    cl_mem d_bn_std_inv;      // 1/sqrt(var + eps)
    cl_mem d_bn_grad_gamma;
    cl_mem d_bn_grad_beta;
    cl_mem d_bn_m_gamma;      // Adam for gamma
    cl_mem d_bn_v_gamma;
    cl_mem d_bn_m_beta;       // Adam for beta
    cl_mem d_bn_v_beta;

    // Temporal GPU buffers for forward/backward
    //  Buffers temporales GPU para forward/backward
    cl_mem d_input;
    cl_mem d_output;
    cl_mem d_z;       // Pre-activation values / valores pre-activación
    cl_mem d_delta;
    cl_mem d_grad_w;
    cl_mem d_grad_b;

    // Dropout mask (Bernoulli)
    cl_mem d_dropout_mask;

    int t;  // Adam step counter (per-layer)
};

class NeuralNetwork {
public:
    NeuralNetwork(cl_device_id device, cl_context context, cl_command_queue queue);
    ~NeuralNetwork();

    // Build network architecture
    //  Construye la arquitectura de la red
    void add_layer(int input_size, int output_size,
                   Activation act = Activation::RELU,
                   float dropout_keep_prob = 1.0f);
    void set_loss(LossType loss);
    void set_optimizer(OptimizerType opt, float lr = 0.001f,
                       float beta1 = 0.9f, float beta2 = 0.999f,
                       float eps = 1e-8f);
    void build();

    // Training: single batch or full epoch (with optional shuffle)
    //  Entrenamiento: batch individual o época completa (con shuffle opcional)
    float train_batch(const float *X, const float *Y, int batch_size);
    void train_epoch(const float *X, const float *Y, int n_samples, int batch_size, bool shuffle = true);

    // Inference
    void predict(const float *X, float *output, int batch_size);
    void forward(const float *X, float *output, int batch_size);

    // Save/Load model to/from binary file
    //  Guardar/Cargar modelo a/desde archivo binario
    void save(const std::string &path);
    void load(const std::string &path);

    // Getters
    int get_num_layers() const { return (int)layers.size(); }
    int get_output_size() const { return layers.empty() ? 0 : layers.back().output_size; }

    // Debug: print network architecture summary (EN/ES)
    //  Imprimir resumen de arquitectura de la red
    void print_summary() const;

private:
    cl_device_id device;
    cl_context context;
    cl_command_queue queue;
    cl_program program;

    // OpenCL kernels for all operations
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

    // Layer configuration
    std::vector<Layer> layers;
    LossType loss_type;
    OptimizerType optimizer_type;
    float learning_rate;
    float initial_lr;
    float beta1, beta2, eps_adam;
    float l2_lambda;
    float gradient_clip_norm;
    float label_smoothing_eps;
    float bn_momentum;
    float bn_eps;
    float huber_delta;
    float weight_decay;

    // Learning Rate scheduler
    //  Programador de tasa de aprendizaje
    enum class LRSchedule { NONE, COSINE, COSINE_WARM_RESTARTS, STEP_DECAY };
    LRSchedule lr_schedule;
    int lr_warmup_epochs;
    int lr_cycle_length;
    int current_epoch;

    bool built;
    int global_step;  // Adam global step / paso global de Adam
    int current_batch_size;

    // Global temporary GPU buffers
    //  Buffers temporales GPU globales
    cl_mem d_loss_buf;
    cl_mem d_seed;
    cl_mem d_target;

    // OpenCL program compilation helpers
    //  Ayudantes de compilación de programa OpenCL
    cl_program build_program(const std::string &source);
    std::string load_kernel_source();

    // Advanced kernels (v2.0 features)
    //  Kernels avanzados (características v2.0)
    cl_kernel k_leaky_relu, k_leaky_relu_deriv;
    cl_kernel k_batch_norm_fwd;
    cl_kernel k_batch_norm_fwd_infer;
    cl_kernel k_batch_norm_bwd;
    cl_kernel k_gradient_clip;
    cl_kernel k_huber_loss;
    cl_kernel k_weight_decay;

    // Internal operations
    //  Operaciones internas
    void init_layer_buffers(Layer &layer);
    void ensure_temp_buffers(int batch_size);
    void allocate_temp(int max_batch, int max_neurons);
    void run_kernel_1d(cl_kernel kernel, int n, cl_mem *args, int nargs);
    void set_kernel_arg(cl_kernel kernel, int idx, size_t size, const void *val);

    float compute_loss_host(const float *pred, const float *target, int size);
    void shuffle_data(float *X, float *Y, int n, int input_dim, int output_dim);

    // Get current learning rate based on scheduler and epoch
    //  Obtiene la tasa de aprendizaje actual según el programador y la época
    float get_current_lr(int epoch);

    unsigned int seed_state;
};

#endif // NN_H