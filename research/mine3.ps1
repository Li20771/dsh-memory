$ErrorActionPreference = 'Continue'
$papers = Get-Content 'D:\DSH记忆\research\raw\papers.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$byId = @{}
foreach ($p in $papers) { $byId[[string]$p.id] = $p }
foreach ($id in @('2609.29144','2609.36373','2609.30813','2610.17763','2610.11270')) {
  $p = $byId[$id]
  if ($null -eq $p) { Write-Host "MISSING $id"; continue }
  Write-Host ""
  Write-Host ("### {0} | {1} | {2}" -f $p.id, $p.date, $p.title)
  Write-Host ([string]$p.abs)
}
