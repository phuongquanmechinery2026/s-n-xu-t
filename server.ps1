# =====================================================================
#  NHA MAY SAN XUAT PHUONG QUAN  -  Server chay tren may (backend + DB)
# ---------------------------------------------------------------------
#  - Phuc vu app.html tai http://localhost:8756/
#  - Luu du lieu dang JSON trong thu muc  data\   (orders.json, meta.json)
#  - Moi lan ghi -> tu dong sao luu vao  backups\
#  Khong can cai dat gi them, khong can quyen Admin.
#  (File nay chi dung ky tu ASCII de PowerShell 5.1 doc dung.)
# =====================================================================

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

try { $Host.UI.RawUI.WindowTitle = 'NHA MAY SAN XUAT PHUONG QUAN - DANG CHAY (dung dong cua so nay khi dang dung app)' } catch {}

Add-Type -AssemblyName System.Web.Extensions
$JS = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$JS.MaxJsonLength = [int]::MaxValue

$PORT      = 8756
$dataDir   = Join-Path $root 'data'
$backupDir = Join-Path $root 'backups'
$appFile   = Join-Path $root 'app.html'
# Cho phep dat file phang chung 1 thu muc (khi tai le tung file tu gitiho):
# tim trong _local\ truoc, khong co thi tim ngay canh server.ps1.
function Find-File($rel, $bare) {
  $a = Join-Path $root $rel
  if (Test-Path $a) { return $a }
  $b = Join-Path $root $bare
  if (Test-Path $b) { return $b }
  return $a
}
$shimFile  = Find-File '_local\claude-shim.js' 'claude-shim.js'
$iconFile  = Find-File '_local\icon.png' 'icon.png'
New-Item -ItemType Directory -Force -Path $dataDir, $backupDir | Out-Null

try { "$PID" | Out-File -FilePath (Join-Path $dataDir 'server.pid') -Encoding ascii -Force } catch {}

# ---- so phien ban moi collection (trong bo nho) --------------------
$script:revs = @{}
function Get-Rev($name) {
  if (-not $script:revs.ContainsKey($name)) { $script:revs[$name] = 1 }
  return $script:revs[$name]
}
function Bump-Rev($name) { $script:revs[$name] = (Get-Rev $name) + 1 }

# ---- doc / ghi 1 collection --------------------------------------
function Load-Coll($name) {
  $f = Join-Path $dataDir ($name + '.json')
  if (Test-Path $f) {
    $txt = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
    if (-not [string]::IsNullOrWhiteSpace($txt)) {
      try { return $JS.DeserializeObject($txt) } catch {}
    }
  }
  return (New-Object 'System.Collections.Generic.Dictionary[string,object]')
}

function Save-Coll($name, $obj) {
  $f   = Join-Path $dataDir ($name + '.json')
  $txt = $JS.Serialize($obj)
  $u8  = New-Object System.Text.UTF8Encoding($false)
  $tmp = $f + '.tmp'
  [System.IO.File]::WriteAllText($tmp, $txt, $u8)
  if (Test-Path $f) { Copy-Item $f ($f + '.bak') -Force }
  Move-Item $tmp $f -Force

  $stamp = Get-Date -Format 'yyyyMMdd-HHmm'
  [System.IO.File]::WriteAllText((Join-Path $backupDir ("$name-$stamp.json")), $txt, $u8)
  # Sheet dien (electric) rat nang -> chi giu 4 ban sao gan nhat. Cac collection
  # khac giu 60 ban nhu cu.
  $keep = 60
  if ($name -like 'electric*' -or $name -like 'cokhi*' -or $name -like 'vtimg*') { $keep = 4 }
  Get-ChildItem $backupDir -Filter "$name-*.json" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip $keep |
    Remove-Item -Force -ErrorAction SilentlyContinue

  Bump-Rev $name
}

# ---- HTTP helpers ----------------------------------------------
function Send-Bytes($ctx, [int]$status, [string]$type, [byte[]]$bytes) {
  try {
    $ctx.Response.StatusCode  = $status
    $ctx.Response.ContentType = $type
    $ctx.Response.Headers['Cache-Control'] = 'no-store'
    if ($bytes -and $bytes.Length) {
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  } catch {}
  finally { try { $ctx.Response.OutputStream.Close() } catch {} }
}
function Send-Json($ctx, [int]$status, $obj) {
  Send-Bytes $ctx $status 'application/json; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes($JS.Serialize($obj)))
}
function Send-Text($ctx, [int]$status, [string]$s) {
  Send-Bytes $ctx $status 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes($s))
}

$APP_BYTES  = [System.IO.File]::ReadAllBytes($appFile)
$SHIM_BYTES = [System.IO.File]::ReadAllBytes($shimFile)
$ICON_BYTES = $null
if (Test-Path $iconFile) { $ICON_BYTES = [System.IO.File]::ReadAllBytes($iconFile) }

# ---- khoi dong listener --------------------------------------
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$PORT/")
try {
  $listener.Start()
} catch {
  Write-Host ""
  Write-Host "  Khong mo duoc cong $PORT - rat co the app DANG CHAY roi." -ForegroundColor Yellow
  Write-Host "  Cua so nay se tu dong dong sau 4 giay..."
  Start-Sleep -Seconds 4
  exit 0
}

Write-Host ""
Write-Host "  ============================================================"
Write-Host "   NHA MAY SAN XUAT PHUONG QUAN - app dang chay"
Write-Host "   Mo trinh duyet tai:   http://localhost:$PORT/"
Write-Host "   Du lieu luu tai:      $dataDir"
Write-Host "   Sao luu tu dong:      $backupDir"
Write-Host ""
Write-Host "   >> DE TAT APP: dong cua so nay (hoac chay 'Dung Nha May.bat')"
Write-Host "  ============================================================"
Write-Host ""

while ($listener.IsListening) {
  $ctx = $null
  try { $ctx = $listener.GetContext() } catch { break }
  try {
    $req    = $ctx.Request
    $path   = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
    $method = $req.HttpMethod
    $query  = $req.QueryString

    if ($path -eq '/' -or $path -eq '/index.html' -or $path -eq '/app.html') {
      Send-Bytes $ctx 200 'text/html; charset=utf-8' $APP_BYTES; continue
    }
    if ($path -eq '/_local/claude-shim.js') {
      Send-Bytes $ctx 200 'application/javascript; charset=utf-8' $SHIM_BYTES; continue
    }
    if ($path -eq '/_local/electric.xlsx' -or $path -eq '/_local/cokhi.xlsx') {
      $fn = [System.IO.Path]::GetFileName($path)
      $ex = Find-File ('_local\' + $fn) $fn
      if (Test-Path $ex) {
        Send-Bytes $ctx 200 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ([System.IO.File]::ReadAllBytes($ex))
      } else { Send-Text $ctx 404 'no sheet file' }
      continue
    }
    if ($path -eq '/favicon.ico' -or $path -eq '/_local/icon.png') {
      if ($ICON_BYTES) { Send-Bytes $ctx 200 'image/png' $ICON_BYTES } else { Send-Text $ctx 404 'no icon' }
      continue
    }

    if ($path -eq '/api/ping') { Send-Json $ctx 200 @{ ok = $true; app = 'nmsx-pq'; port = $PORT }; continue }

    if ($path -match '^/api/rev/([^/]+)$') {
      Send-Json $ctx 200 @{ rev = (Get-Rev $Matches[1]) }; continue
    }

    if ($path -match '^/api/coll/([^/]+)$' -and $method -eq 'GET') {
      $c = $Matches[1]
      Send-Json $ctx 200 @{ rev = (Get-Rev $c); docs = (Load-Coll $c) }; continue
    }

    # Ghi HANG LOAT: thay ca collection bang 1 lan ghi file duy nhat.
    # Dung cho "Dong bo Sheet" (cap nhat vai chuc don cung luc) - tranh
    # ban vai tram request lam server qua tai.
    if ($path -match '^/api/coll/([^/]+)$' -and $method -eq 'PUT') {
      $c = $Matches[1]
      $reader  = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
      $bodyTxt = $reader.ReadToEnd(); $reader.Close()
      $body = $null
      if (-not [string]::IsNullOrWhiteSpace($bodyTxt)) { $body = $JS.DeserializeObject($bodyTxt) }
      if ($null -eq $body) { $body = (New-Object 'System.Collections.Generic.Dictionary[string,object]') }
      $mode = $query['mode']; if (-not $mode) { $mode = 'replace' }
      if ($mode -eq 'merge') {
        $cur = Load-Coll $c
        foreach ($k in @($body.Keys)) { $cur[$k] = $body[$k] }
        Save-Coll $c $cur
      } else {
        Save-Coll $c $body
      }
      Send-Bytes $ctx 204 'text/plain' $null; continue
    }

    if ($path -match '^/api/doc/([^/]+)/(.+)$') {
      $c = $Matches[1]; $id = $Matches[2]
      $data = Load-Coll $c

      if ($method -eq 'GET') {
        $has = $data.ContainsKey($id)
        if ($has) { Send-Json $ctx 200 @{ exists = $true; data = $data[$id] } }
        else      { Send-Json $ctx 200 @{ exists = $false; data = $null } }
        continue
      }

      if ($method -eq 'DELETE') {
        if ($data.ContainsKey($id)) { [void]$data.Remove($id); Save-Coll $c $data }
        Send-Bytes $ctx 204 'text/plain' $null; continue
      }

      if ($method -eq 'PUT') {
        $reader  = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
        $bodyTxt = $reader.ReadToEnd(); $reader.Close()
        $body = @{}
        if (-not [string]::IsNullOrWhiteSpace($bodyTxt)) { $body = $JS.DeserializeObject($bodyTxt) }
        $mode = $query['mode']; if (-not $mode) { $mode = 'set' }

        if ($mode -eq 'update' -and $data.ContainsKey($id) -and ($data[$id] -is [System.Collections.IDictionary])) {
          $cur = $data[$id]
          foreach ($k in @($body.Keys)) { $cur[$k] = $body[$k] }
          $data[$id] = $cur
        } else {
          $data[$id] = $body
        }
        Save-Coll $c $data
        Send-Bytes $ctx 204 'text/plain' $null; continue
      }
    }

    Send-Text $ctx 404 'Not found'
  } catch {
    try { Send-Json $ctx 500 @{ error = ("$_") } } catch {}
  }
}
