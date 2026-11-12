$ErrorActionPreference = 'Stop'
# An independent, statically linked CPU executable. Never load the legacy
# CUDA-linked executable on systems without an NVIDIA driver.
$workDir = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$source = Join-Path $workDir 'speech-whisper-cpu'
if (!(Test-Path $source)) {
    git clone --depth 1 --branch v1.8.3 https://github.com/ggml-org/whisper.cpp.git $source
    if ($LASTEXITCODE) { throw 'Cannot fetch whisper.cpp v1.8.3' }
}
cmake -S $source -B "$source/build" -A x64 `
    -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF `
    -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded `
    -DGGML_NATIVE=OFF -DGGML_CUDA=OFF -DGGML_OPENMP=OFF `
    -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF
if ($LASTEXITCODE) { throw 'CPU backend configuration failed' }
cmake --build "$source/build" --config Release --parallel 4 --target whisper-cli
if ($LASTEXITCODE) { throw 'CPU backend build failed' }
New-Item -ItemType Directory -Force bin | Out-Null
Copy-Item "$source/build/bin/Release/whisper-cli.exe" bin/whisper-cli-cpu.exe -Force

# Run from an empty directory, without the CUDA DLLs or any bundled runtime.
$smoke = Join-Path $workDir 'speech-cpu-smoke'
New-Item -ItemType Directory -Force $smoke | Out-Null
Copy-Item bin/whisper-cli-cpu.exe "$smoke/whisper-cli-cpu.exe" -Force
$sample = Join-Path $source 'samples/jfk.wav'
$model = (Resolve-Path models/ggml-small.bin).Path
$vad = (Resolve-Path models/ggml-silero-v5.1.2.bin).Path
& "$smoke/whisper-cli-cpu.exe" -ng -m $model -f $sample -nt -mc 64 --carry-initial-prompt --prompt 'BIM, IFC, fundering, structural engineer' --suppress-nst --vad -vm $vad 2> "$smoke/stderr.log" | Tee-Object -FilePath "$smoke/out.txt"
if ($LASTEXITCODE) { throw "CPU transcription failed: $(Get-Content "$smoke/stderr.log" -Raw)" }
if (!(Select-String -Path "$smoke/out.txt" -Pattern 'ask not' -Quiet)) {
    throw 'CPU transcription did not contain the expected words'
}
# Test without a VAD model too; no VAD flags may be required by the executable.
& "$smoke/whisper-cli-cpu.exe" -ng -m $model -f $sample -nt -mc 0 --suppress-nst 2> "$smoke/no-vad.log" | Out-Null
if ($LASTEXITCODE) { throw 'CPU transcription without VAD failed' }
