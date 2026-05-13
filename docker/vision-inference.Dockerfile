ARG TENSORRT_BASE_IMAGE=nvcr.io/nvidia/tensorrt:24.07-py3
FROM ${TENSORRT_BASE_IMAGE}

ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ARG PIP_TRUSTED_HOST=pypi.tuna.tsinghua.edu.cn

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST} \
    HF_HOME=/cache/huggingface \
    TRANSFORMERS_CACHE=/cache/huggingface

WORKDIR /app

COPY workloads/vision-inference/requirements.txt /tmp/requirements.txt
COPY workloads/vision-inference/requirements-torch.txt /tmp/requirements-torch.txt
RUN python -m pip install --no-cache-dir --index-url "$PIP_INDEX_URL" --trusted-host "$PIP_TRUSTED_HOST" --trusted-host download.pytorch.org -r /tmp/requirements.txt
RUN python -m pip install --no-cache-dir --no-deps --index-url https://download.pytorch.org/whl/cu124 --trusted-host download.pytorch.org -r /tmp/requirements-torch.txt && \
    python -c "import torch, torchvision; print('torch', torch.__version__, 'cuda', torch.version.cuda); print('torchvision', torchvision.__version__)"

COPY workloads/vision-inference/server.py /app/server.py

EXPOSE 8000

ENTRYPOINT ["python", "/app/server.py"]
