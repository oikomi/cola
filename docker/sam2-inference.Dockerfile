ARG BASE_IMAGE=pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime
FROM ${BASE_IMAGE}

ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ARG PIP_TRUSTED_HOST=pypi.tuna.tsinghua.edu.cn
ARG APT_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/ubuntu
ARG SAM2_GIT_URL=https://github.com/facebookresearch/sam2.git
ARG SAM2_GIT_REF=2b90b9f5ceec907a1c18123530e92e794ad901a4

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST} \
    SAM2_BUILD_CUDA=0 \
    HF_HOME=/cache/huggingface \
    TRANSFORMERS_CACHE=/cache/huggingface \
    TOKENIZERS_PARALLELISM=false \
    HF_HUB_DISABLE_TELEMETRY=1

RUN sed -i \
      -e "s|http://archive.ubuntu.com/ubuntu|${APT_MIRROR}|g" \
      -e "s|http://security.ubuntu.com/ubuntu|${APT_MIRROR}|g" \
      /etc/apt/sources.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      ffmpeg \
      git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY workloads/sam2-inference/requirements.txt /tmp/requirements.txt
RUN python -m pip install --no-cache-dir \
      --index-url "$PIP_INDEX_URL" \
      --trusted-host "$PIP_TRUSTED_HOST" \
      -r /tmp/requirements.txt
RUN python -m pip install --no-cache-dir \
      --no-build-isolation \
      "git+${SAM2_GIT_URL}@${SAM2_GIT_REF}"

COPY workloads/sam2-inference/server.py /app/server.py

EXPOSE 8000

ENTRYPOINT ["python", "/app/server.py"]
