interface StatusBarProps {
  message: string;
  isRecording: boolean;
}

export default function StatusBar(props: StatusBarProps) {
  return (
    <div class={`status-bar ${props.isRecording ? "status-bar-recording" : ""}`}>
      <span class="status-message">{props.message}</span>
      <span class="status-right">
        Open Dictate Studio v0.1.0 | OpenAEC Foundation
      </span>
    </div>
  );
}
