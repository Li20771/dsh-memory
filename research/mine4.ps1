$ErrorActionPreference = 'Continue'
$papers = Get-Content 'D:\DSH记忆\research\raw\papers.json' -Raw -Encoding UTF8 | ConvertFrom-Json

function Mine([string]$label, [string]$rx, [int]$max = 8, [int]$absLen = 300) {
  Write-Host ""
  Write-Host ("================ {0} ================" -f $label)
  $r = [regex]::new($rx, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  $hits = @($papers | Where-Object { $_.title -and $r.IsMatch([string]$_.title) })
  Write-Host ("matches: {0}" -f $hits.Count)
  $hits | Sort-Object { [string]$_.date } -Descending | Select-Object -First $max | ForEach-Object {
    $a = [string]$_.abs
    if ($a.Length -gt $absLen) { $a = $a.Substring(0, $absLen) + ' [...]' }
    Write-Host ""
    Write-Host ("### {0} | {1} | {2}" -f $_.id, $_.date, $_.title)
    Write-Host $a
  }
}

Mine 'DELETION / UNLEARNING / PURGE' 'forget|unlearn|delet|erase|purge|scrub|residual|tombstone|redact' 10
Mine 'EPHEMERAL / TTL / BOUNDED' 'ephemeral|temporar|transient|ttl|expir|bounded|prun|scratchpad|short-lived|lifetime' 10
Mine 'HARVEST / DISTILL / PROMOTE' 'harvest|distill|promot|abstract|skill extract|playbook|lesson' 10
Mine 'DESTRUCTION SAFETY' 'steganograph|covert|leak|residual|side channel|reconstruct' 6

Write-Host ""
Write-Host "================ specific digs ================"
$byId = @{}
foreach ($p in $papers) { $byId[[string]$p.id] = $p }
foreach ($id in @('2610.25758','2610.25561','2610.18052','2610.17659','2610.13267')) {
  $p = $byId[$id]
  if ($null -eq $p) { Write-Host "MISSING $id"; continue }
  Write-Host ""
  Write-Host ("### {0} | {1} | {2}" -f $p.id, $p.date, $p.title)
  $a = [string]$p.abs
  if ($a.Length -gt 700) { $a = $a.Substring(0,700) + ' [...]' }
  Write-Host $a
}
