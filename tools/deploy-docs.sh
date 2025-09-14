#!/bin/bash
set -e

# Phony Documentation Deployment Script
# Supports multiple platforms: local, GitHub Pages, Docker, S3, nginx, Netlify, Vercel

echo "🚀 Phony Documentation Deployment"
echo "=================================="

# Configuration
DOCS_BUILD_DIR="docs_site/_build/html"
PROJECT_NAME="phony-docs"
VERSION=$(date +%Y%m%d-%H%M%S)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

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

log_deploy() {
    echo -e "${PURPLE}[DEPLOY]${NC} $1"
}

# Check if documentation is built
check_build() {
    if [ ! -d "$DOCS_BUILD_DIR" ] || [ ! -f "$DOCS_BUILD_DIR/index.html" ]; then
        log_error "Documentation not built. Run ./build-docs.sh first"
        exit 1
    fi
    log_success "Documentation build found"
}

# Display deployment options
show_menu() {
    echo ""
    echo "📋 Available Deployment Options:"
    echo ""
    echo "1) 🖥️  Local Development Server (http://localhost:8080)"
    echo "2) 🐙 GitHub Pages"
    echo "3) 🐳 Docker Container"
    echo "4) ☁️  AWS S3 Static Hosting"  
    echo "5) 🌐 nginx Server"
    echo "6) 🎯 Netlify"
    echo "7) ▲  Vercel"
    echo "8) 📦 Create Archive (ZIP/TAR)"
    echo "9) 🔄 Custom Deploy Script"
    echo ""
    echo "0) ❌ Exit"
    echo ""
}

# Local development server
deploy_local() {
    log_deploy "Starting local development server..."
    
    cd "$DOCS_BUILD_DIR"
    
    # Try different Python HTTP servers
    if command -v python3 &> /dev/null; then
        log_info "Starting Python 3 HTTP server on port 8080..."
        echo ""
        echo "🌐 Documentation available at: http://localhost:8080"
        echo "📖 Main page: http://localhost:8080/index.html"
        echo ""
        echo "Press Ctrl+C to stop the server"
        python3 -m http.server 8080
    elif command -v python &> /dev/null; then
        log_info "Starting Python 2 HTTP server on port 8080..."
        python -m SimpleHTTPServer 8080
    else
        log_error "Python not found. Cannot start local server."
        echo "Alternative: Use any static file server in $DOCS_BUILD_DIR"
        exit 1
    fi
}

# GitHub Pages deployment
deploy_github_pages() {
    log_deploy "Deploying to GitHub Pages..."
    
    # Check if we're in a git repository
    if [ ! -d ".git" ]; then
        log_error "Not in a git repository"
        exit 1
    fi
    
    # Check if gh CLI is available
    if ! command -v gh &> /dev/null; then
        log_warning "GitHub CLI not found. Using manual git approach..."
        deploy_github_pages_manual
        return
    fi
    
    # Create gh-pages branch if it doesn't exist
    if ! git show-ref --verify --quiet refs/heads/gh-pages; then
        log_info "Creating gh-pages branch..."
        git checkout -b gh-pages
        git rm -rf .
        git commit --allow-empty -m "Initialize gh-pages branch"
        git checkout main
    fi
    
    # Copy built docs to gh-pages branch
    git checkout gh-pages
    
    # Clean existing files except .git
    find . -maxdepth 1 -not -name '.git' -not -name '.' -exec rm -rf {} \; 2>/dev/null || true
    
    # Copy new documentation
    cp -r "$DOCS_BUILD_DIR"/* .
    
    # Create .nojekyll file to prevent Jekyll processing
    touch .nojekyll
    
    # Commit and push
    git add .
    git commit -m "Deploy documentation - $VERSION"
    git push origin gh-pages
    
    # Return to main branch
    git checkout main
    
    log_success "Deployed to GitHub Pages!"
    echo "🌐 Documentation will be available at: https://$(git config --get remote.origin.url | sed 's/.*github.com[:/]\(.*\)\.git/\1/' | tr '[:upper:]' '[:lower:]').github.io"
}

# Manual GitHub Pages deployment
deploy_github_pages_manual() {
    log_info "Manual GitHub Pages deployment..."
    
    echo "📋 Manual GitHub Pages Setup:"
    echo "1. Create a new branch called 'gh-pages'"
    echo "2. Copy contents of $DOCS_BUILD_DIR to the gh-pages branch"
    echo "3. Push the gh-pages branch to GitHub"
    echo "4. Enable GitHub Pages in repository settings"
    echo ""
    echo "Commands to run:"
    echo "  git checkout -b gh-pages"
    echo "  git rm -rf ."
    echo "  cp -r $DOCS_BUILD_DIR/* ."
    echo "  touch .nojekyll"
    echo "  git add ."
    echo "  git commit -m 'Deploy docs'"
    echo "  git push origin gh-pages"
}

# Docker deployment
deploy_docker() {
    log_deploy "Creating Docker deployment..."
    
    # Create Dockerfile for documentation
    cat > Dockerfile.docs << 'EOF'
FROM nginx:alpine

# Copy documentation files
COPY docs_site/_build/html /usr/share/nginx/html

# Custom nginx configuration
RUN echo 'server {' > /etc/nginx/conf.d/default.conf && \
    echo '    listen       80;' >> /etc/nginx/conf.d/default.conf && \
    echo '    server_name  localhost;' >> /etc/nginx/conf.d/default.conf && \
    echo '    location / {' >> /etc/nginx/conf.d/default.conf && \
    echo '        root   /usr/share/nginx/html;' >> /etc/nginx/conf.d/default.conf && \
    echo '        index  index.html index.htm;' >> /etc/nginx/conf.d/default.conf && \
    echo '        try_files $uri $uri/ /index.html;' >> /etc/nginx/conf.d/default.conf && \
    echo '    }' >> /etc/nginx/conf.d/default.conf && \
    echo '}' >> /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
EOF

    # Build Docker image
    log_info "Building Docker image..."
    docker build -f Dockerfile.docs -t "$PROJECT_NAME:$VERSION" -t "$PROJECT_NAME:latest" .
    
    # Create docker-compose.yml for easy deployment
    cat > docker-compose.docs.yml << EOF
version: '3.8'

services:
  docs:
    image: $PROJECT_NAME:latest
    container_name: ${PROJECT_NAME}-server
    ports:
      - "8080:80"
    restart: unless-stopped
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.docs.rule=Host(\`docs.localhost\`)"

networks:
  default:
    external:
      name: bridge
EOF

    log_success "Docker image built: $PROJECT_NAME:$VERSION"
    echo ""
    echo "🐳 Docker Deployment Options:"
    echo "1. Run container: docker run -p 8080:80 $PROJECT_NAME:latest"
    echo "2. Use docker-compose: docker-compose -f docker-compose.docs.yml up -d"
    echo "3. Deploy to registry: docker push your-registry/$PROJECT_NAME:$VERSION"
    
    # Ask if user wants to run immediately
    read -p "🚀 Start container now? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log_info "Starting Docker container..."
        docker run -d -p 8080:80 --name "${PROJECT_NAME}-server" "$PROJECT_NAME:latest"
        log_success "Container started! Access at: http://localhost:8080"
    fi
}

# AWS S3 deployment
deploy_s3() {
    log_deploy "Deploying to AWS S3..."
    
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI not found. Install it first: https://aws.amazon.com/cli/"
        exit 1
    fi
    
    # Get S3 bucket name
    read -p "📦 Enter S3 bucket name: " S3_BUCKET
    
    if [ -z "$S3_BUCKET" ]; then
        log_error "S3 bucket name required"
        exit 1
    fi
    
    # Check if bucket exists
    if ! aws s3 ls "s3://$S3_BUCKET" &> /dev/null; then
        read -p "🆕 Bucket doesn't exist. Create it? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            aws s3 mb "s3://$S3_BUCKET"
            log_success "Bucket created"
        else
            exit 1
        fi
    fi
    
    # Sync files to S3
    log_info "Syncing files to S3..."
    aws s3 sync "$DOCS_BUILD_DIR" "s3://$S3_BUCKET" --delete
    
    # Configure bucket for static website hosting
    aws s3 website "s3://$S3_BUCKET" --index-document index.html --error-document 404.html
    
    log_success "Deployed to S3!"
    echo "🌐 Website URL: http://$S3_BUCKET.s3-website-us-east-1.amazonaws.com"
    echo "📋 Don't forget to configure bucket policies for public access if needed"
}

# nginx deployment
deploy_nginx() {
    log_deploy "Deploying to nginx server..."
    
    # Get nginx configuration
    read -p "🌐 Enter server hostname/IP: " NGINX_HOST
    read -p "📁 Enter nginx web root (default: /var/www/html): " NGINX_ROOT
    NGINX_ROOT=${NGINX_ROOT:-/var/www/html}
    
    # Create deployment directory
    DEPLOY_DIR="$NGINX_ROOT/$PROJECT_NAME"
    
    log_info "Creating nginx configuration..."
    
    # Generate nginx site configuration
    cat > "${PROJECT_NAME}.nginx.conf" << EOF
server {
    listen 80;
    server_name $NGINX_HOST;
    root $DEPLOY_DIR;
    index index.html index.htm;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;
}
EOF

    echo "📋 nginx Deployment Steps:"
    echo "1. Copy files to server:"
    echo "   rsync -avz $DOCS_BUILD_DIR/ $NGINX_HOST:$DEPLOY_DIR/"
    echo ""
    echo "2. Copy nginx configuration:"
    echo "   scp ${PROJECT_NAME}.nginx.conf $NGINX_HOST:/etc/nginx/sites-available/"
    echo ""
    echo "3. Enable site:"
    echo "   ssh $NGINX_HOST 'ln -s /etc/nginx/sites-available/${PROJECT_NAME}.nginx.conf /etc/nginx/sites-enabled/'"
    echo ""
    echo "4. Test and reload nginx:"
    echo "   ssh $NGINX_HOST 'nginx -t && systemctl reload nginx'"
    
    log_success "nginx configuration created: ${PROJECT_NAME}.nginx.conf"
}

# Netlify deployment
deploy_netlify() {
    log_deploy "Deploying to Netlify..."
    
    if ! command -v netlify &> /dev/null; then
        log_info "Installing Netlify CLI..."
        npm install -g netlify-cli
    fi
    
    # Create netlify.toml configuration
    cat > netlify.toml << EOF
[build]
  publish = "docs_site/_build/html"
  command = "./build-docs.sh"

[build.environment]
  PYTHON_VERSION = "3.9"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
  conditions = {Role = ["admin"]}

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-XSS-Protection = "1; mode=block"
    X-Content-Type-Options = "nosniff"

[[headers]]
  for = "/static/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
EOF

    # Deploy to Netlify
    log_info "Deploying to Netlify..."
    netlify deploy --prod --dir="$DOCS_BUILD_DIR"
    
    log_success "Deployed to Netlify!"
    echo "🌐 Check your Netlify dashboard for the URL"
}

# Vercel deployment
deploy_vercel() {
    log_deploy "Deploying to Vercel..."
    
    if ! command -v vercel &> /dev/null; then
        log_info "Installing Vercel CLI..."
        npm install -g vercel
    fi
    
    # Create vercel.json configuration
    cat > vercel.json << EOF
{
  "version": 2,
  "name": "$PROJECT_NAME",
  "builds": [
    {
      "src": "docs_site/_build/html/**",
      "use": "@vercel/static"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/docs_site/_build/html/\$1"
    }
  ],
  "headers": [
    {
      "source": "/static/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}
EOF

    # Deploy to Vercel
    log_info "Deploying to Vercel..."
    vercel --prod
    
    log_success "Deployed to Vercel!"
}

# Create archive
create_archive() {
    log_deploy "Creating documentation archive..."
    
    ARCHIVE_DIR="phony-docs-$VERSION"
    
    # Create archive directory
    mkdir -p "$ARCHIVE_DIR"
    cp -r "$DOCS_BUILD_DIR"/* "$ARCHIVE_DIR/"
    
    # Create ZIP archive
    log_info "Creating ZIP archive..."
    zip -r "$ARCHIVE_DIR.zip" "$ARCHIVE_DIR"
    
    # Create TAR.GZ archive
    log_info "Creating TAR.GZ archive..."
    tar -czf "$ARCHIVE_DIR.tar.gz" "$ARCHIVE_DIR"
    
    # Clean up temp directory
    rm -rf "$ARCHIVE_DIR"
    
    log_success "Archives created:"
    echo "   📦 $ARCHIVE_DIR.zip"
    echo "   📦 $ARCHIVE_DIR.tar.gz"
    echo ""
    echo "💡 Upload these files to any static hosting service"
}

# Custom deployment
deploy_custom() {
    log_deploy "Custom deployment script..."
    
    CUSTOM_SCRIPT="deploy-custom.sh"
    
    if [ -f "$CUSTOM_SCRIPT" ]; then
        log_info "Running custom deployment script: $CUSTOM_SCRIPT"
        chmod +x "$CUSTOM_SCRIPT"
        ./"$CUSTOM_SCRIPT" "$DOCS_BUILD_DIR"
    else
        log_info "Creating custom deployment script template..."
        
        cat > "$CUSTOM_SCRIPT" << 'EOF'
#!/bin/bash
# Custom deployment script for Phony documentation
# Usage: ./deploy-custom.sh <docs_build_directory>

DOCS_DIR="$1"

if [ -z "$DOCS_DIR" ]; then
    echo "Usage: $0 <docs_build_directory>"
    exit 1
fi

echo "🚀 Running custom deployment..."
echo "   Source: $DOCS_DIR"

# Add your custom deployment logic here
# Examples:
# - rsync to remote server
# - Upload to FTP
# - Deploy to custom hosting
# - Push to CDN
# - etc.

echo "✅ Custom deployment completed!"
EOF

        chmod +x "$CUSTOM_SCRIPT"
        log_success "Custom script created: $CUSTOM_SCRIPT"
        echo "📝 Edit the script and run this option again"
    fi
}

# Main deployment flow
main() {
    check_build
    
    while true; do
        show_menu
        read -p "🎯 Select deployment option (0-9): " choice
        
        case $choice in
            1) deploy_local ;;
            2) deploy_github_pages ;;
            3) deploy_docker ;;
            4) deploy_s3 ;;
            5) deploy_nginx ;;
            6) deploy_netlify ;;
            7) deploy_vercel ;;
            8) create_archive ;;
            9) deploy_custom ;;
            0) 
                echo "👋 Goodbye!"
                exit 0
                ;;
            *)
                log_warning "Invalid option. Please select 0-9."
                continue
                ;;
        esac
        
        echo ""
        read -p "🔄 Deploy to another platform? (y/n): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            break
        fi
    done
    
    log_success "Deployment completed! 🎉"
}

# Run main function
main "$@"