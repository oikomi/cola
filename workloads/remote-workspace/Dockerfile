ARG UBUNTU_VERSION=24.04
FROM ubuntu:${UBUNTU_VERSION}

ARG NOVNC_VERSION=v1.6.0

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV HOME=/home/worker
ENV PATH=/opt/websockify-venv/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
    arc-theme \
    ca-certificates \
    curl \
    dbus-x11 \
    fonts-jetbrains-mono \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    fonts-noto-core \
    git \
    gnupg \
    locales \
    nano \
    papirus-icon-theme \
    python3 \
    python3-pip \
    python3-venv \
    sudo \
    supervisor \
    tini \
    wget \
    x11-utils \
    x11vnc \
    xfce4 \
    xfce4-goodies \
    xfce4-terminal \
    xterm \
    xvfb \
  && locale-gen en_US.UTF-8 \
  && useradd -m -s /bin/bash worker \
  && echo "worker ALL=(ALL) NOPASSWD:ALL" >/etc/sudoers.d/worker \
  && chmod 0440 /etc/sudoers.d/worker \
  && python3 -m venv /opt/websockify-venv \
  && /opt/websockify-venv/bin/pip install --no-cache-dir websockify==0.12.0 \
  && ln -sf /opt/websockify-venv/bin/websockify /usr/local/bin/websockify \
  && git clone --depth 1 --branch "${NOVNC_VERSION}" https://github.com/novnc/noVNC.git /opt/novnc \
  && ln -sf /opt/novnc/vnc_lite.html /opt/novnc/index.html \
  && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y --no-install-recommends \
    yaru-theme-gtk \
    yaru-theme-icon \
    yaru-theme-sound \
  && rm -rf /var/lib/apt/lists/*

COPY scripts/ /opt/remote-work/
COPY config/ /opt/remote-work/config/
COPY assets/ /opt/remote-work/assets/

RUN chmod +x /opt/remote-work/*.sh

WORKDIR /home/worker

EXPOSE 6080 5901

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/remote-work/entrypoint.sh"]
