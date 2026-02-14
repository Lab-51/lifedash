# === FILE PURPOSE ===
# Generate a self-signed code signing certificate for Living Dashboard.
# This certificate enables Squirrel installer signing to avoid "Unknown Publisher"
# SmartScreen warnings during installation.
#
# USAGE:
#   $env:CERT_PASSWORD = "your-secure-password"
#   .\scripts\generate-cert.ps1
#
# OUTPUT:
#   certs/living-dashboard.pfx — PKCS#12 certificate file (DO NOT COMMIT)
#
# FOR IT / GROUP POLICY DEPLOYMENT:
#   To suppress SmartScreen warnings across an organization, import the
#   certificate into the GPO Trusted Publishers store:
#
#   1. Open Group Policy Management Console (gpmc.msc)
#   2. Edit the target GPO
#   3. Navigate to:
#      Computer Configuration > Policies > Windows Settings >
#      Security Settings > Public Key Policies > Trusted Publishers
#   4. Right-click > Import > select the .pfx file
#   5. Enter the certificate password when prompted
#   6. Run "gpupdate /force" on target machines
#
#   Alternatively, for a single machine:
#   Import-PfxCertificate -FilePath .\certs\living-dashboard.pfx `
#     -CertStoreLocation Cert:\LocalMachine\TrustedPublisher `
#     -Password (ConvertTo-SecureString -String $env:CERT_PASSWORD -AsPlainText -Force)

param()

$ErrorActionPreference = "Stop"

# Validate password is set
if (-not $env:CERT_PASSWORD) {
    Write-Error "CERT_PASSWORD environment variable is required. Set it before running this script."
    exit 1
}

# Create certs directory if it doesn't exist
$certsDir = Join-Path $PSScriptRoot ".." "certs"
if (-not (Test-Path $certsDir)) {
    New-Item -ItemType Directory -Path $certsDir -Force | Out-Null
    Write-Host "Created certs/ directory"
}

$pfxPath = Join-Path $certsDir "living-dashboard.pfx"

# Check if certificate already exists
if (Test-Path $pfxPath) {
    Write-Warning "Certificate already exists at $pfxPath"
    $confirm = Read-Host "Overwrite? (y/N)"
    if ($confirm -ne "y") {
        Write-Host "Aborted."
        exit 0
    }
}

# Generate self-signed code signing certificate
Write-Host "Generating self-signed code signing certificate..."

$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject "CN=Living Dashboard, O=Living Dashboard" `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -NotAfter (Get-Date).AddYears(3) `
    -CertStoreLocation Cert:\CurrentUser\My

Write-Host "Certificate created: $($cert.Thumbprint)"

# Export to PFX
$password = ConvertTo-SecureString -String $env:CERT_PASSWORD -AsPlainText -Force

Export-PfxCertificate `
    -Cert $cert `
    -FilePath $pfxPath `
    -Password $password | Out-Null

Write-Host "Exported to: $pfxPath"

# Clean up from certificate store (the PFX is the portable artifact)
Remove-Item -Path "Cert:\CurrentUser\My\$($cert.Thumbprint)" -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Done. To use for signing:"
Write-Host '  $env:CERT_PASSWORD = "your-password"'
Write-Host "  npm run make"
Write-Host ""
Write-Host "IMPORTANT: Do NOT commit certs/ to version control."
