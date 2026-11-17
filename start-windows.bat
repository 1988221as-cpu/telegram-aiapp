@echo off
title HumanSense 智能桌面客户端
chcp 65001 >nul
cls

echo ===================================================
echo     HumanSense 智能多开客户端正在启动...
echo ===================================================
echo.

set PORT=38271
set HOST=127.0.0.1
set NODE_ENV=production
set ALLOW_LOCALHOST_AI_ENDPOINTS=true
if "%DATA_DIR%"=="" set DATA_DIR=%LOCALAPPDATA%\HumanSense\data
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

:: 自动启动后台服务并在 2 秒后打开独立客户端桌面窗口
start /b "" node dist/server.js

timeout /t 2 /nobreak >nul

:: 优先使用系统内置 Edge/Chrome 打开独立无边框 App 窗口
where msedge >nul 2>nul
if %errorlevel% equ 0 (
    start "" msedge --app=http://127.0.0.1:38271
    exit
)

where chrome >nul 2>nul
if %errorlevel% equ 0 (
    start "" chrome --app=http://127.0.0.1:38271
    exit
)

:: 备用：默认浏览器打开
start "" http://127.0.0.1:38271
exit
