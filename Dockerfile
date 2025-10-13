# Build stage for frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package*.json ./
RUN npm ci

# Copy frontend source
COPY frontend/ ./

# Build frontend
RUN npm run build

# Build stage for backend
FROM node:22-alpine AS backend-builder
WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy backend package files
COPY package*.json ./
RUN npm ci

# Copy backend source
COPY src/ ./src/
COPY tsconfig.json ./

# Build backend
RUN npm run build

# Production stage
FROM node:22-alpine
WORKDIR /app

# Install runtime dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy backend package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy built backend
COPY --from=backend-builder /app/dist ./dist

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Expose port
EXPOSE 3004

# Start the server
CMD ["node", "dist/start-all.cjs"]
