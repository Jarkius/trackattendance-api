# filename: Dockerfile
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# Copy source files and tsconfig
COPY server.ts tsconfig.json ./

# Build TypeScript
RUN npm run build

# Remove devDependencies after build
RUN npm prune --omit=dev

# Set environment
ENV NODE_ENV=production

# Expose port (documentation + used by some platforms)
EXPOSE 8080

# Run as non-root user (security)
USER node

# Start the compiled JavaScript
CMD ["node", "dist/server.js"]
