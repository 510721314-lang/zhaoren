param(
  [Parameter(Mandatory=$true)][string]$Fn,
  [Parameter(Mandatory=$true)][string]$EvFile,
  [int]$TimeoutMs = 25000
)
$ErrorActionPreference = 'Stop'
$ENV_ID = 'cloud1-d9gkefwcp5c777088'
$PROJECT = 'c:\Users\DC\Desktop\zhaoren'
$APPID = 'wxbc4a4afacdf234f5'

# 1) upgrade handshake
$up = Invoke-WebRequest -Uri "http://127.0.0.1:11841/upgrade" -TimeoutSec 5 -UseBasicParsing
$raw = $up.Content
if ($raw -is [byte[]]) { $raw = [System.Text.Encoding]::UTF8.GetString($raw) }
if ($raw -is [string] -and $raw.TrimStart().StartsWith('[')) {
  $bytes = [byte[]]($raw | ConvertFrom-Json)
  $raw = [System.Text.Encoding]::UTF8.GetString($bytes)
}
$hand = $raw | ConvertFrom-Json
$port = $hand.port
$projectId = '' + $hand.projectId

$nonce = -join ((1..40) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
# 2026-09-13 实测：子协议必须是 projectId + "_CLI"（来自 cli/index.js: d=u+"_CLI"）；加 nonce 或只给 projectId 都会被服务端丢弃/关闭
$proto = $projectId + '_CLI'

$evText = [System.IO.File]::ReadAllText($EvFile, [System.Text.Encoding]::UTF8)
# substitute {{VARS}}
$varsFile = Join-Path $PSScriptRoot 'vars.json'
if (Test-Path $varsFile) {
  $vars = (Get-Content $varsFile -Raw | ConvertFrom-Json)
  $vars.PSObject.Properties | ForEach-Object {
    $evText = $evText.Replace('{{' + $_.Name + '}}', [string]$_.Value)
  }
}
if ($evText -match '\{\{[A-Z0-9_]+\}\}') {
  [Console]::Out.WriteLine('UNRESOLVED ' + $Matches[0])
  exit 6
}

$msg = @{
  type = 'CLOUD_FUNCTIONS_CALL'
  env = $ENV_ID
  name = $Fn
  data = $evText
  callback = @{ id = 0 }
  project = $PROJECT
  appid = $APPID
  extAppid = ''
  lang = 'zh'
  clientId = $nonce
  cwd = $PROJECT
} | ConvertTo-Json -Compress -Depth 10

# 2) websocket
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ws.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(5)
$ws.Options.AddSubProtocol($proto)
$uri = [Uri]("ws://127.0.0.1:$port")
$cts = New-Object System.Threading.CancellationTokenSource([TimeSpan]::FromMilliseconds($TimeoutMs))
$ct = $cts.Token

function Send-Text([string]$s) {
  $buf = [System.Text.Encoding]::UTF8.GetBytes($s)
  $seg = [ArraySegment[byte]]::new($buf)
  $script:ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).GetAwaiter().GetResult() | Out-Null
}
function Recv-Message {
  $ms = New-Object System.IO.MemoryStream
  $buf = New-Object byte[] 65536
  while ($true) {
    $seg = [ArraySegment[byte]]::new($buf)
    $r = $script:ws.ReceiveAsync($seg, $ct).GetAwaiter().GetResult()
    if ($r.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
      return $null
    }
    $ms.Write($buf, 0, $r.Count)
    if ($r.EndOfMessage) { break }
  }
  return [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
}

try {
  [Console]::Error.WriteLine("STAGE connect ws://127.0.0.1:$port proto=$proto")
  $ws.ConnectAsync($uri, $ct).GetAwaiter().GetResult() | Out-Null
  [Console]::Error.WriteLine("STAGE connected state=$($ws.State)")
  Send-Text $msg
  [Console]::Error.WriteLine('STAGE sent, waiting')
  while ($true) {
    $txt = Recv-Message
    if ($null -eq $txt) { [Console]::Out.WriteLine('WS_CLOSED'); exit 5 }
    $p = $null
    try { $p = $txt | ConvertFrom-Json } catch {}
    if ($p -and $p.type -eq 'HEARTBEAT') {
      $hb = @{ type = 'CALLBACK'; callback = $p.callback } | ConvertTo-Json -Compress -Depth 6
      Send-Text $hb
      continue
    }
    if ($p -and $p.type -eq 'CALLBACK') {
      $out = $p.payload
      if (-not $out -and $p.error) { $out = $p.error }
      [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress -Depth 12))
      exit 0
    }
    # other message types: print raw and keep? print and exit
    [Console]::Out.WriteLine('MSG ' + $txt)
    exit 0
  }
} finally {
  [Console]::Error.WriteLine("CLOSE state=$($ws.State) status=$($ws.CloseStatus) desc=$($ws.CloseStatusDescription)")
  try { $ws.Dispose() } catch {}
}
