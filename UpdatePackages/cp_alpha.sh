#!/bin/bash
# filepath: /Users/cloudfs/rust/cloud-fs.github.io/UpdatePackages/cp_Alpha.sh

# Check for version number argument
if [ -z "$1" ]; then
    echo "Please provide a version number."
    echo "Usage: $0 version_number"
    exit 1
fi

# Set version number
VERSION=$1

cp CloudDrive2/Android-Arm/Alpha/$VERSION/readme.txt CloudDrive2/Android-Arm64/Alpha/$VERSION/readme.txt
cp CloudDrive2/Android-Arm/Alpha/$VERSION/readme.txt CloudDrive2/Android-X64/Alpha/$VERSION/readme.txt
cp CloudDrive2/Android-Arm/Alpha/$VERSION/readme.txt CloudDrive2/Linux-Arm/Alpha/$VERSION/readme.txt
cp CloudDrive2/Android-Arm/Alpha/$VERSION/readme.txt CloudDrive2/Linux-Arm64/Alpha/$VERSION/readme.txt
cp CloudDrive2/Android-Arm/Alpha/$VERSION/readme.txt CloudDrive2/Linux-X64/Alpha/$VERSION/readme.txt
cp CloudDrive2/Android-Arm/Alpha/$VERSION/readme.txt CloudDrive2/Macos-Arm64/Alpha/$VERSION/readme.txt
cp CloudDrive2/Android-Arm/Alpha/$VERSION/readme.txt CloudDrive2/Macos-X64/Alpha/$VERSION/readme.txt
cp CloudDrive2/Android-Arm/Alpha/$VERSION/readme.txt CloudDrive2/Windows-X64/Alpha/$VERSION/readme.txt
cp CloudDrive2/Android-Arm/Alpha/$VERSION/readme.txt CloudDrive2/Windows-Arm64/Alpha/$VERSION/readme.txt
