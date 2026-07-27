import wave, struct, math

sample_rate = 44100
duration = 1.0 # seconds
freq = 800 # Hz

obj = wave.open('assets/sounds/ring.wav', 'w')
obj.setnchannels(1)
obj.setsampwidth(2)
obj.setframerate(sample_rate)

for i in range(int(sample_rate * duration)):
    # Create a pulsing ringtone effect
    volume = math.sin(2 * math.pi * 5 * i / sample_rate) > 0
    if volume:
        value = int(32767.0 * 0.5 * math.sin(2 * math.pi * freq * i / sample_rate))
    else:
        value = 0
    data = struct.pack('<h', value)
    obj.writeframesraw(data)

obj.close()
print("Ringtone generated at assets/sounds/ring.wav")
