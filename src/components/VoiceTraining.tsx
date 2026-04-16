import { createSignal, Show } from 'solid-js';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';

// Training text is now fully localised via the i18n system

interface Props {
    language: string;
    onComplete: () => void;
    onCancel: () => void;
}

export default function VoiceTraining(props: Props) {
    const { t } = useI18n();
    const [step, setStep] = createSignal<1 | 2 | 3>(1);
    const [speakerName, setSpeakerName] = createSignal('');
    const [nameError, setNameError] = createSignal('');
    const [isRecording, setIsRecording] = createSignal(false);
    const [progress, setProgress] = createSignal(0); // 0-100
    const [error, setError] = createSignal('');

    let progressInterval: ReturnType<typeof setInterval> | null = null;
    let autoStopTimeout: ReturnType<typeof setTimeout> | null = null;

    const trainingText = () => t('voiceTraining.trainingText');

    const handleNextFromStep1 = () => {
        const name = speakerName().trim();
        if (!name) {
            setNameError(t('voiceTraining.nameRequired'));
            return;
        }
        setNameError('');
        setStep(2);
    };

    const startRecording = async () => {
        setError('');
        try {
            await api.startDictation();
            setIsRecording(true);
            setProgress(0);

            // Tick progress every 300ms over 30 seconds
            const totalMs = 30_000;
            const tickMs = 300;
            const ticks = totalMs / tickMs;
            let tick = 0;
            progressInterval = setInterval(() => {
                tick++;
                setProgress(Math.min(100, Math.round((tick / ticks) * 100)));
            }, tickMs);

            // Auto-stop after 30 seconds
            autoStopTimeout = setTimeout(() => {
                stopRecording();
            }, totalMs);
        } catch (e) {
            setError(t('voiceTraining.startFailed', { error: String(e) }));
        }
    };

    const stopRecording = async () => {
        if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
        if (autoStopTimeout) { clearTimeout(autoStopTimeout); autoStopTimeout = null; }

        if (!isRecording()) return;
        setIsRecording(false);
        setProgress(100);
        setError('');

        try {
            const audio = await api.stopDictationRaw();
            if (!audio || audio.length === 0) {
                setError(t('voiceTraining.noAudio'));
                setProgress(0);
                return;
            }
            await api.trainSpeaker(speakerName().trim(), audio);
            setStep(3);
        } catch (e) {
            setError(t('voiceTraining.saveFailed', { error: String(e) }));
            setProgress(0);
        }
    };

    return (
        <div class="voice-training-wizard">
            {/* Step indicators */}
            <div class="wizard-steps">
                <span class={`wizard-step ${step() >= 1 ? 'active' : ''}`}>1</span>
                <span class="wizard-step-sep">—</span>
                <span class={`wizard-step ${step() >= 2 ? 'active' : ''}`}>2</span>
                <span class="wizard-step-sep">—</span>
                <span class={`wizard-step ${step() >= 3 ? 'active' : ''}`}>3</span>
            </div>

            {/* Step 1: Name input */}
            <Show when={step() === 1}>
                <div class="wizard-content">
                    <h3>{t('voiceTraining.step1Title')}</h3>
                    <p class="wizard-description">{t('voiceTraining.step1Description')}</p>
                    <div class="setting-row">
                        <label>{t('voiceTraining.nameLabel')}</label>
                        <input
                            type="text"
                            class="voice-training-name-input"
                            value={speakerName()}
                            placeholder={t('voiceTraining.namePlaceholder')}
                            onInput={(e) => setSpeakerName(e.currentTarget.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleNextFromStep1(); }}
                        />
                        <Show when={nameError()}>
                            <span class="setting-hint error-text">{nameError()}</span>
                        </Show>
                    </div>
                    <div class="wizard-actions">
                        <button class="btn btn-secondary" onClick={props.onCancel}>{t('voiceTraining.cancel')}</button>
                        <button class="btn btn-primary" onClick={handleNextFromStep1}>{t('voiceTraining.next')}</button>
                    </div>
                </div>
            </Show>

            {/* Step 2: Recording */}
            <Show when={step() === 2}>
                <div class="wizard-content">
                    <h3>{t('voiceTraining.step2Title')}</h3>
                    <p class="wizard-description">
                        {t('voiceTraining.step2Description')}
                    </p>
                    <div class="training-text-box">
                        {trainingText()}
                    </div>
                    <Show when={isRecording()}>
                        <div class="recording-progress">
                            <div
                                class="recording-progress-bar"
                                style={{ width: `${progress()}%` }}
                            />
                        </div>
                        <p class="recording-hint">{t('voiceTraining.recordingInProgress', { percent: progress() })}</p>
                    </Show>
                    <Show when={error()}>
                        <p class="error-text">{error()}</p>
                    </Show>
                    <div class="wizard-actions">
                        <button
                            class="btn btn-secondary"
                            onClick={props.onCancel}
                            disabled={isRecording()}
                        >
                            {t('voiceTraining.cancel')}
                        </button>
                        <Show when={!isRecording()}>
                            <button class="btn btn-primary btn-record" onClick={startRecording}>
                                {t('voiceTraining.startRecording')}
                            </button>
                        </Show>
                        <Show when={isRecording()}>
                            <button class="btn btn-danger" onClick={stopRecording}>
                                {t('voiceTraining.stopRecording')}
                            </button>
                        </Show>
                    </div>
                </div>
            </Show>

            {/* Step 3: Success */}
            <Show when={step() === 3}>
                <div class="wizard-content wizard-success">
                    <div class="wizard-checkmark">&#10003;</div>
                    <h3>{t('voiceTraining.step3Title')}</h3>
                    <p class="wizard-description">
                        {t('voiceTraining.step3Description', { name: speakerName() })}
                    </p>
                    <div class="wizard-actions">
                        <button class="btn btn-primary" onClick={props.onComplete}>{t('voiceTraining.close')}</button>
                    </div>
                </div>
            </Show>
        </div>
    );
}
