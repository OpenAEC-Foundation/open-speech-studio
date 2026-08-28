//! Timeline mixer: places audio from several capture streams onto one shared
//! 16 kHz mono timeline, addressed by timestamp rather than by arrival order.
//!
//! Appending samples as they arrive does not work once system audio is in the
//! mix. WASAPI loopback delivers no packets at all while nothing is playing, so
//! a quiet stretch would shrink to nothing and everything after it would slide
//! earlier — after an hour of meeting the system source is far out of step with
//! the microphone. OBS Studio solves this in its mixer, not in its capture: each
//! packet carries the timestamp the audio was captured at, and the mixer writes
//! it at the position that timestamp implies. A source that delivered nothing
//! simply contributes silence there. This module does the same.
//!
//! Offsets come in as nanoseconds since the recording started; `audio.rs` owns
//! the clock and anchors it on the first microphone packet.

/// Timeline sample rate. Whisper wants 16 kHz mono.
pub const SAMPLE_RATE: u32 = 16_000;

/// Nanoseconds covered by one sample at [`SAMPLE_RATE`].
const NS_PER_SAMPLE: i128 = 1_000_000_000 / SAMPLE_RATE as i128;

/// How much of the tail `take` leaves in place, so a packet from the slower
/// stream still lands at its own position instead of after the cut.
const DRAIN_MARGIN_SAMPLES: usize = (SAMPLE_RATE as usize * 300) / 1000;

pub struct TimelineMixer {
    /// The retained part of the timeline. `samples[0]` sits at absolute
    /// position `drained`.
    samples: Vec<f32>,
    /// How many samples have already been handed out.
    drained: usize,
}

impl TimelineMixer {
    pub fn new() -> Self {
        Self {
            samples: Vec::new(),
            drained: 0,
        }
    }

    /// Mix `samples` into the timeline at `offset_ns` after the recording
    /// origin. Gaps become silence, overlapping sources are summed.
    pub fn write(&mut self, offset_ns: i128, samples: &[f32]) {
        if samples.is_empty() {
            return;
        }

        let position = (offset_ns.max(0) / NS_PER_SAMPLE) as usize;
        if position < self.drained {
            // The slot is gone: this packet is later than the drain margin
            // allows for, or its clock jumped backwards. Writing it anywhere
            // else would put the audio at a time it did not happen.
            log::debug!(
                "mixer: dropping {} samples for position {}, already drained to {}",
                samples.len(),
                position,
                self.drained
            );
            return;
        }

        let start = position - self.drained;
        let end = start + samples.len();
        if self.samples.len() < end {
            self.samples.resize(end, 0.0);
        }
        for (slot, sample) in self.samples[start..end].iter_mut().zip(samples) {
            *slot = (*slot + *sample).clamp(-1.0, 1.0);
        }
    }

    /// Drain everything except the last [`DRAIN_MARGIN_SAMPLES`]. Used for the
    /// meeting recorder's periodic segments, while both streams keep running.
    pub fn take(&mut self) -> Vec<f32> {
        if self.samples.len() <= DRAIN_MARGIN_SAMPLES {
            return Vec::new();
        }
        let cut = self.samples.len() - DRAIN_MARGIN_SAMPLES;
        let tail = self.samples.split_off(cut);
        let head = std::mem::replace(&mut self.samples, tail);
        self.drained += cut;
        head
    }

    /// Drain the whole timeline. Used when the streams are being torn down.
    pub fn take_all(&mut self) -> Vec<f32> {
        self.drained += self.samples.len();
        std::mem::take(&mut self.samples)
    }

    /// Throw away what is buffered without returning it, keeping positions
    /// consistent for whatever arrives next.
    pub fn clear(&mut self) {
        let _ = self.take_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Nanosecond offset of an absolute sample position.
    fn at(position: usize) -> i128 {
        position as i128 * NS_PER_SAMPLE
    }

    #[test]
    fn first_write_starts_at_the_beginning() {
        let mut mixer = TimelineMixer::new();
        mixer.write(at(0), &[1.0, 1.0]);
        assert_eq!(mixer.take_all(), vec![1.0, 1.0]);
    }

    #[test]
    fn gap_between_writes_becomes_silence() {
        let mut mixer = TimelineMixer::new();
        mixer.write(at(0), &[1.0; 4]);
        mixer.write(at(16), &[0.5; 2]);

        let out = mixer.take_all();
        assert_eq!(out.len(), 18);
        assert_eq!(&out[0..4], &[1.0; 4]);
        assert!(out[4..16].iter().all(|s| *s == 0.0), "gap must be silence");
        assert_eq!(&out[16..18], &[0.5; 2]);
    }

    #[test]
    fn out_of_order_writes_land_at_their_timestamps() {
        let mut mixer = TimelineMixer::new();
        mixer.write(at(0), &[0.1]);
        mixer.write(at(10), &[0.3]);
        mixer.write(at(5), &[0.2]);

        let out = mixer.take_all();
        assert_eq!(out.len(), 11);
        assert_eq!(out[0], 0.1);
        assert_eq!(out[5], 0.2);
        assert_eq!(out[10], 0.3);
    }

    #[test]
    fn overlapping_sources_are_summed() {
        let mut mixer = TimelineMixer::new();
        mixer.write(at(0), &[0.25, 0.25, 0.25]);
        mixer.write(at(1), &[0.5, 0.5]);

        let out = mixer.take_all();
        assert_eq!(out, vec![0.25, 0.75, 0.75]);
    }

    #[test]
    fn sums_are_clamped_to_full_scale() {
        let mut mixer = TimelineMixer::new();
        mixer.write(at(0), &[0.9, -0.9]);
        mixer.write(at(0), &[0.9, -0.9]);

        assert_eq!(mixer.take_all(), vec![1.0, -1.0]);
    }

    #[test]
    fn take_leaves_the_margin_and_a_later_write_still_lands_right() {
        let mut mixer = TimelineMixer::new();
        let total = DRAIN_MARGIN_SAMPLES + 200;
        mixer.write(at(0), &vec![0.5; total]);

        let segment = mixer.take();
        assert_eq!(segment.len(), 200, "everything but the margin");

        // A packet for a position inside the retained margin still mixes in.
        mixer.write(at(250), &[0.5]);
        let rest = mixer.take_all();
        assert_eq!(rest.len(), DRAIN_MARGIN_SAMPLES);
        assert_eq!(rest[50], 1.0, "position 250 is 50 past the cut at 200");
    }

    #[test]
    fn take_returns_nothing_while_only_the_margin_is_buffered() {
        let mut mixer = TimelineMixer::new();
        mixer.write(at(0), &vec![0.5; DRAIN_MARGIN_SAMPLES]);
        assert!(mixer.take().is_empty());
    }

    #[test]
    fn write_before_the_drained_point_is_dropped() {
        let mut mixer = TimelineMixer::new();
        mixer.write(at(0), &vec![0.5; DRAIN_MARGIN_SAMPLES + 200]);
        mixer.take();

        mixer.write(at(0), &[1.0]);

        let rest = mixer.take_all();
        assert_eq!(rest.len(), DRAIN_MARGIN_SAMPLES);
        assert_eq!(rest[0], 0.5, "stale packet must not overwrite the margin");
    }

    #[test]
    fn empty_write_is_ignored() {
        let mut mixer = TimelineMixer::new();
        mixer.write(at(100), &[]);
        assert!(mixer.take_all().is_empty());
    }

    #[test]
    fn clear_keeps_positions_consistent() {
        let mut mixer = TimelineMixer::new();
        mixer.write(at(0), &vec![0.5; 100]);
        mixer.clear();

        // The next packet is 10 samples after the cleared stretch, so the
        // timeline resumes with 10 samples of silence — not 110.
        mixer.write(at(110), &[0.5]);
        assert_eq!(mixer.take_all().len(), 11);
    }
}
