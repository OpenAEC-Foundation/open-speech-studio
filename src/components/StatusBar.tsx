import { useI18n } from "../lib/i18n";

interface StatusBarProps {
  isRecording: boolean;
  isModelLoaded: boolean;
  modelName: string;
}

export default function StatusBar(props: StatusBarProps) {
  const { t } = useI18n();
  return (
    <div class="statusbar">
      <span class="statusbar-left">
        <span
          class={`statusbar-dot ${
            props.isRecording ? "recording" : props.isModelLoaded ? "ready" : "inactive"
          }`}
        />
        <span>
          {props.isRecording
            ? t("sidebar.statusRecording")
            : props.isModelLoaded
            ? t("sidebar.statusReady")
            : t("sidebar.statusNoModel")}
        </span>
        {props.isModelLoaded && props.modelName && (
          <span class="statusbar-separator" />
        )}
        {props.isModelLoaded && props.modelName && (
          <span class="statusbar-model">{props.modelName}</span>
        )}
      </span>
      <a class="statusbar-right statusbar-link" href="https://open-aec.com/" target="_blank" rel="noopener">OpenAEC Foundation</a>
    </div>
  );
}
