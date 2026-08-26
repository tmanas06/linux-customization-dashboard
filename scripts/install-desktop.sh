#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-install}"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="linux-dashboard"
APP_NAME="Linux Dashboard"
APP_COMMENT="Customizable desktop dashboard with clocks, calendar, notes, to-do and system stats"

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"

DESKTOP_FILE="$DATA_HOME/applications/${APP_ID}.desktop"
ICON_SRC_SVG="$PROJECT_DIR/assets/icon.svg"
ICON_SRC_PNG="$PROJECT_DIR/assets/icon.png"
AUTOSTART_FILE="$CONFIG_HOME/autostart/${APP_ID}.desktop"

ELECTRON_BIN="$PROJECT_DIR/node_modules/electron/dist/electron"

if [ ! -x "$ELECTRON_BIN" ]; then
  echo "Error: Electron is not installed."
  echo "Run this first:  cd \"$PROJECT_DIR\" && npm install"
  exit 1
fi

make_desktop_entry() {
  cat <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=$APP_NAME
Comment=$APP_COMMENT
Exec="$ELECTRON_BIN" --no-sandbox --class=$APP_ID "$PROJECT_DIR"
Path=$PROJECT_DIR
TryExec=$ELECTRON_BIN
Icon=$APP_ID
Terminal=false
Categories=Utility;
Keywords=dashboard;clock;calendar;widgets;notes;todo;
StartupWMClass=$APP_ID
StartupNotify=true
EOF
}

do_install() {
  local icon_dir_svg="$DATA_HOME/icons/hicolor/scalable/apps"
  local icon_dir_png="$DATA_HOME/icons/hicolor/512x512/apps"
  mkdir -p "$(dirname "$DESKTOP_FILE")" "$icon_dir_svg" "$icon_dir_png"

  cp "$ICON_SRC_SVG" "$icon_dir_svg/${APP_ID}.svg"
  [ -f "$ICON_SRC_PNG" ] && cp "$ICON_SRC_PNG" "$icon_dir_png/${APP_ID}.png"

  make_desktop_entry > "$DESKTOP_FILE"

  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$DATA_HOME/applications" 2>/dev/null || true
  fi
  if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -f -t "$DATA_HOME/icons/hicolor" 2>/dev/null || true
  fi

  echo "Installed: $DESKTOP_FILE"
  echo "You can now launch \"$APP_NAME\" from your application menu."
}

do_autostart() {
  do_install
  mkdir -p "$(dirname "$AUTOSTART_FILE")"
  make_desktop_entry > "$AUTOSTART_FILE"
  echo "Autostart enabled: $AUTOSTART_FILE"
  echo "The dashboard will now start automatically when you log in."
}

do_uninstall() {
  rm -f "$DESKTOP_FILE" "$AUTOSTART_FILE"
  rm -f "$DATA_HOME/icons/hicolor/scalable/apps/${APP_ID}.svg"
  rm -f "$DATA_HOME/icons/hicolor/512x512/apps/${APP_ID}.png"
  echo "Removed menu entry, icon and autostart file."
}

case "$MODE" in
  install) do_install ;;
  autostart) do_autostart ;;
  uninstall) do_uninstall ;;
  *)
    echo "Usage: $0 [install|autostart|uninstall]"
    exit 1
    ;;
esac
