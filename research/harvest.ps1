$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$root = 'D:\DSH记忆\research'
New-Item -ItemType Directory -Force -Path "$root\raw" | Out-Null

$all = New-Object System.Collections.ArrayList

function Get-Arxiv([string]$tag, [string]$q, [int]$n, [string]$sort) {
  $u = "https://export.arxiv.org/api/query?search_query=$q&start=0&max_results=$n&sortBy=$sort&sortOrder=descending"
  try {
    $r = Invoke-WebRequest -Uri $u -TimeoutSec 45 -UseBasicParsing
    [xml]$x = $r.Content
    $c = 0
    foreach ($e in $x.feed.entry) {
      $pub = "$($e.published)"
      $idraw = "$($e.id)"
      [void]$all.Add([pscustomobject]@{
        src     = 'arxiv'
        tag     = $tag
        id      = ($idraw -replace '.*abs/', '' -replace 'v\d+$', '')
        year    = $(if ($pub.Length -ge 4) { $pub.Substring(0, 4) } else { '' })
        date    = $(if ($pub.Length -ge 10) { $pub.Substring(0, 10) } else { $pub })
        title   = (("$($e.title)" -replace '\s+', ' ').Trim())
        abs     = (("$($e.summary)" -replace '\s+', ' ').Trim())
        cites   = $null
        venue   = ''
        url     = $idraw
      })
      $c++
    }
    Write-Host ("arxiv  {0,-22} {1,3} entries" -f $tag, $c)
  } catch { Write-Host "arxiv  $tag FAILED: $($_.Exception.Message)" }
}

function Get-S2([string]$tag, [string]$q, [int]$n) {
  $u = "https://api.semanticscholar.org/graph/v1/paper/search?query=$q&fields=title,year,abstract,citationCount,externalIds,venue,authors&limit=$n"
  try {
    $r = Invoke-WebRequest -Uri $u -TimeoutSec 45 -UseBasicParsing
    $j = $r.Content | ConvertFrom-Json
    $c = 0
    foreach ($p in $j.data) {
      $axid = ''
      if ($p.externalIds -and $p.externalIds.ArXiv) { $axid = $p.externalIds.ArXiv }
      [void]$all.Add([pscustomobject]@{
        src   = 's2'
        tag   = $tag
        id    = $(if ($axid) { $axid } else { "s2:$($p.paperId)" })
        year  = "$($p.year)"
        date  = ''
        title = (("$($p.title)" -replace '\s+', ' ').Trim())
        abs   = (("$($p.abstract)" -replace '\s+', ' ').Trim())
        cites = $p.citationCount
        venue = "$($p.venue)"
        url   = "https://www.semanticscholar.org/paper/$($p.paperId)"
      })
      $c++
    }
    Write-Host ("s2     {0,-22} {1,3} entries" -f $tag, $c)
  } catch { Write-Host "s2     $tag FAILED: $($_.Exception.Message)" }
}

function Get-OA([string]$tag, [string]$q, [int]$n) {
  $u = "https://api.openalex.org/works?search=$q&per-page=$n&sort=cited_by_count:desc&mailto=research@example.com"
  try {
    $r = Invoke-WebRequest -Uri $u -TimeoutSec 45 -UseBasicParsing
    $j = $r.Content | ConvertFrom-Json
    $c = 0
    foreach ($w in $j.results) {
      [void]$all.Add([pscustomobject]@{
        src   = 'openalex'
        tag   = $tag
        id    = "$($w.id -replace 'https://openalex.org/', '')"
        year  = "$($w.publication_year)"
        date  = "$($w.publication_date)"
        title = (("$($w.display_name)" -replace '\s+', ' ').Trim())
        abs   = ''
        cites = $w.cited_by_count
        venue = "$($w.primary_location.source.display_name)"
        url   = "$($w.id)"
      })
      $c++
    }
    Write-Host ("openalex {0,-20} {1,3} entries" -f $tag, $c)
  } catch { Write-Host "openalex $tag FAILED: $($_.Exception.Message)" }
}

Write-Host '--- arXiv ---'
Get-Arxiv 'arch'     'all:%22agent+memory%22' 100 'submittedDate'
Get-Arxiv 'ltm'      'all:%22long-term+memory%22+AND+cat:cs.CL' 100 'submittedDate'
Get-Arxiv 'mem+llm'  'all:%22memory%22+AND+all:%22LLM+agent%22' 80 'submittedDate'
Get-Arxiv 'titletag' 'ti:%22memory%22+AND+abs:%22agent%22' 80 'submittedDate'
Get-Arxiv 'poison'   'all:%22memory+poisoning%22' 40 'submittedDate'
Get-Arxiv 'ctxeng'   'all:%22context+engineering%22' 50 'submittedDate'
Get-Arxiv 'consol'   'all:%22memory+consolidation%22+AND+cat:cs.AI' 40 'submittedDate'
Get-Arxiv 'bench'    'all:%22memory+benchmark%22' 40 'submittedDate'
Get-Arxiv 'survey'   'ti:%22survey%22+AND+abs:%22memory%22+AND+abs:%22agent%22' 40 'submittedDate'

Write-Host '--- Semantic Scholar ---'
Get-S2 's2-arch'    'agent%20memory' 40
Get-S2 's2-ltm'     'long-term%20memory%20large%20language%20model%20agent' 40
Get-S2 's2-retr'    'memory%20retrieval%20agent%20LLM' 30
Get-S2 's2-poison'  'memory%20poisoning%20LLM%20agent' 25
Get-S2 's2-graph'   'knowledge%20graph%20memory%20agent' 25

Write-Host '--- OpenAlex ---'
Get-OA 'oa-arch' 'agent%20memory' 50
Get-OA 'oa-ltm'  'long-term%20memory%20language%20model' 50

# dedupe by normalized title
$seen = @{}
$dedup = New-Object System.Collections.ArrayList
foreach ($r in $all) {
  $k = ($r.title.ToLower() -replace '[^a-z0-9]', '')
  if ($k.Length -lt 8) { continue }
  if ($seen.ContainsKey($k)) {
    $prev = $seen[$k]
    if ($null -ne $r.cites -and ($null -eq $prev.cites -or $r.cites -gt $prev.cites)) { $prev.cites = $r.cites }
    if ($r.abs -and -not $prev.abs) { $prev.abs = $r.abs }
    if ($r.venue -and -not $prev.venue) { $prev.venue = $r.venue }
    continue
  }
  $seen[$k] = $r
  [void]$dedup.Add($r)
}

Write-Host ''
Write-Host "TOTAL raw=$($all.Count)  deduped=$($dedup.Count)"
$dedup | ConvertTo-Json -Depth 4 | Set-Content -Path "$root\raw\papers.json" -Encoding UTF8

# compact digest: everything from 2025+
Write-Host ''
Write-Host '=== DATED 2025+ (by date desc) ==='
$recent = $dedup | Where-Object { $_.year -match '^202[5-6]$' -and $_.date } | Sort-Object date -Descending
Write-Host "count=$($recent.Count)"
foreach ($r in $recent) { Write-Host ("{0} | {1} | {2}" -f $r.date, $r.id, $r.title) }

Write-Host ''
Write-Host '=== TOP CITED (>=40) ==='
$top = $dedup | Where-Object { $null -ne $_.cites -and $_.cites -ge 40 } | Sort-Object cites -Descending
Write-Host "count=$($top.Count)"
foreach ($r in $top) { Write-Host ("{0,5} | {1} | {2} | {3}" -f $r.cites, $r.year, $r.id, $r.title) }

Write-Host ''
Write-Host '=== 2020-2024 anchor papers (cited>=100) ==='
$anchor = $dedup | Where-Object { $_.year -match '^202[0-4]$' -and $null -ne $_.cites -and $_.cites -ge 100 } | Sort-Object cites -Descending
foreach ($r in $anchor) { Write-Host ("{0,5} | {1} | {2} | {3}" -f $r.cites, $r.year, $r.id, $r.title) }
