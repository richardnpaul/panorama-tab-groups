FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

# Install Xfce desktop, TigerVNC, noVNC/websockify, and X11 utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    xfce4 \
    xfce4-terminal \
    tigervnc-standalone-server \
    novnc \
    websockify \
    dbus-x11 \
    x11-xserver-utils \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 26, the version CI tests (see the Node.js CI workflow)
RUN curl -fsSL https://deb.nodesource.com/setup_26.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Bake Playwright OS-level system dependencies into the image.
# Uses install-deps (not install --with-deps) so no browser binaries are
# downloaded into root's cache — binaries are installed per-user in
# postCreateCommand instead.
RUN npx -y playwright@1.59.1 install-deps firefox chromium

# act runs the GitHub workflows locally (see TESTING.md). The release is pinned
# and checked against its published SHA-256; the Docker daemon it needs comes
# from the docker-in-docker feature in devcontainer.json
ARG ACT_VERSION=0.2.89
ARG ACT_SHA256=0191d6f1f3b716b5c55820032605d05fc3c1cdbf581ebeff655019e5dd1524c0
RUN curl -fsSL -o /tmp/act.tar.gz \
        "https://github.com/nektos/act/releases/download/v${ACT_VERSION}/act_Linux_x86_64.tar.gz" \
    && echo "${ACT_SHA256}  /tmp/act.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/act.tar.gz -C /usr/local/bin act \
    && rm /tmp/act.tar.gz

# Configure VNC for the vscode user
USER vscode
RUN mkdir -p /home/vscode/.vnc \
    && printf '#!/bin/bash\nexec dbus-launch --exit-with-session startxfce4\n' \
        > /home/vscode/.vnc/xstartup \
    && chmod +x /home/vscode/.vnc/xstartup
