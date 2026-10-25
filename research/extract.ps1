$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$root = 'D:\DSH记忆\research'
$papers = Get-Content "$root\raw\papers.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$byId = @{}
foreach ($p in $papers) { $byId[$p.id] = $p }

$pick = @(
  '2602.06052','2605.06716','2606.30306','2604.16548','2610.21165',
  '2610.29823','2610.27406','2610.24671','2610.22209',
  '2610.27377','2610.27524','2607.26637','2610.27700','2610.29869','2609.34422',
  '2609.13889','2610.28810','2610.04195','2610.04589','2603.11768',
  '2610.25179','2610.11188','2610.09008','2608.01679','2609.33013',
  '2608.00009','2607.12893','2610.03020','2605.12493','2610.29249',
  '2609.36059','2606.19847','2605.16045','2609.32091','2607.17545','2610.26433','2610.10845'
)

Write-Host "===== SELECTED ABSTRACTS ====="
foreach ($id in $pick) {
  $p = $byId[$id]
  if ($null -eq $p) { Write-Host "`n### $id  <<NOT IN CORPUS>>"; continue }
  $a = "$($p.abs)"
  if ($a.Length -gt 750) { $a = $a.Substring(0, 750) + ' [...]' }
  Write-Host "`n### $id | $($p.date) | $($p.title)"
  Write-Host $a
}

Write-Host "`n`n===== CANONICAL CLASSICS (id_list probe) ====="
$classic = '2310.08560,2504.19413,2502.12110,2501.13956,2402.17753,2410.10813,2304.03442,2405.14831,2309.02427,2402.07630'
try {
  $r = Invoke-WebRequest -Uri "https://export.arxiv.org/api/query?id_list=$classic&max_results=20" -TimeoutSec 45 -UseBasicParsing
  [xml]$x = $r.Content
  foreach ($e in $x.feed.entry) {
    $idr = "$($e.id)" -replace '.*abs/', '' -replace 'v\d+$', ''
    $pub = "$($e.published)"
    $t = ("$($e.title)" -replace '\s+', ' ').Trim()
    $s = ("$($e.summary)" -replace '\s+', ' ').Trim()
    if ($s.Length -gt 420) { $s = $s.Substring(0, 420) + ' [...]' }
    Write-Host "`n### $idr | $pub | $t"
    Write-Host $s
  }
} catch { Write-Host "classics probe FAILED: $($_.Exception.Message)" }
