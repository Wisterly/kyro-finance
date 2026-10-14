@echo off
title KYRO Finance - Servidor do Robo WhatsApp
:loop
cls
echo =========================================================
echo    KYRO FINANCE - SERVIDOR DO ROBO WHATSAPP ATIVO
echo =========================================================
echo.
echo [1/2] Iniciando o servidor de comunicacao do WhatsApp...
echo [2/2] Escutando na porta 3001 para pareamento com o sistema.
echo.
echo Deixe esta janela aberta em segundo plano enquanto usar o sistema!
echo.
node bot.cjs
echo.
echo Reiniciando servidor em 3 segundos... (Pressione Ctrl+C para fechar)
timeout /t 3 >nul
goto loop
