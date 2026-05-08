# WebAR MMD Player Management Makefile

.PHONY: setup dev dev-https build preview help

# Default target
help:
	@echo "WebAR MMD Player Management"
	@echo "Usage:"
	@echo "  make setup       - Configure registry, install dependencies, and deploy WASM"
	@echo "  make dev         - Start development server (HTTP, Port 5173)"
	@echo "  make dev-https   - Start exhibition server (HTTPS, Port 5173, required for AR)"
	@echo "  make build       - Build the production bundle"
	@echo "  make preview     - Preview the production build"

# Initialize the project
setup:
	npm run setup

# Start development server (HTTP)
dev:
	npm run dev

# Start exhibition server (HTTPS)
dev-https:
	npm run dev:https

# Build the project
build:
	npm run build

# Preview build
preview:
	npm run preview
