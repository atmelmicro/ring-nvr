# Stage 1: build the React frontend
FROM oven-sh/bun:alpine AS frontend-builder

WORKDIR /web

COPY web/package.json ./
COPY web/bun.lock ./
RUN bun install --frozen-lockfile

COPY web/ ./
RUN bun run build


# Stage 2: final image with Python backend + built frontend
FROM python:3.12-slim

# System deps required by aiortc
RUN apt-get update && apt-get install -y --no-install-recommends \
    libavformat-dev \
    libavcodec-dev \
    libavdevice-dev \
    libavutil-dev \
    libswscale-dev \
    libswresample-dev \
    libavfilter-dev \
    libopus-dev \
    libvpx-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

# Serve the built frontend from the static directory
COPY --from=frontend-builder /web/dist ./web/dist

RUN mkdir -p /nvr

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
