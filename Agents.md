# AGENTS.md

## Project
GLP-1 Tracker React app for daily tracking and weekly medication updates.

## Main goals
- Keep the app compact and easy to use daily
- Preserve the current dark navy / purple theme
- Do not remove existing working features unless explicitly asked
- Prefer small, targeted changes over major rewrites

## Key workflow rules
- Medication updates happen about every 7 days
- Daily metrics are entered every day
- Medication updates live on their own page with a separate save button
- Daily inputs have their own save button
- The app stores tracker data in `localStorage`
- The app supports JSON export, JSON import, and CSV export
- Native builds use Capacitor file/share flows where available
- Web and native behavior should stay aligned unless platform-specific file handling requires a small difference

## Current defaults
- Default medication: Wegovy
- Default dosage: 0.25 mg
- App starts in dark mode
- Default shot location: Left thigh
- App opens on the Medication Update page

## Chart rules
- Trend Explorer is the main chart area
- Date range controls should only appear on Medication Level
- Nausea, Food Noise, and Hunger charts must use a fixed 0-10 Y axis
- Medication comparison charts use dual Y axes where medication level is paired with another metric
- Medication Level chart uses projection + running average
- Weight vs Medication Level keeps weight on the left axis and medication on the right axis
- Nutrition chart shows calories on one axis and protein, fat, and fiber on the other axis

## Do not break
- Weekly heatmap with Today button and offset slider
- Sticky medication defaults
- `localStorage` persistence and refresh workflow
- Save/load/export file workflows from the hamburger menu
- Hamburger menu actions
- Insights card with weight rate, estimated deficit, next dose, and status text
- Editing banner and tap-to-edit behavior from charts and heatmap
- Page tabs for Medication Update, Nutrition & Metrics, and Charts

## Editing preference
- Make minimal edits
- Keep JSX compile-safe
- Avoid partial patches that can leave broken tags
- When changing chart logic, preserve current UX unless explicitly told otherwise
- Keep inline styles/theme tokens consistent with the current single-file app unless there is a clear reason to extract them

## Done when
- App compiles
- No JSX syntax errors
- Existing features still work
- Requested change is visible in UI
- File import/export still works on web
- Native-safe file handling remains intact
