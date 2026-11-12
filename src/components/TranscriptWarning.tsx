import { Show } from "solid-js";
import { useI18n } from "../lib/i18n";

export default function TranscriptWarning(props: { originalText?: string }) {
  const { t } = useI18n();
  return (
    <Show when={props.originalText}>
      <div class="transcript-warning" role="status">
        <p>{t("transcription.repetitionWarning")}</p>
        <details>
          <summary>{t("transcription.showOriginal")}</summary>
          <pre>{props.originalText}</pre>
        </details>
      </div>
    </Show>
  );
}
