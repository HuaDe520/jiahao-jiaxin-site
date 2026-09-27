# 通过 Git 推送到 GitHub（需要先安装 Git）
#
# 用法：
#   1) 先在 GitHub 网页上新建一个空仓库（不要勾选 README），拿到仓库地址
#   2) 在本文件夹下执行：
#        powershell -ExecutionPolicy Bypass -File .\deploy-github.ps1 -RepoUrl https://github.com/你的用户名/jiahao-jiaxin-site.git
#
# 推送完成后，到仓库 Settings → Pages 把 Source 设为 "GitHub Actions"（推荐，仓库里已带工作流）
# 或者 "Deploy from a branch" → main → / (root)。

param(
  [Parameter(Mandatory = $true)]
  [string]$RepoUrl
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
  Write-Host '没有找到 Git。请先安装后重新执行：' -ForegroundColor Red
  Write-Host '  winget install --id Git.Git -e --source winget' -ForegroundColor Yellow
  Write-Host '  或者到 https://git-scm.com/download/win 下载安装，装完重开终端。' -ForegroundColor Yellow
  exit 1
}

if (-not (Test-Path '.git')) {
  Write-Host '初始化本地仓库……' -ForegroundColor Cyan
  git init | Out-Null
}

git add -A
$changes = git status --porcelain
if ($changes) {
  git -c core.quotepath=false commit -m '更新协会官网' | Out-Null
  Write-Host '已提交本地改动。' -ForegroundColor Green
} else {
  Write-Host '没有需要提交的改动。' -ForegroundColor Gray
}

git branch -M main

$remotes = git remote
if ($remotes -notcontains 'origin') {
  git remote add origin $RepoUrl
} else {
  git remote set-url origin $RepoUrl
}

Write-Host '推送到 GitHub……' -ForegroundColor Cyan
git push -u origin main

Write-Host ''
Write-Host '推送完成。接下来到仓库 Settings → Pages 选择发布源，' -ForegroundColor Green
Write-Host '一两分钟后访问 https://<你的用户名>.github.io/<仓库名>/' -ForegroundColor Green
