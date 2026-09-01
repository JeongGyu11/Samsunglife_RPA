param(
    [string]$Year = "2024",
    [string]$OutputFolder = "",
    [int]$MaxPages = 0,
    [int]$MaxDocuments = 0,
    [string]$LlmEndpoint = "https://3ewe5z22ue1gso-8000.proxy.runpod.net/v1/chat/completions",
    [string]$LlmModel = "Qwen/Qwen3.5-27B",
    [switch]$DisableLlm,
    [switch]$DryRun
)

throw "이 실행기는 Playwright 기반이므로 비활성화되었습니다. 전체 다운로드는 UiPath 워크플로에서 실행해야 합니다."

$projectFolder = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeExe = "C:\Users\FAS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$scriptPath = Join-Path $projectFolder "Scripts\download_all_samsunglife_documents.js"

if ([string]::IsNullOrWhiteSpace($OutputFolder)) {
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $OutputFolder = Join-Path $projectFolder "Evidence\BULK_$timestamp\Downloads"
}

$arguments = @(
    $scriptPath,
    "--year=$Year",
    "--output=$OutputFolder",
    "--max-pages=$MaxPages",
    "--max-documents=$MaxDocuments",
    "--use-llm=$(((-not $DisableLlm.IsPresent)).ToString().ToLowerInvariant())",
    "--llm-endpoint=$LlmEndpoint",
    "--llm-model=$LlmModel",
    "--dry-run=$($DryRun.IsPresent.ToString().ToLowerInvariant())"
)

& $nodeExe @arguments
exit $LASTEXITCODE
