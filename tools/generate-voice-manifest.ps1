[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# 版番号を省略した場合、MP3の名前と内容から自動生成する。
# 新しい一式を保存・照合してから旧キャッシュを削除する
# Service Workerの更新手順を維持するため、内容変更時には必ず版番号を変える。
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
        ForEach-Object { $_.Name }
)

if ($files.Count -eq 0) {
    throw 'MP3音声が1件も見つかりません。'
}

[Array]::Sort($files, [StringComparer]::Ordinal)

if (-not $PSBoundParameters.ContainsKey('Version')) {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $summary = [System.IO.MemoryStream]::new()

    try {
        foreach ($fileName in $files) {
            $nameBytes = [System.Text.Encoding]::UTF8.GetBytes($fileName)
            $lengthBytes = [BitConverter]::GetBytes([int]$nameBytes.Length)
            if (-not [BitConverter]::IsLittleEndian) {
                [Array]::Reverse($lengthBytes)
            }
            $summary.Write($lengthBytes, 0, $lengthBytes.Length)
            $summary.Write($nameBytes, 0, $nameBytes.Length)

            $fileStream = [System.IO.File]::OpenRead(
                (Join-Path $voiceDirectory $fileName)
            )
            try {
                $fileHash = $sha256.ComputeHash($fileStream)
            } finally {
                $fileStream.Dispose()
            }
            $summary.Write($fileHash, 0, $fileHash.Length)
        }

        $summary.Position = 0
        $digest = $sha256.ComputeHash($summary)
        $Version = 'sha256-' + [BitConverter]::ToString($digest).Replace('-', '').ToLowerInvariant()
    } finally {
        $summary.Dispose()
        $sha256.Dispose()
    }
}

if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
    try {
        $currentManifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 |
            ConvertFrom-Json
    } catch {
        throw "既存の音声マニフェストを読み取れません: $($_.Exception.Message)"
    }

    if ([string]$currentManifest.version -eq $Version) {
        if ($PSBoundParameters.ContainsKey('Version')) {
            throw "現在と異なる版番号を指定してください: $Version"
        }

        $currentFiles = @($currentManifest.files)
        [Array]::Sort($currentFiles, [StringComparer]::Ordinal)
        $filesMatch = $currentFiles.Count -eq $files.Count
        if ($filesMatch) {
            for ($index = 0; $index -lt $files.Count; $index++) {
                if (-not [string]::Equals(
                    [string]$currentFiles[$index],
                    [string]$files[$index],
                    [StringComparison]::Ordinal
                )) {
                    $filesMatch = $false
                    break
                }
            }
        }

        if (-not $filesMatch) {
            throw "同じ版番号ですがファイル一覧が異なります: $Version"
        }

        Write-Host "音声に変更はありません。マニフェストは更新しませんでした: $($files.Count) 件 / version=$Version"
        return
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
