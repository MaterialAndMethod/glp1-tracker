# Project Brief

This is a compact React GLP-1 tracker app focused on daily tracking and weekly medication updates.

## Features
- Daily tracking of weight, calories, protein, fiber, and fat
- Subjective metrics for nausea, food noise, and hunger on 0-10 scales
- Separate medication and daily-metrics pages with independent save actions
- Weekly heatmap for quick date navigation
- Trend Explorer with multiple chart views
- Medication projection logic
- `localStorage` persistence
- JSON export and import
- CSV export
- Native file picking and share support through Capacitor on iOS

## UI direction
- Dark navy background
- Purple primary actions
- Gold used sparingly for emphasis
- Compact layout optimized for quick daily use
- Single-column mobile-first layout sized for iPhone use
- Hamburger menu for page navigation and data actions
- Top-level page tabs for quick switching between core workflows

## Data model
Each date can store:
- Medication data
- Daily body metrics
- Nutrition metrics
- Subjective metrics

Medication updates and daily inputs can be saved separately into the same date record.

## Current chart set
- Medication Level with projection and running average
- Weight vs Medication Level
- Food Noise vs Medication Level
- Hunger vs Medication Level
- Nausea vs Medication Level
- Nutrition overlay for calories, protein, fat, and fiber

## Current non-goals
- No built-in AI coach workflow is currently shipped in the app
- No backend dependency is required for the current tracker experience
