CXX = g++
CXXFLAGS = -std=c++11 -O2 -Wall -Wextra -pthread
LDFLAGS = -lOpenCL -lm

SRC_DIR = src
BUILD_DIR = build

SRCS = $(SRC_DIR)/nn.cpp $(SRC_DIR)/main.cpp
TRAIN_SRCS = $(SRC_DIR)/nn.cpp $(SRC_DIR)/train.cpp
OBJS = $(SRCS:$(SRC_DIR)/%.cpp=$(BUILD_DIR)/%.o)
TRAIN_OBJS = $(TRAIN_SRCS:$(SRC_DIR)/%.cpp=$(BUILD_DIR)/%.o)
TARGET = nn_gpu
TRAIN_TARGET = nn_train

.PHONY: all clean test run

all: $(BUILD_DIR) $(TARGET)

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(BUILD_DIR)/%.o: $(SRC_DIR)/%.cpp
	$(CXX) $(CXXFLAGS) -I$(SRC_DIR) -c $< -o $@

$(TARGET): $(OBJS)
	$(CXX) $(CXXFLAGS) -o $@ $^ $(LDFLAGS)

$(TRAIN_TARGET): $(TRAIN_OBJS)
	$(CXX) $(CXXFLAGS) -o $@ $^ $(LDFLAGS)

run: $(TARGET)
	cp -n $(SRC_DIR)/nn_kernel.cl $(BUILD_DIR)/ 2>/dev/null || true
	cp -n $(SRC_DIR)/nn_kernel.cl . 2>/dev/null || true
	./$(TARGET)

test: $(TARGET)
	cp -n $(SRC_DIR)/nn_kernel.cl . 2>/dev/null || true
	./$(TARGET) --test

clean:
	rm -rf $(BUILD_DIR) $(TARGET)