import React from 'react';
import './VoiceStateIndicator.css';

/** The four states an operator needs to tell apart at a glance:
 *  idle   — nothing happening, mic may be off or waiting for the wake word
 *  listen — the mic is open and capturing the operator's speech
 *  think  — transcribing or waiting on the model's reply
 *  speak  — the assistant is talking back over TTS
 *
 *  Kept as its own type rather than reusing MicState because "think" folds in
 *  LLM streaming and "speak" comes from TTS playback — neither is a mic state. */
export type VoiceState = 'idle' | 'listen' | 'think' | 'speak';

interface StateMeta {
  label: string;
  icon: string;
}

const META: Record<VoiceState, StateMeta> = {
  idle: { label: 'Siaga', icon: '⚪' },
  listen: { label: 'Mendengar', icon: '👂' },
  think: { label: 'Berpikir', icon: '💭' },
  speak: { label: 'Berbicara', icon: '🗣️' },
};

/** Derive the single visible state from the raw signals. Order matters: speech
 *  output wins over everything (the assistant is mid-sentence), then thinking,
 *  then listening, else idle. Exported so the tray helper's state can be derived
 *  the same way if the two are ever unified. */
export function deriveVoiceState(sig: {
  speaking: boolean;
  streaming: boolean;
  transcribing: boolean;
  micActive: boolean;
}): VoiceState {
  if (sig.speaking) return 'speak';
  if (sig.streaming || sig.transcribing) return 'think';
  if (sig.micActive) return 'listen';
  return 'idle';
}

export function VoiceStateIndicator({ state }: { state: VoiceState }) {
  const meta = META[state];
  return (
    <div
      className={`voice-state voice-state--${state}`}
      role="status"
      aria-live="polite"
      aria-label={`Status suara: ${meta.label}`}
      title={meta.label}
    >
      <span className="voice-state__dot" aria-hidden="true" />
      <span className="voice-state__icon" aria-hidden="true">{meta.icon}</span>
      <span className="voice-state__label">{meta.label}</span>
    </div>
  );
}
