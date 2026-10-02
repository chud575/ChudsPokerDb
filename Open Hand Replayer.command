#!/bin/bash
# Opens the Hand Replayer in Safari from this folder.
# Always open it the same way: your library is stored per browser AND per location,
# so a different browser (or a localhost address) would start with an empty library.
DIR="$(cd "$(dirname "$0")" && pwd)"
open -a Safari "$DIR/index.html"
