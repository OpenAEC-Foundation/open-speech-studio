import { createSignal, onMount, For } from "solid-js";
import { api, type Dictionary } from "../lib/api";
import { useI18n } from "../lib/i18n";

export default function DictionaryEditor() {
  const { t } = useI18n();
  const [words, setWords] = createSignal<[string, string | null][]>([]);
  const [newWord, setNewWord] = createSignal("");
  const [newReplacement, setNewReplacement] = createSignal("");
  const [statusMsg, setStatusMsg] = createSignal("");

  onMount(async () => {
    try {
      const dict = await api.getDictionary();
      setWords(Object.entries(dict.words));
    } catch (e) {
      console.error("Failed to load dictionary:", e);
    }
  });

  const addWord = async () => {
    const word = newWord().trim();
    if (!word) return;

    const replacement = newReplacement().trim() || null;

    try {
      await api.addDictionaryWord(word, replacement);
      setWords((prev) => [...prev, [word, replacement]]);
      setNewWord("");
      setNewReplacement("");
      setStatusMsg(t("dictionary.wordAdded", { word }));
      setTimeout(() => setStatusMsg(""), 2000);
    } catch (e) {
      setStatusMsg(t("dictionary.error", { error: String(e) }));
    }
  };

  const removeWord = async (word: string) => {
    try {
      await api.removeDictionaryWord(word);
      setWords((prev) => prev.filter(([w]) => w !== word));
      setStatusMsg(t("dictionary.wordRemoved", { word }));
      setTimeout(() => setStatusMsg(""), 2000);
    } catch (e) {
      setStatusMsg(t("dictionary.error", { error: String(e) }));
    }
  };

  return (
    <div class="dictionary-editor">
      <h2>{t("dictionary.title")}</h2>
      <p class="section-description">
        {t("dictionary.description")}
      </p>

      <div class="dictionary-add">
        <div class="add-row">
          <input
            type="text"
            placeholder={t("dictionary.wordPlaceholder")}
            value={newWord()}
            onInput={(e) => setNewWord(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addWord()}
          />
          <input
            type="text"
            placeholder={t("dictionary.replacementPlaceholder")}
            value={newReplacement()}
            onInput={(e) => setNewReplacement(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addWord()}
          />
          <button class="btn btn-primary" onClick={addWord}>
            {t("dictionary.add")}
          </button>
        </div>
        {statusMsg() && <div class="status-msg">{statusMsg()}</div>}
      </div>

      <div class="dictionary-list">
        <div class="dictionary-header">
          <span>{t("dictionary.wordHeader")}</span>
          <span>{t("dictionary.replacementHeader")}</span>
          <span></span>
        </div>
        <For each={words()} fallback={<div class="empty-list">{t("dictionary.empty")}</div>}>
          {([word, replacement]) => (
            <div class="dictionary-row">
              <span class="dict-word">{word}</span>
              <span class="dict-replacement">{replacement || "—"}</span>
              <button class="btn btn-small btn-danger" onClick={() => removeWord(word)}>
                {t("dictionary.remove")}
              </button>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
