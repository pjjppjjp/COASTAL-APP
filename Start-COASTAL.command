#!/bin/sh
# macOS: open the bundled app. No server or package installation is required.
coastal_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd) || exit 1
coastal_html="$coastal_dir/OPEN-COASTAL.html"
if [ ! -f "$coastal_html" ]; then
  printf '%s\n' 'OPEN-COASTAL.html is missing. Extract the complete COASTAL-Planner ZIP first.' >&2
  exit 1
fi
if command -v open >/dev/null 2>&1; then
  exec open "$coastal_html"
elif command -v xdg-open >/dev/null 2>&1; then
  exec xdg-open "$coastal_html"
fi
printf '%s\n' 'Open OPEN-COASTAL.html in your web browser.'
