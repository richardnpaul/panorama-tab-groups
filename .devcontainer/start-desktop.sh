#!/bin/bash
set -e

# Clean up stale X11/VNC state from previous runs or unclean shutdowns.
# Both the lock file and the Unix socket must be removed or vncserver will
# refuse to start on display :1.
rm -rf /tmp/.X11-unix/X1 /tmp/.X1-lock

# Start TigerVNC on display :1 (port 5901).
# -SecurityTypes None: no password required (local dev only).
# -localhost no: allows websockify to connect from the same container.
vncserver :1 -geometry 1920x1080 -depth 24 -localhost no -SecurityTypes None --I-KNOW-THIS-IS-INSECURE

# Start websockify to proxy WebSocket traffic (port 6080) to VNC (port 5901).
# --web: serves the noVNC HTML/JS client.
# --daemon: daemonises the process.
# Access the desktop at http://localhost:6080/vnc.html
websockify --web /usr/share/novnc/ --daemon 6080 localhost:5901
