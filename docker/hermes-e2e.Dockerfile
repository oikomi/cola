FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1
ENV HERMES_HOME=/opt/data

RUN apt-get update && \
  apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    ffmpeg \
    git \
    procps \
    ripgrep && \
  rm -rf /var/lib/apt/lists/*

RUN useradd -u 10000 -m -d /opt/data hermes

COPY . /opt/hermes
WORKDIR /opt/hermes

RUN pip install --no-cache-dir -e .

USER hermes
