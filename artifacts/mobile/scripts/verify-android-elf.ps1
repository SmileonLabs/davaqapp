param([Parameter(Mandatory=$true)][string]$Apk)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Apk).Path)
$checked = 0
try {
  foreach ($entry in $archive.Entries) {
    if ($entry.FullName -notmatch '^lib/arm64-v8a/.+\.so$') { continue }
    $inputStream = $entry.Open()
    $memory = [IO.MemoryStream]::new()
    try { $inputStream.CopyTo($memory); $bytes = $memory.ToArray() }
    finally { $inputStream.Dispose(); $memory.Dispose() }
    if ($bytes.Length -lt 64 -or $bytes[0] -ne 127 -or $bytes[1] -ne 69 -or $bytes[2] -ne 76 -or $bytes[3] -ne 70 -or $bytes[4] -ne 2 -or $bytes[5] -ne 1) {
      throw "Expected little-endian ELF64: $($entry.FullName)"
    }
    $offset = [BitConverter]::ToUInt64($bytes,32)
    $size = [BitConverter]::ToUInt16($bytes,54)
    $count = [BitConverter]::ToUInt16($bytes,56)
    if ($size -lt 56 -or $offset + $size * $count -gt $bytes.Length) { throw "Invalid ELF program headers: $($entry.FullName)" }
    $loads = 0
    for ($i=0; $i -lt $count; $i++) {
      $header = [int]($offset + $i * $size)
      if ([BitConverter]::ToUInt32($bytes,$header) -ne 1) { continue }
      $loads++
      $fileOffset = [BitConverter]::ToUInt64($bytes,$header+8)
      $virtualAddress = [BitConverter]::ToUInt64($bytes,$header+16)
      $alignment = [BitConverter]::ToUInt64($bytes,$header+48)
      if ($alignment -lt 16384 -or ($virtualAddress % 16384) -ne ($fileOffset % 16384)) {
        throw "16 KB ELF alignment failed: $($entry.FullName) LOAD=$i alignment=$alignment"
      }
    }
    if ($loads -eq 0) { throw "No LOAD segments: $($entry.FullName)" }
    $checked++
  }
  if ($checked -eq 0) { throw 'No ARM64 native libraries found' }
  Write-Output "ELF alignment passed: $checked ARM64 libraries support 16 KB LOAD alignment."
} finally { $archive.Dispose() }
