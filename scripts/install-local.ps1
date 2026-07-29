[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)]
	[string]$VaultPath,

	[switch]$SkipReaderDataMigration
)

$ErrorActionPreference = "Stop"

$resolvedVault = (Resolve-Path -LiteralPath $VaultPath).Path
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$distRoot = Join-Path $repoRoot "dist"
$configRoot = Join-Path $resolvedVault ".obsidian"
$pluginRoot = Join-Path $configRoot "plugins"
$targetId = "weave-epub-ai-reader"
$legacyIds = @("weave-epub-reader", "weave-ai-assistant")
$targetRoot = Join-Path $pluginRoot $targetId
$communityPluginsPath = Join-Path $configRoot "community-plugins.json"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $configRoot "plugin-backups\weave-epub-ai-reader-$timestamp"

foreach ($asset in @("main.js", "manifest.json", "styles.css")) {
	$assetPath = Join-Path $distRoot $asset
	if (-not (Test-Path -LiteralPath $assetPath)) {
		throw "Missing build asset: $assetPath. Run npm run build first."
	}
}

New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

foreach ($pluginId in @($legacyIds + $targetId)) {
	$sourceRoot = Join-Path $pluginRoot $pluginId
	if (Test-Path -LiteralPath $sourceRoot) {
		Copy-Item -LiteralPath $sourceRoot -Destination (Join-Path $backupRoot $pluginId) -Recurse
	}
}

if (Test-Path -LiteralPath $communityPluginsPath) {
	Copy-Item -LiteralPath $communityPluginsPath -Destination (Join-Path $backupRoot "community-plugins.json")
}

New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null

if (-not $SkipReaderDataMigration) {
	$legacyReaderRoot = Join-Path $pluginRoot "weave-epub-reader"
	foreach ($entryName in @("data.json", "state", "cache")) {
		$sourcePath = Join-Path $legacyReaderRoot $entryName
		$destinationPath = Join-Path $targetRoot $entryName
		if (
			(Test-Path -LiteralPath $sourcePath) -and
			-not (Test-Path -LiteralPath $destinationPath)
		) {
			Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Recurse -Force
		}
	}
}

foreach ($asset in @("main.js", "manifest.json", "styles.css")) {
	Copy-Item -LiteralPath (Join-Path $distRoot $asset) -Destination (Join-Path $targetRoot $asset) -Force
}

$enabledPlugins = @()
if (Test-Path -LiteralPath $communityPluginsPath) {
	$parsed = Get-Content -LiteralPath $communityPluginsPath -Raw | ConvertFrom-Json
	$enabledPlugins = @($parsed | ForEach-Object { [string]$_ })
}

$enabledPlugins = @(
	$enabledPlugins |
		Where-Object { $_ -notin $legacyIds -and $_ -ne $targetId }
)
$enabledPlugins += $targetId
$enabledPlugins | ConvertTo-Json | Set-Content -LiteralPath $communityPluginsPath -Encoding utf8

Write-Host "Installed $targetId to $targetRoot"
Write-Host "Backup created at $backupRoot"
Write-Host "Reload Obsidian, then configure the DeepSeek API key in the AI 助手 settings tab."
