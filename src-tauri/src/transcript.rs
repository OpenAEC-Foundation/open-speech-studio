/// Conservatively collapse three or more consecutive copies of a phrase of at
/// least three words. Short repetitions ("ja ja", "nee, nee") stay untouched.
/// The caller must retain the original and show a review warning: missing speech
/// cannot be recovered by deduplicating a model's output.
pub fn remove_repetition_loops(text: &str) -> (String, bool) {
    let mut offset = 0;
    let tokens: Vec<_> = text
        .split_whitespace()
        .map(|word| {
            let start = offset + text[offset..].find(word).unwrap();
            offset = start + word.len();
            (start, word.to_lowercase())
        })
        .collect();
    let mut output = String::new();
    let mut copied_until = 0;
    let mut i = 0;
    let mut changed = false;
    while i + 9 <= tokens.len() {
        let mut end = None;
        for width in 3..=((tokens.len() - i) / 3).min(80) {
            // Repeated single words remain legitimate short repetitions,
            // even if there are enough of them to fill a three-word block.
            if tokens[i..i + width].iter().all(|t| t.1 == tokens[i].1) {
                continue;
            }
            let equal = |other: usize| (0..width).all(|j| tokens[i + j].1 == tokens[other + j].1);
            if equal(i + width) && equal(i + 2 * width) {
                let mut next = i + 3 * width;
                while next + width <= tokens.len() && equal(next) {
                    next += width;
                }
                end = Some((width, next));
                break;
            }
        }
        if let Some((width, next)) = end {
            output.push_str(&text[copied_until..tokens[i + width].0]);
            copied_until = tokens.get(next).map_or(text.len(), |t| t.0);
            i = next;
            changed = true;
        } else {
            i += 1;
        }
    }
    if !changed {
        return (text.to_owned(), false);
    }
    output.push_str(&text[copied_until..]);
    log::warn!("Repetition loop removed; transcript requires review against the recording");
    (output.trim().to_owned(), true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collapses_phrase_and_sentence_loops_but_keeps_surrounding_speech() {
        assert_eq!(
            remove_repetition_loops("A B C A B C A B C"),
            ("A B C".into(), true)
        );
        let phrase = "Die huren wij regelmatig in. En kabels. Dat is een bedrijf in de stad.";
        let input = format!("Vooraf. {} Daarna gaat het verder.", [phrase; 7].join(" "));
        assert_eq!(
            remove_repetition_loops(&input),
            (format!("Vooraf. {phrase} Daarna gaat het verder."), true)
        );
    }

    #[test]
    fn preserves_short_and_nonconsecutive_repetitions_and_formatting() {
        for text in [
            "ja ja",
            "nee, nee",
            "ja ja ja ja ja ja ja ja ja",
            "A B C A B C",
            "A B C X A B C Y A B C",
            "één\n\ntwee\tbedrag € 10",
        ] {
            assert_eq!(remove_repetition_loops(text), (text.into(), false));
        }
    }

    #[test]
    fn handles_unicode_and_multiple_loops() {
        assert_eq!(remove_repetition_loops("Één twee drie. één twee drie. één twee drie. Volgende zin hier. Volgende zin hier. Volgende zin hier."), ("Één twee drie. Volgende zin hier.".into(), true));
    }
}
