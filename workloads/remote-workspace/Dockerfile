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
ARG NVIDIA_DRIVER_VERSION="570.211.01"
ARG NVIDIA_DRIVER_RUNFILE_URL=""
ARG INSTALL_NVIDIA_GRAPHICS_USERLAND="1"

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
    cifs-utils \
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
    libgles2 \
    libglvnd0 \
    libglx0 \
    libgomp1 \
    libopengl0 \
    libvulkan1 \
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
    v4l-utils \
    vim-tiny \
    vulkan-tools \
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

RUN if [ "$INSTALL_NVIDIA_GRAPHICS_USERLAND" != "1" ]; then \
    echo "Skipping NVIDIA graphics/Vulkan userland installation."; \
  elif [ "${TARGETARCH:-$(dpkg --print-architecture)}" != "amd64" ]; then \
    echo "Skipping NVIDIA x86_64 userland on TARGETARCH=${TARGETARCH:-$(dpkg --print-architecture)}."; \
  else \
    command -v curl >/dev/null \
    && nvidia_major="${NVIDIA_DRIVER_VERSION%%.*}" \
    && nvidia_root="/opt/nvidia-${nvidia_major}" \
    && nvidia_current_root="/opt/nvidia-current" \
    && nvidia_lib_dir="${nvidia_root}/lib" \
    && nvidia_icd_dir="${nvidia_root}/icd.d" \
    && nvidia_runfile_url="${NVIDIA_DRIVER_RUNFILE_URL:-https://download.nvidia.com/XFree86/Linux-x86_64/${NVIDIA_DRIVER_VERSION}/NVIDIA-Linux-x86_64-${NVIDIA_DRIVER_VERSION}.run}" \
    && install -d -m 0755 \
      "$nvidia_lib_dir" \
      "$nvidia_icd_dir" \
      /usr/share/nvidia \
      /usr/share/glvnd/egl_vendor.d \
      /usr/share/egl/egl_external_platform.d \
      /usr/share/vulkan/icd.d \
      /usr/share/vulkan/implicit_layer.d \
    && ln -sfn "$(basename "$nvidia_root")" "$nvidia_current_root" \
    && curl -fsSL --connect-timeout 30 --retry 3 --retry-delay 2 \
      "$nvidia_runfile_url" \
      -o /tmp/nvidia-driver.run \
    && mkdir -p /tmp/nvidia-driver-extract \
    && cd /tmp/nvidia-driver-extract \
    && sh /tmp/nvidia-driver.run --extract-only \
    && nvidia_extract_dir="/tmp/nvidia-driver-extract/NVIDIA-Linux-x86_64-${NVIDIA_DRIVER_VERSION}" \
    && test -d "$nvidia_extract_dir" \
    && find "$nvidia_extract_dir" -maxdepth 1 \( -type f -o -type l \) \
      \( -name 'lib*.so' -o -name 'lib*.so.*' \) \
      -exec cp -P {} "$nvidia_lib_dir/" \; \
    && cp -a "$nvidia_lib_dir"/. /usr/lib/x86_64-linux-gnu/ \
    && for lib_dir in "$nvidia_lib_dir" /usr/lib/x86_64-linux-gnu; do \
      find "$lib_dir" -maxdepth 1 -type f -name "*.so.${NVIDIA_DRIVER_VERSION}" \
        -exec sh -c 'driver_version="$1"; shift; for lib_path do lib_name="$(basename "$lib_path")"; lib_dir="$(dirname "$lib_path")"; base_name="${lib_name%.so.$driver_version}"; ln -sfn "$lib_name" "$lib_dir/$base_name.so"; ln -sfn "$lib_name" "$lib_dir/$base_name.so.1"; done' sh "$NVIDIA_DRIVER_VERSION" {} +; \
      if [ -f "$lib_dir/libGLX_nvidia.so.${NVIDIA_DRIVER_VERSION}" ]; then ln -sfn "libGLX_nvidia.so.${NVIDIA_DRIVER_VERSION}" "$lib_dir/libGLX_nvidia.so.0"; fi; \
      if [ -f "$lib_dir/libEGL_nvidia.so.${NVIDIA_DRIVER_VERSION}" ]; then ln -sfn "libEGL_nvidia.so.${NVIDIA_DRIVER_VERSION}" "$lib_dir/libEGL_nvidia.so.0"; fi; \
      if [ -f "$lib_dir/libGLESv1_CM_nvidia.so.${NVIDIA_DRIVER_VERSION}" ]; then ln -sfn "libGLESv1_CM_nvidia.so.${NVIDIA_DRIVER_VERSION}" "$lib_dir/libGLESv1_CM_nvidia.so.1"; fi; \
      if [ -f "$lib_dir/libGLESv2_nvidia.so.${NVIDIA_DRIVER_VERSION}" ]; then ln -sfn "libGLESv2_nvidia.so.${NVIDIA_DRIVER_VERSION}" "$lib_dir/libGLESv2_nvidia.so.2"; fi; \
    done \
    && for nvidia_share_file in \
      "nvidia-application-profiles-${NVIDIA_DRIVER_VERSION}-rc" \
      "nvidia-application-profiles-${NVIDIA_DRIVER_VERSION}-key-documentation"; do \
      if [ -f "$nvidia_extract_dir/$nvidia_share_file" ]; then cp "$nvidia_extract_dir/$nvidia_share_file" /usr/share/nvidia/; fi; \
    done \
    && if [ -f "/usr/share/nvidia/nvidia-application-profiles-${NVIDIA_DRIVER_VERSION}-rc" ]; then \
      ln -sfn "nvidia-application-profiles-${NVIDIA_DRIVER_VERSION}-rc" /usr/share/nvidia/nvidia-application-profiles-rc; \
    fi \
    && for egl_vendor_file in 10_nvidia.json; do \
      if [ -f "$nvidia_extract_dir/$egl_vendor_file" ]; then cp "$nvidia_extract_dir/$egl_vendor_file" /usr/share/glvnd/egl_vendor.d/; fi; \
    done \
    && if [ ! -f /usr/share/glvnd/egl_vendor.d/10_nvidia.json ]; then \
      printf '%s\n' \
        '{' \
        '    "file_format_version" : "1.0.0",' \
        '    "ICD" : {' \
        '        "library_path" : "libEGL_nvidia.so.0"' \
        '    }' \
        '}' \
        >/usr/share/glvnd/egl_vendor.d/10_nvidia.json; \
    fi \
    && for egl_platform_file in \
      10_nvidia_wayland.json \
      15_nvidia_gbm.json \
      20_nvidia_xcb.json \
      20_nvidia_xlib.json; do \
      if [ -f "$nvidia_extract_dir/$egl_platform_file" ]; then cp "$nvidia_extract_dir/$egl_platform_file" /usr/share/egl/egl_external_platform.d/; fi; \
    done \
    && nvidia_api_version="$(sed -n 's/.*"api_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$nvidia_extract_dir/nvidia_icd.json" 2>/dev/null | head -n 1)" \
    && nvidia_api_version="${nvidia_api_version:-1.3.280}" \
    && printf '%s\n' \
      '{' \
      '    "file_format_version" : "1.0.0",' \
      '    "ICD": {' \
      "        \"library_path\" : \"${nvidia_current_root}/lib/libGLX_nvidia.so.0\"," \
      "        \"api_version\" : \"${nvidia_api_version}\"" \
      '    }' \
      '}' \
      >"$nvidia_icd_dir/nvidia_icd.json" \
    && cp "$nvidia_icd_dir/nvidia_icd.json" /usr/share/vulkan/icd.d/nvidia_icd.json \
    && if [ -f "$nvidia_extract_dir/nvidia_layers.json" ]; then \
      cp "$nvidia_extract_dir/nvidia_layers.json" /usr/share/vulkan/implicit_layer.d/nvidia_layers.json; \
    fi \
    && ldconfig \
    && rm -rf /tmp/nvidia-driver.run /tmp/nvidia-driver-extract; \
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
