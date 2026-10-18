#!/usr/bin/env bash
# Install runtimes required by LinkUp: Python, Node.js (JavaScript), C++, Java
set -e

PISTON_CLI="docker exec -i linkup-piston piston"

echo "Installing runtimes on Piston container..."
$PISTON_CLI ppman install python
$PISTON_CLI ppman install node
$PISTON_CLI ppman install gcc
$PISTON_CLI ppman install java

echo "Installed runtimes:"
$PISTON_CLI ppman list
