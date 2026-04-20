FROM ubuntu:22.04

ARG NOVNC_VERSION=v1.6.0

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV HOME=/home/worker

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    dbus-x11 \
    git \
    gnupg \
    locales \
    nano \
    python3 \
    python3-pip \
    sudo \
    supervisor \
    tini \
    wget \
    x11-utils \
    x11vnc \
    xfce4 \
    xfce4-goodies \
    xterm \
    xvfb \
  && locale-gen en_US.UTF-8 \
  && useradd -m -s /bin/bash worker \
  && echo "worker ALL=(ALL) NOPASSWD:ALL" >/etc/sudoers.d/worker \
  && chmod 0440 /etc/sudoers.d/worker \
  && python3 -m pip install --no-cache-dir websockify==0.12.0 \
  && git clone --depth 1 --branch "${NOVNC_VERSION}" https://github.com/novnc/noVNC.git /opt/novnc \
  && ln -sf /opt/novnc/vnc.html /opt/novnc/index.html \
  && rm -rf /var/lib/apt/lists/*

COPY scripts/ /opt/remote-work/

RUN chmod +x /opt/remote-work/*.sh

WORKDIR /home/worker

EXPOSE 6080 5901

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/remote-work/entrypoint.sh"]

