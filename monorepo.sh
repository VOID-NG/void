#!/bin/bash


# Create main folders
mkdir apps packages .github

# Create apps folders
mkdir -p apps/web/{public,src}
mkdir -p apps/mobile/{assets,src}
mkdir -p apps/admin-dashboard/{public,src}
mkdir -p apps/backend/{src/{config,controllers,middleware,models,routes,services,utils},migrations,uploads}

# Create shared packages
mkdir -p packages/shared-ui/src
mkdir -p packages/shared-hooks/src
mkdir -p packages/shared-types/src
mkdir -p packages/shared-utils/src

# Create placeholder package.json for root and each app/package
echo '{ "name": "void-monorepo", "private": true, "workspaces": ["apps/*", "packages/*"] }' > package.json
echo '{ "name": "web", "version": "1.0.0" }' > apps/web/package.json
echo '{ "name": "mobile", "version": "1.0.0" }' > apps/mobile/package.json
echo '{ "name": "admin-dashboard", "version": "1.0.0" }' > apps/admin-dashboard/package.json
echo '{ "name": "backend", "version": "1.0.0" }' > apps/backend/package.json
echo '{ "name": "shared-ui", "version": "1.0.0" }' > packages/shared-ui/package.json
echo '{ "name": "shared-hooks", "version": "1.0.0" }' > packages/shared-hooks/package.json
echo '{ "name": "shared-types", "version": "1.0.0" }' > packages/shared-types/package.json
echo '{ "name": "shared-utils", "version": "1.0.0" }' > packages/shared-utils/package.json

# Create Readme files
echo "# Void Marketplace Monorepo" > README.md
echo "# Web App" > apps/web/README.md
echo "# Mobile App" > apps/mobile/README.md
echo "# Admin Dashboard" > apps/admin-dashboard/README.md
echo "# Backend API" > apps/backend/README.md
echo "# Shared UI Library" > packages/shared-ui/README.md
echo "# Shared Hooks Library" > packages/shared-hooks/README.md
echo "# Shared Types Library" > packages/shared-types/README.md
echo "# Shared Utils Library" > packages/shared-utils/README.md

# Create GitHub workflows folder
mkdir .github/workflows

# Create sample Turbo or Nx config (optional)
echo '{ "pipeline": {} }' > turbo.json

echo "✅ Void Marketplace monorepo structure created successfully!"
