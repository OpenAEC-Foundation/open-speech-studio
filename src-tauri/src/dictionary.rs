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
                let pattern = regex_lite::Regex::new(&format!(r"(?i)\b{}\b", regex_lite::escape(word)))
                    .unwrap_or_else(|_| regex_lite::Regex::new(word).unwrap());
                result = pattern.replace_all(&result, rep.as_str()).to_string();
            }
        }

        result
    }
}

fn default_dictionary() -> Dictionary {
    Dictionary { words: HashMap::new() }
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
