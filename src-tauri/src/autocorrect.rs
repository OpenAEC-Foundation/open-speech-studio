use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

pub struct AutoCorrector {
    llama_bin: PathBuf,
    model_path: PathBuf,
    use_gpu: bool,
    timeout_secs: u64,
}

impl AutoCorrector {
    pub fn new(model_path: &Path, use_gpu: bool) -> Result<Self, String> {
        let llama_bin = find_llama_binary().map_err(|e| e.to_string())?;
        if !model_path.exists() {
            return Err(format!("LLM model not found: {:?}", model_path));
        }
        Ok(Self {
            llama_bin,
            model_path: model_path.to_path_buf(),
            use_gpu,
            timeout_secs: 10,
        })
    }

    pub fn correct(&self, text: &str, language: &str) -> Result<String, String> {
        if text.trim().is_empty() {
            return Ok(text.to_string());
        }

        let prompt = get_correction_prompt(language, text);

        let mut cmd = Command::new(&self.llama_bin);
        cmd.args([
            "-m",
            &self.model_path.to_string_lossy(),
            "-p",
            &prompt,
            "-n",
            "256",
            "--temp",
            "0.1",
            "--no-display-prompt",
        ]);
        if !self.use_gpu {
            cmd.arg("--no-gpu");
        }

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        cmd.stdout(Stdio::piped()).stderr(Stdio::null());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start llama-cli: {}", e))?;

        // Read output with timeout
        let timeout_secs = self.timeout_secs;
        let output = std::thread::scope(|s| {
            let stdout_handle = child.stdout.take();
            let handle = s.spawn(move || {
                let mut output = String::new();
                if let Some(mut stdout) = stdout_handle {
                    stdout.read_to_string(&mut output).ok();
                }
                output
            });

            // Wait for completion with timeout
            let start = std::time::Instant::now();
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) => {
                        if start.elapsed() > Duration::from_secs(timeout_secs) {
                            let _ = child.kill();
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    Err(_) => break,
                }
            }

            handle.join().unwrap_or_default()
        });

        let corrected = output.trim().to_string();
        if corrected.is_empty() {
            Ok(text.to_string()) // Fallback to original
        } else {
            Ok(corrected)
        }
    }
}

fn get_correction_prompt(language: &str, text: &str) -> String {
    match language {
        "nl" => format!("Corrigeer de volgende spraak-naar-tekst transcriptie. Verbeter grammatica en zinsbouw, maar behoud de oorspronkelijke betekenis. Geef alleen de gecorrigeerde tekst terug, zonder uitleg.\n\nTranscriptie: {}\n\nGecorrigeerde tekst:", text),
        "de" => format!("Korrigiere die folgende Sprache-zu-Text-Transkription. Verbessere Grammatik und Satzbau, aber behalte die ursprüngliche Bedeutung bei. Gib nur den korrigierten Text zurück, ohne Erklärung.\n\nTranskription: {}\n\nKorrigierter Text:", text),
        "fr" => format!("Corrigez la transcription vocale suivante. Améliorez la grammaire et la structure des phrases tout en préservant le sens original. Retournez uniquement le texte corrigé, sans explication.\n\nTranscription : {}\n\nTexte corrigé :", text),
        "es" => format!("Corrige la siguiente transcripción de voz a texto. Mejora la gramática y la estructura de las oraciones, pero conserva el significado original. Devuelve solo el texto corregido, sin explicación.\n\nTranscripción: {}\n\nTexto corregido:", text),
        "pt" => format!("Corrija a seguinte transcrição de voz para texto. Melhore a gramática e a estrutura das frases, mas preserve o significado original. Retorne apenas o texto corrigido, sem explicação.\n\nTranscrição: {}\n\nTexto corrigido:", text),
        "it" => format!("Correggi la seguente trascrizione vocale. Migliora la grammatica e la struttura delle frasi, preservando il significato originale. Restituisci solo il testo corretto, senza spiegazione.\n\nTrascrizione: {}\n\nTesto corretto:", text),
        "pl" => format!("Popraw następującą transkrypcję mowy na tekst. Popraw gramatykę i strukturę zdań, zachowując oryginalne znaczenie. Zwróć tylko poprawiony tekst, bez wyjaśnień.\n\nTranskrypcja: {}\n\nPoprawiony tekst:", text),
        "ru" => format!("Исправьте следующую транскрипцию речи в текст. Улучшите грамматику и структуру предложений, сохраняя исходный смысл. Верните только исправленный текст, без пояснений.\n\nТранскрипция: {}\n\nИсправленный текст:", text),
        "uk" => format!("Виправте наступну транскрипцію мовлення в текст. Поліпшіть граматику та структуру речень, зберігаючи початковий зміст. Поверніть лише виправлений текст, без пояснень.\n\nТранскрипція: {}\n\nВиправлений текст:", text),
        "tr" => format!("Aşağıdaki konuşmadan metne dönüştürme transkripsiyonunu düzeltin. Orijinal anlamı koruyarak dilbilgisini ve cümle yapısını iyileştirin. Yalnızca düzeltilmiş metni döndürün, açıklama yapmayın.\n\nTranskripsiyon: {}\n\nDüzeltilmiş metin:", text),
        "zh" => format!("修正以下语音转文字的转录内容。改善语法和句子结构，但保留原意。只返回修正后的文字，不要解释。\n\n转录：{}\n\n修正后的文字：", text),
        "ja" => format!("以下の音声テキスト変換の書き起こしを修正してください。元の意味を保ちながら、文法と文章構造を改善してください。修正したテキストのみを返してください。説明は不要です。\n\n書き起こし：{}\n\n修正後のテキスト：", text),
        "ko" => format!("다음 음성-텍스트 변환 전사를 교정하세요. 원래 의미를 유지하면서 문법과 문장 구조를 개선하세요. 설명 없이 교정된 텍스트만 반환하세요.\n\n전사: {}\n\n교정된 텍스트:", text),
        "cs" => format!("Opravte následující přepis řeči na text. Vylepšete gramatiku a strukturu vět, ale zachovejte původní význam. Vraťte pouze opravený text, bez vysvětlení.\n\nPřepis: {}\n\nOpravený text:", text),
        "ro" => format!("Corectați următoarea transcriere vocală. Îmbunătățiți gramatica și structura propozițiilor, păstrând sensul original. Returnați doar textul corectat, fără explicații.\n\nTranscriere: {}\n\nText corectat:", text),
        "hu" => format!("Javítsa ki a következő beszéd-szöveg átiratot. Javítsa a nyelvtant és a mondatszerkezetet, megőrizve az eredeti jelentést. Csak a javított szöveget adja vissza, magyarázat nélkül.\n\nÁtirat: {}\n\nJavított szöveg:", text),
        "sv" => format!("Rätta följande tal-till-text-transkription. Förbättra grammatik och meningsbyggnad men behåll den ursprungliga betydelsen. Returnera bara den rättade texten, utan förklaring.\n\nTranskription: {}\n\nRättad text:", text),
        "da" => format!("Ret følgende tale-til-tekst-transskription. Forbedr grammatik og sætningsstruktur, men bevar den oprindelige betydning. Returner kun den rettede tekst, uden forklaring.\n\nTransskription: {}\n\nRettet tekst:", text),
        "no" => format!("Rett følgende tale-til-tekst-transkripsjon. Forbedre grammatikk og setningsstruktur, men bevar den opprinnelige betydningen. Returner bare den rettede teksten, uten forklaring.\n\nTranskripsjon: {}\n\nRettet tekst:", text),
        "fi" => format!("Korjaa seuraava puheesta tekstiksi -litterointi. Paranna kielioppia ja lauserakennetta, mutta säilytä alkuperäinen merkitys. Palauta vain korjattu teksti, ilman selitystä.\n\nLitterointi: {}\n\nKorjattu teksti:", text),
        "el" => format!("Διορθώστε την ακόλουθη μεταγραφή ομιλίας σε κείμενο. Βελτιώστε τη γραμματική και τη δομή των προτάσεων, διατηρώντας το αρχικό νόημα. Επιστρέψτε μόνο το διορθωμένο κείμενο, χωρίς εξήγηση.\n\nΜεταγραφή: {}\n\nΔιορθωμένο κείμενο:", text),
        "bg" => format!("Коригирайте следната транскрипция от реч в текст. Подобрете граматиката и структурата на изреченията, като запазите първоначалния смисъл. Върнете само коригирания текст, без обяснение.\n\nТранскрипция: {}\n\nКоригиран текст:", text),
        "hr" => format!("Ispravite sljedeću transkripciju govora u tekst. Poboljšajte gramatiku i strukturu rečenica, ali zadržite izvorno značenje. Vratite samo ispravljeni tekst, bez objašnjenja.\n\nTranskripcija: {}\n\nIspravljeni tekst:", text),
        "sk" => format!("Opravte nasledujúci prepis reči na text. Vylepšite gramatiku a štruktúru viet, ale zachovajte pôvodný význam. Vráťte iba opravený text, bez vysvetlenia.\n\nPrepis: {}\n\nOpravený text:", text),
        // Default: English
        _ => format!("Correct the following speech-to-text transcription. Fix grammar and sentence structure while preserving the original meaning. Return only the corrected text, no explanation.\n\nTranscription: {}\n\nCorrected text:", text),
    }
}

fn find_llama_binary() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let bin_name = if cfg!(windows) {
        "llama-cli.exe"
    } else {
        "llama-cli"
    };

    let mut search_dirs: Vec<PathBuf> = Vec::new();

    // Next to the executable (installed app)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            search_dirs.push(dir.to_path_buf());
            search_dirs.push(dir.join("bin"));
            // Tauri bundles resources into _up_/ directory
            search_dirs.push(dir.join("_up_/bin"));
        }
    }

    // Project root bin/ directory (development)
    if let Ok(cwd) = std::env::current_dir() {
        search_dirs.push(cwd.join("bin"));
        search_dirs.push(cwd.join("../bin"));
    }

    // Config directory
    if let Some(config) = dirs::config_dir() {
        search_dirs.push(config.join("open-speech-studio").join("bin"));
    }

    // System PATH
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(if cfg!(windows) { ';' } else { ':' }) {
            search_dirs.push(PathBuf::from(dir));
        }
    }

    for dir in &search_dirs {
        let path = dir.join(bin_name);
        if path.exists() {
            return Ok(path);
        }
    }

    Err(format!(
        "llama-cli binary '{}' not found. Place it in the bin/ directory alongside whisper-cli.",
        bin_name
    )
    .into())
}
