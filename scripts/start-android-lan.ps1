param([int]$Port = 4187, [switch]$AllowPublicProfile)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$address = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.InterfaceAlias -match 'WLAN|Wi-Fi|无线' -and $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' } |
  Select-Object -First 1 -ExpandProperty IPAddress
if (-not $address) { throw '未找到连接中的 Wi-Fi 私有地址。请先将电脑和手机连接到同一 Wi-Fi。' }
$profile = Get-NetConnectionProfile -InterfaceAlias 'WLAN' -ErrorAction SilentlyContinue
if ($profile.NetworkCategory -ne 'Private' -and -not $AllowPublicProfile) {
  throw '当前 Wi-Fi 被标为公用网络。仅在确认为私人 Wi-Fi 时使用 -AllowPublicProfile 启动测试。'
}
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  throw "端口 $Port 已被占用。请用 -Port 指定其他端口。"
}

$env:PORT = [string]$Port
$env:YINGXING_BIND_HOST = $address
$env:YINGXING_PUBLIC = '1'
$env:YINGXING_LAN_TEST = '1'
$env:YINGXING_PUBLIC_ORIGIN = "https://${address}:$Port"
$env:YINGXING_DATA_DIR = Join-Path $root 'test-output\android-lan-data'
$env:YINGXING_TLS_CERT = Join-Path $root 'test-output\android-lan-tls\server-cert.pem'
$env:YINGXING_TLS_KEY = Join-Path $root 'test-output\android-lan-tls\server-key.pem'
if (-not (Test-Path -LiteralPath $env:YINGXING_TLS_CERT) -or -not (Test-Path -LiteralPath $env:YINGXING_TLS_KEY)) {
  throw '缺少手机测试证书。请不要移动 test-output\android-lan-tls 中的文件。'
}
Write-Host "手机测试地址：$env:YINGXING_PUBLIC_ORIGIN"
Write-Host '使用期间请保持此窗口打开。测试资料单独存放在 test-output\android-lan-data。'
Write-Host '若系统提示防火墙访问，请只允许专用网络。按 Ctrl+C 停止。'
Set-Location $root
node server/index.js
