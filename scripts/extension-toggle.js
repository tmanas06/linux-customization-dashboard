#!/usr/bin/env node
const { execSync } = require('child_process');

const ID = 'linux-dashboard@manas';
const mode = process.argv[2];

function getEnabled() {
  try {
    let out = execSync('gsettings get org.gnome.shell enabled-extensions').toString().trim();
    if (out === '@as []') out = '[]';
    return JSON.parse(out.replace(/'/g, '"'));
  } catch {
    return [];
  }
}

function setEnabled(arr) {
  const variant = JSON.stringify(arr).replace(/"/g, "'");
  execSync(`gsettings set org.gnome.shell enabled-extensions "${variant}"`);
}

function shellTry(cmd) {
  try {
    return execSync(cmd).toString().trim();
  } catch {
    return null;
  }
}

if (mode === 'enable') {
  const list = getEnabled();
  if (!list.includes(ID)) list.push(ID);
  setEnabled(list);
  shellTry(`gnome-extensions enable ${ID}`);
  const state = shellTry(`gnome-extensions info ${ID}`);
  console.log(state || 'Enabled in GNOME settings.');
} else if (mode === 'disable') {
  setEnabled(getEnabled().filter((x) => x !== ID));
  shellTry(`gnome-extensions disable ${ID}`);
  console.log('Extension disabled.');
} else {
  console.error('Usage: extension-toggle.js [enable|disable]');
  process.exit(1);
}
