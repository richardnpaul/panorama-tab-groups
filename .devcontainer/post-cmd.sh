#!/usr/bin/env bash
set -o errexit
set -o nounset
set -o pipefail

sudo mkdir -p /workspaces/panorama-tab-groups/node_modules /home/vscode/.cache /home/vscode/.npm
sudo chown -R vscode:vscode /workspaces/panorama-tab-groups/node_modules /home/vscode/.cache /home/vscode/.npm

cd /workspaces/panorama-tab-groups
npm ci
npx playwright install firefox chromium
