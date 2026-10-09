param(
  [string]$SigningFile,
  [string]$GradleInitScript,
  [string]$Architectures = 'arm64-v8a'
)
$ErrorActionPreference = 'Stop'
$davaqMobileRoot = Split-Path $PSScriptRoot -Parent
if (-not $SigningFile) { $SigningFile = Join-Path $davaqMobileRoot '.local-signing/credentials.json' }
$davaqSigning = Get-Content -Raw -LiteralPath $SigningFile | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $davaqSigning.keystorePath)) { throw 'Upload keystore not found' }
$davaqVariables = @{
  DAVAQ_ANDROID_KEYSTORE_PATH = $davaqSigning.keystorePath
  DAVAQ_ANDROID_STORE_PASSWORD = $davaqSigning.keystorePassword
  DAVAQ_ANDROID_KEY_ALIAS = $davaqSigning.keyAlias
  DAVAQ_ANDROID_KEY_PASSWORD = $davaqSigning.keyPassword
  EXPO_PUBLIC_API_BASE_URL = 'https://davaq.anothermeai.app'
  EXPO_PUBLIC_DOMAIN = 'davaq.anothermeai.app'
  NODE_ENV = 'production'
  CI = '1'
}
$davaqPrevious = @{}
foreach ($name in $davaqVariables.Keys) {
  $davaqPrevious[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  [Environment]::SetEnvironmentVariable($name, $davaqVariables[$name], 'Process')
}
Push-Location (Join-Path $davaqMobileRoot 'android')
try {
  $davaqArgs = @(':app:bundleRelease', ':app:assembleRelease', "-PreactNativeArchitectures=$Architectures", '--console=plain', '--max-workers=1')
  if ($GradleInitScript) { $davaqArgs += @('-I', $GradleInitScript) }
  & .\gradlew.bat @davaqArgs
  if ($LASTEXITCODE -ne 0) { throw "DavaQ Play build failed ($LASTEXITCODE)" }
  Write-Output 'AAB: android/app/build/outputs/bundle/release/app-release.aab'
  Write-Output 'APK: android/app/build/outputs/apk/release/app-release.apk'
} finally {
  Pop-Location
  foreach ($name in $davaqPrevious.Keys) {
    [Environment]::SetEnvironmentVariable($name, $davaqPrevious[$name], 'Process')
  }
}
