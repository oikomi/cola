ARG BASE_IMAGE=ubuntu:noble-20260410
FROM ${BASE_IMAGE}

ARG BASE_IMAGE
ARG UBUNTU_VERSION=24.04.4
ARG NOVNC_VERSION=v1.6.0
ARG OFFLINE_DEB_DIR=""
ARG SKIP_PACKAGE_INSTALL=0

LABEL org.opencontainers.image.base.name="${BASE_IMAGE}" \
  org.opencontainers.image.version="${UBUNTU_VERSION}"

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV HOME=/home/worker
ENV PATH=/opt/websockify-venv/bin:$PATH

COPY debs/ /opt/remote-work-debs/

RUN if [ "$SKIP_PACKAGE_INSTALL" = "1" ]; then \
    command -v google-chrome-stable >/dev/null \
    && command -v websockify >/dev/null \
    && test -d /opt/novnc \
    && id -u worker >/dev/null; \
  else \
    printf '%s\n' \
    'Acquire::Retries "5";' \
    'Acquire::http::Timeout "30";' \
    'Acquire::https::Timeout "30";' \
    >/etc/apt/apt.conf.d/80-retries \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    arc-theme \
    ca-certificates \
    curl \
    dnsutils \
    dbus-x11 \
    fonts-jetbrains-mono \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    fonts-noto-core \
    git \
    gnupg \
    iproute2 \
    iputils-ping \
    jq \
    less \
    locales \
    nano \
    net-tools \
    netcat-openbsd \
    papirus-icon-theme \
    procps \
    python3 \
    python3-pip \
    python3-venv \
    sudo \
    supervisor \
    tini \
    traceroute \
    vim-tiny \
    wget \
    xdg-utils \
    x11-utils \
    x11vnc \
    xfce4 \
    xfce4-terminal \
    xterm \
    xvfb \
  && locale-gen en_US.UTF-8 \
  && if [ -n "$OFFLINE_DEB_DIR" ] && [ -n "$(find "$OFFLINE_DEB_DIR" -maxdepth 1 -name '*.deb' -print -quit)" ]; then \
    apt-get install -y --no-install-recommends "$OFFLINE_DEB_DIR"/*.deb; \
  else \
    install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
    | gpg --dearmor -o /etc/apt/keyrings/google-linux.gpg \
    && chmod 0644 /etc/apt/keyrings/google-linux.gpg \
    && printf '%s\n' \
    "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-linux.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
    >/etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable ubuntu-wallpapers-noble; \
  fi \
  && if ! id -u worker >/dev/null 2>&1; then useradd -m -s /bin/bash worker; fi \
  && echo "worker ALL=(ALL) NOPASSWD:ALL" >/etc/sudoers.d/worker \
  && chmod 0440 /etc/sudoers.d/worker \
  && python3 -m venv /opt/websockify-venv \
  && /opt/websockify-venv/bin/pip install --no-cache-dir websockify==0.12.0 \
  && ln -sf /opt/websockify-venv/bin/websockify /usr/local/bin/websockify \
  && if [ ! -d /opt/novnc/.git ]; then rm -rf /opt/novnc && git clone --depth 1 --branch "${NOVNC_VERSION}" https://github.com/novnc/noVNC.git /opt/novnc; fi \
  && ln -sf /opt/novnc/vnc_lite.html /opt/novnc/index.html \
  && rm -rf /var/lib/apt/lists/* /opt/remote-work-debs; \
  fi

RUN if [ "$SKIP_PACKAGE_INSTALL" = "1" ]; then \
    dpkg -s yaru-theme-gtk yaru-theme-icon yaru-theme-sound >/dev/null; \
  else \
    apt-get update && apt-get install -y --no-install-recommends \
    yaru-theme-gtk \
    yaru-theme-icon \
    yaru-theme-sound \
    && rm -rf /var/lib/apt/lists/*; \
  fi

COPY scripts/ /opt/remote-work/
COPY config/ /opt/remote-work/config/
COPY assets/ /opt/remote-work/assets/
COPY bin/ /opt/remote-work/bin/
COPY novnc/ /opt/remote-work/novnc/

RUN cp /opt/remote-work/novnc/vnc_lite.html /opt/novnc/vnc_lite.html \
  && ln -sf /opt/novnc/vnc_lite.html /opt/novnc/index.html \
  && install -m 0755 /opt/remote-work/bin/google-chrome-workspace /usr/local/bin/google-chrome-workspace \
  && chmod +x /opt/remote-work/*.sh

WORKDIR /home/worker

EXPOSE 6080 5901

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/remote-work/entrypoint.sh"]
