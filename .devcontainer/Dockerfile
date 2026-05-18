FROM mcr.microsoft.com/devcontainers/base:ubuntu-22.04

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

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Bake Playwright OS-level system dependencies into the image.
# Uses install-deps (not install --with-deps) so no browser binaries are
# downloaded into root's cache — binaries are installed per-user in
# postCreateCommand instead.
RUN npx -y playwright@1.59.1 install-deps firefox chromium

# Configure VNC for the vscode user
USER vscode
RUN mkdir -p /home/vscode/.vnc \
    && printf '#!/bin/bash\nexec dbus-launch --exit-with-session startxfce4\n' \
        > /home/vscode/.vnc/xstartup \
    && chmod +x /home/vscode/.vnc/xstartup
