import { useCallback, useEffect, useRef, useState } from 'react';
import { MicStream, VoiceRecorder, transcribeBlob, MIC_AEC_WARNING } from '../stt';
import { MicVad, vadConfigFor, VadSensitivity } from '../vad';
import { matchLocalCommand, LocalCommand } from '../commands';

export type MicState = 'off' | 'listening' | 'recording' | 'working';

export interface VoiceLoopOptions {
  /** Server-side stt_enabled. False turns the whole loop off. */
  enabled: boolean;
  handsfree: boolean;
  bargeIn: boolean;
  silenceMs: number;
  sensitivity: VadSensitivity;
  /** True while the assistant is speaking — ducks the VAD threshold and gates
   *  barge-in. Read through a callback so a change does not restart the mic. */
  isSpeaking: () => boolean;
  onBargeIn: () => void;
  onTranscript: (text: string) => void;
  onCommand: (cmd: LocalCommand) => void;
  onError: (message: string) => void;
}

/** Owns the microphone: the analyser, the recorder and the state machine that
 *  connects them.
 *
 *  The analyser runs whenever barge-in or hands-free is on, so the mic stays
 *  open across utterances — reacquiring per utterance costs enough warm-up to
 *  clip the first word, and barge-in cannot wait for a device to open at all. */
export function useVoiceLoop(opts: VoiceLoopOptions) {
  const [micState, setMicState] = useState<MicState>('off');
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const vadRef = useRef<MicVad | null>(null);
  const stateRef = useRef<MicState>('off');
  // Set while a wake-word-triggered capture is in flight, so VAD ends it even
  // when hands-free is off. The watchdog is a hard stop for the case where no
  // VAD analyser is running (barge-in and hands-free both off) to end it.
  const wakeCaptureRef = useRef(false);
  const wakeWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Handlers change every render; the VAD is built once per config. Reading
  // them through a ref keeps a re-render from tearing down the microphone.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const setState = useCallback((next: MicState) => {
    stateRef.current = next;
    setMicState(next);
  }, []);

  const finish = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    wakeCaptureRef.current = false;
    if (wakeWatchdogRef.current) {
      clearTimeout(wakeWatchdogRef.current);
      wakeWatchdogRef.current = null;
    }
    setState('working');
    try {
      const text = await transcribeBlob(await recorder.stop());
      if (text) {
        const cmd = matchLocalCommand(text);
        if (cmd) optsRef.current.onCommand(cmd);
        else optsRef.current.onTranscript(text);
      }
    } catch (err) {
      optsRef.current.onError(
        err instanceof Error ? err.message : 'Transkripsi gagal');
    } finally {
      setState(optsRef.current.enabled
        && (optsRef.current.handsfree || optsRef.current.bargeIn)
        ? 'listening' : 'off');
    }
  }, [setState]);

  const beginRecording = useCallback(async () => {
    if (recorderRef.current) return;
    const recorder = new VoiceRecorder();
    try {
      await recorder.start();
    } catch {
      optsRef.current.onError(
        'Mic tidak bisa diakses. Izinkan mikrofon untuk situs ini.');
      setState('off');
      return;
    }
    recorderRef.current = recorder;
    setState('recording');
  }, [setState]);

  // ── the always-on analyser ──
  const listening = opts.enabled && (opts.handsfree || opts.bargeIn);
  useEffect(() => {
    if (!listening) return;
    let cancelled = false;
    const vad = new MicVad(vadConfigFor(opts.sensitivity, opts.silenceMs), {
      isDucked: () => optsRef.current.isSpeaking(),
      onSpeechStart: () => {
        const o = optsRef.current;
        // Barge-in first: the operator is talking over the assistant, and the
        // stop has to land before the recorder warms up.
        if (o.bargeIn && o.isSpeaking()) o.onBargeIn();
        if (o.handsfree && stateRef.current === 'listening') void beginRecording();
      },
      onSpeechEnd: () => {
        if ((optsRef.current.handsfree || wakeCaptureRef.current)
            && stateRef.current === 'recording') void finish();
      },
    });

    MicStream.shared.acquire()
      .then((stream) => {
        if (cancelled) { MicStream.shared.release(); return; }
        vadRef.current = vad;
        // The browser may have refused echo cancellation; say so once, because
        // barge-in then makes the assistant stop itself mid-sentence.
        if (optsRef.current.bargeIn && MicStream.shared.warning?.echoCancellation === false) {
          optsRef.current.onError(MIC_AEC_WARNING);
        }
        setState('listening');
        return vad.start(stream);
      })
      .catch(() => {
        optsRef.current.onError(
          'Mic tidak bisa diakses. Izinkan mikrofon untuk situs ini.');
        setState('off');
      });

    return () => {
      cancelled = true;
      vad.stop();
      vadRef.current = null;
      MicStream.shared.release();
      setState('off');
    };
  }, [listening, opts.sensitivity, opts.silenceMs, beginRecording, finish, setState]);

  // ── push-to-talk, which keeps working in every mode ──
  const pushToTalkStart = useCallback(() => {
    if (stateRef.current === 'recording' || stateRef.current === 'working') return;
    void beginRecording();
  }, [beginRecording]);

  const pushToTalkStop = useCallback(() => {
    if (stateRef.current !== 'recording') return;
    void finish();
  }, [finish]);

  // Triggered by the wake word ("Hey Ev") arriving from the tray helper. Starts
  // recording and arms VAD to end the turn; a watchdog hard-stops after 15s so a
  // capture with no VAD analyser running (barge-in and hands-free both off) can
  // still finish and send rather than record forever.
  const startWakeCapture = useCallback(() => {
    if (stateRef.current === 'recording' || stateRef.current === 'working') return;
    wakeCaptureRef.current = true;
    if (wakeWatchdogRef.current) clearTimeout(wakeWatchdogRef.current);
    wakeWatchdogRef.current = setTimeout(() => {
      if (stateRef.current === 'recording') void finish();
    }, 15000);
    void beginRecording();
  }, [beginRecording, finish]);

  // Release the mic on unmount so navigating away does not leave the browser's
  // recording indicator lit.
  useEffect(() => () => { void recorderRef.current?.stop(); }, []);

  return { micState, pushToTalkStart, pushToTalkStop, startWakeCapture };
}
