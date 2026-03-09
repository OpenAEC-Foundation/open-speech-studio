import { createSignal, onMount, For } from "solid-js";
import { api, type Dictionary } from "../lib/api";

export default function DictionaryEditor() {
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
      setStatusMsg(`"${word}" toegevoegd`);
      setTimeout(() => setStatusMsg(""), 2000);
    } catch (e) {
      setStatusMsg(`Fout: ${e}`);
    }
  };

  const removeWord = async (word: string) => {
    try {
      await api.removeDictionaryWord(word);
      setWords((prev) => prev.filter(([w]) => w !== word));
      setStatusMsg(`"${word}" verwijderd`);
      setTimeout(() => setStatusMsg(""), 2000);
    } catch (e) {
      setStatusMsg(`Fout: ${e}`);
    }
  };

  return (
    <div class="dictionary-editor">
      <h2>Woordenboek</h2>
      <p class="section-description">
        Voeg woorden toe die het spraakmodel moet herkennen, zoals namen, afkortingen of
        vakjargon. Optioneel kun je een vervanging opgeven.
      </p>

      <div class="dictionary-add">
        <div class="add-row">
          <input
            type="text"
            placeholder="Woord (bijv. OpenAEC)"
            value={newWord()}
            onInput={(e) => setNewWord(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addWord()}
          />
          <input
            type="text"
            placeholder="Vervanging (optioneel)"
            value={newReplacement()}
            onInput={(e) => setNewReplacement(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addWord()}
          />
          <button class="btn btn-primary" onClick={addWord}>
            Toevoegen
          </button>
        </div>
        {statusMsg() && <div class="status-msg">{statusMsg()}</div>}
      </div>

      <div class="dictionary-list">
        <div class="dictionary-header">
          <span>Woord</span>
          <span>Vervanging</span>
          <span></span>
        </div>
        <For each={words()} fallback={<div class="empty-list">Nog geen woorden toegevoegd</div>}>
          {([word, replacement]) => (
            <div class="dictionary-row">
              <span class="dict-word">{word}</span>
              <span class="dict-replacement">{replacement || "—"}</span>
              <button class="btn btn-small btn-danger" onClick={() => removeWord(word)}>
                Verwijder
              </button>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
