# Use official Bun image
FROM oven/bun:latest

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY package.json bun.lockb ./

# Install dependencies (including devDependencies for TypeScript)
RUN bun install --frozen-lockfile

RUN bun add -g @anthropic-ai/claude-code

# Copy TypeScript configuration
COPY tsconfig.json ./

# Copy the OpenAI proxy server file
COPY openai-proxy.ts ./

# Expose the port the server runs on
EXPOSE 5004

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5004

# Note: The @anthropic-ai/claude-agent-sdk may require:
# - ANTHROPIC_API_KEY environment variable, or
# - Configuration files in the user's home directory
# Make sure to set these when running the container

# Health check (optional - uncomment if needed)
# HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
#   CMD bun -e "fetch('http://localhost:5004').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Run the server with hot reloading
CMD ["bun", "--watch", "openai-proxy.ts"]

