#!/bin/bash
# Download and setup Gradle wrapper for Android builds

GRADLE_VERSION="8.2"
GRADLE_ZIP="gradle-${GRADLE_VERSION}-bin.zip"
GRADLE_URL="https://services.gradle.org/distributions/${GRADLE_ZIP}"

cd "$(dirname "$0")/../android" || exit 1

echo "Downloading Gradle wrapper ${GRADLE_VERSION}..."
curl -L -o "${GRADLE_ZIP}" "${GRADLE_URL}"

echo "Extracting..."
unzip -q "${GRADLE_ZIP}"
mv "gradle-${GRADLE_VERSION}" gradle

echo "Creating wrapper files..."
cat > gradlew << 'EOF'
#!/bin/sh
GRADLE_HOME="$(cd "$(dirname "$0")/gradle" && pwd)"
exec "${GRADLE_HOME}/bin/gradle" "$@"
EOF

cat > gradlew.bat << 'EOF'
@echo off
set GRADLE_HOME=%~dp0gradle
"%GRADLE_HOME%\bin\gradle.bat" %*
EOF

chmod +x gradlew

echo "Cleaning up..."
rm "${GRADLE_ZIP}"

echo "✅ Gradle wrapper installed successfully!"
echo "Test with: cd android && ./gradlew --version"
