use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Dictionary {
    /// Custom words that Whisper should recognize (word -> optional replacement)
    /// If replacement is None, the word is just added to improve recognition
    /// If replacement is Some, the recognized word will be replaced with the replacement
    pub words: HashMap<String, Option<String>>,
}

impl Dictionary {
    /// Add missing defaults without overwriting user replacements or removing words.
    pub fn add_aec_terms(&mut self) {
        for word in include_str!("../resources/aec-terms.txt").lines() {
            let word = word.trim();
            if !word.is_empty() && !word.starts_with('#') {
                self.words.entry(word.to_owned()).or_insert(None);
            }
        }
    }

    /// Whisper keeps the tail of a long initial prompt. Prefer user vocabulary
    /// over bundled defaults, and put the most relevant terms at that tail.
    /// The character budget also keeps very large dictionaries off the command line.
    pub fn recognition_prompt(&self) -> String {
        let defaults: Vec<_> = include_str!("../resources/aec-terms.txt")
            .lines()
            .map(str::trim)
            .filter(|w| !w.is_empty() && !w.starts_with('#'))
            .collect();
        let mut words: Vec<_> = self.words.keys().collect();
        words.sort_by_key(|word| (defaults.contains(&word.as_str()), word.as_str()));
        let mut selected = Vec::new();
        let mut length = 0;
        for word in words {
            let word = word.trim();
            let size = word.chars().count() + if selected.is_empty() { 0 } else { 2 };
            if word.is_empty() || length + size > 600 {
                continue;
            }
            selected.push(word);
            length += size;
        }
        selected.reverse();
        selected.join(", ")
    }

    pub fn add_word(&mut self, word: String, replacement: Option<String>) {
        self.words.insert(word, replacement);
    }

    pub fn remove_word(&mut self, word: &str) {
        self.words.remove(word);
    }

    /// Apply dictionary corrections to transcribed text
    pub fn apply_corrections(&self, text: &str) -> String {
        let mut result = text.to_string();

        for (word, replacement) in &self.words {
            if let Some(rep) = replacement {
                // Case-insensitive replacement
                let pattern =
                    regex_lite::Regex::new(&format!(r"(?i)\b{}\b", regex_lite::escape(word)))
                        .unwrap_or_else(|_| regex_lite::Regex::new(word).unwrap());
                result = pattern.replace_all(&result, rep.as_str()).to_string();
            }
        }

        result
    }
}

fn default_dictionary() -> Dictionary {
    let mut dict = Dictionary::default();
    dict.add_aec_terms();
    dict
}

pub fn load_dictionary() -> Result<Dictionary, Box<dyn std::error::Error>> {
    let path = super::settings::get_config_dir()?.join("dictionary.json");
    if !path.exists() {
        let dict = default_dictionary();
        save_dictionary(&dict)?;
        return Ok(dict);
    }
    let content = std::fs::read_to_string(path)?;
    let dict: Dictionary = serde_json::from_str(&content)?;
    Ok(dict)
}

pub fn save_dictionary(dict: &Dictionary) -> Result<(), Box<dyn std::error::Error>> {
    let path = super::settings::get_config_dir()?.join("dictionary.json");
    let content = serde_json::to_string_pretty(dict)?;
    std::fs::write(path, content)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_bilingual_terms_without_overwriting_custom_replacements() {
        let mut dict = default_dictionary();
        for term in ["BIM", "IFC", "omgevingsvergunning", "structural engineer"] {
            assert!(dict.words.contains_key(term), "Missing {term}");
        }
        dict.add_word("IFC".into(), Some("Industry Foundation Classes".into()));
        dict.add_word("Mijn eigen term".into(), None);
        dict.add_aec_terms();
        assert_eq!(
            dict.words["IFC"].as_deref(),
            Some("Industry Foundation Classes")
        );
        assert!(dict.words.contains_key("Mijn eigen term"));
        dict.remove_word("BIM");
        let reloaded: Dictionary =
            serde_json::from_str(&serde_json::to_string(&dict).unwrap()).unwrap();
        assert!(
            !reloaded.words.contains_key("BIM"),
            "Deleted defaults must stay deleted"
        );
    }

    #[test]
    fn prompt_is_deterministic_bounded_and_includes_recognition_only_words() {
        let mut dict = Dictionary::default();
        dict.add_word("IFC".into(), None);
        dict.add_word("BIM".into(), None);
        assert_eq!(dict.recognition_prompt(), "IFC, BIM");
        for i in 0..1000 {
            dict.add_word(format!("woord-{i}-één"), None);
        }
        assert!(dict.recognition_prompt().chars().count() <= 600);
    }
}

#[cfg(test)]
mod priority_tests {
    use super::*;

    #[test]
    fn bundled_vocabulary_cannot_crowd_out_a_users_own_term() {
        let mut dict = default_dictionary();
        dict.add_word("ZeerSpecifiekeProjectnaam".into(), None);
        let prompt = dict.recognition_prompt();
        assert!(prompt.ends_with("ZeerSpecifiekeProjectnaam"));
        assert!(prompt.chars().count() <= 600);
        assert!(dict.words.contains_key("warmtepomp"));
    }
}
