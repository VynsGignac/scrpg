# ============================================================
# Reconstruit l'APK Android à partir des fichiers du jeu (index.html, manifest.json, sw.js, js/,
# icons/, img/). À relancer à chaque fois que le jeu change et qu'il faut une nouvelle APK.
#
# Utilisation : clic droit > "Exécuter avec PowerShell"
# (ou en ligne de commande : powershell -ExecutionPolicy Bypass -File build-apk.ps1)
#
# Prérequis déjà en place sur ce poste : Node.js, JDK 17 (Temurin), SDK Android dans C:\Android\Sdk.
# ============================================================

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

# Node.js n'est pas forcément dans le PATH de toutes les sessions PowerShell.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $env:PATH = "$env:PATH;C:\Program Files\nodejs"
}
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17"
$env:ANDROID_HOME = "C:\Android\Sdk"

# Numero de version (voir js/version.js) : incremente AUTOMATIQUEMENT le dernier chiffre (patch)
# a chaque build d'APK (demande utilisateur explicite : ne jamais publier une APK sans bumper la
# version, meme mecanisme/raisonnement que le CACHE_NAME de publish-web.ps1 -- sinon on oublie).
Write-Host "1/4 Incrementation du numero de version..." -ForegroundColor Cyan
$versionPath = Join-Path $root "js\version.js"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$versionJs = [System.IO.File]::ReadAllText($versionPath, $utf8NoBom)
if ($versionJs -match "const GameVersion = '(\d+)\.(\d+)\.(\d+)';") {
  $newPatch = ([int]$matches[3] + 1).ToString("D3")
  $newVersion = "$($matches[1]).$($matches[2]).$newPatch"
  $versionJs = $versionJs -replace "const GameVersion = '[^']*';", "const GameVersion = '$newVersion';"
  [System.IO.File]::WriteAllText($versionPath, $versionJs, $utf8NoBom)
  Write-Host "Version : $newVersion" -ForegroundColor DarkGray
} else {
  Write-Host "Format de version inattendu dans js/version.js, non modifie." -ForegroundColor Yellow
}

Write-Host "2/4 Copie des fichiers du jeu dans www/..." -ForegroundColor Cyan
$www = Join-Path $root "www"
if (Test-Path $www) { Remove-Item $www -Recurse -Force }
New-Item -ItemType Directory -Path $www | Out-Null
Copy-Item "$root\index.html" $www
Copy-Item "$root\manifest.json" $www
Copy-Item "$root\sw.js" $www
Copy-Item "$root\js" "$www\js" -Recurse
Copy-Item "$root\icons" "$www\icons" -Recurse
Copy-Item "$root\img" "$www\img" -Recurse

Write-Host "3/4 Synchronisation du projet Android (Capacitor)..." -ForegroundColor Cyan
Push-Location $root
npx cap sync android
Pop-Location

Write-Host "4/4 Compilation de l'APK debug (Gradle)..." -ForegroundColor Cyan
Push-Location "$root\android"
# --no-daemon : sans ça, Gradle lance un processus daemon persistant qui hérite des mêmes
# sorties (stdout/stderr) que ce script et les garde ouvertes indéfiniment en arrière-plan --
# la compilation se termine bien (l'APK est produite en moins d'une minute), mais tout ce qui
# lit la sortie de ce script (terminal redirigé, pipe...) attend un EOF qui n'arrive jamais et
# semble donc "bloqué" pendant des dizaines de minutes -- vécu pour de vrai (25 minutes
# d'attente pour un build en réalité terminé dès la première minute).
.\gradlew.bat assembleDebug --no-daemon
Pop-Location

$apk = "$root\android\app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $apk) {
  $dest = "$root\SCRPG-debug.apk"
  Copy-Item $apk $dest -Force
  Write-Host ""
  Write-Host "APK prête : $dest" -ForegroundColor Green
} else {
  Write-Host "APK introuvable, la compilation a probablement échoué (voir les messages ci-dessus)." -ForegroundColor Red
}
