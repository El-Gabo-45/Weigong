#include "nn.h"
#include <cstdio>
#include <cmath>
#include <algorithm>

// ============ HELPER: OpenCL error checking ============
#define CL_CALL(x) do { \
    cl_int _err_ = (x); \
    if (_err_ != CL_SUCCESS) { \
        char _buf_[256]; \
        snprintf(_buf_, sizeof(_buf_), "OpenCL error %d at %s:%d", _err_, __FILE__, __LINE__); \
        throw std::runtime_error(_buf_); \
    } \
} while(0)

// Constructor: initialize OpenCL program, create all kernels, seed buffer for dropout
// ES: Constructor: inicializa programa OpenCL, crea todos los kernels, buffer semilla para dropout
NeuralNetwork::NeuralNetwork(cl_device_id dev, cl_context ctx, cl_command_queue q)
    : device(dev), context(ctx), queue(q), program(nullptr),
      k_matmul(nullptr), k_matmul_transposed(nullptr),
      k_relu(nullptr), k_relu_deriv(nullptr),
      k_leaky_relu(nullptr), k_leaky_relu_deriv(nullptr),
      k_sigmoid(nullptr), k_sigmoid_deriv(nullptr),
      k_tanh_act(nullptr), k_tanh_deriv(nullptr),
      k_softmax(nullptr), k_bias_add(nullptr),
      k_backprop_delta(nullptr), k_grad_weight(nullptr), k_grad_bias(nullptr),
      k_sgd_update(nullptr), k_adam_update(nullptr),
      k_element_mul(nullptr), k_copy(nullptr),
      k_dropout_mask(nullptr), k_dropout_apply(nullptr),
      k_cross_entropy_loss(nullptr), k_mse_loss(nullptr),
      k_batch_norm_fwd(nullptr), k_batch_norm_fwd_infer(nullptr),
      k_batch_norm_bwd(nullptr),
      k_gradient_clip(nullptr), k_huber_loss(nullptr), k_weight_decay(nullptr),
      loss_type(LossType::MSE), optimizer_type(OptimizerType::ADAMW),
      learning_rate(0.001f), initial_lr(0.001f),
      beta1(0.9f), beta2(0.999f), eps_adam(1e-8f),
      l2_lambda(0.0f), gradient_clip_norm(5.0f),
      label_smoothing_eps(0.0f), bn_momentum(0.9f), bn_eps(1e-5f),
      huber_delta(1.0f), weight_decay(1e-4f),
      lr_schedule(LRSchedule::COSINE_WARM_RESTARTS),
      lr_warmup_epochs(5), lr_cycle_length(50), current_epoch(0),
      built(false), global_step(0), seed_state(12345),
      d_loss_buf(nullptr), d_seed(nullptr), d_target(nullptr),
      current_batch_size(0)
{
    // Compilar programa
    std::string src = load_kernel_source();
    program = build_program(src);

    // Crear kernels
    auto create_kernel = [&](const char *name) -> cl_kernel {
        cl_int err;
        cl_kernel k = clCreateKernel(program, name, &err);
        if (err != CL_SUCCESS) {
            fprintf(stderr, "Warning: kernel '%s' not found (err=%d)\n", name, err);
        }
        return k;
    };

    k_matmul              = create_kernel("matmul");
    k_matmul_transposed   = create_kernel("matmul_transposed");
    k_relu                = create_kernel("relu");
    k_relu_deriv          = create_kernel("relu_deriv");
    k_leaky_relu          = create_kernel("leaky_relu");
    k_leaky_relu_deriv    = create_kernel("leaky_relu_deriv");
    k_sigmoid             = create_kernel("sigmoid");
    k_sigmoid_deriv       = create_kernel("sigmoid_deriv");
    k_tanh_act            = create_kernel("tanh_act");
    k_tanh_deriv          = create_kernel("tanh_deriv");
    k_softmax             = create_kernel("softmax");
    k_bias_add            = create_kernel("bias_add");
    k_backprop_delta      = create_kernel("backprop_delta");
    k_grad_weight         = create_kernel("grad_weight");
    k_grad_bias           = create_kernel("grad_bias");
    k_sgd_update          = create_kernel("sgd_update");
    k_adam_update         = create_kernel("adam_update");
    k_element_mul         = create_kernel("element_mul");
    k_copy                = create_kernel("copy");
    k_dropout_mask        = create_kernel("dropout_mask");
    k_dropout_apply       = create_kernel("dropout_apply");
    k_cross_entropy_loss  = create_kernel("cross_entropy_loss");
    k_mse_loss            = create_kernel("mse_loss");
    k_batch_norm_fwd      = create_kernel("batch_norm_fwd");
    k_batch_norm_fwd_infer= create_kernel("batch_norm_fwd_infer");
    k_batch_norm_bwd      = create_kernel("batch_norm_bwd");
    k_gradient_clip       = create_kernel("gradient_clip");
    k_huber_loss          = create_kernel("huber_loss");
    k_weight_decay        = create_kernel("weight_decay");

    // Crear buffer de seed para dropout
    cl_int err;
    d_seed = clCreateBuffer(context, CL_MEM_READ_WRITE, sizeof(cl_uint), nullptr, &err);
    if (err != CL_SUCCESS) throw std::runtime_error("Failed to create seed buffer");
    cl_uint seed_h = 12345;
    CL_CALL(clEnqueueWriteBuffer(queue, d_seed, CL_TRUE, 0, sizeof(cl_uint), &seed_h, 0, nullptr, nullptr));
}

// Helper: release GPU buffer if non-null
static void safe_release_mem(cl_mem &m) {
    if (m) { clReleaseMemObject(m); m = nullptr; }
}

NeuralNetwork::~NeuralNetwork() {
    for (auto &l : layers) {
        delete[] l.weights;
        delete[] l.bias;
        delete[] l.bn_gamma;
        delete[] l.bn_beta;
        delete[] l.bn_running_mean;
        delete[] l.bn_running_var;
        safe_release_mem(l.d_weights);
        safe_release_mem(l.d_bias);
        safe_release_mem(l.d_m_w);
        safe_release_mem(l.d_v_w);
        safe_release_mem(l.d_m_b);
        safe_release_mem(l.d_v_b);
        safe_release_mem(l.d_bn_gamma);
        safe_release_mem(l.d_bn_beta);
        safe_release_mem(l.d_bn_running_mean);
        safe_release_mem(l.d_bn_running_var);
        safe_release_mem(l.d_bn_x_centered);
        safe_release_mem(l.d_bn_std_inv);
        safe_release_mem(l.d_bn_grad_gamma);
        safe_release_mem(l.d_bn_grad_beta);
        safe_release_mem(l.d_bn_m_gamma);
        safe_release_mem(l.d_bn_v_gamma);
        safe_release_mem(l.d_bn_m_beta);
        safe_release_mem(l.d_bn_v_beta);
        safe_release_mem(l.d_input);
        safe_release_mem(l.d_output);
        safe_release_mem(l.d_z);
        safe_release_mem(l.d_delta);
        safe_release_mem(l.d_grad_w);
        safe_release_mem(l.d_grad_b);
        safe_release_mem(l.d_dropout_mask);
    }
    auto safe_release_kernel = [](cl_kernel k) { if (k) clReleaseKernel(k); };
    safe_release_kernel(k_matmul); safe_release_kernel(k_matmul_transposed);
    safe_release_kernel(k_relu); safe_release_kernel(k_relu_deriv);
    safe_release_kernel(k_leaky_relu); safe_release_kernel(k_leaky_relu_deriv);
    safe_release_kernel(k_sigmoid); safe_release_kernel(k_sigmoid_deriv);
    safe_release_kernel(k_tanh_act); safe_release_kernel(k_tanh_deriv);
    safe_release_kernel(k_softmax); safe_release_kernel(k_bias_add);
    safe_release_kernel(k_backprop_delta);
    safe_release_kernel(k_grad_weight); safe_release_kernel(k_grad_bias);
    safe_release_kernel(k_sgd_update); safe_release_kernel(k_adam_update);
    safe_release_kernel(k_element_mul); safe_release_kernel(k_copy);
    safe_release_kernel(k_dropout_mask); safe_release_kernel(k_dropout_apply);
    safe_release_kernel(k_cross_entropy_loss); safe_release_kernel(k_mse_loss);
    safe_release_kernel(k_batch_norm_fwd); safe_release_kernel(k_batch_norm_fwd_infer);
    safe_release_kernel(k_batch_norm_bwd);
    safe_release_kernel(k_gradient_clip); safe_release_kernel(k_huber_loss);
    safe_release_kernel(k_weight_decay);
    safe_release_mem(d_loss_buf);
    safe_release_mem(d_seed);
    safe_release_mem(d_target);
    if (program) clReleaseProgram(program);
}

// ============ Load kernel source ============
std::string NeuralNetwork::load_kernel_source() {
    const char *paths[] = {"src/nn_kernel.cl", "../src/nn_kernel.cl", "nn_kernel.cl"};
    for (auto p : paths) {
        std::ifstream f(p);
        if (f.good()) {
            std::stringstream ss;
            ss << f.rdbuf();
            return ss.str();
        }
    }
    throw std::runtime_error("Cannot find nn_kernel.cl");
}

// ============ Build program ============
cl_program NeuralNetwork::build_program(const std::string &source) {
    cl_int err;
    const char *src = source.c_str();
    size_t len = source.size();
    cl_program prog = clCreateProgramWithSource(context, 1, &src, &len, &err);
    if (err != CL_SUCCESS) throw std::runtime_error("clCreateProgramWithSource failed");

    err = clBuildProgram(prog, 1, &device, "-cl-fast-relaxed-math -cl-mad-enable -Werror", nullptr, nullptr);
    if (err != CL_SUCCESS) {
        size_t log_size;
        clGetProgramBuildInfo(prog, device, CL_PROGRAM_BUILD_LOG, 0, nullptr, &log_size);
        std::string log(log_size, '\0');
        clGetProgramBuildInfo(prog, device, CL_PROGRAM_BUILD_LOG, log_size, &log[0], nullptr);
        clReleaseProgram(prog);
        throw std::runtime_error("OpenCL build error:\n" + log);
    }
    return prog;
}

// ============ Configuración ============
void NeuralNetwork::add_layer(int input_size, int output_size,
                              Activation act, float dropout_keep_prob) {
    if (built) throw std::runtime_error("Network already built");
    Layer l;
    l.input_size = input_size;
    l.output_size = output_size;
    l.activation = act;
    l.dropout_keep_prob = dropout_keep_prob;
    l.use_batch_norm = (act != Activation::SOFTMAX); // BN en todas menos softmax
    l.weights = nullptr;
    l.bias = nullptr;
    l.bn_gamma = nullptr;
    l.bn_beta = nullptr;
    l.bn_running_mean = nullptr;
    l.bn_running_var = nullptr;
    l.d_weights = l.d_bias = nullptr;
    l.d_m_w = l.d_v_w = l.d_m_b = l.d_v_b = nullptr;
    l.d_bn_gamma = l.d_bn_beta = nullptr;
    l.d_bn_running_mean = l.d_bn_running_var = nullptr;
    l.d_bn_x_centered = l.d_bn_std_inv = nullptr;
    l.d_bn_grad_gamma = l.d_bn_grad_beta = nullptr;
    l.d_bn_m_gamma = l.d_bn_v_gamma = l.d_bn_m_beta = l.d_bn_v_beta = nullptr;
    l.d_input = l.d_output = l.d_z = l.d_delta = nullptr;
    l.d_grad_w = l.d_grad_b = nullptr;
    l.d_dropout_mask = nullptr;
    l.t = 0;
    layers.push_back(l);
}

void NeuralNetwork::set_loss(LossType loss) { loss_type = loss; }

void NeuralNetwork::set_optimizer(OptimizerType opt, float lr,
                                   float b1, float b2, float eps) {
    optimizer_type = opt;
    learning_rate = lr;
    initial_lr = lr;
    beta1 = b1; beta2 = b2; eps_adam = eps;
}

// ============ Learning Rate Scheduling ============
float NeuralNetwork::get_current_lr(int epoch) {
    switch (lr_schedule) {
        case LRSchedule::NONE:
            return initial_lr;

        case LRSchedule::COSINE: {
            // Cosine annealing from initial_lr to 0
            float progress = (float)(epoch - lr_warmup_epochs) / std::max(1, lr_cycle_length);
            if (progress < 0.0f) progress = 0.0f;
            if (progress > 1.0f) progress = 1.0f;
            return initial_lr * 0.5f * (1.0f + cos(M_PI * progress));
        }

        case LRSchedule::COSINE_WARM_RESTARTS: {
            // Cosine with warm restarts every lr_cycle_length epochs
            float cycles = (float)(epoch - lr_warmup_epochs) / lr_cycle_length;
            if (cycles < 0.0f) cycles = 0.0f;
            float progress = cycles - floor(cycles);
            float cycle_lr = initial_lr * 0.5f * (1.0f + cos(M_PI * progress));
            // Decay max LR per cycle
            float decay = pow(0.85f, floor(cycles));
            return cycle_lr * decay;
        }

        case LRSchedule::STEP_DECAY: {
            // Reduce by 0.5 every lr_cycle_length epochs
            float factor = 1.0f;
            int steps = (epoch - lr_warmup_epochs) / std::max(1, lr_cycle_length);
            if (steps > 0) {
                factor = pow(0.5f, steps);
            }
            return initial_lr * factor;
        }
    }
    return initial_lr;
}

// ============ Print network architecture summary ============
//  Imprime resumen de la arquitectura de la red
void NeuralNetwork::print_summary() const {
    fprintf(stderr, "\n=== Neural Network Architecture ===\n");
    fprintf(stderr, "  %-6s %-8s %-10s %-8s %-8s\n", "Layer", "Input", "Output", "Activation", "Params");
    fprintf(stderr, "  %s\n", std::string(48, '-').c_str());
    int total_params = 0;
    for (size_t i = 0; i < layers.size(); i++) {
        const auto &l = layers[i];
        int nw = l.input_size * l.output_size;
        int nb = l.output_size;
        int params = nw + nb;
        if (l.use_batch_norm) params += l.output_size * 2;  // gamma + beta
        total_params += params;
        const char *act_name = 
            l.activation == Activation::RELU ? "ReLU" :
            l.activation == Activation::LEAKY_RELU ? "LeakyReLU" :
            l.activation == Activation::SIGMOID ? "Sigmoid" :
            l.activation == Activation::TANH ? "Tanh" :
            l.activation == Activation::SOFTMAX ? "Softmax" : "None";
        fprintf(stderr, "  %-6zu %-8d %-10d %-8s %-8d\n", i+1, l.input_size, l.output_size, act_name, params);
    }
    fprintf(stderr, "  %s\n", std::string(48, '-').c_str());
    fprintf(stderr, "  Total trainable parameters: %d\n", total_params);
    fprintf(stderr, "  Loss: %s | Optimizer: %s | LR: %.4f | BatchNorm: %s\n",
        loss_type == LossType::MSE ? "MSE" : loss_type == LossType::CROSS_ENTROPY ? "CE" : "Huber",
        optimizer_type == OptimizerType::SGD ? "SGD" : optimizer_type == OptimizerType::ADAM ? "Adam" : "AdamW",
        initial_lr, layers[0].use_batch_norm ? "yes" : "no");
    fprintf(stderr, "===================================\n\n");
}

// ============ Build ============
void NeuralNetwork::build() {
    if (layers.empty()) throw std::runtime_error("No layers added");
    if (built) return;

    std::mt19937 rng(seed_state);

    for (auto &l : layers) {
        int nw = l.input_size * l.output_size;
        int nb = l.output_size;

        l.weights = new float[nw];
        l.bias = new float[nb];

        // He initialization for ReLU, Xavier for others
        float scale;
        if (l.activation == Activation::RELU || l.activation == Activation::LEAKY_RELU)
            scale = sqrt(2.0f / l.input_size);
        else
            scale = sqrt(1.0f / l.input_size);

        std::normal_distribution<float> dist(0.0f, scale);
        for (int i = 0; i < nw; i++) l.weights[i] = dist(rng);
        for (int i = 0; i < nb; i++) l.bias[i] = 0.0f;

        // Batch norm params
        if (l.use_batch_norm) {
            l.bn_gamma = new float[nb];
            l.bn_beta = new float[nb];
            l.bn_running_mean = new float[nb];
            l.bn_running_var = new float[nb];
            for (int i = 0; i < nb; i++) {
                l.bn_gamma[i] = 1.0f;
                l.bn_beta[i] = 0.0f;
                l.bn_running_mean[i] = 0.0f;
                l.bn_running_var[i] = 1.0f;
            }
        }

        init_layer_buffers(l);
    }
    built = true;
}

void NeuralNetwork::init_layer_buffers(Layer &l) {
    cl_int err;
    int size_w = l.input_size * l.output_size;
    int size_b = l.output_size;

    l.d_weights = clCreateBuffer(context, CL_MEM_READ_WRITE | CL_MEM_COPY_HOST_PTR,
                                  size_w * sizeof(float), l.weights, &err);
    if (err != CL_SUCCESS) throw std::runtime_error("d_weights create failed");
    l.d_bias = clCreateBuffer(context, CL_MEM_READ_WRITE | CL_MEM_COPY_HOST_PTR,
                               size_b * sizeof(float), l.bias, &err);
    if (err != CL_SUCCESS) throw std::runtime_error("d_bias create failed");

    l.d_m_w = clCreateBuffer(context, CL_MEM_READ_WRITE, size_w * sizeof(float), nullptr, &err);
    if (err != CL_SUCCESS) throw std::runtime_error("d_m_w create failed");
    l.d_v_w = clCreateBuffer(context, CL_MEM_READ_WRITE, size_w * sizeof(float), nullptr, &err);
    if (err != CL_SUCCESS) throw std::runtime_error("d_v_w create failed");
    l.d_m_b = clCreateBuffer(context, CL_MEM_READ_WRITE, size_b * sizeof(float), nullptr, &err);
    if (err != CL_SUCCESS) throw std::runtime_error("d_m_b create failed");
    l.d_v_b = clCreateBuffer(context, CL_MEM_READ_WRITE, size_b * sizeof(float), nullptr, &err);
    if (err != CL_SUCCESS) throw std::runtime_error("d_v_b create failed");

    float zero = 0.0f;
    CL_CALL(clEnqueueFillBuffer(queue, l.d_m_w, &zero, sizeof(float), 0, size_w * sizeof(float), 0, nullptr, nullptr));
    CL_CALL(clEnqueueFillBuffer(queue, l.d_v_w, &zero, sizeof(float), 0, size_w * sizeof(float), 0, nullptr, nullptr));
    CL_CALL(clEnqueueFillBuffer(queue, l.d_m_b, &zero, sizeof(float), 0, size_b * sizeof(float), 0, nullptr, nullptr));
    CL_CALL(clEnqueueFillBuffer(queue, l.d_v_b, &zero, sizeof(float), 0, size_b * sizeof(float), 0, nullptr, nullptr));

    // Batch norm buffers
    if (l.use_batch_norm) {
        l.d_bn_gamma = clCreateBuffer(context, CL_MEM_READ_WRITE | CL_MEM_COPY_HOST_PTR,
                                       size_b * sizeof(float), l.bn_gamma, &err);
        if (err != CL_SUCCESS) throw std::runtime_error("d_bn_gamma create failed");
        l.d_bn_beta = clCreateBuffer(context, CL_MEM_READ_WRITE | CL_MEM_COPY_HOST_PTR,
                                      size_b * sizeof(float), l.bn_beta, &err);
        if (err != CL_SUCCESS) throw std::runtime_error("d_bn_beta create failed");

        l.d_bn_running_mean = clCreateBuffer(context, CL_MEM_READ_WRITE | CL_MEM_COPY_HOST_PTR,
                                              size_b * sizeof(float), l.bn_running_mean, &err);
        if (err != CL_SUCCESS) throw std::runtime_error("d_bn_running_mean create failed");
        l.d_bn_running_var = clCreateBuffer(context, CL_MEM_READ_WRITE | CL_MEM_COPY_HOST_PTR,
                                             size_b * sizeof(float), l.bn_running_var, &err);
        if (err != CL_SUCCESS) throw std::runtime_error("d_bn_running_var create failed");

        // Adam buffers for BN params
        l.d_bn_m_gamma = clCreateBuffer(context, CL_MEM_READ_WRITE, size_b * sizeof(float), nullptr, &err);
        if (err != CL_SUCCESS) throw std::runtime_error("d_bn_m_gamma create failed");
        l.d_bn_v_gamma = clCreateBuffer(context, CL_MEM_READ_WRITE, size_b * sizeof(float), nullptr, &err);
        if (err != CL_SUCCESS) throw std::runtime_error("d_bn_v_gamma create failed");
        l.d_bn_m_beta = clCreateBuffer(context, CL_MEM_READ_WRITE, size_b * sizeof(float), nullptr, &err);
        if (err != CL_SUCCESS) throw std::runtime_error("d_bn_m_beta create failed");
        l.d_bn_v_beta = clCreateBuffer(context, CL_MEM_READ_WRITE, size_b * sizeof(float), nullptr, &err);
        if (err != CL_SUCCESS) throw std::runtime_error("d_bn_v_beta create failed");

        CL_CALL(clEnqueueFillBuffer(queue, l.d_bn_m_gamma, &zero, sizeof(float), 0, size_b * sizeof(float), 0, nullptr, nullptr));
        CL_CALL(clEnqueueFillBuffer(queue, l.d_bn_v_gamma, &zero, sizeof(float), 0, size_b * sizeof(float), 0, nullptr, nullptr));
        CL_CALL(clEnqueueFillBuffer(queue, l.d_bn_m_beta, &zero, sizeof(float), 0, size_b * sizeof(float), 0, nullptr, nullptr));
        CL_CALL(clEnqueueFillBuffer(queue, l.d_bn_v_beta, &zero, sizeof(float), 0, size_b * sizeof(float), 0, nullptr, nullptr));
    }

    l.d_input = l.d_output = l.d_z = l.d_delta = nullptr;
    l.d_grad_w = l.d_grad_b = nullptr;
    l.d_dropout_mask = nullptr;
    l.t = 0;
}

// ============ Allocate per-layer temp buffers for a given batch size ============
void NeuralNetwork::ensure_temp_buffers(int batch_size) {
    if (batch_size <= current_batch_size) return;

    cl_int err;

    // Release old buffers first
    for (auto &l : layers) {
        safe_release_mem(l.d_input);
        safe_release_mem(l.d_output);
        safe_release_mem(l.d_z);
        safe_release_mem(l.d_delta);
        safe_release_mem(l.d_grad_w);
        safe_release_mem(l.d_grad_b);
        safe_release_mem(l.d_dropout_mask);
        safe_release_mem(l.d_bn_x_centered);
        safe_release_mem(l.d_bn_std_inv);
        safe_release_mem(l.d_bn_grad_gamma);
        safe_release_mem(l.d_bn_grad_beta);
    }
    safe_release_mem(d_target);
    safe_release_mem(d_loss_buf);

    // Create new buffers
    for (auto &l : layers) {
        int size_in = batch_size * l.input_size;
        int size_out = batch_size * l.output_size;

        if (size_in > 0) {
            l.d_input = clCreateBuffer(context, CL_MEM_READ_WRITE, size_in * sizeof(float), nullptr, &err);
            if (err != CL_SUCCESS) throw std::runtime_error("d_input alloc");
        }
        if (size_out > 0) {
            l.d_output = clCreateBuffer(context, CL_MEM_READ_WRITE, size_out * sizeof(float), nullptr, &err);
            if (err != CL_SUCCESS) throw std::runtime_error("d_output alloc");
            l.d_z = clCreateBuffer(context, CL_MEM_READ_WRITE, size_out * sizeof(float), nullptr, &err);
            if (err != CL_SUCCESS) throw std::runtime_error("d_z alloc");
            l.d_delta = clCreateBuffer(context, CL_MEM_READ_WRITE, size_out * sizeof(float), nullptr, &err);
            if (err != CL_SUCCESS) throw std::runtime_error("d_delta alloc");
        }
        {
            l.d_grad_w = clCreateBuffer(context, CL_MEM_READ_WRITE,
                                         l.input_size * l.output_size * sizeof(float), nullptr, &err);
            if (err != CL_SUCCESS) throw std::runtime_error("d_grad_w alloc");
            l.d_grad_b = clCreateBuffer(context, CL_MEM_READ_WRITE,
                                         l.output_size * sizeof(float), nullptr, &err);
            if (err != CL_SUCCESS) throw std::runtime_error("d_grad_b alloc");
        }
        if (l.dropout_keep_prob < 1.0f) {
            safe_release_mem(l.d_dropout_mask);
            l.d_dropout_mask = clCreateBuffer(context, CL_MEM_READ_WRITE,
                                               size_out * sizeof(float), nullptr, &err);
            if (err != CL_SUCCESS) throw std::runtime_error("d_dropout_mask alloc");
        }

        // Batch norm temp buffers
        if (l.use_batch_norm) {
            l.d_bn_x_centered = clCreateBuffer(context, CL_MEM_READ_WRITE, size_out * sizeof(float), nullptr, &err);
            if (err != CL_SUCCESS) throw std::runtime_error("d_bn_x_centered alloc");
            l.d_bn_std_inv = clCreateBuffer(context, CL_MEM_READ_WRITE, l.output_size * sizeof(float), nullptr, &err);
            if (err != CL_SUCCESS) throw std::runtime_error("d_bn_std_inv alloc");
            l.d_bn_grad_gamma = clCreateBuffer(context, CL_MEM_READ_WRITE, l.output_size * sizeof(float), nullptr, &err);
            if (err != CL_SUCCESS) throw std::runtime_error("d_bn_grad_gamma alloc");
            l.d_bn_grad_beta = clCreateBuffer(context, CL_MEM_READ_WRITE, l.output_size * sizeof(float), nullptr, &err);
            if (err != CL_SUCCESS) throw std::runtime_error("d_bn_grad_beta alloc");
        }
    }

    // Global temp buffers
    int last_out = batch_size * layers.back().output_size;
    d_target = clCreateBuffer(context, CL_MEM_READ_WRITE, last_out * sizeof(float), nullptr, &err);
    if (err != CL_SUCCESS) throw std::runtime_error("d_target alloc");
    d_loss_buf = clCreateBuffer(context, CL_MEM_READ_WRITE, last_out * sizeof(float), nullptr, &err);
    if (err != CL_SUCCESS) throw std::runtime_error("d_loss_buf alloc");

    current_batch_size = batch_size;
}

// ============ Forward pass (inference mode - no BN training) ============
void NeuralNetwork::forward(const float *X, float *output, int batch_size) {
    if (!built) throw std::runtime_error("Network not built");

    int M = batch_size;
    ensure_temp_buffers(M);

    CL_CALL(clEnqueueWriteBuffer(queue, layers[0].d_input, CL_FALSE, 0,
                                  M * layers[0].input_size * sizeof(float), X, 0, nullptr, nullptr));

    for (size_t i = 0; i < layers.size(); i++) {
        Layer &l = layers[i];
        int K = l.input_size;
        int N = l.output_size;
        int out_size = M * N;

        // Matmul
        CL_CALL(clSetKernelArg(k_matmul, 0, sizeof(cl_mem), &l.d_input));
        CL_CALL(clSetKernelArg(k_matmul, 1, sizeof(cl_mem), &l.d_weights));
        CL_CALL(clSetKernelArg(k_matmul, 2, sizeof(cl_mem), &l.d_z));
        CL_CALL(clSetKernelArg(k_matmul, 3, sizeof(int), &M));
        CL_CALL(clSetKernelArg(k_matmul, 4, sizeof(int), &K));
        CL_CALL(clSetKernelArg(k_matmul, 5, sizeof(int), &N));

        size_t local2[2] = {16, 16};
        size_t global2[2] = {(size_t)((M + 15) / 16 * 16), (size_t)((N + 15) / 16 * 16)};
        CL_CALL(clEnqueueNDRangeKernel(queue, k_matmul, 2, nullptr, global2, local2, 0, nullptr, nullptr));

        // Bias add
        CL_CALL(clSetKernelArg(k_bias_add, 0, sizeof(cl_mem), &l.d_z));
        CL_CALL(clSetKernelArg(k_bias_add, 1, sizeof(cl_mem), &l.d_bias));
        CL_CALL(clSetKernelArg(k_bias_add, 2, sizeof(int), &out_size));
        CL_CALL(clSetKernelArg(k_bias_add, 3, sizeof(int), &N));
        size_t g1d = (size_t)((out_size + 63) / 64 * 64);
        CL_CALL(clEnqueueNDRangeKernel(queue, k_bias_add, 1, nullptr, &g1d, nullptr, 0, nullptr, nullptr));

        // Copy z -> output (for activation)
        CL_CALL(clSetKernelArg(k_copy, 0, sizeof(cl_mem), &l.d_z));
        CL_CALL(clSetKernelArg(k_copy, 1, sizeof(cl_mem), &l.d_output));
        CL_CALL(clSetKernelArg(k_copy, 2, sizeof(int), &out_size));
        CL_CALL(clEnqueueNDRangeKernel(queue, k_copy, 1, nullptr, &g1d, nullptr, 0, nullptr, nullptr));

        // Batch Norm (inference mode)
        if (l.use_batch_norm) {
            CL_CALL(clSetKernelArg(k_batch_norm_fwd_infer, 0, sizeof(cl_mem), &l.d_output));
            CL_CALL(clSetKernelArg(k_batch_norm_fwd_infer, 1, sizeof(cl_mem), &l.d_output));
            CL_CALL(clSetKernelArg(k_batch_norm_fwd_infer, 2, sizeof(cl_mem), &l.d_bn_running_mean));
            CL_CALL(clSetKernelArg(k_batch_norm_fwd_infer, 3, sizeof(cl_mem), &l.d_bn_running_var));
            CL_CALL(clSetKernelArg(k_batch_norm_fwd_infer, 4, sizeof(cl_mem), &l.d_bn_gamma));
            CL_CALL(clSetKernelArg(k_batch_norm_fwd_infer, 5, sizeof(cl_mem), &l.d_bn_beta));
            CL_CALL(clSetKernelArg(k_batch_norm_fwd_infer, 6, sizeof(int), &M));
            CL_CALL(clSetKernelArg(k_batch_norm_fwd_infer, 7, sizeof(int), &N));
            CL_CALL(clSetKernelArg(k_batch_norm_fwd_infer, 8, sizeof(float), &bn_eps));
            size_t g1d_bn = (size_t)((N + 63) / 64 * 64);
            CL_CALL(clEnqueueNDRangeKernel(queue, k_batch_norm_fwd_infer, 1, nullptr, &g1d_bn, nullptr, 0, nullptr, nullptr));
        }

        // Activation
        cl_kernel k_act = nullptr;
        switch (l.activation) {
            case Activation::RELU:       k_act = k_relu; break;
            case Activation::LEAKY_RELU: k_act = k_leaky_relu; break;
            case Activation::SIGMOID:    k_act = k_sigmoid; break;
            case Activation::TANH:       k_act = k_tanh_act; break;
            case Activation::SOFTMAX:    k_act = k_softmax; break;
            default: break;
        }

        if (l.activation == Activation::SOFTMAX) {
            CL_CALL(clSetKernelArg(k_act, 0, sizeof(cl_mem), &l.d_output));
            CL_CALL(clSetKernelArg(k_act, 1, sizeof(cl_mem), &l.d_output));
            CL_CALL(clSetKernelArg(k_act, 2, sizeof(int), &l.output_size));
            CL_CALL(clSetKernelArg(k_act, 3, sizeof(int), &M));
            CL_CALL(clEnqueueNDRangeKernel(queue, k_act, 1, nullptr, &g1d, nullptr, 0, nullptr, nullptr));
        } else if (k_act) {
            CL_CALL(clSetKernelArg(k_act, 0, sizeof(cl_mem), &l.d_output));
            CL_CALL(clSetKernelArg(k_act, 1, sizeof(int), &out_size));
            CL_CALL(clEnqueueNDRangeKernel(queue, k_act, 1, nullptr, &g1d, nullptr, 0, nullptr, nullptr));
        }

        // Copy output -> next layer input
        if (i + 1 < layers.size()) {
            Layer &next = layers[i + 1];
            CL_CALL(clSetKernelArg(k_copy, 0, sizeof(cl_mem), &l.d_output));
            CL_CALL(clSetKernelArg(k_copy, 1, sizeof(cl_mem), &next.d_input));
            CL_CALL(clSetKernelArg(k_copy, 2, sizeof(int), &out_size));
            CL_CALL(clEnqueueNDRangeKernel(queue, k_copy, 1, nullptr, &g1d, nullptr, 0, nullptr, nullptr));
        }
    }

    Layer &last = layers.back();
    int last_size = M * last.output_size;
    CL_CALL(clEnqueueReadBuffer(queue, last.d_output, CL_TRUE, 0, last_size * sizeof(float), output, 0, nullptr, nullptr));
}

void NeuralNetwork::predict(const float *X, float *output, int batch_size) {
    forward(X, output, batch_size);
}

// ============ Train batch ============
float NeuralNetwork::train_batch(const float *X, const float *Y, int batch_size) {
    if (!built) throw std::runtime_error("Network not built");
    int M = batch_size;
    int last_out_size = M * layers.back().output_size;
    size_t local2[2] = {16, 16};

    ensure_temp_buffers(M);

    // ===== 1. Subir targets a GPU =====
    CL_CALL(clEnqueueWriteBuffer(queue, d_target, CL_FALSE, 0,
                                  last_out_size * sizeof(float), Y, 0, nullptr, nullptr));

    // ===== 2. FORWARD =====
    CL_CALL(clEnqueueWriteBuffer(queue, layers[0].d_input, CL_FALSE, 0,
                                  M * layers[0].input_size * sizeof(float), X, 0, nullptr, nullptr));

    for (size_t i = 0; i < layers.size(); i++) {
        Layer &l = layers[i];
        int K = l.input_size, N = l.output_size;
        int out_size = M * N;

        // Matmul
        CL_CALL(clSetKernelArg(k_matmul, 0, sizeof(cl_mem), &l.d_input));
        CL_CALL(clSetKernelArg(k_matmul, 1, sizeof(cl_mem), &l.d_weights));
        CL_CALL(clSetKernelArg(k_matmul, 2, sizeof(cl_mem), &l.d_z));
        CL_CALL(clSetKernelArg(k_matmul, 3, sizeof(int), &M));
        CL_CALL(clSetKernelArg(k_matmul, 4, sizeof(int), &K));
        CL_CALL(clSetKernelArg(k_matmul, 5, sizeof(int), &N));

        size_t global2[2] = {(size_t)((M + 15) / 16 * 16), (size_t)((N + 15) / 16 * 16)};
        CL_CALL(clEnqueueNDRangeKernel(queue, k_matmul, 2, nullptr, global2, local2, 0, nullptr, nullptr));

        // Bias
        CL_CALL(clSetKernelArg(k_bias_add, 0, sizeof(cl_mem), &l.d_z));
        CL_CALL(clSetKernelArg(k_bias_add, 1, sizeof(cl_mem), &l.d_bias));
        CL_CALL(clSetKernelArg(k_bias_add, 2, sizeof(int), &out_size));
        CL_CALL(clSetKernelArg(k_bias_add, 3, sizeof(int), &N));
        size_t g1d = (size_t)((out_size + 63) / 64 * 64);
        CL_CALL(clEnqueueNDRangeKernel(queue, k_bias_add, 1, nullptr, &g1d, nullptr, 0, nullptr, nullptr));

        // Copy z -> output
        CL_CALL(clSetKernelArg(k_copy, 0, sizeof(cl_mem), &l.d_z));
        CL_CALL(clSetKernelArg(k_copy, 1, sizeof(cl_mem), &l.d_output));
        CL_CALL(clSetKernelArg(k_copy, 2, sizeof(int), &out_size));
        CL_CALL(clEnqueueNDRangeKernel(queue, k_copy, 1, nullptr, &g1d, nullptr, 0, nullptr, nullptr));

        // Batch Norm (training mode)
        if (l.use_batch_norm) {
            CL_CALL(clSetKernelArg(k_batch_norm_fwd, 0, sizeof(cl_mem), &l.d_output));
            CL_CALL(clSetKernelArg(k_batch_norm_fwd, 1, sizeof(cl_mem), &l.d_output));
            CL_CALL(clSetKernelArg(k_batch_norm_fwd, 2, sizeof(cl_mem), &l.d_bn_running_mean));
            CL_CALL(clSetKernelArg(k_batch_norm_fwd, 3, sizeof(cl_mem), &l.d_bn_running_var));
            CL_CALL(clSetKernelArg(k_batch_norm_fwd, 4, sizeof(cl_mem), &l.d_bn_gamma));
            CL_CALL(clSetKernelArg(k_batch_norm_fwd, 5, sizeof(cl_mem), &l.d_bn_beta));
            CL_CALL(clSetKernelArg(k_batch_norm_fwd, 6, sizeof(cl_mem), &l.d_bn_x_centered));  // save_mean reuse
            CL_CALL(clSetKernelArg(k_batch_norm_fwd, 7, sizeof(cl_mem), &l.d_bn_std_inv));      // save_var reuse
            CL_CALL(clSetKernelArg(k_batch_norm_fwd, 8, sizeof(int), &M));
            CL_CALL(clSetKernelArg(k_batch_norm_fwd, 9, sizeof(int), &N));
            CL_CALL(clSetKernelArg(k_batch_norm_fwd, 10, sizeof(float), &bn_momentum));
            CL_CALL(clSetKernelArg(k_batch_norm_fwd, 11, sizeof(float), &bn_eps));
            size_t g1d_bn = (size_t)((N + 63) / 64 * 64);
            CL_CALL(clEnqueueNDRangeKernel(queue, k_batch_norm_fwd, 1, nullptr, &g1d_bn, nullptr, 0, nullptr, nullptr));
        }

        // Dropout (training)
        if (l.dropout_keep_prob < 1.0f) {
            CL_CALL(clSetKernelArg(k_dropout_mask, 0, sizeof(cl_mem), &l.d_dropout_mask));
            CL_CALL(clSetKernelArg(k_dropout_mask, 1, sizeof(cl_mem), &d_seed));
            CL_CALL(clSetKernelArg(k_dropout_mask, 2, sizeof(int), &out_size));
            CL_CALL(clSetKernelArg(k_dropout_mask, 3, sizeof(float), &l.dropout_keep_prob));
            CL_CALL(clEnqueueNDRangeKernel(queue, k_dropout_mask, 1, nullptr, &g1d, nullptr, 0, nullptr, nullptr));

            CL_CALL(clSetKernelArg(k_dropout_apply, 0, sizeof(cl_mem), &l.d_output));
            CL_CALL(clSetKernelArg(k_dropout_apply, 1, sizeof(cl_mem), &l.d_dropout_mask));
            CL_CALL(clSetKernelArg(k_dropout_apply, 2, sizeof(int), &out_size));
            CL_CALL(clEnqueueNDRangeKernel(queue, k_dropout_apply, 1, nullptr, &g1d, nullptr, 0, nullptr, nullptr));
        }

        // Activation
        cl_kernel k_act = nullptr;
        switch (l.activation) {
            case Activation::RELU:       k_act = k_relu; break;
            case Activation::LEAKY_RELU: k_act = k_leaky_relu; break;
            case Activation::SIGMOID:    k_act = k_sigmoid; break;
            case Activation::TANH:       k_act = k_tanh_act; break;
            case Activation::SOFTMAX:    k_act = k_softmax; break;
            default: break;
        }

        if (l.activation == Activation::SOFTMAX) {
            CL_CALL(clSetKernelArg(k_act, 0, sizeof(cl_mem), &l.d_output));
            CL_CALL(clSetKernelArg(k_act, 1, sizeof(cl_mem), &l.d_output));
            CL_CALL(clSetKernelArg(k_act, 2, sizeof(int), &l.output_size));
            CL_CALL(clSetKernelArg(k_act, 3, sizeof(int), &M));
            CL_CALL(clEnqueueNDRangeKernel(queue, k_act, 1, nullptr, &g1d, nullptr, 0, nullptr, nullptr));
        } else if (k_act) {
            CL_CALL(clSetKernelArg(k_act, 0, sizeof(cl_mem), &l.d_output));
            CL_CALL(clSetKernelArg(k_act, 1, sizeof(int), &out_size));
            CL_CALL(clEnqueueNDRangeKernel(queue, k_act, 1, nullptr, &g1d, nullptr, 0, nullptr, nullptr));
        }

        // Copy output -> next layer input
        if (i + 1 < layers.size()) {
            Layer &next = layers[i + 1];
            CL_CALL(clSetKernelArg(k_copy, 0, sizeof(cl_mem), &l.d_output));
            CL_CALL(clSetKernelArg(k_copy, 1, sizeof(cl_mem), &next.d_input));
            CL_CALL(clSetKernelArg(k_copy, 2, sizeof(int), &out_size));
            CL_CALL(clEnqueueNDRangeKernel(queue, k_copy, 1, nullptr, &g1d, nullptr, 0, nullptr, nullptr));
        }
    }

    // ===== 3. LOSS =====
    Layer &last = layers.back();
    int out_size = M * last.output_size;

    // Leer predicciones
    float *h_pred = new float[out_size];
    CL_CALL(clEnqueueReadBuffer(queue, last.d_output, CL_TRUE, 0, out_size * sizeof(float), h_pred, 0, nullptr, nullptr));

    // Calcular pérdida
    cl_kernel k_loss;
    if (loss_type == LossType::CROSS_ENTROPY) {
        k_loss = k_cross_entropy_loss;
        float eps = 1e-7f;
        CL_CALL(clSetKernelArg(k_loss, 0, sizeof(cl_mem), &last.d_output));
        CL_CALL(clSetKernelArg(k_loss, 1, sizeof(cl_mem), &d_target));
        CL_CALL(clSetKernelArg(k_loss, 2, sizeof(cl_mem), &d_loss_buf));
        CL_CALL(clSetKernelArg(k_loss, 3, sizeof(int), &out_size));
        CL_CALL(clSetKernelArg(k_loss, 4, sizeof(float), &eps));
    } else if (loss_type == LossType::HUBER) {
        k_loss = k_huber_loss;
        CL_CALL(clSetKernelArg(k_loss, 0, sizeof(cl_mem), &last.d_output));
        CL_CALL(clSetKernelArg(k_loss, 1, sizeof(cl_mem), &d_target));
        CL_CALL(clSetKernelArg(k_loss, 2, sizeof(cl_mem), &d_loss_buf));
        CL_CALL(clSetKernelArg(k_loss, 3, sizeof(int), &out_size));
        CL_CALL(clSetKernelArg(k_loss, 4, sizeof(float), &huber_delta));
    } else {
        k_loss = k_mse_loss;
        CL_CALL(clSetKernelArg(k_loss, 0, sizeof(cl_mem), &last.d_output));
        CL_CALL(clSetKernelArg(k_loss, 1, sizeof(cl_mem), &d_target));
        CL_CALL(clSetKernelArg(k_loss, 2, sizeof(cl_mem), &d_loss_buf));
        CL_CALL(clSetKernelArg(k_loss, 3, sizeof(int), &out_size));
    }
    size_t g1d = (size_t)((out_size + 63) / 64 * 64);
    CL_CALL(clEnqueueNDRangeKernel(queue, k_loss, 1, nullptr, &g1d, nullptr, 0, nullptr, nullptr));

    float *h_loss = new float[out_size];
    CL_CALL(clEnqueueReadBuffer(queue, d_loss_buf, CL_TRUE, 0, out_size * sizeof(float), h_loss, 0, nullptr, nullptr));

    float total_loss = 0.0f;
    for (int i = 0; i < out_size; i++) total_loss += h_loss[i];
    total_loss /= M;

    // ===== 4. BACKPROP =====
    float *h_delta = new float[out_size];
    
    // Compute output delta based on loss + activation combination
    if (last.activation == Activation::SOFTMAX && loss_type == LossType::CROSS_ENTROPY) {
        // dL/dz = p - y (simplified for softmax+CE)
        for (int i = 0; i < out_size; i++)
            h_delta[i] = h_pred[i] - Y[i];
    } else if (loss_type == LossType::HUBER) {
        for (int i = 0; i < out_size; i++) {
            float diff = h_pred[i] - Y[i];
            float abs_diff = fabs(diff);
            float grad = (abs_diff <= huber_delta) ? diff : huber_delta * (diff > 0 ? 1.0f : -1.0f);
            // Apply activation derivative
            if (last.activation == Activation::RELU)
                grad *= (h_pred[i] > 0.0f ? 1.0f : 0.0f);
            else if (last.activation == Activation::LEAKY_RELU)
                grad *= (h_pred[i] >= 0.0f ? 1.0f : 0.01f);
            else if (last.activation == Activation::SIGMOID) {
                float s = h_pred[i];
                grad *= s * (1.0f - s);
            } else if (last.activation == Activation::TANH) {
                float t = h_pred[i];
                grad *= 1.0f - t * t;
            }
            h_delta[i] = grad;
        }
    } else if (last.activation == Activation::SIGMOID && loss_type == LossType::MSE) {
        for (int i = 0; i < out_size; i++) {
            float s = h_pred[i];
            float ds = s * (1.0f - s);
            h_delta[i] = (h_pred[i] - Y[i]) * ds;
        }
    } else if (last.activation == Activation::RELU && loss_type == LossType::MSE) {
        for (int i = 0; i < out_size; i++)
            h_delta[i] = (h_pred[i] - Y[i]) * (h_pred[i] > 0.0f ? 1.0f : 0.0f);
    } else if (last.activation == Activation::LEAKY_RELU && loss_type == LossType::MSE) {
        for (int i = 0; i < out_size; i++)
            h_delta[i] = (h_pred[i] - Y[i]) * (h_pred[i] >= 0.0f ? 1.0f : 0.01f);
    } else if (last.activation == Activation::TANH && loss_type == LossType::MSE) {
        for (int i = 0; i < out_size; i++) {
            float t = h_pred[i];
            float dt = 1.0f - t * t;
            h_delta[i] = (t - Y[i]) * dt;
        }
    } else {
        for (int i = 0; i < out_size; i++)
            h_delta[i] = h_pred[i] - Y[i];
    }

    CL_CALL(clEnqueueWriteBuffer(queue, last.d_delta, CL_FALSE, 0,
                                  out_size * sizeof(float), h_delta, 0, nullptr, nullptr));
    CL_CALL(clFinish(queue));

    // ===== Apply label smoothing to targets (for next layers) =====
    // We've already computed the loss, so we just use the original Y for delta

    // Backprop a través de capas
    for (int i = (int)layers.size() - 1; i >= 0; i--) {
        Layer &l = layers[i];
        int K = l.input_size, N = l.output_size;

        // Gradient clipping on delta
        if (gradient_clip_norm > 0.0f) {
            int delta_size = M * N;
            CL_CALL(clSetKernelArg(k_gradient_clip, 0, sizeof(cl_mem), &l.d_delta));
            CL_CALL(clSetKernelArg(k_gradient_clip, 1, sizeof(int), &delta_size));
            CL_CALL(clSetKernelArg(k_gradient_clip, 2, sizeof(float), &gradient_clip_norm));
            size_t g1d_clip = (size_t)((delta_size + 63) / 64 * 64);
            CL_CALL(clEnqueueNDRangeKernel(queue, k_gradient_clip, 1, nullptr, &g1d_clip, nullptr, 0, nullptr, nullptr));
        }

        // Gradientes de weights
        CL_CALL(clSetKernelArg(k_grad_weight, 0, sizeof(cl_mem), &l.d_input));
        CL_CALL(clSetKernelArg(k_grad_weight, 1, sizeof(cl_mem), &l.d_delta));
        CL_CALL(clSetKernelArg(k_grad_weight, 2, sizeof(cl_mem), &l.d_grad_w));
        CL_CALL(clSetKernelArg(k_grad_weight, 3, sizeof(int), &M));
        CL_CALL(clSetKernelArg(k_grad_weight, 4, sizeof(int), &K));
        CL_CALL(clSetKernelArg(k_grad_weight, 5, sizeof(int), &N));

        size_t global2_gw[2] = {(size_t)((K + 15) / 16 * 16), (size_t)((N + 15) / 16 * 16)};
        CL_CALL(clEnqueueNDRangeKernel(queue, k_grad_weight, 2, nullptr, global2_gw, local2, 0, nullptr, nullptr));

        // Gradientes de bias
        CL_CALL(clSetKernelArg(k_grad_bias, 0, sizeof(cl_mem), &l.d_delta));
        CL_CALL(clSetKernelArg(k_grad_bias, 1, sizeof(cl_mem), &l.d_grad_b));
        CL_CALL(clSetKernelArg(k_grad_bias, 2, sizeof(int), &M));
        CL_CALL(clSetKernelArg(k_grad_bias, 3, sizeof(int), &N));
        size_t g1d_b = (size_t)((N + 63) / 64 * 64);
        CL_CALL(clEnqueueNDRangeKernel(queue, k_grad_bias, 1, nullptr, &g1d_b, nullptr, 0, nullptr, nullptr));

        // Get current learning rate (use global_step to determine epoch position)
        float current_lr = learning_rate > 0.0f ? learning_rate : initial_lr;
        int size_w = K * N;
        int size_b = N;
        global_step++;

        // Apply gradient clipping on weight gradients too
        if (gradient_clip_norm > 0.0f) {
            CL_CALL(clSetKernelArg(k_gradient_clip, 0, sizeof(cl_mem), &l.d_grad_w));
            CL_CALL(clSetKernelArg(k_gradient_clip, 1, sizeof(int), &size_w));
            CL_CALL(clSetKernelArg(k_gradient_clip, 2, sizeof(float), &gradient_clip_norm));
            size_t g1d_gw = (size_t)((size_w + 63) / 64 * 64);
            CL_CALL(clEnqueueNDRangeKernel(queue, k_gradient_clip, 1, nullptr, &g1d_gw, nullptr, 0, nullptr, nullptr));

            CL_CALL(clSetKernelArg(k_gradient_clip, 0, sizeof(cl_mem), &l.d_grad_b));
            CL_CALL(clSetKernelArg(k_gradient_clip, 1, sizeof(int), &size_b));
            CL_CALL(clSetKernelArg(k_gradient_clip, 2, sizeof(float), &gradient_clip_norm));
            CL_CALL(clEnqueueNDRangeKernel(queue, k_gradient_clip, 1, nullptr, &g1d_b, nullptr, 0, nullptr, nullptr));
        }

        // Actualizar parámetros
        if (optimizer_type == OptimizerType::ADAM || optimizer_type == OptimizerType::ADAMW) {
            float corr1 = 1.0f / (1.0f - powf(beta1, global_step));
            float corr2 = 1.0f / (1.0f - powf(beta2, global_step));

            // Adam update for weights
            CL_CALL(clSetKernelArg(k_adam_update, 0, sizeof(cl_mem), &l.d_weights));
            CL_CALL(clSetKernelArg(k_adam_update, 1, sizeof(cl_mem), &l.d_grad_w));
            CL_CALL(clSetKernelArg(k_adam_update, 2, sizeof(cl_mem), &l.d_m_w));
            CL_CALL(clSetKernelArg(k_adam_update, 3, sizeof(cl_mem), &l.d_v_w));
            CL_CALL(clSetKernelArg(k_adam_update, 4, sizeof(int), &size_w));
            CL_CALL(clSetKernelArg(k_adam_update, 5, sizeof(float), &current_lr));
            CL_CALL(clSetKernelArg(k_adam_update, 6, sizeof(float), &beta1));
            CL_CALL(clSetKernelArg(k_adam_update, 7, sizeof(float), &beta2));
            CL_CALL(clSetKernelArg(k_adam_update, 8, sizeof(float), &eps_adam));
            CL_CALL(clSetKernelArg(k_adam_update, 9, sizeof(float), &corr1));
            CL_CALL(clSetKernelArg(k_adam_update, 10, sizeof(float), &corr2));
            size_t g1d_w = (size_t)((size_w + 63) / 64 * 64);
            CL_CALL(clEnqueueNDRangeKernel(queue, k_adam_update, 1, nullptr, &g1d_w, nullptr, 0, nullptr, nullptr));

            // AdamW: apply weight decay separately
            if (optimizer_type == OptimizerType::ADAMW && weight_decay > 0.0f) {
                CL_CALL(clSetKernelArg(k_weight_decay, 0, sizeof(cl_mem), &l.d_weights));
                CL_CALL(clSetKernelArg(k_weight_decay, 1, sizeof(int), &size_w));
                CL_CALL(clSetKernelArg(k_weight_decay, 2, sizeof(float), &current_lr));
                CL_CALL(clSetKernelArg(k_weight_decay, 3, sizeof(float), &weight_decay));
                CL_CALL(clEnqueueNDRangeKernel(queue, k_weight_decay, 1, nullptr, &g1d_w, nullptr, 0, nullptr, nullptr));
            }

            // Adam update for bias
            CL_CALL(clSetKernelArg(k_adam_update, 0, sizeof(cl_mem), &l.d_bias));
            CL_CALL(clSetKernelArg(k_adam_update, 1, sizeof(cl_mem), &l.d_grad_b));
            CL_CALL(clSetKernelArg(k_adam_update, 2, sizeof(cl_mem), &l.d_m_b));
            CL_CALL(clSetKernelArg(k_adam_update, 3, sizeof(cl_mem), &l.d_v_b));
            CL_CALL(clSetKernelArg(k_adam_update, 4, sizeof(int), &size_b));
            CL_CALL(clSetKernelArg(k_adam_update, 5, sizeof(float), &current_lr));
            CL_CALL(clSetKernelArg(k_adam_update, 6, sizeof(float), &beta1));
            CL_CALL(clSetKernelArg(k_adam_update, 7, sizeof(float), &beta2));
            CL_CALL(clSetKernelArg(k_adam_update, 8, sizeof(float), &eps_adam));
            CL_CALL(clSetKernelArg(k_adam_update, 9, sizeof(float), &corr1));
            CL_CALL(clSetKernelArg(k_adam_update, 10, sizeof(float), &corr2));
            size_t g1d_bias = (size_t)((size_b + 63) / 64 * 64);
            CL_CALL(clEnqueueNDRangeKernel(queue, k_adam_update, 1, nullptr, &g1d_bias, nullptr, 0, nullptr, nullptr));

            // Batch norm parameter updates
            if (l.use_batch_norm) {
                // Compute BN gradients
                CL_CALL(clSetKernelArg(k_batch_norm_bwd, 0, sizeof(cl_mem), &l.d_delta));
                CL_CALL(clSetKernelArg(k_batch_norm_bwd, 1, sizeof(cl_mem), &l.d_output));
                CL_CALL(clSetKernelArg(k_batch_norm_bwd, 2, sizeof(cl_mem), &l.d_bn_x_centered));  // save_mean
                CL_CALL(clSetKernelArg(k_batch_norm_bwd, 3, sizeof(cl_mem), &l.d_bn_std_inv));      // save_var
                CL_CALL(clSetKernelArg(k_batch_norm_bwd, 4, sizeof(cl_mem), &l.d_bn_gamma));
                CL_CALL(clSetKernelArg(k_batch_norm_bwd, 5, sizeof(cl_mem), &l.d_delta));  // reuse delta for dx
                CL_CALL(clSetKernelArg(k_batch_norm_bwd, 6, sizeof(cl_mem), &l.d_bn_grad_gamma));
                CL_CALL(clSetKernelArg(k_batch_norm_bwd, 7, sizeof(cl_mem), &l.d_bn_grad_beta));
                CL_CALL(clSetKernelArg(k_batch_norm_bwd, 8, sizeof(int), &M));
                CL_CALL(clSetKernelArg(k_batch_norm_bwd, 9, sizeof(int), &N));
                CL_CALL(clSetKernelArg(k_batch_norm_bwd, 10, sizeof(float), &bn_eps));
                size_t g1d_bn = (size_t)((N + 63) / 64 * 64);
                CL_CALL(clEnqueueNDRangeKernel(queue, k_batch_norm_bwd, 1, nullptr, &g1d_bn, nullptr, 0, nullptr, nullptr));

                // Update BN gamma with Adam
                CL_CALL(clSetKernelArg(k_adam_update, 0, sizeof(cl_mem), &l.d_bn_gamma));
                CL_CALL(clSetKernelArg(k_adam_update, 1, sizeof(cl_mem), &l.d_bn_grad_gamma));
                CL_CALL(clSetKernelArg(k_adam_update, 2, sizeof(cl_mem), &l.d_bn_m_gamma));
                CL_CALL(clSetKernelArg(k_adam_update, 3, sizeof(cl_mem), &l.d_bn_v_gamma));
                CL_CALL(clSetKernelArg(k_adam_update, 4, sizeof(int), &N));
                CL_CALL(clSetKernelArg(k_adam_update, 5, sizeof(float), &current_lr));
                CL_CALL(clSetKernelArg(k_adam_update, 6, sizeof(float), &beta1));
                CL_CALL(clSetKernelArg(k_adam_update, 7, sizeof(float), &beta2));
                CL_CALL(clSetKernelArg(k_adam_update, 8, sizeof(float), &eps_adam));
                CL_CALL(clSetKernelArg(k_adam_update, 9, sizeof(float), &corr1));
                CL_CALL(clSetKernelArg(k_adam_update, 10, sizeof(float), &corr2));
                CL_CALL(clEnqueueNDRangeKernel(queue, k_adam_update, 1, nullptr, &g1d_b, nullptr, 0, nullptr, nullptr));

                // Update BN beta with Adam
                CL_CALL(clSetKernelArg(k_adam_update, 0, sizeof(cl_mem), &l.d_bn_beta));
                CL_CALL(clSetKernelArg(k_adam_update, 1, sizeof(cl_mem), &l.d_bn_grad_beta));
                CL_CALL(clSetKernelArg(k_adam_update, 2, sizeof(cl_mem), &l.d_bn_m_beta));
                CL_CALL(clSetKernelArg(k_adam_update, 3, sizeof(cl_mem), &l.d_bn_v_beta));
                CL_CALL(clSetKernelArg(k_adam_update, 4, sizeof(int), &N));
                CL_CALL(clSetKernelArg(k_adam_update, 5, sizeof(float), &current_lr));
                CL_CALL(clSetKernelArg(k_adam_update, 6, sizeof(float), &beta1));
                CL_CALL(clSetKernelArg(k_adam_update, 7, sizeof(float), &beta2));
                CL_CALL(clSetKernelArg(k_adam_update, 8, sizeof(float), &eps_adam));
                CL_CALL(clSetKernelArg(k_adam_update, 9, sizeof(float), &corr1));
                CL_CALL(clSetKernelArg(k_adam_update, 10, sizeof(float), &corr2));
                CL_CALL(clEnqueueNDRangeKernel(queue, k_adam_update, 1, nullptr, &g1d_b, nullptr, 0, nullptr, nullptr));
            }
        } else {
            // SGD update
            CL_CALL(clSetKernelArg(k_sgd_update, 0, sizeof(cl_mem), &l.d_weights));
            CL_CALL(clSetKernelArg(k_sgd_update, 1, sizeof(cl_mem), &l.d_grad_w));
            CL_CALL(clSetKernelArg(k_sgd_update, 2, sizeof(int), &size_w));
            CL_CALL(clSetKernelArg(k_sgd_update, 3, sizeof(float), &current_lr));
            size_t g1d_w = (size_t)((size_w + 63) / 64 * 64);
            CL_CALL(clEnqueueNDRangeKernel(queue, k_sgd_update, 1, nullptr, &g1d_w, nullptr, 0, nullptr, nullptr));

            CL_CALL(clSetKernelArg(k_sgd_update, 0, sizeof(cl_mem), &l.d_bias));
            CL_CALL(clSetKernelArg(k_sgd_update, 1, sizeof(cl_mem), &l.d_grad_b));
            CL_CALL(clSetKernelArg(k_sgd_update, 2, sizeof(int), &size_b));
            CL_CALL(clSetKernelArg(k_sgd_update, 3, sizeof(float), &current_lr));
            size_t g1d_bias = (size_t)((size_b + 63) / 64 * 64);
            CL_CALL(clEnqueueNDRangeKernel(queue, k_sgd_update, 1, nullptr, &g1d_bias, nullptr, 0, nullptr, nullptr));
        }

        // Propagar delta a capa anterior
        if (i > 0) {
            Layer &prev = layers[i - 1];

            // backprop delta through weights
            CL_CALL(clSetKernelArg(k_backprop_delta, 0, sizeof(cl_mem), &l.d_delta));
            CL_CALL(clSetKernelArg(k_backprop_delta, 1, sizeof(cl_mem), &l.d_weights));
            CL_CALL(clSetKernelArg(k_backprop_delta, 2, sizeof(cl_mem), &prev.d_delta));
            CL_CALL(clSetKernelArg(k_backprop_delta, 3, sizeof(int), &M));
            CL_CALL(clSetKernelArg(k_backprop_delta, 4, sizeof(int), &K));
            CL_CALL(clSetKernelArg(k_backprop_delta, 5, sizeof(int), &N));

            size_t global2_bp[2] = {(size_t)((M + 15) / 16 * 16), (size_t)((K + 15) / 16 * 16)};
            CL_CALL(clEnqueueNDRangeKernel(queue, k_backprop_delta, 2, nullptr, global2_bp, local2, 0, nullptr, nullptr));

            int prev_size = M * prev.output_size;
            // Apply activation derivative
            if (prev.activation == Activation::RELU) {
                CL_CALL(clSetKernelArg(k_relu_deriv, 0, sizeof(cl_mem), &prev.d_output));
                CL_CALL(clSetKernelArg(k_relu_deriv, 1, sizeof(cl_mem), &prev.d_delta));
                CL_CALL(clSetKernelArg(k_relu_deriv, 2, sizeof(int), &prev_size));
                CL_CALL(clEnqueueNDRangeKernel(queue, k_relu_deriv, 1, nullptr, &g1d, nullptr, 0, nullptr, nullptr));
            } else if (prev.activation == Activation::LEAKY_RELU) {
                CL_CALL(clSetKernelArg(k_leaky_relu_deriv, 0, sizeof(cl_mem), &prev.d_output));
                CL_CALL(clSetKernelArg(k_leaky_relu_deriv, 1, sizeof(cl_mem), &prev.d_delta));
                CL_CALL(clSetKernelArg(k_leaky_relu_deriv, 2, sizeof(int), &prev_size));
                CL_CALL(clEnqueueNDRangeKernel(queue, k_leaky_relu_deriv, 1, nullptr, &g1d, nullptr, 0, nullptr, nullptr));
            } else if (prev.activation == Activation::SIGMOID) {
                CL_CALL(clSetKernelArg(k_sigmoid_deriv, 0, sizeof(cl_mem), &prev.d_z));
                CL_CALL(clSetKernelArg(k_sigmoid_deriv, 1, sizeof(cl_mem), &prev.d_delta));
                CL_CALL(clSetKernelArg(k_sigmoid_deriv, 2, sizeof(int), &prev_size));
                CL_CALL(clEnqueueNDRangeKernel(queue, k_sigmoid_deriv, 1, nullptr, &g1d, nullptr, 0, nullptr, nullptr));
            } else if (prev.activation == Activation::TANH) {
                CL_CALL(clSetKernelArg(k_tanh_deriv, 0, sizeof(cl_mem), &prev.d_z));
                CL_CALL(clSetKernelArg(k_tanh_deriv, 1, sizeof(cl_mem), &prev.d_delta));
                CL_CALL(clSetKernelArg(k_tanh_deriv, 2, sizeof(int), &prev_size));
                CL_CALL(clEnqueueNDRangeKernel(queue, k_tanh_deriv, 1, nullptr, &g1d, nullptr, 0, nullptr, nullptr));
            }

            // Batch norm backward for previous layer's delta (if prev layer has BN, we backprop through it)
            // Note: The delta we computed is after BN, so we need to backprop through BN
            // But this is handled by the fact that our delta at the start of backprop for this layer
            // is already after BN for the current layer's output
        }
    }

    delete[] h_loss;
    delete[] h_pred;
    delete[] h_delta;

    return total_loss;
}

void NeuralNetwork::train_epoch(const float *X, const float *Y,
                                 int n_samples, int batch_size, bool shuffle) {
    int n_batches = (n_samples + batch_size - 1) / batch_size;

    float *X_copy = nullptr;
    float *Y_copy = nullptr;
    if (shuffle) {
        int input_dim = layers[0].input_size;
        int output_dim = layers.back().output_size;
        X_copy = new float[n_samples * input_dim];
        Y_copy = new float[n_samples * output_dim];
        memcpy(X_copy, X, n_samples * input_dim * sizeof(float));
        memcpy(Y_copy, Y, n_samples * output_dim * sizeof(float));
        shuffle_data(X_copy, Y_copy, n_samples, input_dim, output_dim);
    }

    const float *X_data = shuffle ? X_copy : X;
    const float *Y_data = shuffle ? Y_copy : Y;

    for (int b = 0; b < n_batches; b++) {
        int start = b * batch_size;
        int current_batch = std::min(batch_size, n_samples - start);
        train_batch(X_data + start * layers[0].input_size,
                     Y_data + start * layers.back().output_size,
                     current_batch);
    }

    delete[] X_copy;
    delete[] Y_copy;
}

void NeuralNetwork::shuffle_data(float *X, float *Y, int n,
                                  int input_dim, int output_dim) {
    std::mt19937 rng(seed_state + global_step);
    for (int i = n - 1; i > 0; i--) {
        int j = rng() % (i + 1);
        for (int k = 0; k < input_dim; k++)
            std::swap(X[i * input_dim + k], X[j * input_dim + k]);
        for (int k = 0; k < output_dim; k++)
            std::swap(Y[i * output_dim + k], Y[j * output_dim + k]);
    }
}

void NeuralNetwork::save(const std::string &path) {
    std::ofstream f(path, std::ios::binary);
    if (!f) throw std::runtime_error("Cannot save to " + path);

    int n = (int)layers.size();
    f.write((char*)&n, sizeof(n));

    for (auto &l : layers) {
        f.write((char*)&l.input_size, sizeof(int));
        f.write((char*)&l.output_size, sizeof(int));
        int act = (int)l.activation;
        f.write((char*)&act, sizeof(int));
        f.write((char*)&l.dropout_keep_prob, sizeof(float));
        bool use_bn = l.use_batch_norm;
        f.write((char*)&use_bn, sizeof(bool));

        int size_w = l.input_size * l.output_size;
        int size_b = l.output_size;

        CL_CALL(clEnqueueReadBuffer(queue, l.d_weights, CL_TRUE, 0,
                                     size_w * sizeof(float), l.weights, 0, nullptr, nullptr));
        CL_CALL(clEnqueueReadBuffer(queue, l.d_bias, CL_TRUE, 0,
                                     size_b * sizeof(float), l.bias, 0, nullptr, nullptr));

        f.write((char*)l.weights, size_w * sizeof(float));
        f.write((char*)l.bias, size_b * sizeof(float));

        // Save BN params
        if (use_bn) {
            CL_CALL(clEnqueueReadBuffer(queue, l.d_bn_gamma, CL_TRUE, 0,
                                         size_b * sizeof(float), l.bn_gamma, 0, nullptr, nullptr));
            CL_CALL(clEnqueueReadBuffer(queue, l.d_bn_beta, CL_TRUE, 0,
                                         size_b * sizeof(float), l.bn_beta, 0, nullptr, nullptr));
            CL_CALL(clEnqueueReadBuffer(queue, l.d_bn_running_mean, CL_TRUE, 0,
                                         size_b * sizeof(float), l.bn_running_mean, 0, nullptr, nullptr));
            CL_CALL(clEnqueueReadBuffer(queue, l.d_bn_running_var, CL_TRUE, 0,
                                         size_b * sizeof(float), l.bn_running_var, 0, nullptr, nullptr));
            f.write((char*)l.bn_gamma, size_b * sizeof(float));
            f.write((char*)l.bn_beta, size_b * sizeof(float));
            f.write((char*)l.bn_running_mean, size_b * sizeof(float));
            f.write((char*)l.bn_running_var, size_b * sizeof(float));
        }
    }
}

void NeuralNetwork::load(const std::string &path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) throw std::runtime_error("Cannot load from " + path);

    int n;
    f.read((char*)&n, sizeof(n));
    if (n != (int)layers.size())
        throw std::runtime_error("Layer count mismatch");

    for (auto &l : layers) {
        int in, out, act;
        float drop;
        bool use_bn;
        f.read((char*)&in, sizeof(int));
        f.read((char*)&out, sizeof(int));
        f.read((char*)&act, sizeof(int));
        f.read((char*)&drop, sizeof(float));
        f.read((char*)&use_bn, sizeof(bool));

        if (in != l.input_size || out != l.output_size)
            throw std::runtime_error("Layer size mismatch");

        int size_w = l.input_size * l.output_size;
        int size_b = l.output_size;

        f.read((char*)l.weights, size_w * sizeof(float));
        f.read((char*)l.bias, size_b * sizeof(float));

        CL_CALL(clEnqueueWriteBuffer(queue, l.d_weights, CL_TRUE, 0,
                                      size_w * sizeof(float), l.weights, 0, nullptr, nullptr));
        CL_CALL(clEnqueueWriteBuffer(queue, l.d_bias, CL_TRUE, 0,
                                      size_b * sizeof(float), l.bias, 0, nullptr, nullptr));

        // Load BN params
        if (use_bn && l.use_batch_norm) {
            f.read((char*)l.bn_gamma, size_b * sizeof(float));
            f.read((char*)l.bn_beta, size_b * sizeof(float));
            f.read((char*)l.bn_running_mean, size_b * sizeof(float));
            f.read((char*)l.bn_running_var, size_b * sizeof(float));
            CL_CALL(clEnqueueWriteBuffer(queue, l.d_bn_gamma, CL_TRUE, 0,
                                          size_b * sizeof(float), l.bn_gamma, 0, nullptr, nullptr));
            CL_CALL(clEnqueueWriteBuffer(queue, l.d_bn_beta, CL_TRUE, 0,
                                          size_b * sizeof(float), l.bn_beta, 0, nullptr, nullptr));
            CL_CALL(clEnqueueWriteBuffer(queue, l.d_bn_running_mean, CL_TRUE, 0,
                                          size_b * sizeof(float), l.bn_running_mean, 0, nullptr, nullptr));
            CL_CALL(clEnqueueWriteBuffer(queue, l.d_bn_running_var, CL_TRUE, 0,
                                          size_b * sizeof(float), l.bn_running_var, 0, nullptr, nullptr));
        }
    }
}