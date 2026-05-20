ARG BASE_IMAGE=ubuntu:noble-20260410
FROM ${BASE_IMAGE}

ARG BASE_IMAGE
ARG UBUNTU_VERSION=24.04.4
ARG KASMVNC_VERSION=1.4.0
ARG OFFLINE_DEB_DIR=""
ARG SKIP_PACKAGE_INSTALL=0
ARG UBUNTU_APT_URL="http://mirrors.cernet.edu.cn/ubuntu"
ARG MOZILLA_APT_URL="https://mirrors.cernet.edu.cn/mozilla/apt"
ARG MOZILLA_APT_FALLBACK_URL="https://mirrors.cernet.edu.cn/mozilla/apt"
ARG TARGETARCH

LABEL org.opencontainers.image.base.name="${BASE_IMAGE}" \
  org.opencontainers.image.version="${UBUNTU_VERSION}"

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV HOME=/home/worker

COPY debs/ /opt/remote-work-debs/

RUN if [ -n "$UBUNTU_APT_URL" ]; then \
    find /etc/apt -type f \( -name '*.list' -o -name '*.sources' \) -exec sed -i \
      -e "s|http://archive.ubuntu.com/ubuntu|${UBUNTU_APT_URL}|g" \
      -e "s|https://archive.ubuntu.com/ubuntu|${UBUNTU_APT_URL}|g" \
      -e "s|http://security.ubuntu.com/ubuntu|${UBUNTU_APT_URL}|g" \
      -e "s|https://security.ubuntu.com/ubuntu|${UBUNTU_APT_URL}|g" \
      {} +; \
  fi

RUN if [ "$SKIP_PACKAGE_INSTALL" = "1" ]; then \
    command -v vncserver >/dev/null \
    && command -v Xvnc >/dev/null \
    && command -v vncpasswd >/dev/null \
    && test -d /usr/share/kasmvnc/www \
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
    default-jre-headless \
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
    nodejs \
    npm \
    procps \
    python3 \
    python3-pip \
    ssl-cert \
    sudo \
    supervisor \
    tini \
    traceroute \
    ubuntu-session \
    ubuntu-wallpapers-noble \
    vim-tiny \
    wget \
    xdg-utils \
    x11-utils \
    xterm \
    yaru-theme-gtk \
    yaru-theme-icon \
    yaru-theme-sound \
  && locale-gen en_US.UTF-8 \
  && kasmvnc_arch="${TARGETARCH:-$(dpkg --print-architecture)}" \
  && case "$kasmvnc_arch" in amd64|arm64) ;; *) echo "Unsupported KasmVNC arch: $kasmvnc_arch" >&2; exit 1 ;; esac \
  && curl -fsSL \
    "https://github.com/kasmtech/KasmVNC/releases/download/v${KASMVNC_VERSION}/kasmvncserver_noble_${KASMVNC_VERSION}_${kasmvnc_arch}.deb" \
    -o /tmp/kasmvncserver.deb \
  && apt-get install -y --no-install-recommends /tmp/kasmvncserver.deb \
  && command -v Xvnc >/dev/null \
  && command -v vncpasswd >/dev/null \
  && if ! id -u worker >/dev/null 2>&1; then useradd -m -s /bin/bash worker; fi \
  && echo "worker ALL=(ALL) NOPASSWD:ALL" >/etc/sudoers.d/worker \
  && chmod 0440 /etc/sudoers.d/worker \
  && rm -f /tmp/kasmvncserver.deb \
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

RUN if command -v npm >/dev/null 2>&1; then \
    npm install -g @openai/codex \
    && command -v codex >/dev/null; \
  else \
    echo "npm is required to install @openai/codex." >&2; \
    exit 1; \
  fi

COPY scripts/ /opt/remote-work/
COPY config/ /opt/remote-work/config/
COPY assets/ /opt/remote-work/assets/
COPY bin/ /opt/remote-work/bin/

RUN cp -R /opt/remote-work/config/usr/. /usr/ \
  && rm -f \
    /usr/local/bin/google-chrome-workspace \
    /opt/remote-work/bin/google-chrome-workspace \
    /opt/remote-work/config/.local/share/applications/google-chrome-workspace.desktop \
    "/opt/remote-work/config/Desktop/Google Chrome.desktop" \
  && install -m 0755 /opt/remote-work/bin/firefox-workspace /usr/local/bin/firefox-workspace \
  && chmod +x /opt/remote-work/*.sh

WORKDIR /home/worker

EXPOSE 6080

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/remote-work/entrypoint.sh"]
