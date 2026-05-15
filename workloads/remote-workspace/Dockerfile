ARG BASE_IMAGE=ubuntu:noble-20260410
FROM ${BASE_IMAGE}

ARG BASE_IMAGE
ARG UBUNTU_VERSION=24.04.4
ARG NOVNC_VERSION=v1.6.0
ARG OFFLINE_DEB_DIR=""
ARG SKIP_PACKAGE_INSTALL=0
ARG MOZILLA_APT_URL="https://packages.mozilla.org/apt"
ARG MOZILLA_APT_FALLBACK_URL="https://mirrors.cernet.edu.cn/mozilla/apt"

LABEL org.opencontainers.image.base.name="${BASE_IMAGE}" \
  org.opencontainers.image.version="${UBUNTU_VERSION}"

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV HOME=/home/worker

COPY debs/ /opt/remote-work-debs/

RUN if [ "$SKIP_PACKAGE_INSTALL" = "1" ]; then \
    command -v websockify >/dev/null \
    && test -d /opt/novnc \
    && command -v gnome-session >/dev/null \
    && command -v gnome-shell >/dev/null \
    && id -u worker >/dev/null; \
  else \
    printf '%s\n' \
    'Acquire::Retries "5";' \
    'Acquire::http::Timeout "30";' \
    'Acquire::https::Timeout "30";' \
    >/etc/apt/apt.conf.d/80-retries \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    adwaita-icon-theme \
    ca-certificates \
    curl \
    dbus-user-session \
    dbus-x11 \
    dconf-cli \
    dnsutils \
    fonts-jetbrains-mono \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    fonts-noto-core \
    git \
    gnome-control-center \
    gnome-session \
    gnome-shell \
    gnome-shell-extension-appindicator \
    gnome-shell-extension-desktop-icons-ng \
    gnome-shell-extension-ubuntu-dock \
    gnome-terminal \
    gnupg \
    gsettings-desktop-schemas \
    gvfs-backends \
    iproute2 \
    iputils-ping \
    jq \
    less \
    libegl1 \
    libgl1-mesa-dri \
    locales \
    mesa-utils \
    mutter \
    nano \
    nautilus \
    net-tools \
    netcat-openbsd \
    procps \
    python3 \
    python3-pip \
    sudo \
    supervisor \
    tini \
    traceroute \
    ubuntu-session \
    ubuntu-wallpapers-noble \
    vim-tiny \
    websockify \
    wget \
    xdg-utils \
    x11-utils \
    x11vnc \
    xterm \
    xvfb \
    yaru-theme-gtk \
    yaru-theme-icon \
    yaru-theme-sound \
  && locale-gen en_US.UTF-8 \
  && if ! id -u worker >/dev/null 2>&1; then useradd -m -s /bin/bash worker; fi \
  && echo "worker ALL=(ALL) NOPASSWD:ALL" >/etc/sudoers.d/worker \
  && chmod 0440 /etc/sudoers.d/worker \
  && if [ ! -d /opt/novnc/.git ]; then rm -rf /opt/novnc && git clone --depth 1 --branch "${NOVNC_VERSION}" https://github.com/novnc/noVNC.git /opt/novnc; fi \
  && ln -sf /opt/novnc/vnc_lite.html /opt/novnc/index.html \
  && rm -rf /var/lib/apt/lists/* /opt/remote-work-debs; \
  fi

ARG SKIP_BROWSER_INSTALL=0

RUN if [ "$SKIP_BROWSER_INSTALL" = "1" ]; then \
    true; \
  elif [ "$SKIP_PACKAGE_INSTALL" = "1" ]; then \
    if command -v firefox >/dev/null; then exit 0; fi; \
    printf '%s\n' \
      'Acquire::Retries "5";' \
      'Acquire::http::Timeout "30";' \
      'Acquire::https::Timeout "30";' \
      >/etc/apt/apt.conf.d/80-retries \
    && install -d -m 0755 /etc/apt/keyrings \
    && if curl -fsSL --connect-timeout 20 --retry 2 --retry-delay 2 https://packages.mozilla.org/apt/repo-signing-key.gpg -o /etc/apt/keyrings/packages.mozilla.org.asc; then \
      test "$(gpg -n -q --import --import-options import-show /etc/apt/keyrings/packages.mozilla.org.asc | awk '/pub/{getline; gsub(/^ +| +$/, ""); print; exit}')" = "35BAA0B33E9EB396F59CA838C0BA5CE6DC6315A3" \
      && printf '%s\n' \
        'Types: deb' \
        "URIs: ${MOZILLA_APT_URL}" \
        'Suites: mozilla' \
        'Components: main' \
        'Signed-By: /etc/apt/keyrings/packages.mozilla.org.asc' \
        >/etc/apt/sources.list.d/mozilla.sources; \
    else \
      printf '%s\n' \
        'Types: deb' \
        "URIs: ${MOZILLA_APT_FALLBACK_URL}" \
        'Suites: mozilla' \
        'Components: main' \
        'Trusted: yes' \
        >/etc/apt/sources.list.d/mozilla.sources; \
    fi \
    && printf '%s\n' \
      'Package: *' \
      'Pin: origin packages.mozilla.org' \
      'Pin-Priority: 1000' \
      '' \
      'Package: *' \
      'Pin: release n=mozilla' \
      'Pin-Priority: 1000' \
      >/etc/apt/preferences.d/mozilla \
    && apt-get update \
    && apt-get install -y --no-install-recommends firefox firefox-l10n-zh-cn ubuntu-wallpapers-noble xdg-utils; \
  elif [ -n "$OFFLINE_DEB_DIR" ] && [ -n "$(find "$OFFLINE_DEB_DIR" -maxdepth 1 -name '*.deb' -print -quit)" ]; then \
    find "$OFFLINE_DEB_DIR" -maxdepth 1 -name 'google-chrome*.deb' -delete \
    && test -n "$(find "$OFFLINE_DEB_DIR" -maxdepth 1 -name '*.deb' -print -quit)" \
    && apt-get install -y --no-install-recommends "$OFFLINE_DEB_DIR"/*.deb xdg-utils \
    && command -v firefox >/dev/null \
    && command -v xdg-open >/dev/null; \
  else \
    install -d -m 0755 /etc/apt/keyrings \
    && if curl -fsSL --connect-timeout 20 --retry 2 --retry-delay 2 https://packages.mozilla.org/apt/repo-signing-key.gpg -o /etc/apt/keyrings/packages.mozilla.org.asc; then \
      test "$(gpg -n -q --import --import-options import-show /etc/apt/keyrings/packages.mozilla.org.asc | awk '/pub/{getline; gsub(/^ +| +$/, ""); print; exit}')" = "35BAA0B33E9EB396F59CA838C0BA5CE6DC6315A3" \
      && printf '%s\n' \
        'Types: deb' \
        "URIs: ${MOZILLA_APT_URL}" \
        'Suites: mozilla' \
        'Components: main' \
        'Signed-By: /etc/apt/keyrings/packages.mozilla.org.asc' \
        >/etc/apt/sources.list.d/mozilla.sources; \
    else \
      printf '%s\n' \
        'Types: deb' \
        "URIs: ${MOZILLA_APT_FALLBACK_URL}" \
        'Suites: mozilla' \
        'Components: main' \
        'Trusted: yes' \
        >/etc/apt/sources.list.d/mozilla.sources; \
    fi \
    && printf '%s\n' \
      'Package: *' \
      'Pin: origin packages.mozilla.org' \
      'Pin-Priority: 1000' \
      '' \
      'Package: *' \
      'Pin: release n=mozilla' \
      'Pin-Priority: 1000' \
      >/etc/apt/preferences.d/mozilla \
    && apt-get update \
    && apt-get install -y --no-install-recommends firefox firefox-l10n-zh-cn ubuntu-wallpapers-noble xdg-utils; \
  fi

COPY scripts/ /opt/remote-work/
COPY config/ /opt/remote-work/config/
COPY assets/ /opt/remote-work/assets/
COPY bin/ /opt/remote-work/bin/
COPY novnc/ /opt/remote-work/novnc/

RUN cp /opt/remote-work/novnc/vnc_lite.html /opt/novnc/vnc_lite.html \
  && cp -R /opt/remote-work/config/usr/. /usr/ \
  && ln -sf /opt/novnc/vnc_lite.html /opt/novnc/index.html \
  && rm -f \
    /usr/local/bin/google-chrome-workspace \
    /opt/remote-work/bin/google-chrome-workspace \
    /opt/remote-work/config/.local/share/applications/google-chrome-workspace.desktop \
    "/opt/remote-work/config/Desktop/Google Chrome.desktop" \
  && install -m 0755 /opt/remote-work/bin/firefox-workspace /usr/local/bin/firefox-workspace \
  && chmod +x /opt/remote-work/*.sh

WORKDIR /home/worker

EXPOSE 6080 5901

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/remote-work/entrypoint.sh"]
