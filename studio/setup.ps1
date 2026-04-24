#Requires -Version 5.1
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0
<#
.SYNOPSIS
    Full environment setup for Unsloth Studio on Windows (bundled version).
.DESCRIPTION
    Always installs Node.js if needed. When running from pip install:
    skips frontend build (already bundled). When running from git repo:
    full setup including frontend build.
    Supports NVIDIA GPU (full training) and CPU-only development.
.NOTES
    Default output is minimal (step/substep), aligned with studio/setup.sh.

    FULL / LEGACY LOGGING (defensible audit trail, detailed multi-line output):
      unsloth studio setup --verbose
      Or:  $env:UNSLOTH_VERBOSE='1'; powershell -File .\studio\setup.ps1
      Or:  .\setup.ps1 --verbose
#>

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PackageDir = Split-Path -Parent $ScriptDir

# Verbose can be enabled either by CLI flag or by UNSLOTH_VERBOSE=1.
$script:UnslothVerbose = ($env:UNSLOTH_VERBOSE -eq '1')
foreach ($a in $args) {
    if ($a -eq '--verbose' -or $a -eq '-v') {
        $script:UnslothVerbose = $true
        break
    }
}
# Propagate to child processes (e.g. install_python_stack.py) so they
# also respect verbose mode. Process-scoped -- does not persist.
if ($script:UnslothVerbose) {
    $env:UNSLOTH_VERBOSE = '1'
}
# Detect if running from pip install (no frontend/ dir in studio)
$FrontendDir = Join-Path $ScriptDir "frontend"
$OxcValidatorDir = Join-Path $ScriptDir "backend\core\data_recipe\oxc-validator"
$IsPipInstall = -not (Test-Path $FrontendDir)

# ─────────────────────────────────────────────
# Helper functions
# ─────────────────────────────────────────────

# Reload ALL environment variables from registry.
# Picks up changes made by installers (winget, msi, etc.) including
# Path, CUDA_PATH, CUDA_PATH_V*, and any other vars they set.
function Refresh-Environment {
    foreach ($level in @('Machine', 'User')) {
        $vars = [System.Environment]::GetEnvironmentVariables($level)
        foreach ($key in $vars.Keys) {
            if ($key -eq 'Path') { continue }
            Set-Item -Path "Env:$key" -Value $vars[$key] -ErrorAction SilentlyContinue
        }
    }
    $machinePath = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    # Merge: venv Scripts (if active) > Machine > User > current $env:Path. Dedup raw+expanded.
    $venvScripts = if ($env:VIRTUAL_ENV) { Join-Path $env:VIRTUAL_ENV 'Scripts' } else { $null }
    $sources = @()
    if ($venvScripts) { $sources += $venvScripts }
    $sources += @($machinePath, $userPath, $env:Path)
    $merged = ($sources | Where-Object { $_ }) -join ';'
    $seen = @{}
    $unique = New-Object System.Collections.Generic.List[string]
    foreach ($p in $merged -split ";") {
        $rawKey = $p.Trim().Trim('"').TrimEnd("\").ToLowerInvariant()
        $expKey = [Environment]::ExpandEnvironmentVariables($p).Trim().Trim('"').TrimEnd("\").ToLowerInvariant()
        if ($rawKey -and -not $seen.ContainsKey($rawKey) -and -not $seen.ContainsKey($expKey)) {
            $seen[$rawKey] = $true
            if ($expKey -and $expKey -ne $rawKey) { $seen[$expKey] = $true }
            $unique.Add($p)
        }
    }
    $env:Path = $unique -join ";"
}

# ── Helper: safely add a directory to the persistent User PATH ──
# Direct registry access preserves REG_EXPAND_SZ (avoids dotnet/runtime#1442).
# Append (default) keeps existing tools first; Prepend for must-win entries.
function Add-ToUserPath {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [ValidateSet('Append','Prepend')]
        [string]$Position = 'Append'
    )
    try {
        $regKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
        try {
            $rawPath = $regKey.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
            [string[]]$entries = if ($rawPath) { $rawPath -split ';' } else { @() } # string[] prevents scalar collapse
            $normalDir = $Directory.Trim().Trim('"').TrimEnd('\').ToLowerInvariant()
            $expNormalDir = [Environment]::ExpandEnvironmentVariables($Directory).Trim().Trim('"').TrimEnd('\').ToLowerInvariant()
            $kept = New-Object System.Collections.Generic.List[string]
            $matchIndices = New-Object System.Collections.Generic.List[int]
            for ($i = 0; $i -lt $entries.Count; $i++) {
                $stripped = $entries[$i].Trim().Trim('"')
                $rawNorm = $stripped.TrimEnd('\').ToLowerInvariant()
                $expNorm = [Environment]::ExpandEnvironmentVariables($stripped).TrimEnd('\').ToLowerInvariant()
                $isMatch = ($rawNorm -and ($rawNorm -eq $normalDir -or $rawNorm -eq $expNormalDir)) -or
                           ($expNorm -and ($expNorm -eq $normalDir -or $expNorm -eq $expNormalDir))
                if ($isMatch) {
                    $matchIndices.Add($i)
                    continue
                }
                $kept.Add($entries[$i])
            }
            $alreadyPresent = $matchIndices.Count -gt 0
            if ($alreadyPresent -and $Position -eq 'Append') { # Append: idempotent no-op
                return $false
            }
            if ($alreadyPresent -and $Position -eq 'Prepend' -and # Prepend: no-op if already at front
                $matchIndices.Count -eq 1 -and $matchIndices[0] -eq 0) {
                return $false
            }
            # One-time backup under HKCU\Software\Unsloth\PathBackup
            if ($rawPath) {
                try {
                    $backupKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Unsloth')
                    try {
                        $existingBackup = $backupKey.GetValue('PathBackup', $null)
                        if (-not $existingBackup) {
                            $backupKey.SetValue('PathBackup', $rawPath, [Microsoft.Win32.RegistryValueKind]::ExpandString)
                        }
                    } finally {
                        $backupKey.Close()
                    }
                } catch { }
            }
            if (-not $rawPath) {
                Write-Host "[WARN] User PATH is empty - initializing with $Directory" -ForegroundColor Yellow
            }
            $newPath = if ($rawPath) {
                if ($Position -eq 'Prepend') {
                    (@($Directory) + $kept) -join ';'
                } else {
                    ($kept + @($Directory)) -join ';'
                }
            } else {
                $Directory
            }
            if ($newPath -ceq $rawPath) { # no actual change
                return $false
            }
            $regKey.SetValue('Path', $newPath, [Microsoft.Win32.RegistryValueKind]::ExpandString)
            # Broadcast WM_SETTINGCHANGE via dummy env-var roundtrip.
            # [NullString]::Value avoids PS 7.5+/.NET 9 $null-to-"" coercion.
            try {
                $d = "UnslothPathRefresh_$([guid]::NewGuid().ToString('N').Substring(0,8))"
                [Environment]::SetEnvironmentVariable($d, '1', 'User')
                [Environment]::SetEnvironmentVariable($d, [NullString]::Value, 'User')
            } catch { }
            return $true
        } finally {
            $regKey.Close()
        }
    } catch {
        Write-Host "[WARN] Could not update User PATH: $($_.Exception.Message)" -ForegroundColor Yellow
        return $false
    }
}

# PowerShell 5.1 compatibility helper: avoid relying on New-TemporaryFile.
function New-UnslothTemporaryFile {
    $tempPath = [System.IO.Path]::GetTempFileName()
    return Get-Item -LiteralPath $tempPath
}

function Invoke-SetupCommand {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Command,
        [switch]$AlwaysQuiet
    )
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        # Reset to avoid stale values from prior native commands.
        $global:LASTEXITCODE = 0
        if ($script:UnslothVerbose -and -not $AlwaysQuiet) {
            # Merge stderr into stdout so progress/warning output stays visible
            # without flipping $? on successful native commands (PS 5.1 treats
            # stderr records as errors that set $? = $false even on exit code 0).
            & $Command 2>&1 | Out-Host
        } else {
            $output = & $Command 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0) {
                Write-Host $output -ForegroundColor Red
            }
        }
        return [int]$LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEap
    }
}

function step {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$Value,
        [string]$Color = "Green"
    )
    if ($script:StudioVtOk -and -not $env:NO_COLOR) {
        $dim = Get-StudioAnsi Dim
        $rst = Get-StudioAnsi Reset
        $val = switch ($Color) {
            'Green' { Get-StudioAnsi Ok }
            'Yellow' { Get-StudioAnsi Warn }
            'Red' { Get-StudioAnsi Err }
            'DarkGray' { Get-StudioAnsi Dim }
            default { Get-StudioAnsi Ok }
        }
        $padded = if ($Label.Length -ge 15) { $Label.Substring(0, 15) } else { $Label.PadRight(15) }
        Write-Host ("  {0}{1}{2}{3}{4}{2}" -f $dim, $padded, $rst, $val, $Value)
    } else {
        $padded = if ($Label.Length -ge 15) { $Label.Substring(0, 15) } else { $Label.PadRight(15) }
        Write-Host ("  {0}" -f $padded) -NoNewline -ForegroundColor DarkGray
        $fc = switch ($Color) {
            'Green' { 'DarkGreen' }
            'Yellow' { 'Yellow' }
            'Red' { 'Red' }
            'DarkGray' { 'DarkGray' }
            default { 'DarkGreen' }
        }
        Write-Host $Value -ForegroundColor $fc
    }
}

function substep {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [string]$Color = "DarkGray"
    )
    if ($script:StudioVtOk -and -not $env:NO_COLOR) {
        $msgCol = switch ($Color) {
            'Yellow' { (Get-StudioAnsi Warn) }
            default { (Get-StudioAnsi Dim) }
        }
        $pad = "".PadRight(15)
        Write-Host ("  {0}{1}{2}{3}" -f $msgCol, $pad, $Message, (Get-StudioAnsi Reset))
    } else {
        $fc = switch ($Color) {
            'Yellow' { 'Yellow' }
            default { 'DarkGray' }
        }
        Write-Host ("  {0,-15}{1}" -f "", $Message) -ForegroundColor $fc
    }
}

# ─────────────────────────────────────────────
# Banner
# ─────────────────────────────────────────────
Write-Host ""
if ($script:StudioVtOk -and -not $env:NO_COLOR) {
    Write-Host ("  " + (Get-StudioAnsi Title) + [char]::ConvertFromUtf32(0x1F9A5) + " Unsloth Studio Setup" + (Get-StudioAnsi Reset))
    Write-Host ("  {0}{1}{2}" -f (Get-StudioAnsi Dim), $Rule, (Get-StudioAnsi Reset))
} else {
    Write-Host ("  " + [char]::ConvertFromUtf32(0x1F9A5) + " Unsloth Studio Setup") -ForegroundColor Green
    Write-Host "  $Rule" -ForegroundColor DarkGray
}

# Back up User PATH under HKCU\Software\Unsloth before any modifications.
try {
    $envKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $false)
    if ($envKey) {
        try {
            $rawPath = $envKey.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        } finally {
            $envKey.Close()
        }
        if ($rawPath) {
            $backupKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Unsloth')
            try {
                $existingBackup = $backupKey.GetValue('PathBackup', $null)
                if (-not $existingBackup) {
                    $backupKey.SetValue('PathBackup', $rawPath, [Microsoft.Win32.RegistryValueKind]::ExpandString)
                }
            } finally {
                $backupKey.Close()
            }
        }
    }
} catch {
    Write-Host "[DEBUG] Could not back up User PATH: $($_.Exception.Message)" -ForegroundColor DarkGray
}

# ==========================================================================
#  PHASE 1: System-level prerequisites (winget installs, env vars)
#  All heavy system tool installs happen here BEFORE touching Python.
# ==========================================================================

# ============================================
# 1a. GPU detection
# ============================================
$HasNvidiaSmi = $false
$NvidiaSmiExe = $null  # Absolute path -- survives Refresh-Environment
try {
    $nvSmiCmd = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if ($nvSmiCmd) {
        & $nvSmiCmd.Source *> $null
        if ($LASTEXITCODE -eq 0) {
            $HasNvidiaSmi = $true
            $NvidiaSmiExe = $nvSmiCmd.Source
        }
    }
} catch {}
# Fallback: nvidia-smi may not be on PATH even though a GPU + driver exist.
# Check the default install location and the Windows driver store.
if (-not $HasNvidiaSmi) {
    $nvSmiDefaults = @(
        "$env:ProgramFiles\NVIDIA Corporation\NVSMI\nvidia-smi.exe",
        "$env:SystemRoot\System32\nvidia-smi.exe"
    )
    foreach ($p in $nvSmiDefaults) {
        if (Test-Path $p) {
            try {
                & $p *> $null
                if ($LASTEXITCODE -eq 0) {
                    $HasNvidiaSmi = $true
                    $NvidiaSmiExe = $p
                    Write-Host "   Found nvidia-smi at $(Split-Path $p -Parent)" -ForegroundColor Gray
                    break
                }
            } catch {}
        }
    }
}
if (-not $HasNvidiaSmi) {
    Write-Host ""
    step "gpu" "none (CPU-only for training / Studio GPU path)" "Yellow"
    substep "Training and local GPU features require an NVIDIA GPU with drivers installed." "Yellow"
    Write-Host ""
} else {
    step "gpu" "NVIDIA GPU detected"
}

# ============================================
# 1a.5. Windows Long Paths (required for deep node_modules / Python paths)
# ============================================
$LongPathsEnabled = $false
try {
    $regVal = Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -ErrorAction SilentlyContinue
    if ($regVal -and $regVal.LongPathsEnabled -eq 1) {
        $LongPathsEnabled = $true
    }
} catch {}

if ($LongPathsEnabled) {
    step "long paths" "enabled"
} else {
    Write-Host "Windows Long Paths not enabled (required for Triton compilation and deep dependency paths)." -ForegroundColor Yellow
    Write-Host "   Requesting admin access to fix..." -ForegroundColor Yellow
    try {
        # Spawn an elevated process to set the registry key (triggers UAC prompt)
        $proc = Start-Process -FilePath "reg.exe" `
            -ArgumentList 'add "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f' `
            -Verb RunAs -Wait -PassThru -ErrorAction Stop
        if ($proc.ExitCode -eq 0) {
            $LongPathsEnabled = $true
            step "long paths" "enabled (via UAC)"
        } else {
            step "long paths" "failed to enable (exit code: $($proc.ExitCode))" "Yellow"
        }
    } catch {
        step "long paths" "could not enable (UAC declined/unavailable)" "Yellow"
        Write-Host "       Run this manually in an Admin terminal:" -ForegroundColor Yellow
        Write-Host '       reg add "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f' -ForegroundColor Cyan
    }
}

# ============================================
# 1b. Git (required by pip for git+https:// deps and by npm)
# ============================================
$HasGit = $null -ne (Get-Command git -ErrorAction SilentlyContinue)
if (-not $HasGit) {
    Write-Host "Git not found -- installing via winget..." -ForegroundColor Yellow
    $HasWinget = $null -ne (Get-Command winget -ErrorAction SilentlyContinue)
    if ($HasWinget) {
        try {
            Invoke-SetupCommand { winget install Git.Git --source winget --accept-package-agreements --accept-source-agreements } | Out-Null
            Refresh-Environment
            $HasGit = $null -ne (Get-Command git -ErrorAction SilentlyContinue)
        } catch { }
    }
    if (-not $HasGit) {
        Write-Host "[ERROR] Git is required but could not be installed automatically." -ForegroundColor Red
        Write-Host "        Install Git from https://git-scm.com/download/win and re-run." -ForegroundColor Red
        exit 1
    }
    step "git" "$(git --version)"
} else {
    step "git" "$(git --version)"
}

# ============================================
# 1f. Node.js / npm (skip if pip-installed or Tauri -- only needed for frontend build)
# ============================================
$SkipFrontend = ($env:SKIP_STUDIO_FRONTEND -eq "1")
if ($IsPipInstall) {
    step "frontend" "bundled (pip install)"
} elseif ($SkipFrontend) {
    step "frontend" "bundled (Tauri)"
} else {
    # setup.sh installs Node LTS (v22) via nvm. We enforce the same range here:
    # Vite 8 requires Node ^20.19.0 || >=22.12.0, npm >= 11.
    $NeedNode = $true
    try {
        $NodeVersion = (node -v 2>$null)
        $NpmVersion = (npm -v 2>$null)
        if ($NodeVersion -and $NpmVersion) {
            $NodeParts = ($NodeVersion -replace 'v','').Split('.')
            $NodeMajor = [int]$NodeParts[0]
            $NodeMinor = [int]$NodeParts[1]
            $NpmMajor = [int]$NpmVersion.Split('.')[0]

            # Vite 8: ^20.19.0 || >=22.12.0
            $NodeOk = ($NodeMajor -eq 20 -and $NodeMinor -ge 19) -or
                      ($NodeMajor -eq 22 -and $NodeMinor -ge 12) -or
                      ($NodeMajor -ge 23)
            if ($NodeOk -and $NpmMajor -ge 11) {
                substep "Node $NodeVersion and npm $NpmVersion already meet requirements."
                $NeedNode = $false
            } else {
                substep "Node $NodeVersion / npm $NpmVersion too old." "Yellow"
            }
        }
    } catch {
        substep "Node/npm not found." "Yellow"
    }

    if ($NeedNode) {
        substep "installing Node.js LTS via winget..."
        try {
            winget install OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements
            Refresh-Environment
        } catch {
            Write-Host "[ERROR] Could not install Node.js automatically." -ForegroundColor Red
            Write-Host "Please install Node.js >= 20 from https://nodejs.org/" -ForegroundColor Red
            exit 1
        }
    }

    step "node" "$(node -v) | npm $(npm -v)"

    # ── bun (optional, faster package installs) ──
    # Installed via npm — Node is already guaranteed above. Works on all platforms.
    if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
        substep "installing bun (faster frontend package installs)..."
        $prevEAP_bun = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        Invoke-SetupCommand { npm install -g bun } | Out-Null
        $ErrorActionPreference = $prevEAP_bun
        Refresh-Environment
        if (Get-Command bun -ErrorAction SilentlyContinue) {
            substep "bun installed ($(bun --version))"
        } else {
            substep "bun install skipped (npm will be used instead)"
        }
    } else {
        substep "bun already installed ($(bun --version))"
    }
}

# ============================================
# 1g. Python (>= 3.11 and < 3.14, matching setup.sh)
# ============================================
$HasPython = $null -ne (Get-Command python -ErrorAction SilentlyContinue)
$PythonOk = $false

if ($HasPython) {
    $PyVer = python --version 2>&1
    if ($PyVer -match "(\d+)\.(\d+)") {
        $PyMajor = [int]$Matches[1]; $PyMinor = [int]$Matches[2]
        if ($PyMajor -eq 3 -and $PyMinor -ge 11 -and $PyMinor -lt 14) {
            substep "Python $PyVer"
            $PythonOk = $true
        } else {
            Write-Host "[ERROR] Python $PyVer is outside supported range (need >= 3.11 and < 3.14)." -ForegroundColor Red
            Write-Host "        Install Python 3.12 from https://python.org/downloads/" -ForegroundColor Yellow
            exit 1
        }
    }
} else {
    # No Python at all -- install 3.12
    Write-Host "Python not found -- installing Python 3.12 via winget..." -ForegroundColor Yellow
    $HasWinget = $null -ne (Get-Command winget -ErrorAction SilentlyContinue)
    if ($HasWinget) {
        winget install -e --id Python.Python.3.12 --source winget --accept-package-agreements --accept-source-agreements
        Refresh-Environment
    }
    $HasPython = $null -ne (Get-Command python -ErrorAction SilentlyContinue)
    if (-not $HasPython) {
        Write-Host "[ERROR] Python could not be installed automatically." -ForegroundColor Red
        Write-Host "        Install Python 3.12 from https://python.org/downloads/" -ForegroundColor Yellow
        exit 1
    }
    step "python" "$(python --version 2>&1)"
    $PythonOk = $true
}

# Add user-scheme Python Scripts dir to PATH (nt_user only, no venv fallback).
$ScriptsDir = python -c "import os, sysconfig; p = sysconfig.get_path('scripts', 'nt_user'); print(p if os.path.exists(p) else '')"
if ($LASTEXITCODE -eq 0 -and $ScriptsDir -and (Test-Path $ScriptsDir)) {
    # Append (not Prepend) -- this dir has other pip scripts; shim handles unsloth.
    if (Add-ToUserPath -Directory $ScriptsDir) {
        # Also add to current process so it's available immediately
        $ProcessPathEntries = $env:PATH.Split(';')
        if (-not ($ProcessPathEntries | Where-Object { $_.TrimEnd('\') -eq $ScriptsDir })) {
            $env:PATH = "$ScriptsDir;$env:PATH"
        }
        substep "Persisted Python Scripts dir to user PATH: $ScriptsDir"
    }
}

Write-Host ""
step "system" "prerequisites ready"
Write-Host ""

# ==========================================================================
#  PHASE 2: Frontend build (skip if pip-installed -- already bundled)
# ==========================================================================
$DistDir = Join-Path $FrontendDir "dist"
# Skip build if dist/ exists and no tracked input is newer than dist/.
# Checks src/, public/, package.json, config files -- not just src/.
$NeedFrontendBuild = $true
if ($IsPipInstall) {
    $NeedFrontendBuild = $false
    step "frontend" "bundled (pip install)"
} elseif ($SkipFrontend) {
    $NeedFrontendBuild = $false
    step "frontend" "bundled (Tauri)"
} elseif (Test-Path $DistDir) {
    $DistTime = (Get-Item $DistDir).LastWriteTime
    $NewerFile = $null
    # Check src/ and public/ recursively (probe paths directly, not via -Include)
    foreach ($subDir in @("src", "public")) {
        $subPath = Join-Path $FrontendDir $subDir
        if (Test-Path $subPath) {
            $NewerFile = Get-ChildItem -Path $subPath -Recurse -File -ErrorAction SilentlyContinue |
                Where-Object { $_.LastWriteTime -gt $DistTime } | Select-Object -First 1
            if ($NewerFile) { break }
        }
    }
    # Also check all top-level files (package.json, vite.config.ts, index.html, etc.)
    if (-not $NewerFile) {
        $NewerFile = Get-ChildItem -Path $FrontendDir -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -ne "bun.lock" -and $_.LastWriteTime -gt $DistTime } |
            Select-Object -First 1
    }
    if (-not $NewerFile) {
        $NeedFrontendBuild = $false
        step "frontend" "up to date"
    } else {
        substep "Frontend source changed since last build -- rebuilding..." "Yellow"
    }
}
if ($NeedFrontendBuild -and -not $IsPipInstall) {
    Write-Host ""
    substep "building frontend..."

    # ── Tailwind v4 .gitignore workaround ──
    # Tailwind v4's oxide scanner respects .gitignore in parent directories.
    # Python venvs create a .gitignore with "*" (ignore everything), which
    # prevents Tailwind from scanning .tsx source files for class names.
    # Temporarily hide any such .gitignore during the build, then restore it.
    $HiddenGitignores = @()
    $WalkDir = (Get-Item $FrontendDir).Parent.FullName
    while ($WalkDir -and $WalkDir -ne [System.IO.Path]::GetPathRoot($WalkDir)) {
        $gi = Join-Path $WalkDir ".gitignore"
        if (Test-Path $gi) {
            $content = Get-Content $gi -Raw -ErrorAction SilentlyContinue
            if ($content -and ($content.Trim() -match '^\*$')) {
                $hidden = "$gi._twbuild"
                Rename-Item -Path $gi -NewName (Split-Path $hidden -Leaf) -Force
                $HiddenGitignores += $gi
                substep "Temporarily hiding $gi (venv .gitignore blocks Tailwind scanner)"
            }
        }
        $WalkDir = Split-Path $WalkDir -Parent
    }

    # Use bun if available (faster install), fall back to npm.
    # Bun is used only as package manager; Node runs the actual build (Vite 8).
    $prevEAP_npm = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    Push-Location $FrontendDir

    $UseBun = $null -ne (Get-Command bun -ErrorAction SilentlyContinue)

    # bun's package cache can become corrupt -- packages get stored with only
    # metadata but no actual content (bin/, lib/). When this happens bun install
    # exits 0 but leaves binaries missing. We validate after install and clear
    # the cache + retry once before falling back to npm.
    if ($UseBun) {
        Write-Host "   Using bun for package install (faster)" -ForegroundColor DarkGray
        $bunExit = Invoke-SetupCommand { bun install }
        # On Windows, .bin/ entries vary by package manager:
        #   npm  → tsc, tsc.cmd, tsc.ps1
        #   bun  → tsc.exe, tsc.bunx
        $hasTsc = (Test-Path "node_modules\.bin\tsc") -or (Test-Path "node_modules\.bin\tsc.cmd") -or (Test-Path "node_modules\.bin\tsc.exe") -or (Test-Path "node_modules\.bin\tsc.bunx")
        $hasVite = (Test-Path "node_modules\.bin\vite") -or (Test-Path "node_modules\.bin\vite.cmd") -or (Test-Path "node_modules\.bin\vite.exe") -or (Test-Path "node_modules\.bin\vite.bunx")
        if ($bunExit -eq 0 -and $hasTsc -and $hasVite) {
            # bun install succeeded and critical binaries are present
        } elseif ($bunExit -eq 0) {
            Write-Host "   bun install exited 0 but critical binaries are missing, clearing cache and retrying..." -ForegroundColor Yellow
            if (Test-Path "node_modules") {
                Remove-Item "node_modules" -Recurse -Force -ErrorAction SilentlyContinue
            }
            Invoke-SetupCommand { bun pm cache rm } | Out-Null
            $bunExit = Invoke-SetupCommand { bun install }
            $hasTsc = (Test-Path "node_modules\.bin\tsc") -or (Test-Path "node_modules\.bin\tsc.cmd") -or (Test-Path "node_modules\.bin\tsc.exe") -or (Test-Path "node_modules\.bin\tsc.bunx")
            $hasVite = (Test-Path "node_modules\.bin\vite") -or (Test-Path "node_modules\.bin\vite.cmd") -or (Test-Path "node_modules\.bin\vite.exe") -or (Test-Path "node_modules\.bin\vite.bunx")
            if ($bunExit -ne 0 -or -not $hasTsc -or -not $hasVite) {
                Write-Host "   bun retry failed, falling back to npm" -ForegroundColor Yellow
                if (Test-Path "node_modules") {
                    Remove-Item "node_modules" -Recurse -Force -ErrorAction SilentlyContinue
                }
                $UseBun = $false
            }
        } else {
            substep "bun install failed (exit $bunExit), falling back to npm" "Yellow"
            if (Test-Path "node_modules") {
                Remove-Item "node_modules" -Recurse -Force -ErrorAction SilentlyContinue
            }
            $UseBun = $false
        }
    }
    if (-not $UseBun) {
        $npmExit = Invoke-SetupCommand { npm install }
        if ($npmExit -ne 0) {
            Pop-Location
            $ErrorActionPreference = $prevEAP_npm
            foreach ($gi in $HiddenGitignores) { Rename-Item -Path "$gi._twbuild" -NewName (Split-Path $gi -Leaf) -Force -ErrorAction SilentlyContinue }
            Write-Host "[ERROR] npm install failed (exit code $npmExit)" -ForegroundColor Red
            Write-Host "   Try running 'npm install' manually in frontend/ to see errors" -ForegroundColor Yellow
            exit 1
        }
    }

    # Always use npm to run the build (Node runtime — avoids bun Windows runtime issues)
    $buildExit = Invoke-SetupCommand { npm run build }
    if ($buildExit -ne 0) {
        Pop-Location
        $ErrorActionPreference = $prevEAP_npm
        foreach ($gi in $HiddenGitignores) { Rename-Item -Path "$gi._twbuild" -NewName (Split-Path $gi -Leaf) -Force -ErrorAction SilentlyContinue }
        Write-Host "[ERROR] npm run build failed (exit code $buildExit)" -ForegroundColor Red
        exit 1
    }
    Pop-Location
    $ErrorActionPreference = $prevEAP_npm

    # ── Restore hidden .gitignore files ──
    foreach ($gi in $HiddenGitignores) {
        Rename-Item -Path "$gi._twbuild" -NewName (Split-Path $gi -Leaf) -Force -ErrorAction SilentlyContinue
    }

    # ── Validate CSS output ──
    $CssFiles = Get-ChildItem (Join-Path $DistDir "assets") -Filter "*.css" -ErrorAction SilentlyContinue
    $MaxCssSize = ($CssFiles | Measure-Object -Property Length -Maximum).Maximum
    if ($MaxCssSize -lt 100000) {
        step "frontend" "built (warning: CSS may be truncated)" "Yellow"
    } else {
        step "frontend" "built"
    }
}

if (Test-Path $OxcValidatorDir) {
    substep "installing OXC validator runtime..."
    $prevEAP_oxc = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    Push-Location $OxcValidatorDir
    $oxcInstallExit = Invoke-SetupCommand { npm install }
    if ($oxcInstallExit -ne 0) {
        Pop-Location
        $ErrorActionPreference = $prevEAP_oxc
        Write-Host "[ERROR] OXC validator npm install failed (exit code $oxcInstallExit)" -ForegroundColor Red
        exit 1
    }
    Pop-Location
    $ErrorActionPreference = $prevEAP_oxc
    step "oxc runtime" "installed"
}

# ==========================================================================
#  PHASE 3: Python environment + dependencies
# ==========================================================================
Write-Host ""
substep "setting up Python environment..."

# Find Python -- skip Anaconda/Miniconda distributions.
# Conda-bundled CPython ships modified DLL search paths that break
# torch's c10.dll loading on Windows. Standalone CPython (python.org,
# winget, uv) does not have this issue.
# Uses Get-Command -All to look past conda entries that shadow a valid
# standalone Python further down PATH, and probes py.exe (the Python
# Launcher) which reliably finds python.org installs.
#
# NOTE: A venv created from conda Python inherits conda's base_prefix
# even though the venv path itself does not contain "conda". We check
# both the executable path AND sys.base_prefix to catch this case.
$CondaSkipPattern = '(?i)(conda|miniconda|anaconda|miniforge|mambaforge)'
$PythonCmd = $null

# Helper: check if a Python executable is conda-based by inspecting
# both the path and sys.base_prefix (catches venvs created from conda).
function Test-IsConda {
    param([string]$Exe)
    if ($Exe -match $CondaSkipPattern) { return $true }
    try {
        $basePrefix = (& $Exe -c "import sys; print(sys.base_prefix)" 2>$null | Out-String).Trim()
        if ($basePrefix -match $CondaSkipPattern) { return $true }
    } catch { }
    return $false
}

# 1. Try the Python Launcher (py.exe) first -- most reliable on Windows.
#    py.exe is installed by python.org and resolves to standalone CPython.
$pyLauncher = Get-Command py -CommandType Application -ErrorAction SilentlyContinue
if ($pyLauncher -and $pyLauncher.Source -notmatch $CondaSkipPattern) {
    foreach ($minor in @("3.13", "3.12", "3.11")) {
        try {
            $out = & $pyLauncher.Source "-$minor" --version 2>&1 | Out-String
            if ($out -match 'Python 3\.(\d+)') {
                $pyMinor = [int]$Matches[1]
                if ($pyMinor -ge 11 -and $pyMinor -le 13) {
                    # Resolve the actual executable path so venv creation
                    # does not re-resolve back to a conda interpreter.
                    $resolvedExe = (& $pyLauncher.Source "-$minor" -c "import sys; print(sys.executable)" 2>$null | Out-String).Trim()
                    if ($resolvedExe -and (Test-Path $resolvedExe) -and -not (Test-IsConda $resolvedExe)) {
                        $PythonCmd = $resolvedExe
                        break
                    }
                }
            }
        } catch { }
    }
}

# 2. Fall back to scanning python3.x / python3 / python on PATH.
#    Use Get-Command -All to look past conda entries.
if (-not $PythonCmd) {
    foreach ($candidate in @("python3.13", "python3.12", "python3.11", "python3", "python")) {
        foreach ($cmdInfo in @(Get-Command $candidate -All -ErrorAction SilentlyContinue)) {
            try {
                if (-not $cmdInfo.Source) { continue }
                if ($cmdInfo.Source -like "*\WindowsApps\*") { continue }
                if (Test-IsConda $cmdInfo.Source) {
                    substep "skipping $($cmdInfo.Source) (conda Python breaks torch DLL loading)" "Yellow"
                    continue
                }
                $ver = & $cmdInfo.Source --version 2>&1
                if ($ver -match 'Python 3\.(\d+)') {
                    $minor = [int]$Matches[1]
                    if ($minor -ge 11 -and $minor -le 13) {
                        $PythonCmd = $cmdInfo.Source
                        break
                    }
                }
            } catch { }
        }
        if ($PythonCmd) { break }
    }
}

if (-not $PythonCmd) {
    Write-Host "[ERROR] No standalone Python 3.11-3.13 found (conda Python is not supported)." -ForegroundColor Red
    Write-Host "        Install Python from https://python.org/downloads/ or via:" -ForegroundColor Yellow
    Write-Host "        winget install -e --id Python.Python.3.12" -ForegroundColor Yellow
    exit 1
}

substep "Using $PythonCmd ($(& $PythonCmd --version 2>&1))"

# The venv must already exist (created by install.ps1).
# This script (setup.ps1 / "unsloth studio update") only updates packages.
$VenvDir = Join-Path $env:USERPROFILE ".unsloth\studio\unsloth_studio"

# Stale-venv detection: if the venv exists but its torch flavor no longer
# matches the current machine, wipe it so we get a clean install.
if (Test-Path $VenvDir -PathType Container) {
    $VenvPyExe = Join-Path $VenvDir "Scripts\python.exe"
    $installedTorchTag = $null
    $shouldRebuild = $false

    if (Test-Path $VenvPyExe) {
        try {
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = $VenvPyExe
            $psi.Arguments = '-c "import torch; print(torch.__version__)"'
            $psi.RedirectStandardOutput = $true
            $psi.RedirectStandardError = $true
            $psi.UseShellExecute = $false
            $psi.CreateNoWindow = $true
            $proc = [System.Diagnostics.Process]::Start($psi)
            $torchVer = $proc.StandardOutput.ReadToEnd().Trim()
            $finished = $proc.WaitForExit(30000)
            if ($finished -and $proc.ExitCode -eq 0 -and $torchVer) {
                if ($torchVer -match '\+(cu\d+)') {
                    $installedTorchTag = $Matches[1]
                } elseif ($torchVer -match '\+cpu') {
                    $installedTorchTag = "cpu"
                } else {
                    # Untagged wheel (plain "2.x.y" from PyPI) -- treat as cpu
                    $installedTorchTag = "cpu"
                }
            } else {
                if (-not $finished) { try { $proc.Kill() } catch {} }
                $shouldRebuild = $true
            }
        } catch {
            $shouldRebuild = $true
        }
    } else {
        # Missing python.exe means the venv is incomplete -- rebuild it.
        $shouldRebuild = $true
    }

    if (-not $shouldRebuild) {
        $expectedTorchTag = if ($HasNvidiaSmi) { Get-PytorchCudaTag } else { "cpu" }
        if ($installedTorchTag -and $installedTorchTag -ne $expectedTorchTag) {
            $shouldRebuild = $true
        }
    }

    if ($shouldRebuild) {
        $reason = if ($installedTorchTag) { "torch $installedTorchTag != required $expectedTorchTag" } else { "torch could not be imported" }
        substep "Stale venv detected ($reason) -- rebuilding..." "Yellow"
        try {
            Remove-Item $VenvDir -Recurse -Force -ErrorAction Stop
        } catch {
            Write-Host "   [ERROR] Could not remove stale venv: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "           Close any running Studio/Python processes and re-run setup." -ForegroundColor Red
            exit 1
        }
    }
}

if (-not (Test-Path $VenvDir)) {
    Write-Host "[ERROR] Virtual environment not found at $VenvDir" -ForegroundColor Red
    Write-Host "        Run install.ps1 first to create the environment:" -ForegroundColor Yellow
    Write-Host "        irm https://unsloth.ai/install.ps1 | iex" -ForegroundColor Yellow
    exit 1
} else {
    substep "reusing existing virtual environment at $VenvDir"
}

# pip and python write to stderr even on success (progress bars, warnings).
# With $ErrorActionPreference = "Stop" (set at top of script), PS 5.1
# converts stderr lines into terminating ErrorRecords, breaking output.
# Lower to "Continue" for the pip/python section.
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"

$ActivateScript = Join-Path $VenvDir "Scripts\Activate.ps1"
. $ActivateScript

# Try to use uv (much faster than pip), fall back to pip if unavailable
$UseUv = $false
if (Get-Command uv -ErrorAction SilentlyContinue) {
    $UseUv = $true
} else {
    substep "installing uv package manager..."
    try {
        Invoke-SetupCommand { Invoke-Expression (Invoke-RestMethod -Uri "https://astral.sh/uv/install.ps1") } | Out-Null
        Refresh-Environment
        # Re-activate venv since Refresh-Environment rebuilds PATH from
        # registry and drops the venv's Scripts directory
        . $ActivateScript
        if (Get-Command uv -ErrorAction SilentlyContinue) { $UseUv = $true }
    } catch { }
}

# Helper: install a package, preferring uv with pip fallback
function Fast-Install {
    param([Parameter(ValueFromRemainingArguments=$true)]$Args_)
    if ($UseUv) {
        $VenvPy = (Get-Command python).Source
        $result = & uv pip install --python $VenvPy @Args_ 2>&1
        if ($LASTEXITCODE -eq 0) { return }
    }
    & python -m pip install @Args_ 2>&1
}

# ── Check if Python deps need updating ──
# Compare installed package version against PyPI latest.
# Skip all Python dependency work if versions match (fast update path).
$_PkgName = if ($env:STUDIO_PACKAGE_NAME) { $env:STUDIO_PACKAGE_NAME } else { "unsloth" }
$SkipPythonDeps = $false

if ($env:SKIP_STUDIO_BASE -ne "1" -and $env:STUDIO_LOCAL_INSTALL -ne "1") {
    # Only check when NOT called from install.ps1 (which just installed the package)
    $InstalledVer = try { (& python -c "from importlib.metadata import version; print(version('$_PkgName'))" 2>$null | Out-String).Trim() } catch { "" }
    $LatestVer = ""
    try {
        $pypiJson = Invoke-RestMethod -Uri "https://pypi.org/pypi/$_PkgName/json" -TimeoutSec 5 -ErrorAction Stop
        $LatestVer = "$($pypiJson.info.version)".Trim()
    } catch { }

    if ($InstalledVer -and $LatestVer -and ($InstalledVer -eq $LatestVer)) {
        step "python" "$_PkgName $InstalledVer is up to date"
        $SkipPythonDeps = $true
    } elseif ($InstalledVer -and $LatestVer) {
        substep "$_PkgName $InstalledVer -> $LatestVer available, updating..."
    } elseif (-not $LatestVer) {
        substep "could not reach PyPI, updating to be safe..."
    }
}

# if (-not $IsPipInstall) {
#     # Running from repo: copy requirements and do editable install
#     $RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
#     $ReqsSrc = Join-Path $RepoRoot "backend\requirements"
#     $ReqsDst = Join-Path $PackageDir "requirements"
#     if (-not (Test-Path $ReqsDst)) { New-Item -ItemType Directory -Path $ReqsDst | Out-Null }
#     Copy-Item (Join-Path $ReqsSrc "*.txt") $ReqsDst -Force

#     Write-Host "   Installing CLI entry point..." -ForegroundColor Cyan
#     pip install -e $RepoRoot 2>&1 | Out-Null
# } else {
#     # Running from pip install: the package is in system Python but not in
#     # the fresh .venv. Install it so run_install() can find its modules
#     # and bundled requirements files.
#     Write-Host "   Installing package into venv..." -ForegroundColor Cyan
#     pip install unsloth-roland-test 2>&1 | Out-Null
# }

if (-not $SkipPythonDeps) {

if ($script:UnslothVerbose) {
    Fast-Install --upgrade pip
} else {
    Fast-Install --upgrade pip | Out-Null
}

# Pre-install PyTorch with CUDA support.
# On Windows, the default PyPI torch wheel is CPU-only.
# We need PyTorch's CUDA index to get GPU-enabled wheels.
# PyTorch bundles its own CUDA runtime, so this works regardless
# of whether the CUDA Toolkit is installed yet.
# The CUDA tag is chosen based on the driver's max supported CUDA version.

# Windows MAX_PATH (260 chars) causes Triton kernel compilation to fail because
# the auto-generated filenames are extremely long. Use a short cache directory.
$TorchCacheDir = "C:\tc"
if (-not (Test-Path $TorchCacheDir)) { New-Item -ItemType Directory -Path $TorchCacheDir -Force | Out-Null }
$env:TORCHINDUCTOR_CACHE_DIR = $TorchCacheDir
[Environment]::SetEnvironmentVariable('TORCHINDUCTOR_CACHE_DIR', $TorchCacheDir, 'User')
substep "TORCHINDUCTOR_CACHE_DIR set to $TorchCacheDir (avoids MAX_PATH issues)"

if ($HasNvidiaSmi) {
    $CuTag = Get-PytorchCudaTag
} else {
    $CuTag = "cpu"
}

$PyTorchWhlBase = if ($env:UNSLOTH_PYTORCH_MIRROR) { $env:UNSLOTH_PYTORCH_MIRROR.TrimEnd('/') } else { "https://download.pytorch.org/whl" }

if ($CuTag -eq "cpu") {
    substep "installing PyTorch (CPU-only)..."
    if ($script:UnslothVerbose) {
        Fast-Install torch torchvision torchaudio --index-url "$PyTorchWhlBase/cpu"
        $torchInstallExit = $LASTEXITCODE
        $output = ""
    } else {
        $output = Fast-Install torch torchvision torchaudio --index-url "$PyTorchWhlBase/cpu" | Out-String
        $torchInstallExit = $LASTEXITCODE
    }
    if ($torchInstallExit -ne 0) {
        Write-Host "[FAILED] PyTorch install failed (exit code $torchInstallExit)" -ForegroundColor Red
        Write-Host $output -ForegroundColor Red
        exit 1
    }
} else {
    substep "installing PyTorch with CUDA support ($CuTag)..."
    substep "(This download is ~2.8 GB -- may take a few minutes)"
    if ($script:UnslothVerbose) {
        Fast-Install torch torchvision torchaudio --index-url "$PyTorchWhlBase/$CuTag"
        $torchInstallExit = $LASTEXITCODE
        $output = ""
    } else {
        $output = Fast-Install torch torchvision torchaudio --index-url "$PyTorchWhlBase/$CuTag" | Out-String
        $torchInstallExit = $LASTEXITCODE
    }
    if ($torchInstallExit -ne 0) {
        Write-Host "[FAILED] PyTorch CUDA install failed (exit code $torchInstallExit)" -ForegroundColor Red
        Write-Host $output -ForegroundColor Red
        exit 1
    }

    # Install Triton for Windows (enables torch.compile -- without it training can hang)
    substep "installing Triton for Windows..."
    if ($script:UnslothVerbose) {
        Fast-Install "triton-windows<3.7"
        $tritonInstallExit = $LASTEXITCODE
        $output = ""
    } else {
        $output = Fast-Install "triton-windows<3.7" | Out-String
        $tritonInstallExit = $LASTEXITCODE
    }
    if ($tritonInstallExit -ne 0) {
        substep "Triton install failed -- torch.compile may not work" "Yellow"
        Write-Host $output -ForegroundColor Yellow
    } else {
        substep "Triton for Windows installed (enables torch.compile)"
    }
}

# Ordered heavy dependency installation -- shared cross-platform script
substep "running ordered dependency installation..."
python "$PSScriptRoot\install_python_stack.py"
$stackExit = $LASTEXITCODE
# Restore ErrorActionPreference after pip/python work
$ErrorActionPreference = $prevEAP
if ($stackExit -ne 0) {
    Write-Host "[FAILED] Python dependency installation failed (exit code $stackExit)" -ForegroundColor Red
    Write-Host "   Re-run the installer or check the error above for details." -ForegroundColor Red
    exit 1
}

} else {
    step "python" "dependencies up to date"
    # Restore ErrorActionPreference (was lowered for pip/python section)
    $ErrorActionPreference = $prevEAP
}

# ── Pre-install transformers 5.x into .venv_t5_530/ and .venv_t5_550/ ──
# Runs outside the deps fast-path gate so that upgrades from the legacy
# single .venv_t5 are always migrated to the tiered layout.
$VenvT5_530Dir = Join-Path $env:USERPROFILE ".unsloth\studio\.venv_t5_530"
$VenvT5_550Dir = Join-Path $env:USERPROFILE ".unsloth\studio\.venv_t5_550"
$VenvT5Legacy = Join-Path $env:USERPROFILE ".unsloth\studio\.venv_t5"

$_NeedT5Install = $false
if (Test-Path $VenvT5Legacy) {
    Remove-Item -Recurse -Force $VenvT5Legacy
    $_NeedT5Install = $true
}
if (-not (Test-Path $VenvT5_530Dir)) { $_NeedT5Install = $true }
if (-not (Test-Path $VenvT5_550Dir)) { $_NeedT5Install = $true }
# Also reinstall when python deps were updated
if (-not $SkipPythonDeps) { $_NeedT5Install = $true }

if ($_NeedT5Install) {
Write-Host ""

$prevEAP_t5 = $ErrorActionPreference
$ErrorActionPreference = "Continue"

# --- .venv_t5_530 (transformers 5.3.0) ---
substep "pre-installing transformers 5.3.0 for newer model support..."
if (Test-Path $VenvT5_530Dir) { Remove-Item -Recurse -Force $VenvT5_530Dir }
New-Item -ItemType Directory -Path $VenvT5_530Dir -Force | Out-Null
foreach ($pkg in @("transformers==5.3.0", "huggingface_hub==1.8.0", "hf_xet==1.4.2")) {
    if ($script:UnslothVerbose) {
        Fast-Install --target $VenvT5_530Dir --no-deps $pkg
        $t5PkgExit = $LASTEXITCODE
        $output = ""
    } else {
        $output = Fast-Install --target $VenvT5_530Dir --no-deps $pkg | Out-String
        $t5PkgExit = $LASTEXITCODE
    }
    if ($t5PkgExit -ne 0) {
        Write-Host "[FAIL] Could not install $pkg into .venv_t5_530/" -ForegroundColor Red
        Write-Host $output -ForegroundColor Red
        $ErrorActionPreference = $prevEAP_t5
        exit 1
    }
}
if ($script:UnslothVerbose) {
    Fast-Install --target $VenvT5_530Dir tiktoken
    $tiktokenInstallExit = $LASTEXITCODE
    $output = ""
} else {
    $output = Fast-Install --target $VenvT5_530Dir tiktoken | Out-String
    $tiktokenInstallExit = $LASTEXITCODE
}
if ($tiktokenInstallExit -ne 0) {
    substep "Could not install tiktoken into .venv_t5_530/ -- Qwen tokenizers may fail" "Yellow"
}
step "transformers" "5.3.0 pre-installed"

# --- .venv_t5_550 (transformers 5.5.0) ---
substep "pre-installing transformers 5.5.0 for Gemma 4 support..."
if (Test-Path $VenvT5_550Dir) { Remove-Item -Recurse -Force $VenvT5_550Dir }
New-Item -ItemType Directory -Path $VenvT5_550Dir -Force | Out-Null
foreach ($pkg in @("transformers==5.5.0", "huggingface_hub==1.8.0", "hf_xet==1.4.2")) {
    if ($script:UnslothVerbose) {
        Fast-Install --target $VenvT5_550Dir --no-deps $pkg
        $t5PkgExit = $LASTEXITCODE
        $output = ""
    } else {
        $output = Fast-Install --target $VenvT5_550Dir --no-deps $pkg | Out-String
        $t5PkgExit = $LASTEXITCODE
    }
    if ($t5PkgExit -ne 0) {
        Write-Host "[FAIL] Could not install $pkg into .venv_t5_550/" -ForegroundColor Red
        Write-Host $output -ForegroundColor Red
        $ErrorActionPreference = $prevEAP_t5
        exit 1
    }
}
if ($script:UnslothVerbose) {
    Fast-Install --target $VenvT5_550Dir tiktoken
    $tiktokenInstallExit = $LASTEXITCODE
    $output = ""
} else {
    $output = Fast-Install --target $VenvT5_550Dir tiktoken | Out-String
    $tiktokenInstallExit = $LASTEXITCODE
}
if ($tiktokenInstallExit -ne 0) {
    substep "Could not install tiktoken into .venv_t5_550/ -- Qwen tokenizers may fail" "Yellow"
}
$ErrorActionPreference = $prevEAP_t5
step "transformers" "5.5.0 pre-installed"

} # end $_NeedT5Install

# ─────────────────────────────────────────────
# Footer
# ─────────────────────────────────────────────
$DoneLabel = if ($env:SKIP_STUDIO_BASE -eq "1") { "Unsloth Studio Setup Complete" } else { "Unsloth Studio Updated" }
if ($script:StudioVtOk -and -not $env:NO_COLOR) {
    Write-Host ("  {0}{1}{2}" -f (Get-StudioAnsi Dim), $Rule, (Get-StudioAnsi Reset))
    Write-Host ("  " + (Get-StudioAnsi Title) + $DoneLabel + (Get-StudioAnsi Reset))
    Write-Host ("  {0}{1}{2}" -f (Get-StudioAnsi Dim), $Rule, (Get-StudioAnsi Reset))
} else {
    Write-Host "  $Rule" -ForegroundColor DarkGray
    Write-Host "  $DoneLabel" -ForegroundColor Green
    Write-Host "  $Rule" -ForegroundColor DarkGray
}
step "launch" "unsloth studio -H 0.0.0.0 -p 8888"
Write-Host ""

