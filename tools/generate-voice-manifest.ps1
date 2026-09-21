[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# MP3を追加・差し替え・削除した際は、必ず新しい版番号を指定して実行する。
# 版番号が変わることで、新しい一式を保存・照合してから旧キャッシュを
# 各端末で削除するService Workerの更新手順が成立する。
$toolsDirectory = Split-Path -Parent $PSCommandPath
$projectDirectory = Split-Path -Parent $toolsDirectory
$voiceDirectory = Join-Path $projectDirectory 'data/voice'
$manifestPath = Join-Path $projectDirectory 'data/voice-manifest.json'

if (-not (Test-Path -LiteralPath $voiceDirectory -PathType Container)) {
    throw "音声ディレクトリが見つかりません: $voiceDirectory"
}

$files = @(
    Get-ChildItem -LiteralPath $voiceDirectory -File |
        Where-Object { $_.Extension -ieq '.mp3' } |
        Sort-Object -Property Name |
        ForEach-Object { $_.Name }
)

if ($files.Count -eq 0) {
    throw 'MP3音声が1件も見つかりません。'
}

if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
    try {
        $currentManifest = Get-Content -LiteralPath $manifestPath -Raw |
            ConvertFrom-Json

        if ([string]$currentManifest.version -eq $Version) {
            throw "現在と異なる版番号を指定してください: $Version"
        }
    } catch {
        if ($_.Exception.Message -like '現在と異なる版番号を指定してください:*') {
            throw
        }

        throw "既存の音声マニフェストを読み取れません: $($_.Exception.Message)"
    }
}

$manifest = [ordered]@{
    version = $Version
    files = $files
}
$json = $manifest | ConvertTo-Json -Depth 3
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)

[System.IO.File]::WriteAllText(
    $manifestPath,
    $json + [Environment]::NewLine,
    $utf8WithoutBom
)

Write-Host "音声マニフェストを更新しました: $($files.Count) 件 / version=$Version"
