# GLP-1 Tracker

Compact React + Capacitor tracker for daily GLP-1-related metrics and weekly medication updates.

## Current scope

- Separate medication and daily metrics workflows
- Weekly heatmap with quick date selection
- Trend Explorer charts for medication level, weight, symptoms, and nutrition
- Local persistence with `localStorage`
- JSON import/export and CSV export
- iOS wrapper via Capacitor with App Store preflight checks

## Stack

- React 18
- Vite 5
- Recharts
- Capacitor 8

## Local development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## iOS

```bash
npm run ios:prep-store
npm run ios:open
```

## Beta baseline

This repository starts from the current beta version of the app, including the latest requirements docs aligned to the shipped behavior.
