#!/usr/bin/env bash
set -o errexit
set -o nounset
set -o pipefail

# The repository, whatever the folder is called
cd "$(dirname "${BASH_SOURCE[0]}")/.."

sudo mkdir -p "$PWD/node_modules" /home/vscode/.cache /home/vscode/.npm
sudo chown -R vscode:vscode "$PWD/node_modules" /home/vscode/.cache /home/vscode/.npm

npm ci
npx playwright install firefox chromium
