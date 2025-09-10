# Phony Documentation

This directory contains the complete documentation for the Phony Voice AI Agent system, built with Jupyter Book.

## 📋 Contents

### Core Documentation Structure

```
docs_site/
├── _config.yml          # Jupyter Book configuration
├── _toc.yml             # Table of contents
├── intro.md             # Homepage/introduction
├── features/            # Feature documentation
│   └── overview.md      # Complete feature overview
├── guides/              # User guides
│   └── quickstart.md    # Getting started guide
├── api/                 # API reference
│   └── index.md         # REST/WebSocket API docs
├── tutorials/           # Interactive tutorials
│   └── basic-setup.ipynb # Step-by-step Jupyter notebook
├── examples/            # Real-world examples
│   └── customer-service.md # Customer service bot example
├── ui-guide/            # Dashboard documentation
│   └── overview.md      # UI interface guide
└── _static/             # Static assets (images, CSS, JS)
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
# Simple installation
pip install -r requirements-docs-simple.txt

# Or full installation (takes longer)
pip install -r requirements-docs.txt
```

### 2. Build Documentation

```bash
# Using the build script
./build-docs.sh

# Or using Make
make docs

# Or manually
cd docs_site
jupyter-book build .
```

### 3. View Documentation

```bash
# Serve locally
make docs-serve

# Or manually
cd docs_site/_build/html
python3 -m http.server 8080

# Open browser to: http://localhost:8080
```

### 4. Deploy Documentation

```bash
# Interactive deployment script
./deploy-docs.sh

# Available platforms:
# - Local development server
# - GitHub Pages  
# - Docker container
# - AWS S3
# - nginx server
# - Netlify
# - Vercel
# - Archive (ZIP/TAR)
```

## 📚 Documentation Sections

### Getting Started
- **Quick Start**: Fast setup and first call
- **Installation**: Detailed setup instructions
- **Configuration**: Environment and API keys
- **First Call**: Making your first voice AI call

### Features
- **Overview**: Complete feature matrix
- **Voice Conversation**: AI personality and voice options
- **Twilio Integration**: Phone system integration
- **OpenAI Realtime**: AI model configuration
- **Agent System**: Multi-agent management
- **Supervisor Controls**: Real-time intervention
- **Multi-tenancy**: Isolated tenant support

### API Documentation
- **REST Endpoints**: Complete API reference
- **WebSocket APIs**: Real-time communication
- **Twilio Webhooks**: Phone call handling
- **Supervisor API**: Call control endpoints
- **Agent API**: Agent management
- **Tenant API**: Multi-tenant operations

### Tutorials
- **Basic Setup**: Interactive Jupyter notebook walkthrough
- **Outbound Calls**: AI calling humans
- **Inbound Calls**: Humans calling AI
- **Custom Prompts**: Creating specialized agents
- **Multi-Agent**: Managing multiple agents
- **Advanced Scenarios**: Complex conversation flows

### Examples
- **Customer Service**: Complete support bot implementation
- **Appointment Booking**: Scheduling system integration
- **Survey Bot**: Automated survey collection
- **Voice Assistant**: General-purpose assistant
- **Emergency Response**: Crisis hotline implementation

### UI Guide
- **Dashboard Overview**: Web interface walkthrough
- **Call Monitoring**: Real-time call tracking
- **Agent Management**: Create and configure agents
- **Supervisor Controls**: Intervention tools
- **Analytics**: Performance metrics and reports

## 🛠️ Building and Development

### Build Commands

```bash
# Full build with all features
make docs

# Quick build (minimal dependencies)
make docs-quick

# Clean build artifacts
make docs-clean

# Development server with auto-reload
make docs-dev

# Validate markdown files
make docs-validate
```

### Customization

#### Themes and Styling
- Edit `_static/custom.css` for custom styles
- Modify `_config.yml` for theme settings
- Update colors in CSS variables

#### Adding Content
1. Create new `.md` files in appropriate directories
2. Add entries to `_toc.yml` table of contents
3. Reference images in `_static/images/`
4. Rebuild documentation

#### Interactive Notebooks
1. Create `.ipynb` files in `tutorials/` or `examples/`
2. Include executable Python code
3. Add to `_toc.yml` for navigation
4. Test notebook execution before committing

### Build Requirements

#### Minimal (faster build)
```
jupyter-book==0.15.1
sphinx==5.3.0
sphinx-book-theme==1.0.1
myst-parser==1.0.0
myst-nb==0.17.2
```

#### Full (all features)
```
All Sphinx extensions
Plotting libraries (matplotlib, plotly)
Interactive widgets (ipywidgets)
Documentation tools (linkchecker, doc8)
```

## 🚀 Deployment Options

### 1. Local Development

```bash
./deploy-docs.sh
# Select option 1: Local Development Server
# Opens http://localhost:8080
```

### 2. GitHub Pages

```bash
./deploy-docs.sh
# Select option 2: GitHub Pages
# Automatically creates gh-pages branch
# Enables GitHub Pages in repository settings
```

### 3. Docker Container

```bash
./deploy-docs.sh
# Select option 3: Docker Container
# Creates nginx-based container
# Accessible at http://localhost:8080
```

### 4. Cloud Platforms

```bash
./deploy-docs.sh
# Options 4-7: AWS S3, nginx, Netlify, Vercel
# Follow platform-specific setup instructions
```

### 5. Static Archive

```bash
./deploy-docs.sh
# Select option 8: Create Archive
# Generates ZIP and TAR.GZ files
# Upload to any static hosting service
```

## 🔧 Configuration

### Jupyter Book Settings

Key configuration in `_config.yml`:

```yaml
title: Phony Voice AI Agent
author: Phony Development Team
logo: _static/images/logo.png

# Execution settings
execute:
  execute_notebooks: cache
  cache: ""
  timeout: 600

# Repository integration
repository:
  url: https://github.com/sackio/phony
  path_to_book: docs_site
  branch: main
```

### Theme Customization

Brand colors in `_static/custom.css`:

```css
:root {
    --phony-primary: #2196F3;
    --phony-secondary: #4CAF50;
    --phony-accent: #FF9800;
}
```

## 📊 Analytics and Metrics

### Build Statistics

After building, check `docs-build-summary.txt` for:
- Number of pages generated
- Build time and size
- File locations
- Deployment URLs

### Quality Checks

```bash
# Validate all markdown
make docs-validate

# Check for broken links (if linkchecker installed)
linkchecker docs_site/_build/html/

# Lint documentation
doc8 docs_site/
```

## 🐛 Troubleshooting

### Common Issues

#### Build Fails
```bash
# Check dependencies
pip install -r requirements-docs-simple.txt

# Clean and retry
make docs-clean
make docs
```

#### Missing Images
```bash
# Check image paths in markdown
ls docs_site/_static/images/

# Ensure correct relative paths
![Logo](/_static/images/logo.png)
```

#### Jupyter Notebook Errors
```bash
# Test notebook execution
jupyter nbconvert --execute --to notebook tutorials/basic-setup.ipynb

# Check for syntax errors
python -m py_compile tutorials/basic-setup.py
```

### Performance Issues

#### Slow Build
- Use `requirements-docs-simple.txt` instead of full requirements
- Set `execute_notebooks: 'off'` in `_config.yml` during development
- Use `make docs-quick` for faster builds

#### Large Build Size
- Optimize images in `_static/images/`
- Remove unused dependencies
- Use `.gitignore` to exclude build artifacts

## 📝 Contributing

### Adding New Documentation

1. **Create Content**: Write markdown or notebook files
2. **Update Navigation**: Add entries to `_toc.yml`
3. **Test Build**: Run `make docs` to verify
4. **Review Output**: Check generated HTML
5. **Submit PR**: Include both source and any new assets

### Documentation Standards

- Use clear, concise headings
- Include code examples with explanations
- Add cross-references between sections
- Include screenshots for UI documentation
- Test all interactive examples
- Follow MyST Markdown syntax

### Review Process

- All documentation changes require review
- Test builds before submitting PRs
- Include screenshots for UI changes  
- Update table of contents for new sections
- Verify all links and references work

## 🔗 Useful Links

- **Jupyter Book Documentation**: https://jupyterbook.org
- **MyST Markdown Guide**: https://myst-parser.readthedocs.io
- **Sphinx Documentation**: https://www.sphinx-doc.org
- **Phony Repository**: https://github.com/sackio/phony
- **Live Documentation**: https://sackio.github.io/phony

---

## Need Help?

- **Build Issues**: Check the troubleshooting section above
- **Content Questions**: Review existing examples and guides
- **Technical Problems**: Open an issue in the main repository
- **Feature Requests**: Discuss in GitHub Discussions

Happy documenting! 📚✨