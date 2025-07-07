#!/bin/bash

# Navigate to the current script directory (backend)
PROJECT_ROOT="$(pwd)"

# Create main folders
mkdir -p $PROJECT_ROOT/src/{config,controllers,middleware,models,routes,services,utils,validators}
mkdir -p $PROJECT_ROOT/migrations
mkdir -p $PROJECT_ROOT/uploads/{images,videos,models}

# Config files
touch $PROJECT_ROOT/src/config/{db.js,cloudStorage.js,paymentConfig.js,constants.js}

# Controllers
touch $PROJECT_ROOT/src/controllers/{adminController.js,authController.js,chatController.js,listingController.js,messageController.js,notificationController.js,promotionController.js,reviewController.js,searchController.js,subscriptionController.js,transactionController.js}

# Middleware
touch $PROJECT_ROOT/src/middleware/{authMiddleware.js,roleMiddleware.js,errorMiddleware.js,uploadMiddleware.js,validateMiddleware.js}

# Models
touch $PROJECT_ROOT/src/models/{adminModel.js,chatModel.js,listingModel.js,messageModel.js,notificationModel.js,promotionModel.js,reviewModel.js,subscriptionModel.js,transactionModel.js,userModel.js}

# Routes
touch $PROJECT_ROOT/src/routes/{adminRoutes.js,authRoutes.js,chatRoutes.js,listingRoutes.js,messageRoutes.js,notificationRoutes.js,promotionRoutes.js,reviewRoutes.js,searchRoutes.js,subscriptionRoutes.js,transactionRoutes.js,index.js}

# Services
touch $PROJECT_ROOT/src/services/{adminService.js,authService.js,chatService.js,listingService.js,messageService.js,notificationService.js,promotionService.js,reviewService.js,searchService.js,subscriptionService.js,transactionService.js}

# Utils
touch $PROJECT_ROOT/src/utils/{tokenUtils.js,hashUtils.js,fileUtils.js,imageEmbeddingUtils.js,fuzzySearchUtils.js,paymentUtils.js,notificationUtils.js,logger.js}

# Validators
touch $PROJECT_ROOT/src/validators/{authValidator.js,listingValidator.js,promotionValidator.js,subscriptionValidator.js,reviewValidator.js,transactionValidator.js}

# App file
touch $PROJECT_ROOT/src/app.js

# Migrations
touch $PROJECT_ROOT/migrations/init.sql

# Root-level files
touch $PROJECT_ROOT/.env
touch $PROJECT_ROOT/package.json
touch $PROJECT_ROOT/README.md

echo "✅ Void Marketplace Backend structure created successfully!"
