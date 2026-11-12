# Bundled models

`ggml-small.bin` is the existing Whisper speech model.

`ggml-silero-v5.1.2.bin` is the optional Silero VAD model used to skip non-speech
before local transcription. The application remains usable if it is absent.

Source (MIT): https://huggingface.co/ggml-org/whisper-vad/tree/9ffd54a1e1ee413ddf265af9913beaf518d1639b

Download: https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v5.1.2.bin

SHA-256: `29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf`

Both binary files use Git LFS. Use `git lfs pull` after cloning.
