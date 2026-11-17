# RRY-Map-Bot Docker Image
# Supports running Discord bot, API server, or sync service

# Stage 1: build the web apps: the configurator, and the map, stats and region map pages
FROM node:22-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/ web/
# What the two builds read outside web/: the pages and their icons, their scripts and styles, the
# libraries and the images (tests/test_dockerfile.py checks this list against what they reach).
COPY index.html stats.html region-map.html favicon.ico favicon.png favicon-16.png favicon-32.png ./
COPY src/ src/
COPY css/ css/
COPY img/ img/
COPY lib/ lib/
RUN npm ci && npm run build

# Stage 2: runtime
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Built configurator app and built pages
COPY --from=web /app/dist/configurator /app/dist/configurator
COPY --from=web /app/dist/site /app/dist/site

# Create data directory for database
RUN mkdir -p /app/data

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# Expose API port
EXPOSE 8000

# Default command (can be overridden in docker-compose)
CMD ["python3", "backend/api/app.py"]

