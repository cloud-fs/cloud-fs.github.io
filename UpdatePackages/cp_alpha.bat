@echo off
setlocal
:: Check for version number argument
if "%~1"=="" (
    echo Please provide a version number.
    echo Usage: %0 version_number
    exit /b 1
)

:: Set version number
set VERSION=%~1

copy CloudDrive2\Android-Arm\Alpha\%VERSION%\readme.txt CloudDrive2\Android-Arm64\Alpha\%VERSION%\readme.txt
copy CloudDrive2\Android-Arm\Alpha\%VERSION%\readme.txt CloudDrive2\Android-X64\Alpha\%VERSION%\readme.txt
copy CloudDrive2\Android-Arm\Alpha\%VERSION%\readme.txt CloudDrive2\Linux-Arm\Alpha\%VERSION%\readme.txt
copy CloudDrive2\Android-Arm\Alpha\%VERSION%\readme.txt CloudDrive2\Linux-Arm64\Alpha\%VERSION%\readme.txt
copy CloudDrive2\Android-Arm\Alpha\%VERSION%\readme.txt CloudDrive2\Linux-X64\Alpha\%VERSION%\readme.txt
copy CloudDrive2\Android-Arm\Alpha\%VERSION%\readme.txt CloudDrive2\Macos-Arm64\Alpha\%VERSION%\readme.txt
copy CloudDrive2\Android-Arm\Alpha\%VERSION%\readme.txt CloudDrive2\Macos-X64\Alpha\%VERSION%\readme.txt
copy CloudDrive2\Android-Arm\Alpha\%VERSION%\readme.txt CloudDrive2\Windows-X64\Alpha\%VERSION%\readme.txt