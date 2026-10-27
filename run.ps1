param(
  [ValidateSet('dev','install','build','typecheck','test','check:data','preview')]
  [string]$Action = 'dev'
)
$ErrorActionPreference = 'Stop'
$runtimeRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $runtimeRoot 'node\bin\node.exe' }
$pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
$pnpmScript = Join-Path $runtimeRoot 'node\node_modules\pnpm\bin\pnpm.mjs'
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js was not found. See README.md.' }
if (-not $pnpmCommand -and -not (Test-Path -LiteralPath $pnpmScript)) { throw 'pnpm was not found. See README.md.' }
$nodeVersion = & $nodePath --version
if ($nodeVersion -notmatch '^v24\.') { throw "This milestone was verified with Node 24.x; found $nodeVersion." }
$env:PATH = (Split-Path -Parent $nodePath) + [IO.Path]::PathSeparator + $env:PATH
Push-Location (Join-Path $PSScriptRoot 'app')
try {
  $pmArgs = if ($Action -eq 'install') { @('install','--frozen-lockfile','--store-dir','.pnpm-store') } else { @('run',$Action) }
  if ($pnpmCommand) { & $pnpmCommand.Source @pmArgs } else { & $nodePath $pnpmScript @pmArgs }
  if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE." }
} finally { Pop-Location }
