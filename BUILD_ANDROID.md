# Pick Game - Android Build Guide

## Prerequisites
- Node.js 18+
- Android Studio (with SDK 33+)
- Java 17+

## Quick Start (Browser Testing)
```bash
npm install
npm start
# Opens at http://localhost:3000
```

## Build Android APK

### 1. Install dependencies
```bash
npm install
```

### 2. Add Android platform
```bash
npm run android:init
```

### 3. Sync web assets to Android
```bash
npm run android:sync
```

### 4. Open in Android Studio
```bash
npm run android:open
```
Then click **Run** in Android Studio.

### 5. Or build APK from command line
```bash
npm run android:build
```
APK will be at: `android/app/build/outputs/apk/debug/app-debug.apk`

## Tech Stack
- **Rendering**: HTML5 Canvas 2D (hardware-accelerated, 60fps)
- **Language**: Vanilla JavaScript (zero framework overhead)
- **Audio**: Web Audio API (synthesized, no file downloads)
- **Haptics**: Capacitor Haptics + navigator.vibrate fallback
- **Android Wrapper**: Capacitor 6 (lightweight native bridge)

## Performance Notes
- Object pooling for particles and floating text (no GC pressure)
- requestAnimationFrame for locked 60fps rendering
- Canvas 2D with DPR-aware scaling (crisp on all screens)
- No DOM manipulation during gameplay (all Canvas-rendered)
- Touch events with passive:false to prevent scroll lag
