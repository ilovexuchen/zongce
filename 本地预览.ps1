Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '请先安装 Node.js，或使用已部署的 GitHub Pages 网址。'
  exit 1
}
node tools/serve.mjs
