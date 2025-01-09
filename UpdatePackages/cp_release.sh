#!/bin/bash

# Check for version number argument
if [ -z "$1" ]; then
    echo "Please provide a version number."
    echo "Usage: $0 version_number"
    exit 1
fi

# Set version number
VERSION=$1

cp -r CloudDrive2/Android-Arm/Beta/$VERSION CloudDrive2/Android-Arm/Release/$VERSION
cp -r CloudDrive2/Android-Arm64/Beta/$VERSION CloudDrive2/Android-Arm64/Release/$VERSION
cp -r CloudDrive2/Android-X64/Beta/$VERSION CloudDrive2/Android-X64/Release/$VERSION
cp -r CloudDrive2/Linux-Arm/Beta/$VERSION CloudDrive2/Linux-Arm/Release/$VERSION
cp -r CloudDrive2/Linux-Arm64/Beta/$VERSION CloudDrive2/Linux-Arm64/Release/$VERSION
cp -r CloudDrive2/Linux-X64/Beta/$VERSION CloudDrive2/Linux-X64/Release/$VERSION
cp -r CloudDrive2/Macos-Arm64/Beta/$VERSION CloudDrive2/Macos-Arm64/Release/$VERSION
cp -r CloudDrive2/Macos-X64/Beta/$VERSION CloudDrive2/Macos-X64/Release/$VERSION
cp -r CloudDrive2/Windows-X64/Beta/$VERSION CloudDrive2/Windows-X64/Release/$VERSION