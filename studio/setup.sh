#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RULE=$(printf '\342\224\200%.0s' {1..52})

# ── Colors (same palette as startup_banner / install_python_stack) ──
if [ -n "${NO_COLOR:-}" ]; then
    C_TITLE= C_DIM= C_OK= C_WARN= C_ERR= C_RST=
elif [ -t 1 ] || [ -n "${FORCE_COLOR:-}" ]; then
    C_TITLE=$'\033[38;5;150m'
    C_DIM=$'\033[38;5;245m'
    C_OK=$'\033[38;5;108m'
    C_WARN=$'\033[38;5;136m'
    C_ERR=$'\033[91m'
    C_RST=$'\033[0m'
else
    C_TITLE= C_DIM= C_OK= C_WARN= C_ERR= C_RST=
fi

# ── Output helpers ──
# Consistent column layout: 2-space indent, 15-char label, then value.
# Usage: step <label> <message> [color]   (color defaults to C_OK)
step()    { printf "  ${C_DIM}%-15.15s${C_RST}${3:-$C_OK}%s${C_RST}\n" "$1" "$2"; }
substep() { printf "  ${C_DIM}%-15s%s${C_RST}\n" "" "$1"; }

_is_verbose() {
    [ "${UNSLOTH_VERBOSE:-0}" = "1" ]
}

verbose_substep() {
    if _is_verbose; then
        substep "$1"
    fi
    return 0
}

run_maybe_quiet() {
    if _is_verbose; then
        "$@"
    else
        "$@" > /dev/null 2>&1
    fi
}

# ── Helper: run command quietly, show output only on failure ──
_run_quiet() {
    local on_fail=$1
    local label=$2
    shift 2

    if _is_verbose; then
        local exit_code
        "$@" && return 0
        exit_code=$?
        step "error" "$label failed (exit code $exit_code)" "$C_ERR" >&2
        if [ "$on_fail" = "exit" ]; then
            exit "$exit_code"
        else
            return "$exit_code"
        fi
    fi

    local tmplog
    tmplog=$(mktemp) || {
        step "error" "Failed to create temporary file" "$C_ERR" >&2
        [ "$on_fail" = "exit" ] && exit 1 || return 1
    }

    if "$@" >"$tmplog" 2>&1; then
        rm -f "$tmplog"
        return 0
    else
        local exit_code=$?
        step "error" "$label failed (exit code $exit_code)" "$C_ERR" >&2
        cat "$tmplog" >&2
        rm -f "$tmplog"

        if [ "$on_fail" = "exit" ]; then
            exit "$exit_code"
        else
            return "$exit_code"
        fi
    fi
}

run_quiet() {
    _run_quiet exit "$@"
}

run_quiet_no_exit() {
    _run_quiet return "$@"
}

# ── Banner ──
echo ""
printf "  ${C_TITLE}%s${C_RST}\n" "🦥 Unsloth Studio Setup"
printf "  ${C_DIM}%s${C_RST}\n" "$RULE"
verbose_substep "verbose diagnostics enabled"
# ── Clean up stale caches ──
rm -rf "$REPO_ROOT/unsloth_compiled_cache"
rm -rf "$SCRIPT_DIR/backend/unsloth_compiled_cache"
rm -rf "$SCRIPT_DIR/tmp/unsloth_compiled_cache"

# ── Detect Colab ──
IS_COLAB=false
keynames=$'\n'$(printenv | cut -d= -f1)
if [[ "$keynames" == *$'\nCOLAB_'* ]]; then
    IS_COLAB=true
fi

# ── Detect whether frontend needs building ──
# Skip if SKIP_STUDIO_FRONTEND=1 (Tauri desktop app bundles its own frontend),
# or if dist/ exists AND no tracked input is newer than dist/.
if [ "${SKIP_STUDIO_FRONTEND:-0}" = "1" ]; then
    _NEED_FRONTEND_BUILD=false
    step "frontend" "bundled (Tauri)"
else
_NEED_FRONTEND_BUILD=true
if [ -d "$SCRIPT_DIR/frontend/dist" ]; then
    _changed=$(find "$SCRIPT_DIR/frontend" -maxdepth 1 -type f \
        ! -name 'bun.lock' \
        -newer "$SCRIPT_DIR/frontend/dist" -print -quit 2>/dev/null)
    if [ -z "$_changed" ]; then
        _changed=$(find "$SCRIPT_DIR/frontend/src" "$SCRIPT_DIR/frontend/public" \
            -type f -newer "$SCRIPT_DIR/frontend/dist" -print -quit 2>/dev/null) || true
    fi
    [ -z "$_changed" ] && _NEED_FRONTEND_BUILD=false
fi
fi  # end SKIP_STUDIO_FRONTEND guard

if [ "$_NEED_FRONTEND_BUILD" = false ]; then
    step "frontend" "up to date"
    verbose_substep "frontend dist is newer than source inputs"
else

# ── Node ──
NEED_NODE=true
if command -v node &>/dev/null && command -v npm &>/dev/null; then
    NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
    NODE_MINOR=$(node -v | sed 's/v//' | cut -d. -f2)
    NPM_MAJOR=$(npm -v | cut -d. -f1)
    # Vite 8 requires Node ^20.19.0 || >=22.12.0
    NODE_OK=false
    if [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -ge 19 ]; then NODE_OK=true; fi
    if [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -ge 12 ]; then NODE_OK=true; fi
    if [ "$NODE_MAJOR" -ge 23 ]; then NODE_OK=true; fi
    if [ "$NODE_OK" = true ] && [ "$NPM_MAJOR" -ge 11 ]; then
        NEED_NODE=false
    else
        if [ "$IS_COLAB" = true ] && [ "$NODE_OK" = true ]; then
            # In Colab, just upgrade npm directly - nvm doesn't work well
            if [ "$NPM_MAJOR" -lt 11 ]; then
                substep "upgrading npm..."
                run_maybe_quiet npm install -g npm@latest
            fi
            NEED_NODE=false
        fi
    fi
fi

if [ "$NEED_NODE" = true ]; then
    substep "installing nvm..."
    export NODE_OPTIONS=--dns-result-order=ipv4first
    if _is_verbose; then
        curl -so- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    else
        curl -so- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash > /dev/null 2>&1
    fi

    export NVM_DIR="$HOME/.nvm"
    set +u
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

    if [ -f "$HOME/.npmrc" ]; then
        if grep -qE '^\s*(prefix|globalconfig)\s*=' "$HOME/.npmrc"; then
            sed -i.bak '/^\s*\(prefix\|globalconfig\)\s*=/d' "$HOME/.npmrc"
        fi
    fi

    substep "installing Node LTS..."
    run_quiet "nvm install" nvm install --lts
    if _is_verbose; then
        nvm use --lts
    else
        nvm use --lts > /dev/null 2>&1
    fi
    set -u

    NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
    NPM_MAJOR=$(npm -v | cut -d. -f1)

    if [ "$NODE_MAJOR" -lt 20 ]; then
        step "node" "FAILED -- version must be >= 20 (got $(node -v))" "$C_ERR"
        exit 1
    fi
    if [ "$NPM_MAJOR" -lt 11 ]; then
        substep "upgrading npm..."
        run_quiet "npm update" npm install -g npm@latest
    fi
fi

step "node" "$(node -v) | npm $(npm -v)"
verbose_substep "node check: NEED_NODE=$NEED_NODE NODE_OK=${NODE_OK:-unknown} NPM_MAJOR=${NPM_MAJOR:-unknown}"

# ── Install bun (optional, faster package installs) ──
# Uses npm to install bun globally -- Node is already guaranteed above,
# avoids platform-specific installers, PATH issues, and admin requirements.
if ! command -v bun &>/dev/null; then
    substep "installing bun..."
    if run_maybe_quiet npm install -g bun && command -v bun &>/dev/null; then
        substep "bun installed ($(bun --version))"
    else
        substep "bun install skipped (npm will be used instead)"
    fi
else
    substep "bun already installed ($(bun --version))"
fi

# ── Build frontend ──
substep "building frontend..."
cd "$SCRIPT_DIR/frontend"
_HIDDEN_GITIGNORES=()
_dir="$(pwd)"
while [ "$_dir" != "/" ]; do
    _dir="$(dirname "$_dir")"
    if [ -f "$_dir/.gitignore" ] && grep -qx '\*' "$_dir/.gitignore" 2>/dev/null; then
        mv "$_dir/.gitignore" "$_dir/.gitignore._twbuild"
        _HIDDEN_GITIGNORES+=("$_dir/.gitignore")
    fi
done

_restore_gitignores() {
    for _gi in "${_HIDDEN_GITIGNORES[@]+"${_HIDDEN_GITIGNORES[@]}"}"; do
        mv "${_gi}._twbuild" "$_gi" 2>/dev/null || true
    done
}
trap _restore_gitignores EXIT

# Use bun for install if available (faster), fall back to npm.
# Build always uses npm (Node runtime -- avoids bun runtime issues on some platforms).
# NOTE: We intentionally avoid run_quiet for the bun install attempt because
# run_quiet calls exit on failure, which would kill the script before the npm
# fallback can run. Instead we capture output manually and only show it on failure.
#
# IMPORTANT: bun's package cache can become corrupt -- packages get stored
# with only metadata (package.json, README) but no actual content (bin/,
# lib/). When this happens bun install exits 0 but leaves binaries missing.
# We verify critical binaries after install. If missing, we clear the cache
# and retry once before falling back to npm.
_try_bun_install() {
    local _log _exit_code=0
    _log=$(mktemp)
    bun install >"$_log" 2>&1 || _exit_code=$?

    # bun may create .exe shims on Windows (Git Bash / MSYS2) instead of plain scripts
    if [ "$_exit_code" -eq 0 ] \
        && { [ -x node_modules/.bin/tsc ] || [ -f node_modules/.bin/tsc.exe ] || [ -f node_modules/.bin/tsc.bunx ]; } \
        && { [ -x node_modules/.bin/vite ] || [ -f node_modules/.bin/vite.exe ] || [ -f node_modules/.bin/vite.bunx ]; }; then
        rm -f "$_log"
        return 0
    fi

    # Either bun install failed or it exited 0 but left packages missing
    if [ "$_exit_code" -ne 0 ]; then
        echo "   bun install failed (exit code $_exit_code):"
    else
        echo "   bun install exited 0 but critical binaries are missing:"
    fi
    sed 's/^/   | /' "$_log" >&2
    rm -f "$_log"
    rm -rf node_modules
    return 1
}

_bun_install_ok=false
if command -v bun &>/dev/null; then
    substep "using bun for package install (faster)"
    if _try_bun_install; then
        _bun_install_ok=true
    else
        # First attempt failed, likely due to corrupt cache entries.
        # Clear the cache and retry once.
        echo "   Clearing bun cache and retrying..."
        run_maybe_quiet bun pm cache rm || true
        if _try_bun_install; then
            _bun_install_ok=true
        fi
    fi
fi
if [ "$_bun_install_ok" = false ]; then
    run_quiet_no_exit "npm install" npm install --no-fund --no-audit --loglevel=error
    _npm_install_rc=$?
    if [ "$_npm_install_rc" -ne 0 ]; then
        exit "$_npm_install_rc"
    fi
fi
run_quiet "npm run build" npm run build

_restore_gitignores
trap - EXIT

_MAX_CSS=$(find "$SCRIPT_DIR/frontend/dist/assets" -name '*.css' -exec wc -c {} + 2>/dev/null | sort -n | tail -1 | awk '{print $1}')
if [ -z "$_MAX_CSS" ]; then
    step "frontend" "built (warning: no CSS emitted)" "$C_WARN"
elif [ "$_MAX_CSS" -lt 100000 ]; then
    step "frontend" "built (warning: CSS may be truncated)" "$C_WARN"
else
    step "frontend" "built"
fi

cd "$SCRIPT_DIR"

fi  # end frontend build check

# ── oxc-validator runtime ──
if [ -d "$SCRIPT_DIR/backend/core/data_recipe/oxc-validator" ] && command -v npm &>/dev/null; then
    cd "$SCRIPT_DIR/backend/core/data_recipe/oxc-validator"
    run_quiet_no_exit "npm install (oxc validator runtime)" npm install --no-fund --no-audit --loglevel=error
    _oxc_install_rc=$?
    if [ "$_oxc_install_rc" -ne 0 ]; then
        exit "$_oxc_install_rc"
    fi
    cd "$SCRIPT_DIR"
fi

# ── Python venv + deps ──
STUDIO_HOME="$HOME/.unsloth/studio"
VENV_DIR="$STUDIO_HOME/unsloth_studio"
VENV_T5_530_DIR="$STUDIO_HOME/.venv_t5_530"
VENV_T5_550_DIR="$STUDIO_HOME/.venv_t5_550"

[ -d "$REPO_ROOT/.venv" ] && rm -rf "$REPO_ROOT/.venv"
[ -d "$REPO_ROOT/.venv_overlay" ] && rm -rf "$REPO_ROOT/.venv_overlay"
[ -d "$REPO_ROOT/.venv_t5" ] && rm -rf "$REPO_ROOT/.venv_t5"
[ -d "$REPO_ROOT/.venv_t5_530" ] && rm -rf "$REPO_ROOT/.venv_t5_530"
[ -d "$REPO_ROOT/.venv_t5_550" ] && rm -rf "$REPO_ROOT/.venv_t5_550"
# Note: do NOT delete $STUDIO_HOME/.venv here — install.sh handles migration

_COLAB_NO_VENV=false
if [ ! -x "$VENV_DIR/bin/python" ]; then
    if [ "$IS_COLAB" = true ]; then
        # On Colab there is no Studio venv -- install backend deps into system Python.
        # Strip all version constraints so pip keeps Colab's pre-installed
        # packages (huggingface-hub, datasets, transformers) and only pulls
        # in genuinely missing ones (structlog, fastapi, etc.).
        substep "Colab detected, installing Studio backend dependencies..."
        _COLAB_REQS_TMP="$(mktemp)"
        sed 's/[><=!~;].*//' "$SCRIPT_DIR/backend/requirements/studio.txt" \
            | grep -v '^#' | grep -v '^$' > "$_COLAB_REQS_TMP"
        if [ -s "$_COLAB_REQS_TMP" ]; then
            if ! run_quiet_no_exit "install Colab backend deps" pip install -q -r "$_COLAB_REQS_TMP"; then
                rm -f "$_COLAB_REQS_TMP"
                step "python" "Colab backend dependency install failed" "$C_ERR"
                exit 1
            fi
        else
            step "python" "no Colab backend dependencies resolved from requirements file" "$C_WARN"
        fi
        rm -f "$_COLAB_REQS_TMP"
        _COLAB_NO_VENV=true
    else
        step "python" "venv not found at $VENV_DIR" "$C_ERR"
        substep "Run install.sh first to create the environment:"
        substep "curl -fsSL https://unsloth.ai/install.sh | sh"
        exit 1
    fi
else
    source "$VENV_DIR/bin/activate"
fi

install_python_stack() {
    python "$SCRIPT_DIR/install_python_stack.py"
}

USE_UV=false
if command -v uv &>/dev/null; then
    USE_UV=true
elif {
    if _is_verbose; then
        curl -LsSf https://astral.sh/uv/install.sh | sh
    else
        curl -LsSf https://astral.sh/uv/install.sh | sh > /dev/null 2>&1
    fi
}; then
    export PATH="$HOME/.local/bin:$PATH"
    command -v uv &>/dev/null && USE_UV=true
fi

fast_install() {
    if [ "$USE_UV" = true ]; then
        uv pip install --python "$(command -v python)" "$@" && return 0
    fi
    python -m pip install "$@"
}

cd "$SCRIPT_DIR"

# On Colab without a venv, skip venv-dependent Python deps sections but
# run remaining Studio setup on system Python when no venv.
if [ "$_COLAB_NO_VENV" = true ]; then
    step "python" "backend deps installed into system Python"
    substep "continuing with Studio setup (system Python)"
fi

# ── Check if Python deps need updating ──
# Compare installed package version against PyPI latest.
# Skip all Python dependency work if versions match (fast update path).
# On Colab (no venv), skip this version check (it needs $VENV_DIR/bin/python)
# but still run install_python_stack below (it uses sys.executable).
_SKIP_PYTHON_DEPS=false
_SKIP_VERSION_CHECK=false
if [ "$_COLAB_NO_VENV" = true ]; then
    _SKIP_VERSION_CHECK=true
fi
_PKG_NAME="${STUDIO_PACKAGE_NAME:-unsloth}"
if [ "$_SKIP_VERSION_CHECK" != true ] && [ "${SKIP_STUDIO_BASE:-0}" != "1" ] && [ "${STUDIO_LOCAL_INSTALL:-0}" != "1" ]; then
    # Only check when NOT called from install.sh (which just installed the package)
    INSTALLED_VER=$("$VENV_DIR/bin/python" -c "
import sys; from importlib.metadata import version
print(version(sys.argv[1]))
" "$_PKG_NAME" 2>/dev/null || echo "")

    LATEST_VER=$(curl -fsSL --max-time 5 "https://pypi.org/pypi/$_PKG_NAME/json" 2>/dev/null \
        | "$VENV_DIR/bin/python" -c "import sys,json; print(json.load(sys.stdin)['info']['version'])" 2>/dev/null \
        || echo "")

    if [ -n "$INSTALLED_VER" ] && [ -n "$LATEST_VER" ] && [ "$INSTALLED_VER" = "$LATEST_VER" ]; then
        step "python" "$_PKG_NAME $INSTALLED_VER is up to date"
        _SKIP_PYTHON_DEPS=true
    elif [ -n "$INSTALLED_VER" ] && [ -n "$LATEST_VER" ]; then
        substep "$_PKG_NAME $INSTALLED_VER -> $LATEST_VER available, updating..."
    elif [ -z "$LATEST_VER" ]; then
        substep "could not reach PyPI, updating to be safe..."
    fi
fi

if [ "$_SKIP_PYTHON_DEPS" = false ]; then
    install_python_stack
else
    step "python" "dependencies up to date"
    verbose_substep "python deps check: installed=$_PKG_NAME@${INSTALLED_VER:-unknown} latest=${LATEST_VER:-unknown}"
fi

# ── 6b. Pre-install transformers 5.x into .venv_t5_530/ and .venv_t5_550/ ──
# Models like GLM-4.7-Flash, Qwen3 MoE need transformers>=5.3.0.
# Gemma 4 models need transformers>=5.5.0.
# Pre-install into separate directories to avoid runtime pip overhead.
# The training subprocess prepends the appropriate dir to sys.path.
#
# Runs outside the _SKIP_PYTHON_DEPS gate so that upgrades from legacy
# single .venv_t5 are always migrated to the tiered layout.
_NEED_T5_INSTALL=false
if [ -d "$STUDIO_HOME/.venv_t5" ]; then
    # Legacy layout — migrate
    rm -rf "$STUDIO_HOME/.venv_t5"
    _NEED_T5_INSTALL=true
fi
[ ! -d "$VENV_T5_530_DIR" ] && _NEED_T5_INSTALL=true
[ ! -d "$VENV_T5_550_DIR" ] && _NEED_T5_INSTALL=true
# Also reinstall when python deps were updated (packages may need rebuild)
[ "$_SKIP_PYTHON_DEPS" = false ] && _NEED_T5_INSTALL=true

if [ "$_NEED_T5_INSTALL" = true ]; then
    [ -d "$VENV_T5_530_DIR" ] && rm -rf "$VENV_T5_530_DIR"
    mkdir -p "$VENV_T5_530_DIR"
    run_quiet "install transformers 5.3.0" fast_install --target "$VENV_T5_530_DIR" --no-deps "transformers==5.3.0"
    run_quiet "install huggingface_hub for t5_530" fast_install --target "$VENV_T5_530_DIR" --no-deps "huggingface_hub==1.8.0"
    run_quiet "install hf_xet for t5_530" fast_install --target "$VENV_T5_530_DIR" --no-deps "hf_xet==1.4.2"
    run_quiet "install tiktoken for t5_530" fast_install --target "$VENV_T5_530_DIR" "tiktoken"
    step "transformers" "5.3.0 pre-installed"

    [ -d "$VENV_T5_550_DIR" ] && rm -rf "$VENV_T5_550_DIR"
    mkdir -p "$VENV_T5_550_DIR"
    run_quiet "install transformers 5.5.0" fast_install --target "$VENV_T5_550_DIR" --no-deps "transformers==5.5.0"
    run_quiet "install huggingface_hub for t5_550" fast_install --target "$VENV_T5_550_DIR" --no-deps "huggingface_hub==1.8.0"
    run_quiet "install hf_xet for t5_550" fast_install --target "$VENV_T5_550_DIR" --no-deps "hf_xet==1.4.2"
    run_quiet "install tiktoken for t5_550" fast_install --target "$VENV_T5_550_DIR" "tiktoken"
    step "transformers" "5.5.0 pre-installed"
fi


# ── Footer ──
echo ""
printf "  ${C_DIM}%s${C_RST}\n" "$RULE"
if [ "$IS_COLAB" = true ]; then
    if [ "$_COLAB_NO_VENV" = true ]; then
        printf "  ${C_TITLE}%s${C_RST}\n" "Unsloth Studio Setup Complete"
    else
        printf "  ${C_TITLE}%s${C_RST}\n" "Unsloth Studio Installed"
    fi
    printf "  ${C_DIM}%s${C_RST}\n" "$RULE"
    substep "from colab import start"
    substep "start()"
else
    printf "  ${C_TITLE}%s${C_RST}\n" "Unsloth Studio Installed"
    printf "  ${C_DIM}%s${C_RST}\n" "$RULE"
    printf "  ${C_DIM}%-15s${C_OK}%s${C_RST}\n" "launch" "unsloth studio -H 0.0.0.0 -p 8888"
fi
echo ""
