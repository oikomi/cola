FROM unsloth/unsloth:latest

RUN DS_BUILD_OPS=0 python -m pip install --no-cache-dir --no-deps \
    "deepspeed>=0.16,<0.17" \
    hjson \
    ninja \
 && python - <<'PY'
import deepspeed
print(deepspeed.__version__)
PY
