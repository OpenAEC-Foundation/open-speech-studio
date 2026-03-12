import { useI18n } from "../lib/i18n";

interface StatusBarProps {
  message: string;
  isRecording: boolean;
}

export default function StatusBar(props: StatusBarProps) {
  const { t } = useI18n();
  return (
    <div class={`status-bar ${props.isRecording ? "status-bar-recording" : ""}`}>
      <span class="status-message">{props.message}</span>
      <span class="status-right">
        {t("statusBar.version")}
      </span>
    </div>
  );
}
