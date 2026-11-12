The MP4 fixtures contain no human speech or third-party media.

Generated with FFmpeg 6.1.1:

    ffmpeg -f lavfi -i color=c=black:s=16x16:r=10:d=1 -f lavfi -i sine=frequency=440:sample_rate=48000:duration=1 -map 0:v -map 1:a -c:v mpeg4 -c:a aac -ac 2 -shortest aac-video.mp4
    ffmpeg -f lavfi -i color=c=black:s=16x16:r=10:d=0.2 -c:v mpeg4 -an video-only.mp4

The first fixture deliberately places video before the stereo 48 kHz AAC track.
Its decoder test verifies the resulting mono 16 kHz PCM WAV and duration.
