#!/bin/bash

# Build script for the React frontend

set -e

echo "🔧 Building Phony React Frontend..."

# Navigate to frontend directory
cd frontend

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build the production app
echo "🏗️  Building production app..."
npm run build

# Copy build to dashboard directory for serving
echo "📁 Copying build to dashboard directory..."
cd ..
rm -rf dashboard-old
if [ -d "dashboard" ]; then
    mv dashboard dashboard-old
fi
cp -r frontend/build dashboard

# Create a simple redirect for the old agents.html
cat > dashboard/agents.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="refresh" content="0; url=/#/agents">
</head>
<body>
    <p>Redirecting to <a href="/#/agents">agent management</a>...</p>
</body>
</html>
EOF

echo "✅ Frontend build complete!"
echo "📍 Dashboard available at: http://localhost:24187/dashboard/"
echo "🤖 Agent management at: http://localhost:24187/dashboard/#/agents"