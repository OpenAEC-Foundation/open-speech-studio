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

/// Default dictionary with OpenAEC infrastructure terms.
/// Whisper often misspells these domain-specific words; the dictionary corrects them.
fn default_dictionary() -> Dictionary {
    let entries: Vec<(&str, &str)> = vec![
        // OpenAEC Foundation
        ("open aec", "OpenAEC"),
        ("open a c", "OpenAEC"),
        ("openaec", "OpenAEC"),
        ("open aic", "OpenAEC"),
        // IFC / buildingSMART
        ("ifc", "IFC"),
        ("i f c", "IFC"),
        ("building smart", "buildingSMART"),
        ("ifc4", "IFC4"),
        ("ifc 4", "IFC4"),
        ("ifc2x3", "IFC2x3"),
        ("ifc 2x3", "IFC2x3"),
        ("ifcopenshell", "IfcOpenShell"),
        ("ifc open shell", "IfcOpenShell"),
        // BIM
        ("bim", "BIM"),
        ("b i m", "BIM"),
        ("bim server", "BIMserver"),
        ("bimserver", "BIMserver"),
        ("openbim", "openBIM"),
        ("open bim", "openBIM"),
        ("bcf", "BCF"),
        ("b c f", "BCF"),
        ("bsdd", "bSDD"),
        ("b s d d", "bSDD"),
        ("ids", "IDS"),
        ("mvd", "MVD"),
        // CAD / Modelling
        ("freecad", "FreeCAD"),
        ("free cad", "FreeCAD"),
        ("blender", "Blender"),
        ("revit", "Revit"),
        ("archicad", "ArchiCAD"),
        ("archi cad", "ArchiCAD"),
        ("autocad", "AutoCAD"),
        ("auto cad", "AutoCAD"),
        ("tekla", "Tekla"),
        ("navisworks", "Navisworks"),
        ("rhinoceros", "Rhinoceros"),
        ("rhino", "Rhino"),
        ("grasshopper", "Grasshopper"),
        // GIS
        ("gis", "GIS"),
        ("g i s", "GIS"),
        ("qgis", "QGIS"),
        ("q gis", "QGIS"),
        ("citygml", "CityGML"),
        ("city gml", "CityGML"),
        ("cityjson", "CityJSON"),
        ("city json", "CityJSON"),
        ("geojson", "GeoJSON"),
        ("geo json", "GeoJSON"),
        // Standards & formats
        ("gbxml", "gbXML"),
        ("gb xml", "gbXML"),
        ("cobie", "COBie"),
        ("co bie", "COBie"),
        ("loin", "LOIN"),
        ("nlsfb", "NL-SfB"),
        ("nl sfb", "NL-SfB"),
        // Construction & engineering terms (NL → correct)
        ("bouwwerk", "bouwwerk"),
        ("bestekspost", "bestekspost"),
        ("wapeningsplan", "wapeningsplan"),
        ("prefab", "prefab"),
        ("staalconstructie", "staalconstructie"),
        ("funderingspaal", "funderingspaal"),
        // Open source tools
        ("speckle", "Speckle"),
        ("xbim", "xBIM"),
        ("x bim", "xBIM"),
        ("osarch", "OSArch"),
        ("os arch", "OSArch"),
        ("ladybug", "Ladybug"),
        ("honeybee", "Honeybee"),
        ("energyplus", "EnergyPlus"),
        ("energy plus", "EnergyPlus"),
        ("openstudio", "OpenStudio"),
        ("open studio", "OpenStudio"),
        // Web / data
        ("sparql", "SPARQL"),
        ("linked data", "Linked Data"),
        ("json ld", "JSON-LD"),
        ("rdf", "RDF"),
        ("owl", "OWL"),
        ("api", "API"),
        ("a p i", "API"),
        ("rest api", "REST API"),
        ("graphql", "GraphQL"),
        ("graph ql", "GraphQL"),
        ("webhook", "webhook"),
    ];

    let mut words = HashMap::new();
    for (key, val) in entries {
        words.insert(key.to_string(), Some(val.to_string()));
    }
    Dictionary { words }
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
