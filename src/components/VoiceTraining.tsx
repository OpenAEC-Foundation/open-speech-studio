import { createSignal, Show } from 'solid-js';
import { api } from '../lib/api';

// Training texts per language with phonetically diverse content
const TRAINING_TEXTS: Record<string, string> = {
    nl: `De schrijver beschrijft hoe de schroevendraaier naast de schroef lag. Hij wist dat het niet klopte en ook niet zou kloppen. De ui en de uil stonden in het uurboek. Gereed of bereid, het verschil is verschrikkelijk klein. De acht nachten waren koud, maar de gracht bleef onbevroren. Scheveningse scholieren schrijven schitterende schaakstrategieën.`,
    en: `The quick brown fox jumps over the lazy dog. She sells seashells by the seashore. Peter Piper picked a peck of pickled peppers. How much wood would a woodchuck chuck if a woodchuck could chuck wood? The sixth sick sheik's sixth sheep's sick. Unique New York.`,
    de: `Fischers Fritz fischt frische Fische. Brautkleid bleibt Brautkleid und Blaukraut bleibt Blaukraut. Zwischen zwei Zwetschgenzweigen zwitschern zwei Schwalben.`,
};

const DEFAULT_TEXT = TRAINING_TEXTS['en'];

interface Props {
    language: string;
    onComplete: () => void;
    onCancel: () => void;
}

export default function VoiceTraining(props: Props) {
    const [step, setStep] = createSignal<1 | 2 | 3>(1);
    const [speakerName, setSpeakerName] = createSignal('');
    const [nameError, setNameError] = createSignal('');
    const [isRecording, setIsRecording] = createSignal(false);
    const [progress, setProgress] = createSignal(0); // 0-100
    const [error, setError] = createSignal('');

    let progressInterval: ReturnType<typeof setInterval> | null = null;
    let autoStopTimeout: ReturnType<typeof setTimeout> | null = null;

    const trainingText = () => {
        const lang = props.language?.toLowerCase();
        return TRAINING_TEXTS[lang] ?? DEFAULT_TEXT;
    };

    const handleNextFromStep1 = () => {
        const name = speakerName().trim();
        if (!name) {
            setNameError('Voer een naam in voor het stemprofiel.');
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
            setError(`Opname starten mislukt: ${e}`);
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
                setError('Geen audio opgenomen. Probeer opnieuw.');
                setProgress(0);
                return;
            }
            await api.trainSpeaker(speakerName().trim(), audio);
            setStep(3);
        } catch (e) {
            setError(`Stemprofiel opslaan mislukt: ${e}`);
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
                    <h3>Nieuw stemprofiel</h3>
                    <p class="wizard-description">Geef een naam op voor het stemprofiel.</p>
                    <div class="setting-row">
                        <label>Naam</label>
                        <input
                            type="text"
                            class="voice-training-name-input"
                            value={speakerName()}
                            placeholder="Bijv. Jan Jansen"
                            onInput={(e) => setSpeakerName(e.currentTarget.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleNextFromStep1(); }}
                        />
                        <Show when={nameError()}>
                            <span class="setting-hint error-text">{nameError()}</span>
                        </Show>
                    </div>
                    <div class="wizard-actions">
                        <button class="btn btn-secondary" onClick={props.onCancel}>Annuleren</button>
                        <button class="btn btn-primary" onClick={handleNextFromStep1}>Volgende</button>
                    </div>
                </div>
            </Show>

            {/* Step 2: Recording */}
            <Show when={step() === 2}>
                <div class="wizard-content">
                    <h3>Spreek de tekst in</h3>
                    <p class="wizard-description">
                        Lees de onderstaande tekst luid en duidelijk voor. De opname stopt automatisch na 30 seconden.
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
                        <p class="recording-hint">Opname bezig... {progress()}%</p>
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
                            Annuleren
                        </button>
                        <Show when={!isRecording()}>
                            <button class="btn btn-primary btn-record" onClick={startRecording}>
                                Opname starten
                            </button>
                        </Show>
                        <Show when={isRecording()}>
                            <button class="btn btn-danger" onClick={stopRecording}>
                                Stoppen
                            </button>
                        </Show>
                    </div>
                </div>
            </Show>

            {/* Step 3: Success */}
            <Show when={step() === 3}>
                <div class="wizard-content wizard-success">
                    <div class="wizard-checkmark">&#10003;</div>
                    <h3>Stemprofiel opgeslagen!</h3>
                    <p class="wizard-description">
                        Het stemprofiel voor <strong>{speakerName()}</strong> is succesvol aangemaakt.
                    </p>
                    <div class="wizard-actions">
                        <button class="btn btn-primary" onClick={props.onComplete}>Sluiten</button>
                    </div>
                </div>
            </Show>
        </div>
    );
}
