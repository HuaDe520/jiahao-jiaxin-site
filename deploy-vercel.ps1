# 一键部署到 Vercel
#
# 用法（在 PowerShell 里，于本文件夹下执行）：
#   powershell -ExecutionPolicy Bypass -File .\deploy-vercel.ps1
#
# 首次运行会要求登录（浏览器授权或输入邮箱），登录一次之后就不用再登了。

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

Write-Host ''
Write-Host '=== 浙江嘉豪嘉欣协会 · Vercel 部署 ===' -ForegroundColor Cyan
Write-Host ''

# 1. 检查 Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host '没有找到 Node.js。请先安装：https://nodejs.org/ （或 winget install OpenJS.NodeJS.LTS）' -ForegroundColor Red
  exit 1
}
Write-Host ("Node.js " + (& node --version)) -ForegroundColor Green

# 2. 上线前提醒
Write-Host ''
Write-Host '提醒：发布前请先替换 index.html 中 #join 区块里的 QQ 群号 / 微信群等占位内容，' -ForegroundColor Yellow
Write-Host '      并删除页面底部那段带 #join 的提示文案（class="contact__note"）。' -ForegroundColor Yellow
Write-Host ''
$answer = Read-Host '已经替换好了吗？继续部署请输入 y'
if ($answer -ne 'y' -and $answer -ne 'Y') {
  Write-Host '已取消。' -ForegroundColor Yellow
  exit 0
}

# 3. 部署（--prod 直接发到生产环境，--yes 使用默认项目设置）
Write-Host ''
Write-Host '开始部署……首次运行会提示登录，按提示完成即可。' -ForegroundColor Cyan
Write-Host ''

& npx --yes vercel@latest deploy --prod --yes

Write-Host ''
Write-Host '完成。上面输出的 Production 地址就是你的公开网址（形如 https://xxx.vercel.app）。' -ForegroundColor Green
Write-Host '要改项目名，可以执行： npx vercel --prod --name jiahao-jiaxin' -ForegroundColor Gray
