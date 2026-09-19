// voice.js - Voice Conversation Layer for CalenturaChat

let voiceActive = false;
let voiceWs = null;
let audioContext = null;
let mediaStream = null;
let microphone = null;
let scriptProcessor = null;
let analyser = null;

let isSpeaking = false;
let silenceTimer = null;
const SILENCE_THRESHOLD = 800; // ms of silence to detect end of speech
const VOLUME_THRESHOLD = 15; // out of 255

// States: IDLE, LISTENING, TRANSCRIBING, THINKING, SPEAKING, ERROR
let voiceState = 'IDLE';

// Playback
let playbackQueue = [];
let isPlaying = false;
let currentSource = null;

// UI Elements
const voiceOverlay = document.getElementById('voiceOverlay');
const voiceAvatar = document.getElementById('voiceAvatar');
const voiceStatusText = document.getElementById('voiceStatusText');
const voiceModeText = document.getElementById('voiceModeText');

function setVoiceState(state) {
    voiceState = state;
    voiceStatusText.textContent = state;
    
    // Update avatar classes
    voiceAvatar.className = 'voice-avatar';
    if (state === 'LISTENING') voiceAvatar.classList.add('listening');
    if (state === 'THINKING' || state === 'TRANSCRIBING') voiceAvatar.classList.add('thinking');
    if (state === 'SPEAKING') voiceAvatar.classList.add('speaking');
    if (state === 'ERROR') voiceAvatar.classList.add('error');
}

async function toggleVoiceMode() {
    if (voiceActive) {
        stopVoiceMode();
    } else {
        await startVoiceMode();
    }
}

async function startVoiceMode() {
    if (cfg.provider !== 'local') {
        alert('El modo de voz solo está disponible con el proveedor Local.');
        return;
    }
    
    try {
        voiceOverlay.style.display = 'flex';
        voiceModeText.textContent = 'Voz: ON';
        voiceActive = true;
        setVoiceState('IDLE');
        
        // 1. Connect WebSocket
        let wsUrl = cfg.localApiUrl.replace('http', 'ws').replace('/v1', '/client-voice');
        // Add auth token if needed: wsUrl += '?token=' + cfg.localKey;
        voiceWs = new WebSocket(wsUrl);
        
        voiceWs.binaryType = 'arraybuffer';
        
        voiceWs.onopen = () => {
            console.log('Voice WebSocket connected');
            initAudio();
        };
        
        voiceWs.onmessage = async (event) => {
            if (typeof event.data === 'string') {
                try {
                    const msg = JSON.parse(event.data);
                    handleVoiceMessage(msg);
                } catch (e) {
                    console.error('Invalid WS message', e);
                }
            } else {
                // Binary data (audio chunk from TTS)
                handleAudioChunk(event.data);
            }
        };
        
        voiceWs.onclose = () => {
            console.log('Voice WebSocket disconnected');
            if (voiceActive) {
                setVoiceState('ERROR');
                setTimeout(stopVoiceMode, 2000);
            }
        };
        
        voiceWs.onerror = (e) => {
            console.error('Voice WebSocket Error', e);
            setVoiceState('ERROR');
        };
        
    } catch (err) {
        console.error('Failed to start Voice Mode:', err);
        setVoiceState('ERROR');
        setTimeout(stopVoiceMode, 2000);
    }
}

function stopVoiceMode() {
    voiceActive = false;
    voiceOverlay.style.display = 'none';
    voiceModeText.textContent = 'Voz: OFF';
    
    if (voiceWs) {
        voiceWs.close();
        voiceWs = null;
    }
    
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
    
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    
    stopPlayback();
}

async function initAudio() {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        
        microphone = audioContext.createMediaStreamSource(mediaStream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        
        scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
        
        microphone.connect(analyser);
        analyser.connect(scriptProcessor);
        scriptProcessor.connect(audioContext.destination);
        
        scriptProcessor.onaudioprocess = (e) => {
            if (!voiceActive) return;
            
            const inputData = e.inputBuffer.getChannelData(0);
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(dataArray);
            
            // Calculate average volume
            let sum = 0;
            for(let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const volume = sum / dataArray.length;
            
            if (voiceState === 'IDLE' || voiceState === 'LISTENING') {
                if (volume > VOLUME_THRESHOLD) {
                    if (!isSpeaking) {
                        isSpeaking = true;
                        setVoiceState('LISTENING');
                        if (isPlaying) {
                            // Barge-in: User interrupted the AI
                            stopPlayback();
                            voiceWs.send(JSON.stringify({ type: 'voice.interrupt' }));
                        }
                        voiceWs.send(JSON.stringify({ type: 'voice.start' }));
                    }
                    clearTimeout(silenceTimer);
                    silenceTimer = null;
                    
                    // Send audio data
                    sendAudioData(inputData);
                } else if (isSpeaking) {
                    // Start silence timer
                    if (!silenceTimer) {
                        silenceTimer = setTimeout(() => {
                            isSpeaking = false;
                            setVoiceState('TRANSCRIBING');
                            voiceWs.send(JSON.stringify({ type: 'voice.end' }));
                        }, SILENCE_THRESHOLD);
                    }
                    // Send trailing silence
                    sendAudioData(inputData);
                }
            }
        };
        
    } catch (err) {
        console.error('Mic access denied:', err);
        setVoiceState('ERROR');
        setTimeout(stopVoiceMode, 2000);
    }
}

function sendAudioData(float32Array) {
    if (voiceWs && voiceWs.readyState === WebSocket.OPEN) {
        // Convert Float32 to Int16 PCM (16kHz mono)
        const int16 = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            let s = Math.max(-1, Math.min(1, float32Array[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        voiceWs.send(int16.buffer);
    }
}

function handleVoiceMessage(msg) {
    switch (msg.type) {
        case 'voice.transcript':
            setVoiceState('THINKING');
            break;
        case 'assistant.text':
            break;
        case 'assistant.speaking':
            if (voiceState !== 'SPEAKING') setVoiceState('SPEAKING');
            break;
        case 'assistant.done':
            if (!isPlaying && voiceState !== 'IDLE') {
                setVoiceState('IDLE');
            }
            break;
        case 'voice.error':
            console.error('Backend Voice Error:', msg.error);
            setVoiceState('ERROR');
            setTimeout(() => setVoiceState('IDLE'), 2000);
            break;
    }
}

// Playback logic
async function handleAudioChunk(arrayBuffer) {
    if (voiceState !== 'SPEAKING') {
        setVoiceState('SPEAKING');
    }
    
    try {
        // Piper typically returns raw PCM audio. But for the browser to decode it with decodeAudioData,
        // we'd need it wrapped in a WAV header. We will assume the backend adds a WAV header to chunks,
        // OR we can manually decode raw 22050Hz Float32/Int16.
        // For robustness, let's assume the backend wraps it in a WAV header.
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        playbackQueue.push(audioBuffer);
        if (!isPlaying) {
            playNextChunk();
        }
    } catch (e) {
        console.error('Error decoding audio chunk:', e);
    }
}

function playNextChunk() {
    if (playbackQueue.length === 0) {
        isPlaying = false;
        if (!isSpeaking) setVoiceState('IDLE');
        return;
    }
    
    isPlaying = true;
    const buffer = playbackQueue.shift();
    
    currentSource = audioContext.createBufferSource();
    currentSource.buffer = buffer;
    currentSource.connect(audioContext.destination);
    
    currentSource.onended = () => {
        currentSource = null;
        playNextChunk();
    };
    
    currentSource.start();
}

function stopPlayback() {
    if (currentSource) {
        currentSource.stop();
        currentSource = null;
    }
    playbackQueue = [];
    isPlaying = false;
}
