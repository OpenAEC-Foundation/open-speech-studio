//! Simple but effective post-transcription spell checker.
//!
//! Works by splitting text into words, checking each against a language-specific
//! word list, and replacing misspelled words with the closest match (edit distance).
//! Only corrects words that are "close enough" (distance <= 2) to avoid mangling
//! proper nouns and technical terms.

use std::collections::HashMap;
use std::sync::Mutex;

static WORD_LISTS: Mutex<Option<HashMap<String, Vec<String>>>> = Mutex::new(None);

/// Levenshtein edit distance between two strings.
fn edit_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let (m, n) = (a.len(), b.len());
    let mut dp = vec![vec![0usize; n + 1]; m + 1];
    for i in 0..=m { dp[i][0] = i; }
    for j in 0..=n { dp[0][j] = j; }
    for i in 1..=m {
        for j in 1..=n {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            dp[i][j] = (dp[i - 1][j] + 1)
                .min(dp[i][j - 1] + 1)
                .min(dp[i - 1][j - 1] + cost);
        }
    }
    dp[m][n]
}

/// Get or initialize the word list for a language.
fn get_word_list(lang: &str) -> Vec<String> {
    let mut lists = WORD_LISTS.lock().unwrap();
    if lists.is_none() {
        *lists = Some(HashMap::new());
    }
    let map = lists.as_mut().unwrap();

    let lang_key = match lang {
        "auto" | "" => "nl", // Default to Dutch
        l => l,
    };

    if let Some(words) = map.get(lang_key) {
        return words.clone();
    }

    // Try to load from config dir
    let words = load_word_list(lang_key);
    map.insert(lang_key.to_string(), words.clone());
    words
}

/// Load a word list from the config directory or use built-in common words.
fn load_word_list(lang: &str) -> Vec<String> {
    // Check for user-provided word list
    if let Ok(config_dir) = super::settings::get_config_dir() {
        let path = config_dir.join(format!("wordlist-{}.txt", lang));
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                return content.lines()
                    .map(|l| l.trim().to_lowercase())
                    .filter(|l| !l.is_empty() && !l.starts_with('#'))
                    .collect();
            }
        }
    }

    // Built-in common word lists for frequent transcription languages
    let words = match lang {
        "nl" => include_str!("wordlists/nl.txt"),
        "en" => include_str!("wordlists/en.txt"),
        "de" => include_str!("wordlists/de.txt"),
        "fr" => include_str!("wordlists/fr.txt"),
        _ => return Vec::new(), // No built-in list for this language
    };

    words.lines()
        .map(|l| l.trim().to_lowercase())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .collect()
}

/// Correct a full text string using the spell checker.
pub fn correct(text: &str, lang: &str) -> String {
    let word_list = get_word_list(lang);
    if word_list.is_empty() {
        return text.to_string();
    }

    // Build a set for O(1) lookup
    let known: std::collections::HashSet<String> = word_list.iter().cloned().collect();

    let mut result = String::new();
    let mut chars = text.chars().peekable();

    while let Some(&ch) = chars.peek() {
        if ch.is_alphabetic() {
            // Collect a word
            let mut word = String::new();
            while let Some(&c) = chars.peek() {
                if c.is_alphabetic() || c == '\'' || c == '-' {
                    word.push(c);
                    chars.next();
                } else {
                    break;
                }
            }

            let lower = word.to_lowercase();

            // Skip short words (1-2 chars), words that are known, or ALL CAPS (likely acronyms)
            if word.len() <= 2
                || known.contains(&lower)
                || word.chars().all(|c| c.is_uppercase())
            {
                result.push_str(&word);
            } else {
                // Find closest match
                if let Some(correction) = find_best_match(&lower, &word_list) {
                    // Preserve original capitalization pattern
                    result.push_str(&match_case(&word, &correction));
                } else {
                    result.push_str(&word);
                }
            }
        } else {
            result.push(ch);
            chars.next();
        }
    }

    result
}

/// Find the best matching word within edit distance 2.
fn find_best_match(word: &str, word_list: &[String]) -> Option<String> {
    let max_distance = if word.len() <= 4 { 1 } else { 2 };
    let mut best: Option<(String, usize)> = None;

    for candidate in word_list {
        // Quick length check to avoid expensive edit distance
        let len_diff = (word.len() as isize - candidate.len() as isize).unsigned_abs();
        if len_diff > max_distance {
            continue;
        }

        let dist = edit_distance(word, candidate);
        if dist > 0 && dist <= max_distance {
            if best.is_none() || dist < best.as_ref().unwrap().1 {
                best = Some((candidate.clone(), dist));
            }
        }
    }

    best.map(|(w, _)| w)
}

/// Match the capitalization of the original word to the corrected word.
fn match_case(original: &str, correction: &str) -> String {
    let orig_chars: Vec<char> = original.chars().collect();
    let corr_chars: Vec<char> = correction.chars().collect();

    // If original is all uppercase, return correction in uppercase
    if orig_chars.iter().all(|c| c.is_uppercase()) {
        return correction.to_uppercase();
    }

    // If original starts with uppercase, capitalize first letter
    if orig_chars.first().map(|c| c.is_uppercase()).unwrap_or(false) {
        let mut result = String::new();
        for (i, c) in corr_chars.iter().enumerate() {
            if i == 0 {
                result.extend(c.to_uppercase());
            } else {
                result.push(*c);
            }
        }
        return result;
    }

    correction.to_string()
}
