#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-install}"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_ID="linux-dashboard@manas"
EXT_SRC="$PROJECT_DIR/extension"
EXT_DEST="$HOME/.local/share/gnome-shell/extensions/$EXT_ID"
CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/linux-dashboard/dashboard-config.json"

if [ ! -f "$EXT_SRC/metadata.json" ]; then
  echo "Error: extension source not found at $EXT_SRC"
  exit 1
fi

detect_shell_major() {
  gnome-shell --version 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo ""
}

patch_metadata() {
  local major
  major="$(detect_shell_major)"
  [ -z "$major" ] && return 0
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const major = process.argv[2];
    const m = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!m["shell-version"].includes(major)) m["shell-version"].push(major);
    fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
  ' "$EXT_DEST/metadata.json" "$major"
}

seed_config() {
  if [ -f "$CONFIG_FILE" ]; then
    node -e '
      const fs = require("fs");
      const p = process.argv[1];
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
      cfg.desktop = Object.assign({ enabled: true, cols: 6, margin: 40, opacity: 80, rowH: 100 }, cfg.desktop || {}, { enabled: true });
      fs.mkdirSync(require("path").dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
      console.log("Desktop mode enabled in config: " + p);
    ' "$CONFIG_FILE"
  else
    node -e '
      const fs = require("fs");
      const p = process.argv[1];
      const cfg = {
        version: 1,
        theme: "dark",
        accent: "",
        desktop: { enabled: true, cols: 6, margin: 40, opacity: 80, rowH: 100 },
        layout: [
          { type: "digitalClock", w: 2, h: 1, settings: { format: "24h", seconds: true, showDate: true, timezone: "system" } },
          { type: "analogClock", w: 2, h: 2, settings: { timezone: "system", numbers: true, smooth: false } },
          { type: "systemMonitor", w: 2, h: 1, settings: {} },
          { type: "calendar", w: 2, h: 2, settings: { startOfWeek: "sun" } },
          { type: "worldClock", w: 2, h: 2, settings: { zones: ["UTC", "America/New_York", "Asia/Tokyo"] } },
          { type: "todo", w: 2, h: 2, settings: { items: [] } },
          { type: "notes", w: 2, h: 2, settings: { text: "", placeholder: "Write something…" } }
        ]
      };
      cfg.layout.forEach((it, i) => { it.id = "seed-" + i + "-" + Date.now().toString(36); });
      fs.mkdirSync(require("path").dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
      console.log("Created config with desktop mode enabled: " + p);
    ' "$CONFIG_FILE"
  fi
}

case "$MODE" in
  install)
    mkdir -p "$EXT_DEST"
    cp "$EXT_SRC/metadata.json" "$EXT_SRC/extension.js" "$EXT_SRC/stylesheet.css" "$EXT_DEST/"
    patch_metadata
    seed_config
    node "$PROJECT_DIR/scripts/extension-toggle.js" enable || true
    echo ""
    echo "Installed GNOME extension to: $EXT_DEST"
    MAJOR="$(detect_shell_major)"
    echo "Detected GNOME Shell: ${MAJOR:-unknown}"
    echo ""
    echo "NEXT STEP (one time only):"
    echo "  GNOME only scans new extensions at startup, so log out and log back in."
    echo "  After logging back in, your widgets will be live on the desktop."
    echo "  (If they are not visible, run: npm run extension:enable)"
    ;;
  uninstall)
    node "$PROJECT_DIR/scripts/extension-toggle.js" disable || true
    rm -rf "$EXT_DEST"
    echo "Extension removed. Log out and back in to fully unload it."
    ;;
  *)
    echo "Usage: $0 [install|uninstall]"
    exit 1
    ;;
esac
