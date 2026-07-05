import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import {
  useAudioRecorder,
  RecordingPresets,
  useAudioPlayer,
  useAudioPlayerStatus,
  requestRecordingPermissionsAsync,
  setAudioModeAsync
} from 'expo-audio';
import { FontAwesome5, Ionicons } from '@expo/vector-icons';

type RecorderState = 'idle' | 'recording' | 'reviewing';

export const VoiceIntroRecorder = ({ onUploadSuccess }: { onUploadSuccess?: (audioUrl: string) => void }) => {
  const [recorderState, setRecorderState] = useState<RecorderState>('idle');
  const [durationMillis, setDurationMillis] = useState(0);

  const MAX_DURATION_MS = 15000; // 15 seconds

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY, (status: any) => {
    setDurationMillis(status.durationMillis || status.currentTime || 0);
    if ((status.durationMillis || status.currentTime || 0) >= MAX_DURATION_MS && recorderState === 'recording') {
      stopRecording();
    }
  });

  const [audioUri, setAudioUri] = useState<string | null>(null);
  const player = useAudioPlayer(audioUri);
  const playerStatus = useAudioPlayerStatus(player);
  const isPlaying = playerStatus.playing;
  const playbackPosition = playerStatus.currentTime * 1000;

  const startRecording = async () => {
    try {
      console.log('Requesting permissions..');
      await requestRecordingPermissionsAsync();
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      console.log('Starting recording..');
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecorderState('recording');
      setDurationMillis(0);
    } catch (err) {
      console.error('Failed to start recording', err);
    }
  };

  const stopRecording = async () => {
    if (recorderState !== 'recording') return;
    console.log('Stopping recording..');
    
    setRecorderState('reviewing');
    await recorder.stop();
    await setAudioModeAsync({
      allowsRecording: false,
    });
    
    const uri = recorder.uri;
    console.log('Recording stopped and stored at', uri);
    
    if (uri) {
      setAudioUri(uri);
    }
  };

  const togglePlayback = () => {
    if (isPlaying) {
      player.pause();
    } else {
      if (playerStatus.currentTime >= playerStatus.duration) {
        player.seekTo(0);
      }
      player.play();
    }
  };

  const resetRecording = () => {
    setAudioUri(null);
    setRecorderState('idle');
    setDurationMillis(0);
  };

  const uploadRecording = async () => {
    if (!audioUri) return;

    try {
      console.log('Uploading audio intro...');
      // To be wired to backend/app.py /api/v1/host/upload-intro
      const formData = new FormData();
      formData.append('audio', {
        uri: audioUri,
        name: 'intro.m4a',
        type: 'audio/m4a',
      } as any);

      const response = await fetch('https://batboy-glider-sanitary.ngrok-free.dev/api/v1/host/upload-intro', {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const result = await response.json();
      console.log('Upload success:', result);
      if (onUploadSuccess) {
        onUploadSuccess(result.url);
      }
    } catch (error) {
      console.error('Error uploading intro:', error);
      alert('Failed to upload intro. Please try again.');
    }
  };

  const formatTime = (millis: number) => {
    const totalSeconds = Math.floor(millis / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Voice Intro</Text>
      
      {recorderState === 'idle' && (
        <View style={styles.stateContainer}>
          <Text style={styles.prompt}>Tap mic to record your 15-second intro.</Text>
          <TouchableOpacity style={styles.micButton} onPress={startRecording}>
            <FontAwesome5 name="microphone" size={32} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {recorderState === 'recording' && (
        <View style={styles.stateContainer}>
          <Text style={styles.timer}>{formatTime(durationMillis)} / 0:15</Text>
          <View style={styles.pulsingRing}>
            <TouchableOpacity style={styles.stopButton} onPress={stopRecording}>
              <View style={styles.stopIcon} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {recorderState === 'reviewing' && (
        <View style={styles.stateContainer}>
          <View style={styles.scrubberContainer}>
            <TouchableOpacity onPress={togglePlayback} style={styles.playButton}>
              <Ionicons name={isPlaying ? "pause" : "play"} size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.progressBarBackground}>
              <View 
                style={[
                  styles.progressBarFill, 
                  { width: `${durationMillis > 0 ? (playbackPosition / durationMillis) * 100 : 0}%` }
                ]} 
              />
            </View>
            <Text style={styles.timeText}>{formatTime(playbackPosition)}</Text>
          </View>
          
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.secondaryButton} onPress={resetRecording}>
              <Text style={styles.secondaryButtonText}>Re-record</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={uploadRecording}>
              <Text style={styles.primaryButtonText}>Confirm & Upload</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1E1E1E',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  stateContainer: {
    alignItems: 'center',
    width: '100%',
  },
  prompt: {
    color: '#A0A0A0',
    fontSize: 16,
    marginBottom: 24,
    textAlign: 'center',
  },
  micButton: {
    backgroundColor: '#FF3B30',
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 15,
    elevation: 8,
  },
  stopButton: {
    backgroundColor: '#FF3B30',
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stopIcon: {
    backgroundColor: '#fff',
    width: 24,
    height: 24,
    borderRadius: 4,
  },
  pulsingRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255, 59, 48, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  timer: {
    color: '#FF3B30',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    fontVariant: ['tabular-nums'],
  },
  scrubberContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: '#2A2A2A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 24,
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  progressBarBackground: {
    flex: 1,
    height: 6,
    backgroundColor: '#404040',
    borderRadius: 3,
    marginRight: 12,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#007AFF',
  },
  timeText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: '#333333',
    borderRadius: 8,
    marginRight: 8,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
  primaryButton: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: '#007AFF',
    borderRadius: 8,
    marginLeft: 8,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
});
