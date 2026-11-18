#!/usr/bin/env bash
# Real-device QA harness for the "today" Android app.
# Runs only against the physical phone reached through ADB. No emulator fallback.
# Usage: ./qa.sh <command> [args]
#   fingerprint | env | install <apk> | launch | shot <name> | ui <name>
#   logstart <name> | logstop | perf <name> [secs] | smoke
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="today.fluently.app"

require_one_device() {
  local count
  count="$(adb devices | awk 'NR>1 && $2=="device"' | wc -l | tr -d ' ')"
  if [ "$count" -lt 1 ]; then echo "BLOCKED: no authorized ADB device"; exit 3; fi
  if [ "$count" -gt 1 ]; then echo "BLOCKED: multiple devices; export ANDROID_SERIAL"; exit 3; fi
  SERIAL="$(adb devices | awk 'NR>1 && $2=="device"{print $1}')"
  ADB=(adb -s "$SERIAL")
  echo "device: $SERIAL"
}

shot() {
  local name="$1"
  mkdir -p "$ROOT/screenshots"
  "${ADB[@]}" shell screencap -p /sdcard/qa-shot.png >/dev/null 2>&1
  "${ADB[@]}" pull /sdcard/qa-shot.png "$ROOT/screenshots/$name.png" >/dev/null 2>&1
  "${ADB[@]}" shell rm -f /sdcard/qa-shot.png >/dev/null 2>&1
  echo "screenshot: screenshots/$name.png ($(wc -c < "$ROOT/screenshots/$name.png") bytes)"
}

ui() {
  local name="$1"
  mkdir -p "$ROOT/logs"
  "${ADB[@]}" shell uiautomator dump /sdcard/qa-ui.xml >/dev/null 2>&1
  "${ADB[@]}" pull /sdcard/qa-ui.xml "$ROOT/logs/$name.xml" >/dev/null 2>&1
  echo "ui dump: logs/$name.xml"
}

logstart() {
  local name="$1"
  mkdir -p "$ROOT/logs"
  "${ADB[@]}" logcat -c 2>/dev/null
  echo "$name" > "$ROOT/logs/.logcat.name"
  echo "logcat cleared; capture will be dumped on logstop ($name)"
}

logstop() {
  local name="$(cat "$ROOT/logs/.logcat.name" 2>/dev/null || echo capture)"
  "${ADB[@]}" logcat -d -v threadtime > "$ROOT/logs/$name.logcat" 2>/dev/null
  rm -f "$ROOT/logs/.logcat.name"
  echo "logcat saved: logs/$name.logcat"
}

fingerprint() {
  local out="$ROOT/logs/device-fingerprint.txt"
  mkdir -p "$ROOT/logs"
  {
    echo "# fingerprint $(date -u +%Y-%m-%dT%H:%M:%SZ) serial=$SERIAL"
    adb version | head -2
    "${ADB[@]}" get-state
    for p in ro.product.manufacturer ro.product.brand ro.product.model ro.product.device ro.product.board ro.board.platform ro.hardware ro.product.cpu.abi ro.product.cpu.abilist ro.build.version.release ro.build.version.sdk ro.build.version.security_patch ro.build.fingerprint ro.build.version.incremental ro.build.display.id persist.sys.locale ro.hardware.egl ro.sf.lcd_density ro.opengles.version; do
      printf "%-34s = %s\n" "$p" "$("${ADB[@]}" shell getprop "$p" | tr -d "\r")"
    done
    echo "## memory"; "${ADB[@]}" shell cat /proc/meminfo | head -4
    echo "## storage"; "${ADB[@]}" shell df -h /data /system | head -5
    echo "## display"; "${ADB[@]}" shell wm size; "${ADB[@]}" shell wm density
    "${ADB[@]}" shell dumpsys display | grep -E "mRefreshRate|mDisplayMode|w= *[0-9]+, h=" | head -12
    echo "## battery"; "${ADB[@]}" shell dumpsys battery
    echo "## thermals"; "${ADB[@]}" shell dumpsys thermalservice 2>/dev/null | head -12
    echo "## sensors"; "${ADB[@]}" shell dumpsys sensorservice 2>/dev/null | sed -n "1,25p"
    echo "## network"; "${ADB[@]}" shell dumpsys connectivity 2>/dev/null | head -20
  } > "$out" 2>&1
  echo "fingerprint: logs/device-fingerprint.txt"
}

envstate() {
  local out="$ROOT/logs/device-env.txt"
  {
    echo "# env $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "## display state"; "${ADB[@]}" shell dumpsys window policy | grep -E "mShowingLockscreen|screenState|mAwake|interactive" | head -8
    echo "## keyboard"; "${ADB[@]}" shell dumpsys input_method | grep -E "mInputShown|mCurMethodId" | head -6
    echo "## locale"; "${ADB[@]}" shell settings get system system_locales
    echo "## font scale"; "${ADB[@]}" shell settings get system font_scale
    echo "## dark mode"; "${ADB[@]}" shell cmd uimode night
    echo "## nav mode"; "${ADB[@]}" shell cmd overlay list 2>/dev/null | grep -E "navigationbar" | head -5
    echo "## battery optimization"; "${ADB[@]}" shell dumpsys deviceidle whitelist 2>/dev/null | head -5
    echo "## package"; "${ADB[@]}" shell dumpsys package "$PKG" | grep -E "versionName|versionCode|firstInstallTime|lastUpdateTime" | head -6
  } > "$out" 2>&1
  echo "env: logs/device-env.txt"
}

install_apk() {
  local apk="$1"
  [ -f "$apk" ] || { echo "missing apk: $apk"; exit 4; }
  echo "installing $apk (preserve data; no uninstall, no clear)"
  "${ADB[@]}" install -r "$apk"
  "${ADB[@]}" shell dumpsys package "$PKG" | grep -E "versionName|versionCode" | head -3
}

launch() {
  "${ADB[@]}" shell am force-stop "$PKG" >/dev/null 2>&1
  sleep 1
  "${ADB[@]}" shell am start -W -n "$PKG/.MainActivity" | tee "$ROOT/logs/launch-timing.txt"
}

perf() {
  local name="$1"; local secs="${2:-10}"
  mkdir -p "$ROOT/logs"
  "${ADB[@]}" shell dumpsys meminfo "$PKG" > "$ROOT/logs/perf-$name-mem-before.txt" 2>&1
  "${ADB[@]}" shell top -b -n 1 -o PID,%CPU,RES,CMDLINE > "$ROOT/logs/perf-$name-top.txt" 2>&1
  sleep "$secs"
  "${ADB[@]}" shell dumpsys gfxinfo "$PKG" framestats > "$ROOT/logs/perf-$name-gfxinfo.txt" 2>&1
  "${ADB[@]}" shell dumpsys meminfo "$PKG" > "$ROOT/logs/perf-$name-mem-after.txt" 2>&1
  echo "perf: logs/perf-$name-*.txt"
}

smoke() {
  "${ADB[@]}" shell input keyevent KEYCODE_WAKEUP 2>/dev/null
  logstart smoke
  launch
  sleep 3; shot 01-launch
  sleep 2; shot 02-after-first-paint
  ui 01-launch
  envstate
  perf smoke 5
  logstop
  echo "smoke evidence captured"
}

case "${1:-}" in
  fingerprint) require_one_device; fingerprint ;;
  env) require_one_device; envstate ;;
  install) require_one_device; shift; install_apk "$@" ;;
  launch) require_one_device; launch ;;
  shot) require_one_device; shot "$2" ;;
  ui) require_one_device; ui "$2" ;;
  logstart) require_one_device; logstart "$2" ;;
  logstop) require_one_device; logstop ;;
  perf) require_one_device; perf "$2" "$3" ;;
  smoke) require_one_device; smoke ;;
  *) sed -n "1,7p" "$0" ;;
esac
