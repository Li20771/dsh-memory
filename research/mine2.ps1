$ErrorActionPreference = 'Continue'
$root = 'D:\DSH记忆\research\raw\papers.json'
$papers = Get-Content $root -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Host ("corpus loaded: {0} papers" -f $papers.Count)

function Mine([string]$label, [string]$titleRx, [int]$max = 7, [int]$absLen = 320) {
  Write-Host ""
  Write-Host ("================ {0} ================" -f $label)
  $rx = [regex]::new($titleRx, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  $hits = @($papers | Where-Object { $_.title -and $rx.IsMatch([string]$_.title) })
  Write-Host ("matches: {0}" -f $hits.Count)
  $hits | Sort-Object { [string]$_.date } -Descending | Select-Object -First $max | ForEach-Object {
    $a = [string]$_.abs
    if ($a.Length -gt $absLen) { $a = $a.Substring(0, $absLen) + ' [...]' }
    Write-Host ""
    Write-Host ("### {0} | {1} | {2}" -f $_.id, $_.date, $_.title)
    Write-Host $a
  }
}

Mine 'SCOPE' 'scope|scoping|tenant|isolat|cross-user|cross-project|cross-family|interference|contaminat' 9
Mine 'AUTHORIZATION' 'authoriz|audience|consent|opt-in|eligib|admission|permission|govern' 9
Mine 'PORTABILITY' 'migrat|portab|version control|rollback|lineage|snapshot|transfer' 6
Mine 'COMPACTION' 'compact|consolidat|promot|recurr|distill|defrag' 8
Mine 'EPISTEMICS' 'epistem|confidence|uncertain|provenance|attribut|sufficien|authority' 8
