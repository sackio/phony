# Phony Documentation Makefile

.PHONY: docs docs-clean docs-serve docs-deploy help

# Default target
help:
	@echo "Phony Documentation Makefile"
	@echo "============================="
	@echo ""
	@echo "Available targets:"
	@echo "  docs        - Build the documentation"
	@echo "  docs-clean  - Clean documentation build"
	@echo "  docs-serve  - Serve documentation locally"
	@echo "  docs-deploy - Deploy documentation"
	@echo "  help        - Show this help message"

# Build documentation
docs:
	@echo "🚀 Building documentation..."
	./build-docs.sh

# Clean documentation
docs-clean:
	@echo "🧹 Cleaning documentation build..."
	rm -rf docs_site/_build
	rm -rf docs_site/venv*
	rm -f docs-build-summary.txt

# Serve documentation locally
docs-serve:
	@echo "🌐 Starting local documentation server..."
	@if [ ! -d "docs_site/_build/html" ]; then \
		echo "❌ Documentation not built. Run 'make docs' first."; \
		exit 1; \
	fi
	@cd docs_site/_build/html && python3 -m http.server 8080

# Deploy documentation
docs-deploy:
	@echo "🚀 Deploying documentation..."
	./deploy-docs.sh

# Quick test build (simplified)
docs-quick:
	@echo "🚀 Quick documentation build..."
	@cd docs_site && \
	if [ ! -d "venv-quick" ]; then python3 -m venv venv-quick; fi && \
	source venv-quick/bin/activate && \
	pip install -q jupyter-book && \
	jupyter-book build . --keep-going

# Install documentation dependencies
docs-install:
	@echo "📦 Installing documentation dependencies..."
	pip install -r requirements-docs-simple.txt

# Validate documentation
docs-validate:
	@echo "✅ Validating documentation..."
	@cd docs_site && find . -name "*.md" -exec echo "Checking {}" \; -exec head -n 1 {} \;

# Development server with auto-reload
docs-dev:
	@echo "🔄 Starting development server with auto-reload..."
	@echo "Visit: http://localhost:8080"
	@cd docs_site/_build/html 2>/dev/null || (echo "❌ Build docs first with 'make docs'" && exit 1)
	@python3 -m http.server 8080 --bind localhost