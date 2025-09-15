#!/bin/bash
# Phony Documentation Build Script
# Usage: ./build-docs.sh [clean|serve|build]

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DOCS_DIR="docs"
BUILD_DIR="${DOCS_DIR}/_build"
HTML_DIR="${BUILD_DIR}/html"
PYTHON_ENV="venv"

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
check_directory() {
    if [ ! -d "$DOCS_DIR" ]; then
        log_error "Documentation directory '$DOCS_DIR' not found!"
        log_info "Please run this script from the project root directory."
        exit 1
    fi
    
    if [ ! -f "${DOCS_DIR}/_config.yml" ]; then
        log_error "Jupyter Book configuration not found at ${DOCS_DIR}/_config.yml"
        exit 1
    fi
}

# Setup Python virtual environment
setup_environment() {
    log_info "Setting up Python environment..."
    
    if [ ! -d "$PYTHON_ENV" ]; then
        log_info "Creating Python virtual environment..."
        python3 -m venv $PYTHON_ENV
    fi
    
    log_info "Activating virtual environment..."
    source ${PYTHON_ENV}/bin/activate
    
    log_info "Installing/updating documentation dependencies..."
    pip install --upgrade pip
    pip install -r requirements-docs.txt
    
    log_success "Environment setup complete!"
}

# Clean build artifacts
clean_build() {
    log_info "Cleaning build artifacts..."
    
    if [ -d "$BUILD_DIR" ]; then
        rm -rf "$BUILD_DIR"
        log_info "Removed build directory: $BUILD_DIR"
    fi
    
    # Clean Jupyter Book cache
    if [ -d "${DOCS_DIR}/_build" ]; then
        rm -rf "${DOCS_DIR}/_build"
    fi
    
    # Clean Python cache
    find . -name "*.pyc" -delete
    find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
    
    log_success "Cleanup complete!"
}

# Build documentation
build_docs() {
    log_info "Building Jupyter Book documentation..."
    
    # Ensure we're in the virtual environment
    if [[ "$VIRTUAL_ENV" == "" ]]; then
        source ${PYTHON_ENV}/bin/activate
    fi
    
    # Check for missing files and create placeholders
    check_missing_files
    
    # Build with Jupyter Book
    log_info "Running jupyter-book build..."
    cd $DOCS_DIR
    
    # Build with verbose output
    jupyter-book build . --all
    
    cd ..
    
    # Check build success
    if [ -d "$HTML_DIR" ] && [ -f "${HTML_DIR}/index.html" ]; then
        log_success "Documentation built successfully!"
        log_info "Output directory: $HTML_DIR"
        
        # Show size information
        if command -v du &> /dev/null; then
            SIZE=$(du -sh "$HTML_DIR" | cut -f1)
            log_info "Build size: $SIZE"
        fi
        
        # Count pages
        PAGE_COUNT=$(find "$HTML_DIR" -name "*.html" | wc -l)
        log_info "Generated $PAGE_COUNT HTML pages"
        
    else
        log_error "Build failed! HTML output not found."
        exit 1
    fi
}

# Check for missing files and create minimal versions
check_missing_files() {
    log_info "Checking for missing documentation files..."
    
    # Create missing directories
    mkdir -p guides api tutorials examples ui-guide features
    
    # Create placeholder files if they don't exist
    files_to_check=(
        "guides/installation.md:# Installation Guide\n\nSee [Getting Started](getting-started.md) for installation."
        "guides/configuration.md:# Configuration Guide\n\nSee [Getting Started](getting-started.md) for configuration."
        "guides/making-calls.md:# Making Calls\n\nSee [Getting Started](getting-started.md) for call instructions."
        "guides/monitoring-calls.md:# Monitoring Calls\n\nSee [Dashboard Guide](../ui-guide/dashboard-overview.md)."
        "guides/troubleshooting.md:# Troubleshooting\n\nSee [Getting Started](getting-started.md) for common issues."
        "api/endpoints.md:# REST Endpoints\n\nSee [API Index](index.md) for endpoints."
        "api/websockets.md:# WebSocket API\n\nSee [API Index](index.md) for WebSocket docs."
        "api/models.md:# Data Models\n\nSee [API Index](index.md) for models."
        "api/authentication.md:# Authentication\n\nSee [API Index](index.md) for auth details."
        "tutorials/first-call.md:# First Call Tutorial\n\nSee [Quick Start](quickstart.ipynb)."
        "tutorials/dashboard-demo.md:# Dashboard Demo\n\nSee [UI Guide](../ui-guide/dashboard-overview.md)."
        "tutorials/custom-agent.md:# Custom Agent Tutorial\n\nSee [Getting Started](../guides/getting-started.md)."
        "tutorials/deployment-guide.md:# Deployment Guide\n\nSee [Docker Deployment](../features/docker-deployment.md)."
        "examples/notebooks.md:# Example Notebooks\n\nSee [Quick Start](../tutorials/quickstart.ipynb)."
        "examples/api-examples.md:# API Examples\n\nSee [API Index](../api/index.md)."
        "examples/integration-patterns.md:# Integration Patterns\n\nSee [API Index](../api/index.md)."
        "examples/performance-testing.md:# Performance Testing\n\nSee [Getting Started](../guides/getting-started.md)."
        "ui-guide/dashboard-overview.md:# Dashboard Overview\n\nThe Phony dashboard provides real-time call monitoring.\n\n![Dashboard](/_static/images/dashboard-main.png)"
        "ui-guide/call-monitoring.md:# Call Monitoring\n\nSee [Dashboard Overview](dashboard-overview.md)."
        "ui-guide/agent-management.md:# Agent Management\n\nSee [Multi-Tenant Architecture](../features/multi-tenant-architecture.md)."
        "ui-guide/settings-configuration.md:# Settings Configuration\n\nSee [Getting Started](../guides/getting-started.md)."
        "features/real-time-dashboard.md:# Real-time Dashboard\n\nSee [Features Overview](overview.md) and [UI Guide](../ui-guide/dashboard-overview.md)."
        "features/docker-deployment.md:# Docker Deployment\n\nSee [Getting Started](../guides/getting-started.md) for Docker setup."
        "features/testing-suite.md:# Testing Suite\n\nSee [Getting Started](../guides/getting-started.md) for testing information."
    )
    
    for item in "${files_to_check[@]}"; do
        file="${item%%:*}"
        content="${item#*:}"
        
        if [ ! -f "$file" ]; then
            log_warning "Creating missing file: $file"
            echo -e "$content" > "$file"
        fi
    done
}

# Serve documentation locally
serve_docs() {
    log_info "Starting local documentation server..."
    
    if [ ! -d "$HTML_DIR" ]; then
        log_warning "Documentation not built yet. Building now..."
        build_docs
    fi
    
    # Find an available port
    PORT=8000
    while lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; do
        PORT=$((PORT + 1))
    done
    
    log_info "Starting server on port $PORT..."
    log_info "Documentation will be available at: http://localhost:$PORT"
    log_info "Press Ctrl+C to stop the server"
    
    cd "$HTML_DIR"
    python3 -m http.server $PORT
}

# Show help
show_help() {
    echo "Phony Documentation Build Script"
    echo ""
    echo "Usage: ./build-docs.sh [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  build    - Build the documentation (default)"
    echo "  clean    - Clean build artifacts"
    echo "  serve    - Serve documentation locally"
    echo "  setup    - Setup Python environment only"
    echo "  help     - Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./build-docs.sh              # Build documentation"
    echo "  ./build-docs.sh clean build  # Clean and build"
    echo "  ./build-docs.sh serve        # Build and serve locally"
}

# Main script logic
main() {
    log_info "Phony Documentation Build System"
    log_info "================================"
    
    # Check prerequisites
    check_directory
    
    # Handle command line arguments
    case "${1:-build}" in
        "clean")
            clean_build
            ;;
        "setup")
            setup_environment
            ;;
        "build")
            setup_environment
            build_docs
            ;;
        "serve")
            setup_environment
            build_docs
            serve_docs
            ;;
        "help"|"--help"|"-h")
            show_help
            ;;
        *)
            log_error "Unknown command: $1"
            show_help
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"